import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../src/db/connection";
import { runMigrations } from "../../src/db/migrations";
import { CustomerRepository } from "../../src/db/repositories/customerRepository";
import { PendingChangeRepository } from "../../src/db/repositories/pendingChangeRepository";
import { PolicyRepository } from "../../src/db/repositories/policyRepository";
import { ReminderRepository } from "../../src/db/repositories/reminderRepository";
import {
  detectCustomerKeyFieldChanges,
  detectPolicyKeyFieldChanges,
  importWorkbooks,
} from "../../src/importers/importService";

const tempDirs: string[] = [];

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "customer-reminders-"));
  tempDirs.push(dir);
  return join(dir, "app.sqlite");
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("import service contract", () => {
  it("detects customer and policy key field changes without treating missing imports as conflicts", () => {
    expect(
      detectCustomerKeyFieldChanges(
        {
          id: "customer:one",
          name: "张三",
          birthDate: "1988-01-01",
          phone: "13800000000",
        },
        {
          id: "customer:one",
          name: "张三",
          birthDate: "1989-01-01",
        },
      ),
    ).toEqual([
      {
        field: "birthDate",
        label: "出生日期",
        current: "1988-01-01",
        incoming: "1989-01-01",
      },
    ]);

    expect(
      detectPolicyKeyFieldChanges(
        {
          id: "policy:one",
          applicantName: "张三",
          insuredName: "张三",
          productName: "年金A",
          premium: 10000,
          paymentPeriodRaw: "10年",
          effectiveDate: "2023-06-01",
        },
        {
          id: "policy:one",
          applicantName: "张三",
          insuredName: "张三",
          productName: "年金A",
          premium: 12000,
          paymentPeriodRaw: "20年",
          effectiveDate: "2023-06-01",
        },
      ).map((change) => change.field),
    ).toEqual(["premium", "paymentPeriodRaw"]);
  });

  it("imports sample workbooks into normalized persisted reminders", async () => {
    const dbPath = tempDbPath();

    const summary = await importWorkbooks({
      customerWorkbookPath: "tests/fixtures/customer-info.xlsx",
      policyWorkbookPath: "tests/fixtures/policy-performance.xlsx",
      today: "2026-06-17",
      dbPath,
    });

    expect(summary.importedCustomers).toBeGreaterThan(600);
    expect(summary.importedPolicies).toBeGreaterThan(700);
    expect(summary.generatedReminders).toBeGreaterThan(600);
    expect(summary.pendingConfirmations).toBeGreaterThan(0);

    const db = openDatabase(dbPath);
    runMigrations(db);
    const customers = new CustomerRepository(db);
    const policies = new PolicyRepository(db);
    const reminders = new ReminderRepository(db);
    const pending = new PendingChangeRepository(db);

    expect(customers.list().length).toBe(summary.persistedCustomers);
    expect(policies.list().length).toBe(summary.persistedPolicies);
    expect(reminders.countGenerated()).toBe(summary.generatedReminders);
    expect(summary.persistedPolicies).toBeLessThan(summary.importedPolicies);
    expect(reminders.list().some((reminder) => reminder.group === "birthday")).toBe(true);
    expect(reminders.list().some((reminder) => reminder.group === "policy_renewal")).toBe(
      true,
    );
    expect(pending.list().some((item) => item.reason === "missing_required_field")).toBe(true);
    db.close();
  });

  it("does not treat first-import multi-insured policy rows as key field changes", async () => {
    const dbPath = tempDbPath();

    const summary = await importWorkbooks({
      customerWorkbookPath: "tests/fixtures/customer-info.xlsx",
      policyWorkbookPath: "tests/fixtures/policy-performance.xlsx",
      today: "2026-06-18",
      dbPath,
    });

    const db = openDatabase(dbPath);
    runMigrations(db);
    const pending = new PendingChangeRepository(db);

    expect(summary.importedPolicies).toBeGreaterThan(700);
    expect(summary.persistedPolicies).toBeLessThan(summary.importedPolicies);
    expect(pending.list({ status: "all" }).some((item) => item.reason === "key_field_changed")).toBe(
      false,
    );
    db.close();
  }, 15000);

  it("preserves completed reminder status across repeated imports", async () => {
    const dbPath = tempDbPath();

    await importWorkbooks({
      customerWorkbookPath: "tests/fixtures/customer-info.xlsx",
      today: "2026-06-17",
      dbPath,
    });

    const db = openDatabase(dbPath);
    runMigrations(db);
    const reminders = new ReminderRepository(db);
    const firstReminder = reminders.list()[0];
    reminders.markCompleted(firstReminder.id);
    db.close();

    await importWorkbooks({
      customerWorkbookPath: "tests/fixtures/customer-info.xlsx",
      today: "2026-06-17",
      dbPath,
    });

    const dbAfter = openDatabase(dbPath);
    runMigrations(dbAfter);
    const remindersAfter = new ReminderRepository(dbAfter);
    expect(remindersAfter.findByBusinessKey(firstReminder.id)?.status).toBe("completed");
    dbAfter.close();
  });

  it("reconciles stale generated reminders and pending confirmations after a full re-import", async () => {
    const dbPath = tempDbPath();

    const beforeDb = openDatabase(dbPath);
    runMigrations(beforeDb);
    const beforePending = new PendingChangeRepository(beforeDb);
    const beforeReminders = new ReminderRepository(beforeDb);
    beforeReminders.upsertGenerated({
      id: "reminder:stale-policy-import",
      group: "policy_renewal",
      title: "续期提醒：旧客户",
      reminderDate: "2026-01-01",
      status: "pending",
      isKey: false,
      policyId: "policy:stale",
      source: "policy_import",
    });
    beforeReminders.createManual({
      id: "reminder:manual-keep",
      group: "manual_todo",
      title: "手动待办保留",
      reminderDate: "2026-01-01",
      status: "pending",
      isKey: false,
      source: "manual",
    });
    beforePending.create({
      id: "pending:stale",
      reason: "missing_required_field",
      title: "旧待确认",
      detail: "旧待确认",
      payload: {},
    });
    beforeDb.close();

    const summary = await importWorkbooks({
      customerWorkbookPath: "tests/fixtures/customer-info.xlsx",
      policyWorkbookPath: "tests/fixtures/policy-performance.xlsx",
      today: "2026-06-17",
      dbPath,
    });

    const afterDb = openDatabase(dbPath);
    runMigrations(afterDb);
    const afterPending = new PendingChangeRepository(afterDb);
    const afterReminders = new ReminderRepository(afterDb);
    expect(afterReminders.countGenerated()).toBe(summary.generatedReminders);
    expect(afterReminders.findByBusinessKey("reminder:stale-policy-import")).toBeUndefined();
    expect(afterReminders.findByBusinessKey("reminder:manual-keep")).toBeDefined();
    expect(afterPending.findById("pending:stale")?.status).toBe("resolved");
    expect(afterPending.findById("pending:stale")?.resolutionNote).toBe(
      "自动关闭：本次导入未再发现该待确认问题。",
    );
    afterDb.close();
  }, 15000);
});
