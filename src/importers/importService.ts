import { openDatabase } from "../db/connection";
import { runMigrations } from "../db/migrations";
import { CustomerRepository } from "../db/repositories/customerRepository";
import { PendingChangeRepository } from "../db/repositories/pendingChangeRepository";
import { PolicyRepository } from "../db/repositories/policyRepository";
import { ReminderRepository } from "../db/repositories/reminderRepository";
import { matchCustomerIdentity } from "../domain/matching";
import { generateBirthdayReminder } from "../domain/reminders/birthdayReminder";
import { generatePolicyRenewalReminders } from "../domain/reminders/policyRenewalReminder";
import type {
  Customer,
  KeyFieldChange,
  PendingConfirmation,
  Policy,
  Reminder,
} from "../domain/types";
import { importCustomerInfoWorkbook } from "./customerInfoImporter";
import { importPolicyPerformanceWorkbook } from "./policyPerformanceImporter";

interface ImportInput {
  customerWorkbookPath?: string;
  policyWorkbookPath?: string;
  today: string;
  dbPath: string;
}

interface ImportSummary {
  importedCustomers: number;
  importedPolicies: number;
  persistedCustomers: number;
  persistedPolicies: number;
  generatedReminders: number;
  pendingConfirmations: number;
}

function hasValue(value: unknown): value is string | number {
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  return typeof value === "string" && value.trim().length > 0;
}

function sameValue(current: string | number, incoming: string | number): boolean {
  return typeof current === "number" || typeof incoming === "number"
    ? Number(current) === Number(incoming)
    : current.trim() === incoming.trim();
}

function collectChangedFields<T extends object>(
  existing: T,
  incoming: T,
  fields: Array<{ field: keyof T & string; label: string }>,
): KeyFieldChange[] {
  return fields.flatMap(({ field, label }) => {
    const currentValue = existing[field];
    const incomingValue = incoming[field];
    if (!hasValue(currentValue) || !hasValue(incomingValue) || sameValue(currentValue, incomingValue)) {
      return [];
    }
    return [{ field, label, current: currentValue, incoming: incomingValue }];
  });
}

export function detectCustomerKeyFieldChanges(
  existing: Customer,
  incoming: Customer,
): KeyFieldChange[] {
  return collectChangedFields(existing, incoming, [
    { field: "birthDate", label: "出生日期" },
    { field: "phone", label: "手机号" },
  ]);
}

export function detectPolicyKeyFieldChanges(
  existing: Policy,
  incoming: Policy,
): KeyFieldChange[] {
  return collectChangedFields(existing, incoming, [
    { field: "productName", label: "产品名称" },
    { field: "insurerName", label: "保险公司" },
    { field: "premium", label: "保费" },
    { field: "paymentMethod", label: "缴费方式" },
    { field: "paymentPeriodRaw", label: "缴费期间" },
    { field: "effectiveDate", label: "生效日期" },
  ]);
}

function makeKeyFieldChangePending(input: {
  entityType: "customer" | "policy";
  entityId: string;
  entityName: string;
  changes: KeyFieldChange[];
}): PendingConfirmation {
  const fieldNames = input.changes.map((change) => change.label).join("、");
  return {
    id: `pending:key_field_changed:${input.entityType}:${input.entityId}`,
    reason: "key_field_changed",
    title: `${input.entityName} 的关键字段变化需确认`,
    detail: `再次导入时发现 ${fieldNames} 与当前记录不一致，已保留原数据，确认后再更新。`,
    payload: {
      entityType: input.entityType,
      [`${input.entityType}Id`]: input.entityId,
      entityName: input.entityName,
      changes: input.changes,
    },
  };
}

function storeGeneratedResult(
  result: Reminder | PendingConfirmation,
  reminders: ReminderRepository,
  pending: PendingChangeRepository,
  activeReminderIds?: Set<string>,
  activePendingIds?: Set<string>,
): number {
  if ("reminderDate" in result) {
    reminders.upsertGenerated(result);
    activeReminderIds?.add(result.id);
    return 1;
  }

  pending.create(result);
  activePendingIds?.add(result.id);
  return 0;
}

function findMatchingCustomer(
  customers: Customer[],
  name: string,
  idNumber?: string,
): Customer | undefined {
  return customers.find((customer) => {
    const match = matchCustomerIdentity(
      { name: customer.name, idNumber: customer.fullIdNumber ?? customer.maskedIdNumber },
      { name, idNumber },
    );
    return match.matched;
  });
}

function linkPolicyCustomers(policy: Policy, customers: Customer[]): Policy {
  const applicant = findMatchingCustomer(
    customers,
    policy.applicantName,
    policy.applicantMaskedIdNumber,
  );
  const insured = findMatchingCustomer(
    customers,
    policy.insuredName,
    policy.insuredMaskedIdNumber,
  );

  return {
    ...policy,
    applicantCustomerId: applicant?.id,
    insuredCustomerId: insured?.id,
  };
}

export async function importWorkbooks(input: ImportInput): Promise<ImportSummary> {
  const db = openDatabase(input.dbPath);
  runMigrations(db);

  const customers = new CustomerRepository(db);
  const policies = new PolicyRepository(db);
  const reminders = new ReminderRepository(db);
  const pending = new PendingChangeRepository(db);

  let importedCustomers = 0;
  let importedPolicies = 0;
  let generatedReminders = 0;
  const activeReminderIds = new Set<string>();
  const activePendingIds = new Set<string>();
  const importedReminderGroups = new Set<Reminder["group"]>();

  try {
    if (input.customerWorkbookPath) {
      importedReminderGroups.add("birthday");
      const result = await importCustomerInfoWorkbook(input.customerWorkbookPath);
      result.confirmations.forEach((item) => {
        pending.create(item);
        activePendingIds.add(item.id);
      });
      for (const customer of result.customers) {
        const existingCustomer = customers.findByBusinessKey(customer.id);
        const keyFieldChanges = existingCustomer
          ? detectCustomerKeyFieldChanges(existingCustomer, customer)
          : [];
        if (keyFieldChanges.length > 0) {
          pending.create(
            makeKeyFieldChangePending({
              entityType: "customer",
              entityId: customer.id,
              entityName: customer.name,
              changes: keyFieldChanges,
            }),
          );
          activePendingIds.add(`pending:key_field_changed:customer:${customer.id}`);
        } else {
          customers.upsertFromImport(customer);
          generatedReminders += storeGeneratedResult(
            generateBirthdayReminder(customer, input.today),
            reminders,
            pending,
            activeReminderIds,
            activePendingIds,
          );
        }
        importedCustomers += 1;
      }
    }

    if (input.policyWorkbookPath) {
      importedReminderGroups.add("policy_renewal");
      const result = await importPolicyPerformanceWorkbook(input.policyWorkbookPath);
      result.confirmations.forEach((item) => {
        pending.create(item);
        activePendingIds.add(item.id);
      });
      const customerPool = customers.list();
      for (const policy of result.policies) {
        const linkedPolicy = linkPolicyCustomers(policy, customerPool);
        const existingPolicy = policies.findByBusinessKey(linkedPolicy.id);
        const keyFieldChanges = existingPolicy
          ? detectPolicyKeyFieldChanges(existingPolicy, linkedPolicy)
          : [];
        const activePolicy = keyFieldChanges.length > 0 && existingPolicy ? existingPolicy : linkedPolicy;
        if (keyFieldChanges.length > 0) {
          pending.create(
            makeKeyFieldChangePending({
              entityType: "policy",
              entityId: linkedPolicy.id,
              entityName: `${linkedPolicy.insuredName} - ${linkedPolicy.productName}`,
              changes: keyFieldChanges,
            }),
          );
          activePendingIds.add(`pending:key_field_changed:policy:${linkedPolicy.id}`);
        } else {
          policies.upsertFromImport(linkedPolicy);
        }
        importedPolicies += 1;

        const insuredCustomer = activePolicy.insuredCustomerId
          ? customerPool.find((customer) => customer.id === activePolicy.insuredCustomerId)
          : undefined;
        const renewalResult = generatePolicyRenewalReminders(activePolicy, input.today, {
          insuredBirthDate: insuredCustomer?.birthDate,
        });
        renewalResult.confirmations.forEach((item) => {
          pending.create(item);
          activePendingIds.add(item.id);
        });
        for (const reminder of renewalResult.reminders) {
          reminders.upsertGenerated(reminder);
          activeReminderIds.add(reminder.id);
          generatedReminders += 1;
        }
      }
    }

    if (importedReminderGroups.size > 0) {
      reminders.deleteStaleGenerated(activeReminderIds, [...importedReminderGroups]);
      if (input.customerWorkbookPath && input.policyWorkbookPath) {
        pending.resolveStaleOpen(
          activePendingIds,
          "自动关闭：本次导入未再发现该待确认问题。",
        );
      }
    }

    return {
      importedCustomers,
      importedPolicies,
      persistedCustomers: customers.list().length,
      persistedPolicies: policies.list().length,
      generatedReminders: reminders.countGenerated(),
      pendingConfirmations: pending.list().length,
    };
  } finally {
    db.close();
  }
}
