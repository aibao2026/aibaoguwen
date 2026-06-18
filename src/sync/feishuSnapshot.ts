import { openDatabase } from "../db/connection";
import { runMigrations } from "../db/migrations";
import { CustomerRepository } from "../db/repositories/customerRepository";
import { PolicyRepository } from "../db/repositories/policyRepository";
import { ReminderRepository } from "../db/repositories/reminderRepository";
import { getPolicyRenewalSchedule } from "../domain/reminders/policyRenewalReminder";
import type { Customer, Policy, Reminder } from "../domain/types";

export interface FeishuCustomerRow {
  externalId: string;
  name: string;
  maskedIdNumber?: string;
  maskedPhone?: string;
  birthDate?: string;
}

export interface FeishuPolicyRow {
  externalId: string;
  policyNumber?: string;
  applicantName: string;
  insuredName: string;
  productName: string;
  insurerName?: string;
  premium?: number;
  paymentMethod?: string;
  paymentPeriodRaw?: string;
  effectiveDate?: string;
  applicantCustomerExternalId?: string;
  insuredCustomerExternalId?: string;
  nextRenewalDate?: string;
  finalPaymentYear?: number;
}

export interface FeishuReminderRow {
  externalId: string;
  group: Reminder["group"];
  title: string;
  reminderDate: string;
  status: Reminder["status"];
  isKey: boolean;
  customerExternalId?: string;
  policyExternalId?: string;
  source: Reminder["source"];
}

export interface FeishuSyncSnapshot {
  customers: FeishuCustomerRow[];
  policies: FeishuPolicyRow[];
  reminders: FeishuReminderRow[];
  summary: {
    customers: number;
    policies: number;
    reminders: number;
    keyCalendarReminders: number;
  };
}

export function maskIdNumber(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  if (value.includes("*")) {
    return value;
  }
  if (value.length <= 8) {
    return value;
  }
  return `${value.slice(0, 4)}${"*".repeat(Math.max(4, value.length - 8))}${value.slice(-4)}`;
}

export function maskPhone(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  if (value.includes("*")) {
    return value;
  }
  if (value.length < 7) {
    return value;
  }
  return `${value.slice(0, 3)}****${value.slice(-4)}`;
}

function customerRow(customer: Customer): FeishuCustomerRow {
  return {
    externalId: customer.id,
    name: customer.name,
    maskedIdNumber: maskIdNumber(customer.fullIdNumber ?? customer.maskedIdNumber),
    maskedPhone: maskPhone(customer.phone),
    birthDate: customer.birthDate,
  };
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function policyRenewalSummary(input: {
  policy: Policy;
  insuredBirthDate?: string;
  today: string;
}) {
  const schedule = getPolicyRenewalSchedule(input.policy, input.today, {
    insuredBirthDate: input.insuredBirthDate,
  });
  if ("reason" in schedule) {
    return {};
  }
  return {
    nextRenewalDate: schedule.nextRenewalDate,
    finalPaymentYear: schedule.finalPaymentYear,
  };
}

function policyRow(policy: Policy, customersById: Map<string, Customer>, today: string): FeishuPolicyRow {
  return {
    externalId: policy.id,
    policyNumber: policy.policyNumber,
    applicantName: policy.applicantName,
    insuredName: policy.insuredName,
    productName: policy.productName,
    insurerName: policy.insurerName,
    premium: policy.premium,
    paymentMethod: policy.paymentMethod,
    paymentPeriodRaw: policy.paymentPeriodRaw,
    effectiveDate: policy.effectiveDate,
    applicantCustomerExternalId: policy.applicantCustomerId,
    insuredCustomerExternalId: policy.insuredCustomerId,
    ...policyRenewalSummary({
      policy,
      insuredBirthDate: policy.insuredCustomerId
        ? customersById.get(policy.insuredCustomerId)?.birthDate
        : undefined,
      today,
    }),
  };
}

function reminderRow(reminder: Reminder): FeishuReminderRow {
  return {
    externalId: reminder.id,
    group: reminder.group,
    title: reminder.title,
    reminderDate: reminder.reminderDate,
    status: reminder.status,
    isKey: reminder.isKey,
    customerExternalId: reminder.customerId,
    policyExternalId: reminder.policyId,
    source: reminder.source,
  };
}

export function buildFeishuSyncSnapshot(
  dbPath: string,
  options: { today?: string } = {},
): FeishuSyncSnapshot {
  const db = openDatabase(dbPath);
  runMigrations(db);
  try {
    const localCustomers = new CustomerRepository(db).list();
    const customersById = new Map(localCustomers.map((customer) => [customer.id, customer]));
    const today = options.today ?? todayIso();
    const customers = localCustomers.map(customerRow);
    const policies = new PolicyRepository(db)
      .list()
      .map((policy) => policyRow(policy, customersById, today));
    const reminders = new ReminderRepository(db).list().map(reminderRow);
    return {
      customers,
      policies,
      reminders,
      summary: {
        customers: customers.length,
        policies: policies.length,
        reminders: reminders.length,
        keyCalendarReminders: reminders.filter(
          (item) => item.isKey && item.status === "pending",
        ).length,
      },
    };
  } finally {
    db.close();
  }
}
