import { mkdtempSync, readFileSync } from "node:fs";
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
import { makeCustomerBusinessKey, makePolicyBusinessKey } from "../../src/domain/ids";
import { syncFeishuBaseBatch } from "../../src/sync/feishuBaseBatchSync";
import type { LarkCliRunner } from "../../src/sync/larkCli";

const tempDirs: string[] = [];

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "customer-reminders-batch-sync-"));
  tempDirs.push(dir);
  return join(dir, "app.sqlite");
}

function seedLinkedRows(dbPath: string) {
  const db = openDatabase(dbPath);
  runMigrations(db);
  const customerId = makeCustomerBusinessKey({
    name: "张三",
    idNumber: "110101199001010010",
  });
  const policyId = makePolicyBusinessKey({
    policyNumber: "abc",
    applicantName: "张三",
    insuredName: "张三",
    productName: "测试产品",
    effectiveDate: "2024-06-01",
  });
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
  new ReminderRepository(db).createManual({
    id: "reminder:manual",
    group: "manual_todo",
    title: "联系张三",
    reminderDate: "2026-06-17",
    status: "pending",
    isKey: true,
    customerId,
    policyId,
    source: "manual",
  });
  db.close();
  return { customerId, policyId };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Feishu Base batch sync", () => {
  it("plans batch creates with masked command arguments", async () => {
    const dbPath = tempDbPath();
    seedLinkedRows(dbPath);

    const result = await syncFeishuBaseBatch({
      dbPath,
      baseToken: "app_test_token",
      mode: "plan",
      batchSize: 2,
    });

    expect(result.summary).toMatchObject({
      planned: 3,
      created: 0,
      skippedExisting: 0,
      failed: 0,
      batches: 3,
    });
    expect(result.batches.map((batch) => batch.table)).toEqual([
      "customers",
      "policies",
      "reminders",
    ]);
    expect(result.batches[0].argv).toContain("<base-token>");
    expect(result.batches[0].argv).not.toContain("app_test_token");
  });

  it("executes staged batches and persists returned record ids", async () => {
    const dbPath = tempDbPath();
    const { customerId, policyId } = seedLinkedRows(dbPath);
    const payloads: Array<{ fields: string[]; rows: unknown[][] }> = [];
    let callIndex = 0;
    const runner: LarkCliRunner = async (argv) => {
      const payloadArg = argv[argv.indexOf("--json") + 1];
      const payloadPath = payloadArg.replace(/^@/, "");
      payloads.push(JSON.parse(readFileSync(payloadPath, "utf8")));
      callIndex += 1;
      return {
        stdout: JSON.stringify({ data: { record_id_list: [`rec_${callIndex}`] } }),
        stderr: "",
      };
    };

    const result = await syncFeishuBaseBatch({
      dbPath,
      baseToken: "app_test_token",
      mode: "execute",
      batchSize: 10,
      runner,
    });

    expect(result.summary).toMatchObject({
      planned: 3,
      created: 3,
      skippedExisting: 0,
      failed: 0,
      batches: 3,
    });
    expect(payloads[1].fields).toContain("投保人客户");
    expect(payloads[1].rows[0]).toContainEqual([{ id: "rec_1" }]);
    expect(payloads[2].fields).toContain("关联客户");
    expect(payloads[2].rows[0]).toContainEqual([{ id: "rec_1" }]);
    expect(payloads[2].rows[0]).toContainEqual([{ id: "rec_2" }]);

    const db = openDatabase(dbPath);
    runMigrations(db);
    const state = new SyncStateRepository(db);
    expect(
      state.get(
        feishuRecordStateKey({
          baseToken: "app_test_token",
          tableRef: "客户",
          externalId: customerId,
        }),
      ),
    ).toBe("rec_1");
    expect(
      state.get(
        feishuRecordStateKey({
          baseToken: "app_test_token",
          tableRef: "保单",
          externalId: policyId,
        }),
      ),
    ).toBe("rec_2");
    db.close();
  });

  it("skips rows already tracked in sync state", async () => {
    const dbPath = tempDbPath();
    const { customerId } = seedLinkedRows(dbPath);
    const db = openDatabase(dbPath);
    runMigrations(db);
    new SyncStateRepository(db).set(
      feishuRecordStateKey({
        baseToken: "app_test_token",
        tableRef: "客户",
        externalId: customerId,
      }),
      "rec_existing",
    );
    db.close();

    const result = await syncFeishuBaseBatch({
      dbPath,
      baseToken: "app_test_token",
      mode: "plan",
    });

    expect(result.summary.skippedExisting).toBe(1);
    expect(result.summary.planned).toBe(2);
    expect(result.batches.map((batch) => batch.table)).toEqual(["policies", "reminders"]);
  });
});
