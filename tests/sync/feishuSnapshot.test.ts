import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../src/db/connection";
import { runMigrations } from "../../src/db/migrations";
import { CustomerRepository } from "../../src/db/repositories/customerRepository";
import { PolicyRepository } from "../../src/db/repositories/policyRepository";
import { ReminderRepository } from "../../src/db/repositories/reminderRepository";
import { feishuRecordStateKey, SyncStateRepository } from "../../src/db/repositories/syncStateRepository";
import { makeCustomerBusinessKey } from "../../src/domain/ids";
import { syncFeishuBase } from "../../src/sync/feishuBaseSync";
import { buildFeishuSyncSnapshot, maskIdNumber, maskPhone } from "../../src/sync/feishuSnapshot";

const tempDirs: string[] = [];

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "customer-reminders-sync-"));
  tempDirs.push(dir);
  return join(dir, "app.sqlite");
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("feishu sync snapshot", () => {
  it("masks sensitive local fields before building Feishu rows", () => {
    expect(maskIdNumber("110101199001010010")).toBe("1101**********0010");
    expect(maskPhone("13800000000")).toBe("138****0000");
  });

  it("builds a dry-run snapshot from persisted local data", () => {
    const dbPath = tempDbPath();
    const db = openDatabase(dbPath);
    runMigrations(db);
    const customerId = makeCustomerBusinessKey({
      name: "张三",
      idNumber: "110101199001010010",
    });
    new CustomerRepository(db).upsertFromImport({
      id: customerId,
      name: "张三",
      fullIdNumber: "110101199001010010",
      phone: "13800000000",
      birthDate: "1990-01-01",
    });
    new PolicyRepository(db).upsertFromImport({
      id: "policy:abc",
      policyNumber: "abc",
      applicantCustomerId: customerId,
      insuredCustomerId: customerId,
      applicantName: "张三",
      insuredName: "张三",
      productName: "测试产品",
      paymentPeriodRaw: "10年",
      effectiveDate: "2024-08-01",
    });
    new ReminderRepository(db).createManual({
      id: "reminder:manual",
      group: "manual_todo",
      title: "联系张三",
      reminderDate: "2026-06-17",
      status: "pending",
      isKey: true,
      customerId,
      source: "manual",
    });
    db.close();

    const snapshot = buildFeishuSyncSnapshot(dbPath, { today: "2026-06-17" });

    expect(snapshot.summary).toEqual({
      customers: 1,
      policies: 1,
      reminders: 1,
      keyCalendarReminders: 1,
    });
    expect(snapshot.customers[0]).toMatchObject({
      maskedIdNumber: "1101**********0010",
      maskedPhone: "138****0000",
    });
    expect(snapshot.policies[0].insuredCustomerExternalId).toBe(
      customerId,
    );
    expect(snapshot.policies[0]).toMatchObject({
      nextRenewalDate: "2026-08-01",
      finalPaymentYear: 2033,
    });
    expect(snapshot.reminders[0].customerExternalId).toBe(customerId);
    expect(String(snapshot.policies[0].insuredCustomerExternalId)).not.toContain(
      "110101199001010010",
    );
    expect(String(snapshot.reminders[0].customerExternalId)).not.toContain(
      "110101199001010010",
    );
  });

  it("builds a masked Feishu Base command plan without external writes", async () => {
    const dbPath = tempDbPath();
    const db = openDatabase(dbPath);
    runMigrations(db);
    const customerId = makeCustomerBusinessKey({
      name: "张三",
      idNumber: "110101199001010010",
    });
    new CustomerRepository(db).upsertFromImport({
      id: customerId,
      name: "张三",
      fullIdNumber: "110101199001010010",
      phone: "13800000000",
      birthDate: "1990-01-01",
    });
    new SyncStateRepository(db).set(
      feishuRecordStateKey({
        baseToken: "app_test_token",
        tableRef: "客户",
        externalId: customerId,
      }),
      "rec_existing",
    );
    db.close();

    const result = await syncFeishuBase({
      dbPath,
      baseToken: "app_test_token",
      mode: "plan",
      limit: 1,
    });

    expect(result.summary).toMatchObject({
      planned: 1,
      created: 0,
      updated: 0,
      failed: 0,
    });
    expect(result.commands[0]).toMatchObject({
      table: "customers",
      tableRef: "客户",
      operation: "update",
      fields: {
        外部ID: customerId,
        姓名: "张三",
        证件号: "1101**********0010",
        手机号: "138****0000",
      },
    });
    expect(String(result.commands[0].fields["外部ID"])).not.toContain("110101199001010010");
    expect(result.commands[0].argv).toContain("<base-token>");
    expect(result.commands[0].argv).not.toContain("app_test_token");
    expect(result.commands[0].argv).toContain("rec_existing");
  });

  it("writes Feishu Base link fields when related record ids are already known", async () => {
    const dbPath = tempDbPath();
    const db = openDatabase(dbPath);
    runMigrations(db);
    const customerId = makeCustomerBusinessKey({
      name: "张三",
      idNumber: "110101199001010010",
    });
    const policyId = "policy:abc";
    new CustomerRepository(db).upsertFromImport({
      id: customerId,
      name: "张三",
      fullIdNumber: "110101199001010010",
      phone: "13800000000",
      birthDate: "1990-01-01",
    });
    new PolicyRepository(db).upsertFromImport({
      id: policyId,
      policyNumber: "abc",
      applicantCustomerId: customerId,
      insuredCustomerId: customerId,
      applicantName: "张三",
      insuredName: "张三",
      productName: "测试产品",
      effectiveDate: "2024-06-01",
    });
    const syncState = new SyncStateRepository(db);
    syncState.set(
      feishuRecordStateKey({
        baseToken: "app_test_token",
        tableRef: "客户",
        externalId: customerId,
      }),
      "rec_customer",
    );
    db.close();

    const result = await syncFeishuBase({
      dbPath,
      baseToken: "app_test_token",
      mode: "plan",
      limit: 2,
    });

    const policyCommand = result.commands.find((command) => command.table === "policies");
    expect(policyCommand?.fields).toMatchObject({
      投保人客户: [{ id: "rec_customer" }],
      被保人客户: [{ id: "rec_customer" }],
    });
    expect(JSON.parse(policyCommand?.argv[policyCommand.argv.indexOf("--json") + 1] ?? "{}")).toMatchObject({
      投保人客户: [{ id: "rec_customer" }],
      被保人客户: [{ id: "rec_customer" }],
    });
  });
});
