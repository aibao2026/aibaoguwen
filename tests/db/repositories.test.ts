import { describe, expect, it } from "vitest";
import { openDatabase } from "../../src/db/connection";
import { runMigrations } from "../../src/db/migrations";
import { CustomerRepository } from "../../src/db/repositories/customerRepository";
import { PendingChangeRepository } from "../../src/db/repositories/pendingChangeRepository";
import { PolicyRepository } from "../../src/db/repositories/policyRepository";
import { ReminderRepository } from "../../src/db/repositories/reminderRepository";
import { makeCustomerBusinessKey } from "../../src/domain/ids";
import type { Customer, Policy, Reminder } from "../../src/domain/types";

function setup() {
  const db = openDatabase(":memory:");
  runMigrations(db);
  return {
    db,
    customers: new CustomerRepository(db),
    policies: new PolicyRepository(db),
    reminders: new ReminderRepository(db),
    pending: new PendingChangeRepository(db),
  };
}

describe("repositories", () => {
  it("migrates legacy customer business keys and references to opaque ids", () => {
    const db = openDatabase(":memory:");
    runMigrations(db);
    const oldCustomerId = "customer:张三:110101199001010010";
    const nextCustomerId = makeCustomerBusinessKey({
      name: "张三",
      idNumber: "110101199001010010",
    });
    db.prepare(
      `
      INSERT INTO customers (id, name, full_id_number, phone, birth_date)
      VALUES (?, '张三', '110101199001010010', '13800000000', '1990-01-01')
    `,
    ).run(oldCustomerId);
    db.prepare(
      `
      INSERT INTO policies (
        id, policy_number, applicant_customer_id, insured_customer_id,
        applicant_name, insured_name, product_name
      )
      VALUES (
        'policy:abc',
        'abc',
        ?,
        ?,
        '张三',
        '张三',
        '测试产品'
      )
    `,
    ).run(oldCustomerId, oldCustomerId);
    db.prepare(
      `
      INSERT INTO reminders (
        id, group_name, title, reminder_date, status, is_key, customer_id, source
      )
      VALUES (
        ?,
        'birthday',
        '生日提醒：张三',
        '2026-01-01',
        'pending',
        0,
        ?,
        'birthday_import'
      )
    `,
    ).run(
      `reminder:birthday:2026-01-01:${oldCustomerId}:unknown:生日提醒：张三`,
      oldCustomerId,
    );
    db.prepare(
      `
      INSERT INTO pending_confirmations (id, reason, title, detail, payload_json)
      VALUES (?, 'missing_required_field', '旧客户', '旧客户', ?)
    `,
    ).run(
      `pending:birthday:${oldCustomerId}`,
      JSON.stringify({ customerId: oldCustomerId }),
    );
    db.prepare("INSERT INTO sync_state (key, value) VALUES (?, ?)").run(
      `feishu:test:客户:${oldCustomerId}`,
      "rec_customer",
    );

    runMigrations(db);

    const customer = db.prepare("SELECT id FROM customers").get() as { id: string };
    const policy = db
      .prepare("SELECT applicant_customer_id, insured_customer_id FROM policies")
      .get() as { applicant_customer_id: string; insured_customer_id: string };
    const reminder = db.prepare("SELECT id, customer_id FROM reminders").get() as {
      id: string;
      customer_id: string;
    };
    const pending = db.prepare("SELECT id, payload_json FROM pending_confirmations").get() as {
      id: string;
      payload_json: string;
    };
    const syncState = db.prepare("SELECT key, value FROM sync_state").get() as {
      key: string;
      value: string;
    };

    expect(customer.id).toBe(nextCustomerId);
    expect(policy).toEqual({
      applicant_customer_id: nextCustomerId,
      insured_customer_id: nextCustomerId,
    });
    expect(reminder.customer_id).toBe(nextCustomerId);
    expect(reminder.id).toContain(nextCustomerId);
    expect(reminder.id).not.toContain("110101199001010010");
    expect(pending.id).toContain(nextCustomerId);
    expect(pending.payload_json).toContain(nextCustomerId);
    expect(pending.payload_json).not.toContain("110101199001010010");
    expect(syncState).toEqual({
      key: `feishu:test:客户:${nextCustomerId}`,
      value: "rec_customer",
    });
    expect(nextCustomerId).toMatch(/^customer:[a-f0-9]{16}$/);
    db.close();
  });

  it("migrates legacy policy-number-only business keys and references", () => {
    const db = openDatabase(":memory:");
    runMigrations(db);
    db.prepare(
      `
      INSERT INTO policies (
        id, policy_number, applicant_name, insured_name, product_name, payment_period_raw, effective_date
      )
      VALUES (
        'policy:TEST-POLICY-0200',
        'TEST-POLICY-0200',
        '测试客户0200',
        '测试家属0200',
        '示例长期医疗计划',
        '1年',
        '2025-09-15'
      )
    `,
    ).run();
    db.prepare(
      `
      INSERT INTO reminders (
        id, group_name, title, reminder_date, status, is_key, policy_id, source
      )
      VALUES (
        'reminder:policy_renewal:2026-09-15:unknown:policy:TEST-POLICY-0200:续期提醒：测试家属0200',
        'policy_renewal',
        '续期提醒：测试家属0200',
        '2026-09-15',
        'pending',
        0,
        'policy:TEST-POLICY-0200',
        'policy_import'
      )
    `,
    ).run();
    db.prepare(
      `
      INSERT INTO pending_confirmations (id, reason, title, detail, payload_json)
      VALUES (
        'pending:legacy',
        'key_field_changed',
        '旧保单',
        '旧保单',
        '{"policyId":"policy:TEST-POLICY-0200"}'
      )
    `,
    ).run();
    db.prepare("INSERT INTO sync_state (key, value) VALUES (?, ?)").run(
      "feishu:test:保单:policy:TEST-POLICY-0200",
      "rec_policy",
    );

    runMigrations(db);

    const nextPolicyId =
      "policy:TEST-POLICY-0200:测试家属0200:示例长期医疗计划";
    const policy = db.prepare("SELECT id FROM policies").get() as { id: string };
    const reminder = db.prepare("SELECT id, policy_id FROM reminders").get() as {
      id: string;
      policy_id: string;
    };
    const pending = db.prepare("SELECT payload_json FROM pending_confirmations").get() as {
      payload_json: string;
    };
    const syncState = db.prepare("SELECT key, value FROM sync_state").get() as {
      key: string;
      value: string;
    };

    expect(policy.id).toBe(nextPolicyId);
    expect(reminder.policy_id).toBe(nextPolicyId);
    expect(reminder.id).toContain(nextPolicyId);
    expect(pending.payload_json).toContain(nextPolicyId);
    expect(syncState).toEqual({
      key: `feishu:test:保单:${nextPolicyId}`,
      value: "rec_policy",
    });
    db.close();
  });

  it("upserts customers by business key", () => {
    const { customers } = setup();
    const customerId = makeCustomerBusinessKey({
      name: "张三",
      idNumber: "110101199001010010",
    });
    const customer: Customer = {
      id: customerId,
      name: "张三",
      fullIdNumber: "110101199001010010",
    };

    customers.upsertFromImport(customer);
    customers.upsertFromImport({ ...customer, phone: "13800000000" });

    expect(customers.list()).toHaveLength(1);
    expect(customers.findByBusinessKey(customer.id)?.phone).toBe("13800000000");
  });

  it("upserts policies by business key", () => {
    const { policies } = setup();
    const policy: Policy = {
      id: "policy:abc",
      policyNumber: "abc",
      applicantName: "张三",
      insuredName: "张三",
      productName: "测试产品",
      paymentPeriodRaw: "10年",
      effectiveDate: "2023-08-01",
    };

    policies.upsertFromImport(policy);
    policies.upsertFromImport({ ...policy, premium: 1000 });

    expect(policies.list()).toHaveLength(1);
    expect(policies.findByBusinessKey(policy.id)?.premium).toBe(1000);
  });

  it("upserts reminders by business key", () => {
    const { reminders } = setup();
    const reminder: Reminder = {
      id: "reminder:abc",
      group: "birthday",
      title: "生日提醒：张三",
      reminderDate: "2026-08-01",
      status: "pending",
      isKey: false,
      customerId: "customer:abc",
      source: "birthday_import",
    };

    reminders.upsertGenerated(reminder);
    reminders.upsertGenerated({ ...reminder, title: "生日提醒：张三" });

    expect(reminders.list()).toHaveLength(1);
  });

  it("keeps completed reminder completed when same generated reminder is re-imported", () => {
    const { reminders } = setup();
    const reminder: Reminder = {
      id: "reminder:abc",
      group: "birthday",
      title: "生日提醒：张三",
      reminderDate: "2026-08-01",
      status: "pending",
      isKey: false,
      customerId: "customer:abc",
      source: "birthday_import",
    };

    reminders.upsertGenerated(reminder);
    reminders.markCompleted(reminder.id);
    reminders.upsertGenerated(reminder);

    expect(reminders.findByBusinessKey(reminder.id)?.status).toBe("completed");
  });

  it("marks all pending reminders for one date as completed", () => {
    const { reminders } = setup();
    const baseReminder: Reminder = {
      id: "reminder:date-1",
      group: "birthday",
      title: "生日提醒：张三",
      reminderDate: "2026-06-18",
      status: "pending",
      isKey: false,
      customerId: "customer:abc",
      source: "birthday_import",
    };

    reminders.upsertGenerated(baseReminder);
    reminders.upsertGenerated({ ...baseReminder, id: "reminder:date-2", title: "生日提醒：李四" });
    reminders.upsertGenerated({
      ...baseReminder,
      id: "reminder:date-3",
      title: "生日提醒：王五",
      reminderDate: "2026-06-19",
    });

    expect(reminders.markCompletedByDate("2026-06-18")).toBe(2);
    expect(reminders.findByBusinessKey("reminder:date-1")?.status).toBe("completed");
    expect(reminders.findByBusinessKey("reminder:date-2")?.status).toBe("completed");
    expect(reminders.findByBusinessKey("reminder:date-3")?.status).toBe("pending");
  });

  it("deletes stale generated reminders without removing manual todos", () => {
    const { reminders } = setup();
    const currentReminder: Reminder = {
      id: "reminder:current",
      group: "birthday",
      title: "生日提醒：张三",
      reminderDate: "2026-08-01",
      status: "pending",
      isKey: false,
      customerId: "customer:current",
      source: "birthday_import",
    };
    const staleReminder: Reminder = {
      ...currentReminder,
      id: "reminder:stale",
      customerId: "customer:stale",
    };
    const manualReminder: Reminder = {
      id: "reminder:manual",
      group: "manual_todo",
      title: "联系客户",
      reminderDate: "2026-08-01",
      status: "pending",
      isKey: false,
      source: "manual",
    };

    reminders.upsertGenerated(currentReminder);
    reminders.upsertGenerated(staleReminder);
    reminders.createManual(manualReminder);

    expect(reminders.deleteStaleGenerated(new Set([currentReminder.id]), ["birthday"])).toBe(1);
    expect(reminders.findByBusinessKey(currentReminder.id)).toBeDefined();
    expect(reminders.findByBusinessKey(staleReminder.id)).toBeUndefined();
    expect(reminders.findByBusinessKey(manualReminder.id)).toBeDefined();
  });

  it("deletes only manual reminders", () => {
    const { reminders } = setup();
    const manualReminder: Reminder = {
      id: "reminder:manual",
      group: "manual_todo",
      title: "联系客户",
      reminderDate: "2026-08-01",
      status: "pending",
      isKey: false,
      source: "manual",
    };
    const generatedReminder: Reminder = {
      id: "reminder:birthday",
      group: "birthday",
      title: "生日提醒：张三",
      reminderDate: "2026-08-01",
      status: "pending",
      isKey: false,
      customerId: "customer:abc",
      source: "birthday_import",
    };

    reminders.createManual(manualReminder);
    reminders.upsertGenerated(generatedReminder);

    expect(reminders.deleteManual(generatedReminder.id)).toBe(false);
    expect(reminders.deleteManual(manualReminder.id)).toBe(true);
    expect(reminders.findByBusinessKey(manualReminder.id)).toBeUndefined();
    expect(reminders.findByBusinessKey(generatedReminder.id)).toBeDefined();
  });

  it("resolves stale open pending confirmations while preserving current ones", () => {
    const { pending } = setup();
    pending.create({
      id: "pending:current",
      reason: "missing_required_field",
      title: "当前问题",
      detail: "当前问题",
      payload: {},
    });
    pending.create({
      id: "pending:stale",
      reason: "unsupported_payment_period",
      title: "旧问题",
      detail: "旧问题",
      payload: {},
    });

    expect(pending.resolveStaleOpen(new Set(["pending:current"]), "自动关闭")).toBe(1);
    expect(pending.findById("pending:current")?.status).toBe("open");
    expect(pending.findById("pending:stale")?.status).toBe("resolved");
    expect(pending.findById("pending:stale")?.resolutionNote).toBe("自动关闭");
  });

  it("updates manual reminders and can reopen completed reminders", () => {
    const { reminders } = setup();
    const manualReminder: Reminder = {
      id: "reminder:manual",
      group: "manual_todo",
      title: "联系客户",
      reminderDate: "2026-08-01",
      status: "pending",
      isKey: false,
      source: "manual",
    };
    const generatedReminder: Reminder = {
      id: "reminder:birthday",
      group: "birthday",
      title: "生日提醒：张三",
      reminderDate: "2026-08-01",
      status: "pending",
      isKey: false,
      customerId: "customer:abc",
      source: "birthday_import",
    };

    reminders.createManual(manualReminder);
    reminders.upsertGenerated(generatedReminder);

    expect(
      reminders.updateManual(manualReminder.id, {
        title: "联系客户确认缴费",
        reminderDate: "2026-08-03",
        isKey: true,
      }),
    ).toMatchObject({
      title: "联系客户确认缴费",
      reminderDate: "2026-08-03",
      isKey: true,
    });
    expect(
      reminders.updateManual(generatedReminder.id, {
        title: "不应更新",
        reminderDate: "2026-08-04",
        isKey: true,
      }),
    ).toBeUndefined();

    reminders.markCompleted(generatedReminder.id);
    reminders.markPending(generatedReminder.id);

    expect(reminders.findByBusinessKey(generatedReminder.id)?.status).toBe("pending");
  });

  it("stores pending confirmations", () => {
    const { pending } = setup();

    pending.create({
      id: "pending:abc",
      reason: "key_field_changed",
      title: "字段变化需确认",
      detail: "续期日期变化",
      payload: { oldValue: "2026-08-01", newValue: "2026-08-02" },
    });

    expect(pending.list()[0]).toMatchObject({
      id: "pending:abc",
      reason: "key_field_changed",
      payload: { oldValue: "2026-08-01", newValue: "2026-08-02" },
    });
  });

  it("resolves pending confirmations without reopening them on repeated import", () => {
    const { pending } = setup();
    const confirmation = {
      id: "pending:abc",
      reason: "key_field_changed" as const,
      title: "字段变化需确认",
      detail: "续期日期变化",
      payload: { oldValue: "2026-08-01", newValue: "2026-08-02" },
    };

    pending.create(confirmation);

    expect(pending.resolve(confirmation.id, "已人工确认", "2026-06-17T00:00:00.000Z")).toBe(
      true,
    );
    expect(pending.list()).toHaveLength(0);
    expect(pending.list({ status: "resolved" })[0]).toMatchObject({
      id: confirmation.id,
      status: "resolved",
      resolutionNote: "已人工确认",
      resolvedAt: "2026-06-17T00:00:00.000Z",
    });

    pending.create({ ...confirmation, detail: "再次导入仍存在" });

    expect(pending.list()).toHaveLength(0);
    expect(pending.list({ status: "resolved" })[0]).toMatchObject({
      detail: "再次导入仍存在",
      status: "resolved",
    });
  });
});
