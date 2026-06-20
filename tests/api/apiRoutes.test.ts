import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3-multiple-ciphers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../../src/api/server";
import { openDatabase } from "../../src/db/connection";
import { runMigrations } from "../../src/db/migrations";
import { CustomerRepository } from "../../src/db/repositories/customerRepository";
import { PendingChangeRepository } from "../../src/db/repositories/pendingChangeRepository";
import { PolicyRepository } from "../../src/db/repositories/policyRepository";
import { ReminderRepository } from "../../src/db/repositories/reminderRepository";

const tempDirs: string[] = [];

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "customer-reminders-api-"));
  tempDirs.push(dir);
  return join(dir, "app.sqlite");
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("api routes", () => {
  it("enables database encryption and blocks plaintext reads", async () => {
    const dbPath = tempDbPath();
    const app = buildServer({ dbPath, today: "2026-06-17" });

    const beforeStatus = await app.inject({
      method: "GET",
      url: "/api/database/encryption",
    });
    expect(beforeStatus.statusCode).toBe(200);
    expect(beforeStatus.json()).toMatchObject({ encrypted: false, unlocked: true });

    const enableResponse = await app.inject({
      method: "POST",
      url: "/api/database/encryption/enable",
      payload: { password: "local-data-secret" },
    });
    expect(enableResponse.statusCode).toBe(200);
    expect(enableResponse.json()).toMatchObject({ encrypted: true, unlocked: true });

    const plainDb = new Database(dbPath);
    expect(() => plainDb.prepare("SELECT name FROM sqlite_master LIMIT 1").get()).toThrow();
    plainDb.close();

    const statsResponse = await app.inject({
      method: "GET",
      url: "/api/stats",
    });
    expect(statsResponse.statusCode).toBe(200);
    await app.close();
  });

  it("unlocks an existing encrypted database before serving data", async () => {
    const dbPath = tempDbPath();
    const encryptedDb = new Database(dbPath);
    encryptedDb.prepare("CREATE TABLE sample (id INTEGER PRIMARY KEY)").run();
    encryptedDb.rekey(Buffer.from("existing-data-secret"));
    encryptedDb.close();

    const app = buildServer({ dbPath, today: "2026-06-17" });
    const lockedStatus = await app.inject({
      method: "GET",
      url: "/api/database/encryption",
    });
    expect(lockedStatus.statusCode).toBe(200);
    expect(lockedStatus.json()).toMatchObject({ encrypted: true, unlocked: false });

    const badUnlock = await app.inject({
      method: "POST",
      url: "/api/database/encryption/unlock",
      payload: { password: "wrong-secret" },
    });
    expect(badUnlock.statusCode).toBe(401);

    const unlock = await app.inject({
      method: "POST",
      url: "/api/database/encryption/unlock",
      payload: { password: "existing-data-secret" },
    });
    expect(unlock.statusCode).toBe(200);
    expect(unlock.json()).toMatchObject({ encrypted: true, unlocked: true });

    const remindersResponse = await app.inject({
      method: "GET",
      url: "/api/reminders",
    });
    expect(remindersResponse.statusCode).toBe(200);
    await app.close();
  });

  it("rejects database password changes when the current password is wrong", async () => {
    const dbPath = tempDbPath();
    const app = buildServer({ dbPath, today: "2026-06-17" });

    const enableResponse = await app.inject({
      method: "POST",
      url: "/api/database/encryption/enable",
      payload: { password: "original-data-secret" },
    });
    expect(enableResponse.statusCode).toBe(200);

    const changeResponse = await app.inject({
      method: "POST",
      url: "/api/database/encryption/change-password",
      payload: {
        currentPassword: "wrong-data-secret",
        nextPassword: "next-data-secret",
      },
    });
    expect(changeResponse.statusCode).toBe(401);

    const oldPasswordDb = new Database(dbPath, { fileMustExist: true });
    oldPasswordDb.key(Buffer.from("original-data-secret"));
    expect(oldPasswordDb.prepare("SELECT count(*) AS count FROM sqlite_master").get()).toEqual({ count: 0 });
    oldPasswordDb.close();

    const nextPasswordDb = new Database(dbPath, { fileMustExist: true });
    nextPasswordDb.key(Buffer.from("next-data-secret"));
    expect(() => nextPasswordDb.prepare("SELECT count(*) AS count FROM sqlite_master").get()).toThrow();
    nextPasswordDb.close();
    await app.close();
  });

  it("changes the database password only when the current password is valid", async () => {
    const dbPath = tempDbPath();
    const app = buildServer({ dbPath, today: "2026-06-17" });

    const enableResponse = await app.inject({
      method: "POST",
      url: "/api/database/encryption/enable",
      payload: { password: "original-data-secret" },
    });
    expect(enableResponse.statusCode).toBe(200);

    const changeResponse = await app.inject({
      method: "POST",
      url: "/api/database/encryption/change-password",
      payload: {
        currentPassword: "original-data-secret",
        nextPassword: "next-data-secret",
      },
    });
    expect(changeResponse.statusCode).toBe(200);
    expect(changeResponse.json()).toMatchObject({ encrypted: true, unlocked: true });

    const oldPasswordDb = new Database(dbPath, { fileMustExist: true });
    oldPasswordDb.key(Buffer.from("original-data-secret"));
    expect(() => oldPasswordDb.prepare("SELECT count(*) AS count FROM sqlite_master").get()).toThrow();
    oldPasswordDb.close();

    const nextPasswordDb = new Database(dbPath, { fileMustExist: true });
    nextPasswordDb.key(Buffer.from("next-data-secret"));
    expect(nextPasswordDb.prepare("SELECT count(*) AS count FROM sqlite_master").get()).toEqual({ count: 0 });
    nextPasswordDb.close();
    await app.close();
  });

  it("blocks cloud backup until the database is encrypted", async () => {
    const app = buildServer({ dbPath: tempDbPath(), today: "2026-06-17" });

    const statusResponse = await app.inject({
      method: "GET",
      url: "/api/cloud-backup/status",
    });
    expect(statusResponse.statusCode).toBe(200);
    expect(statusResponse.json()).toMatchObject({
      connected: false,
      blockedReason: "database_encryption_required",
    });

    const connectResponse = await app.inject({
      method: "POST",
      url: "/api/cloud-backup/connect",
      payload: {
        username: "user@example.com",
        password: "app-password",
      },
    });
    expect(connectResponse.statusCode).toBe(400);
    expect(connectResponse.json()).toEqual({ error: "database_encryption_required" });
    await app.close();
  });

  it("keeps Jianguoyun app password out of persisted cloud backup settings", async () => {
    const dbPath = tempDbPath();
    const app = buildServer({ dbPath, today: "2026-06-17" });
    await app.inject({
      method: "POST",
      url: "/api/database/encryption/enable",
      payload: { password: "local-data-secret" },
    });

    const originalFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 207 })),
    );
    try {
      const connectResponse = await app.inject({
        method: "POST",
        url: "/api/cloud-backup/connect",
        payload: {
          baseUrl: "https://dav.jianguoyun.com/dav/",
          username: "user@example.com",
          password: "app-password-should-not-persist",
          remoteDir: "客户提醒备份",
        },
      });
      expect(connectResponse.statusCode).toBe(200);
      expect(connectResponse.json()).toMatchObject({
        connected: true,
        configured: true,
        username: "user@example.com",
        remoteDir: "客户提醒备份",
      });
    } finally {
      vi.unstubAllGlobals();
      globalThis.fetch = originalFetch;
    }

    const db = openDatabase(dbPath);
    const row = db
      .prepare("SELECT value FROM sync_state WHERE key = ?")
      .get("cloud-backup:jianguoyun:settings") as { value: string };
    db.close();
    expect(row.value).toContain("user@example.com");
    expect(row.value).not.toContain("app-password-should-not-persist");
    expect(JSON.parse(row.value)).not.toHaveProperty("password");
    await app.close();
  });

  it("returns a specific error when Jianguoyun rejects WebDAV credentials", async () => {
    const dbPath = tempDbPath();
    const app = buildServer({ dbPath, today: "2026-06-17" });
    await app.inject({
      method: "POST",
      url: "/api/database/encryption/enable",
      payload: { password: "local-data-secret" },
    });

    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));
    try {
      const connectResponse = await app.inject({
        method: "POST",
        url: "/api/cloud-backup/connect",
        payload: {
          baseUrl: "https://dav.jianguoyun.com/dav/",
          username: "user@example.com",
          password: "wrong-app-password",
          remoteDir: "客户提醒备份",
        },
      });
      expect(connectResponse.statusCode).toBe(400);
      expect(connectResponse.json()).toEqual({ error: "jianguoyun_credentials_invalid" });
    } finally {
      vi.unstubAllGlobals();
    }
    await app.close();
  });

  it("keeps auth disabled unless an access password is configured", async () => {
    const app = buildServer({ dbPath: tempDbPath(), today: "2026-06-17" });

    const statusResponse = await app.inject({
      method: "GET",
      url: "/api/auth/status",
    });
    const remindersResponse = await app.inject({
      method: "GET",
      url: "/api/reminders",
    });

    expect(statusResponse.statusCode).toBe(200);
    expect(statusResponse.json()).toEqual({ enabled: false, authenticated: true });
    expect(remindersResponse.statusCode).toBe(200);
    await app.close();
  });

  it("requires the local access password when configured", async () => {
    const app = buildServer({
      dbPath: tempDbPath(),
      today: "2026-06-17",
      accessPassword: "local-secret",
    });

    const lockedResponse = await app.inject({
      method: "GET",
      url: "/api/reminders",
    });
    expect(lockedResponse.statusCode).toBe(401);
    expect(lockedResponse.json()).toEqual({ error: "authentication_required" });

    const badLoginResponse = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "wrong" },
    });
    expect(badLoginResponse.statusCode).toBe(401);

    const loginResponse = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "local-secret" },
    });
    expect(loginResponse.statusCode).toBe(200);
    const cookie = loginResponse.headers["set-cookie"];
    expect(cookie).toContain("customer_reminders_session=");

    const unlockedResponse = await app.inject({
      method: "GET",
      url: "/api/reminders",
      headers: { cookie },
    });
    expect(unlockedResponse.statusCode).toBe(200);

    const logoutResponse = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { cookie },
    });
    expect(logoutResponse.statusCode).toBe(200);

    const relockedResponse = await app.inject({
      method: "GET",
      url: "/api/reminders",
      headers: { cookie },
    });
    expect(relockedResponse.statusCode).toBe(401);
    await app.close();
  });

  it("saves AI settings locally without returning the API key", async () => {
    const app = buildServer({ dbPath: tempDbPath(), today: "2026-06-17" });

    const saveResponse = await app.inject({
      method: "POST",
      url: "/api/ai/settings",
      payload: { providerId: "deepseek", apiKey: "sk-local-test" },
    });
    const getResponse = await app.inject({
      method: "GET",
      url: "/api/ai/settings",
    });

    expect(saveResponse.statusCode).toBe(200);
    expect(saveResponse.json()).toMatchObject({
      providerId: "deepseek",
      apiKeyConfigured: true,
    });
    expect(JSON.stringify(saveResponse.json())).not.toContain("sk-local-test");
    expect(getResponse.json()).toMatchObject({
      providerId: "deepseek",
      apiKeyConfigured: true,
    });
    expect(getResponse.json().providers.length).toBeGreaterThan(1);
    await app.close();
  });

  it("imports workbooks and lists pending reminders", async () => {
    const app = buildServer({ dbPath: tempDbPath(), today: "2026-06-17" });

    const importResponse = await app.inject({
      method: "POST",
      url: "/api/imports",
      payload: {
        customerWorkbookPath: "tests/fixtures/customer-info.xlsx",
        policyWorkbookPath: "tests/fixtures/policy-performance.xlsx",
      },
    });

    expect(importResponse.statusCode).toBe(200);
    expect(importResponse.json().generatedReminders).toBeGreaterThan(600);

    const remindersResponse = await app.inject({
      method: "GET",
      url: "/api/reminders?status=pending",
    });

    expect(remindersResponse.statusCode).toBe(200);
    expect(remindersResponse.json().items.length).toBeGreaterThan(600);

    const statsResponse = await app.inject({
      method: "GET",
      url: "/api/stats",
    });
    expect(statsResponse.statusCode).toBe(200);
    expect(statsResponse.json()).toMatchObject({
      customers: expect.any(Number),
      policies: expect.any(Number),
      reminders: {
        total: expect.any(Number),
        pending: expect.any(Number),
        completed: expect.any(Number),
        birthday: expect.any(Number),
        policyRenewal: expect.any(Number),
        manualTodo: expect.any(Number),
        keyPending: expect.any(Number),
      },
      pendingConfirmations: {
        open: expect.any(Number),
        resolved: expect.any(Number),
      },
      health: {
        legacyPolicyKeys: 0,
      },
    });
    expect(statsResponse.json().customers).toBeGreaterThan(600);
    expect(statsResponse.json().policies).toBeGreaterThan(700);
    expect(statsResponse.json().reminders.total).toBeGreaterThan(600);
    await app.close();
  });

  it("imports uploaded workbook files", async () => {
    const app = buildServer({ dbPath: tempDbPath(), today: "2026-06-17" });

    const importResponse = await app.inject({
      method: "POST",
      url: "/api/imports",
      payload: {
        customerWorkbookFile: {
          fileName: "customer-info.xlsx",
          base64: readFileSync("tests/fixtures/customer-info.xlsx").toString("base64"),
        },
        policyWorkbookFile: {
          fileName: "policy-performance.xlsx",
          base64: readFileSync("tests/fixtures/policy-performance.xlsx").toString("base64"),
        },
      },
    });

    expect(importResponse.statusCode).toBe(200);
    expect(importResponse.json().generatedReminders).toBeGreaterThan(600);
    await app.close();
  }, 15000);

  it("analyzes and imports multiple files through the unified import entry", async () => {
    const app = buildServer({ dbPath: tempDbPath(), today: "2026-06-17" });
    const files = [
      {
        fileName: "customer-info.xlsx",
        base64: readFileSync("tests/fixtures/customer-info.xlsx").toString("base64"),
      },
      {
        fileName: "policy-performance.xlsx",
        base64: readFileSync("tests/fixtures/policy-performance.xlsx").toString("base64"),
      },
    ];

    const analyzeResponse = await app.inject({
      method: "POST",
      url: "/api/imports/analyze",
      payload: { files },
    });
    expect(analyzeResponse.statusCode).toBe(200);
    expect(analyzeResponse.json().summary).toMatchObject({
      customerTables: 1,
      policyTables: 1,
    });
    expect(analyzeResponse.json().summary.mappedFields).toBeGreaterThan(10);

    const importResponse = await app.inject({
      method: "POST",
      url: "/api/imports",
      payload: { files },
    });

    expect(importResponse.statusCode).toBe(200);
    expect(importResponse.json().generatedReminders).toBeGreaterThan(600);
    await app.close();
  }, 15000);

  it("previews workbook imports without mutating the app database", async () => {
    const dbPath = tempDbPath();
    const app = buildServer({ dbPath, today: "2026-06-17" });

    const previewResponse = await app.inject({
      method: "POST",
      url: "/api/imports/preview",
      payload: {
        customerWorkbookPath: "tests/fixtures/customer-info.xlsx",
        policyWorkbookPath: "tests/fixtures/policy-performance.xlsx",
      },
    });

    expect(previewResponse.statusCode).toBe(200);
    expect(previewResponse.json()).toMatchObject({
      mode: "preview",
      delta: {
        customers: expect.any(Number),
        policies: expect.any(Number),
        reminders: expect.any(Number),
        openPendingConfirmations: expect.any(Number),
      },
    });
    expect(previewResponse.json().delta.customers).toBeGreaterThan(600);

    const statsResponse = await app.inject({
      method: "GET",
      url: "/api/stats",
    });
    expect(statsResponse.statusCode).toBe(200);
    expect(statsResponse.json()).toMatchObject({
      customers: 0,
      policies: 0,
      reminders: { total: 0 },
      pendingConfirmations: { open: 0 },
    });
    expect(existsSync(dbPath)).toBe(true);
    await app.close();
  }, 15000);

  it("creates, lists, and restores local database backups", async () => {
    const dbPath = tempDbPath();
    const app = buildServer({ dbPath, today: "2026-06-17" });

    await app.inject({
      method: "POST",
      url: "/api/imports",
      payload: {
        customerWorkbookPath: "tests/fixtures/customer-info.xlsx",
      },
    });
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/backups",
      payload: { label: "before-large-test" },
    });
    expect(createResponse.statusCode).toBe(200);
    expect(createResponse.json().backup.fileName).toMatch(/^customer-reminders-/);
    const backedUpCustomerCount = (
      await app.inject({
        method: "GET",
        url: "/api/stats",
      })
    ).json().customers;

    const db = openDatabase(dbPath);
    runMigrations(db);
    new CustomerRepository(db).upsertFromImport({
      id: "customer:temporary",
      name: "临时客户",
      birthDate: "1990-01-01",
    });
    db.close();

    const listResponse = await app.inject({
      method: "GET",
      url: "/api/backups",
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().items.length).toBe(1);

    const restoreResponse = await app.inject({
      method: "POST",
      url: "/api/backups/restore",
      payload: { fileName: createResponse.json().backup.fileName },
    });
    expect(restoreResponse.statusCode).toBe(200);
    expect(restoreResponse.json().stats.customers).toBe(backedUpCustomerCount);

    const invalidRestoreResponse = await app.inject({
      method: "POST",
      url: "/api/backups/restore",
      payload: { fileName: "../app.sqlite" },
    });
    expect(invalidRestoreResponse.statusCode).toBe(404);
    await app.close();
  }, 15000);

  it("clears local data only after confirmation and keeps a restorable backup", async () => {
    const dbPath = tempDbPath();
    const app = buildServer({ dbPath, today: "2026-06-17" });

    await app.inject({
      method: "POST",
      url: "/api/imports",
      payload: {
        customerWorkbookPath: "tests/fixtures/customer-info.xlsx",
      },
    });
    const beforeClearStats = (
      await app.inject({
        method: "GET",
        url: "/api/stats",
      })
    ).json();
    expect(beforeClearStats.customers).toBeGreaterThan(0);

    const rejectedResponse = await app.inject({
      method: "POST",
      url: "/api/local-data/clear",
      payload: { confirm: "delete" },
    });
    expect(rejectedResponse.statusCode).toBe(400);
    expect(rejectedResponse.json()).toEqual({ error: "clear_confirmation_required" });

    const clearResponse = await app.inject({
      method: "POST",
      url: "/api/local-data/clear",
      payload: { confirm: "清空数据" },
    });
    expect(clearResponse.statusCode).toBe(200);
    expect(clearResponse.json().backup.fileName).toContain("before-clear");
    expect(clearResponse.json().stats).toMatchObject({
      customers: 0,
      policies: 0,
      reminders: { total: 0, pending: 0, completed: 0 },
      pendingConfirmations: { open: 0, resolved: 0 },
    });

    const restoreResponse = await app.inject({
      method: "POST",
      url: "/api/backups/restore",
      payload: { fileName: clearResponse.json().backup.fileName },
    });
    expect(restoreResponse.statusCode).toBe(200);
    expect(restoreResponse.json().stats.customers).toBe(beforeClearStats.customers);
    await app.close();
  }, 15000);

  it("plans Feishu Base batch sync through the API", async () => {
    const app = buildServer({ dbPath: tempDbPath(), today: "2026-06-17" });

    await app.inject({
      method: "POST",
      url: "/api/imports",
      payload: {
        customerWorkbookPath: "tests/fixtures/customer-info.xlsx",
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/sync/feishu/base",
      payload: {
        baseToken: "app_test_token",
        mode: "plan",
        strategy: "batch-create",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      mode: "plan",
      summary: {
        planned: expect.any(Number),
        batches: expect.any(Number),
      },
      batches: expect.any(Array),
    });
    expect(response.json().summary.planned).toBeGreaterThan(600);
    expect(response.json().batches[0].argv).toContain("<base-token>");
    await app.close();
  }, 15000);

  it("returns linked customer and policy details for imported reminders", async () => {
    const app = buildServer({ dbPath: tempDbPath(), today: "2026-06-17" });

    await app.inject({
      method: "POST",
      url: "/api/imports",
      payload: {
        customerWorkbookPath: "tests/fixtures/customer-info.xlsx",
        policyWorkbookPath: "tests/fixtures/policy-performance.xlsx",
      },
    });

    const birthdayListResponse = await app.inject({
      method: "GET",
      url: "/api/reminders?group=birthday",
    });
    const birthdayReminder = birthdayListResponse
      .json()
      .items.find((item: { customerId?: string }) => item.customerId);
    expect(birthdayReminder).toBeDefined();

    const birthdayDetailResponse = await app.inject({
      method: "GET",
      url: `/api/reminders/${encodeURIComponent(birthdayReminder!.id)}/detail`,
    });
    expect(birthdayDetailResponse.statusCode).toBe(200);
    expect(birthdayDetailResponse.json()).toMatchObject({
      reminder: {
        id: birthdayReminder!.id,
        group: "birthday",
      },
      customer: {
        id: birthdayReminder!.customerId,
        name: expect.any(String),
      },
    });

    const renewalListResponse = await app.inject({
      method: "GET",
      url: "/api/reminders?group=policy_renewal",
    });
    const renewalReminder = renewalListResponse
      .json()
      .items.find((item: { policyId?: string }) => item.policyId);
    expect(renewalReminder).toBeDefined();
    expect(renewalReminder!.policySummary).toMatchObject({
      productName: expect.any(String),
      premium: expect.any(Number),
    });

    const renewalDetailResponse = await app.inject({
      method: "GET",
      url: `/api/reminders/${encodeURIComponent(renewalReminder!.id)}/detail`,
    });
    expect(renewalDetailResponse.statusCode).toBe(200);
    expect(renewalDetailResponse.json()).toMatchObject({
      reminder: {
        id: renewalReminder!.id,
        group: "policy_renewal",
      },
      policy: {
        id: renewalReminder!.policyId,
        productName: expect.any(String),
      },
    });
    await app.close();
  });

  it("handles long generated reminder ids in detail and complete routes", async () => {
    const dbPath = tempDbPath();
    const db = openDatabase(dbPath);
    runMigrations(db);
    const reminderId =
      "reminder:policy_renewal:2026-06-11:unknown:policy:synthetic-long-policy-id:测试客户长ID:" +
      "测试长期险产品组合A+附加测试长期险产品组合B:" +
      "续期提醒：测试客户长ID";
    expect(reminderId.length).toBeGreaterThan(100);
    new ReminderRepository(db).upsertGenerated({
      id: reminderId,
      group: "policy_renewal",
      title: "续期提醒：测试客户长ID",
      reminderDate: "2026-06-11",
      status: "pending",
      isKey: false,
      source: "policy_import",
    });
    db.close();

    const app = buildServer({ dbPath, today: "2026-06-17" });

    const detailResponse = await app.inject({
      method: "GET",
      url: `/api/reminders/${encodeURIComponent(reminderId)}/detail`,
    });
    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json().reminder.id).toBe(reminderId);

    const completeResponse = await app.inject({
      method: "POST",
      url: `/api/reminders/${encodeURIComponent(reminderId)}/complete`,
      payload: {},
    });
    expect(completeResponse.statusCode).toBe(200);
    expect(completeResponse.json()).toEqual({ ok: true, updated: true });

    await app.close();
  });

  it("rejects unsupported uploaded workbook file types", async () => {
    const app = buildServer({ dbPath: tempDbPath(), today: "2026-06-17" });

    const importResponse = await app.inject({
      method: "POST",
      url: "/api/imports",
      payload: {
        customerWorkbookFile: {
          fileName: "customer-info.csv",
          base64: Buffer.from("name,birthday").toString("base64"),
        },
      },
    });

    expect(importResponse.statusCode).toBe(400);
    expect(importResponse.json()).toEqual({ error: "unsupported_workbook_file_type" });
    await app.close();
  });

  it("creates and completes a manual todo", async () => {
    const app = buildServer({ dbPath: tempDbPath(), today: "2026-06-17" });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/todos",
      payload: {
        title: "联系张三确认保费",
        reminderDate: "2026-06-20",
        isKey: true,
      },
    });

    expect(createResponse.statusCode).toBe(200);
    const created = createResponse.json();
    expect(created.group).toBe("manual_todo");
    expect(created.isKey).toBe(true);

    const completeResponse = await app.inject({
      method: "POST",
      url: `/api/reminders/${encodeURIComponent(created.id)}/complete`,
    });
    expect(completeResponse.statusCode).toBe(200);

    const remindersResponse = await app.inject({
      method: "GET",
      url: "/api/reminders",
    });
    expect(remindersResponse.json().items[0].status).toBe("completed");
    await app.close();
  });

  it("completes every pending reminder on a selected date", async () => {
    const app = buildServer({ dbPath: tempDbPath(), today: "2026-06-17" });

    const first = await app.inject({
      method: "POST",
      url: "/api/todos",
      payload: { title: "联系张三", reminderDate: "2026-06-18" },
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/todos",
      payload: { title: "联系李四", reminderDate: "2026-06-18" },
    });
    const otherDay = await app.inject({
      method: "POST",
      url: "/api/todos",
      payload: { title: "联系王五", reminderDate: "2026-06-19" },
    });

    const completeResponse = await app.inject({
      method: "POST",
      url: "/api/reminders/complete-date",
      payload: { reminderDate: "2026-06-18" },
    });

    expect(completeResponse.statusCode).toBe(200);
    expect(completeResponse.json()).toEqual({ ok: true, completed: 2 });

    const remindersResponse = await app.inject({
      method: "GET",
      url: "/api/reminders",
    });
    const items = remindersResponse.json().items as Array<{ id: string; status: string }>;
    expect(items.find((item) => item.id === first.json().id)?.status).toBe("completed");
    expect(items.find((item) => item.id === second.json().id)?.status).toBe("completed");
    expect(items.find((item) => item.id === otherDay.json().id)?.status).toBe("pending");
    await app.close();
  });

  it("updates a manual todo and reopens a completed reminder", async () => {
    const app = buildServer({ dbPath: tempDbPath(), today: "2026-06-17" });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/todos",
      payload: {
        title: "联系张三确认保费",
        reminderDate: "2026-06-20",
      },
    });
    const created = createResponse.json();

    const updateResponse = await app.inject({
      method: "PATCH",
      url: `/api/todos/${encodeURIComponent(created.id)}`,
      payload: {
        title: "联系张三确认续期",
        reminderDate: "2026-06-22",
        isKey: true,
      },
    });
    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.json()).toMatchObject({
      title: "联系张三确认续期",
      reminderDate: "2026-06-22",
      isKey: true,
    });

    const completeResponse = await app.inject({
      method: "POST",
      url: `/api/reminders/${encodeURIComponent(created.id)}/complete`,
    });
    expect(completeResponse.statusCode).toBe(200);

    const reopenResponse = await app.inject({
      method: "POST",
      url: `/api/reminders/${encodeURIComponent(created.id)}/reopen`,
    });
    expect(reopenResponse.statusCode).toBe(200);

    const remindersResponse = await app.inject({
      method: "GET",
      url: "/api/reminders",
    });
    expect(remindersResponse.json().items[0]).toMatchObject({
      title: "联系张三确认续期",
      status: "pending",
    });
    await app.close();
  });

  it("deletes a manual todo without deleting generated reminders", async () => {
    const app = buildServer({ dbPath: tempDbPath(), today: "2026-06-17" });

    const importResponse = await app.inject({
      method: "POST",
      url: "/api/imports",
      payload: {
        customerWorkbookPath: "tests/fixtures/customer-info.xlsx",
      },
    });
    expect(importResponse.statusCode).toBe(200);

    const listGeneratedResponse = await app.inject({
      method: "GET",
      url: "/api/reminders?group=birthday",
    });
    const generated = listGeneratedResponse.json().items[0];

    const deleteGeneratedResponse = await app.inject({
      method: "DELETE",
      url: `/api/reminders/${encodeURIComponent(generated.id)}`,
    });
    expect(deleteGeneratedResponse.statusCode).toBe(404);

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/todos",
      payload: {
        title: "整理客户资料",
        reminderDate: "2026-06-21",
      },
    });
    const manual = createResponse.json();

    const deleteManualResponse = await app.inject({
      method: "DELETE",
      url: `/api/reminders/${encodeURIComponent(manual.id)}`,
    });
    expect(deleteManualResponse.statusCode).toBe(200);

    const remindersResponse = await app.inject({
      method: "GET",
      url: "/api/reminders",
    });
    const items = remindersResponse.json().items;
    expect(items.some((item: { id: string }) => item.id === manual.id)).toBe(false);
    expect(items.some((item: { id: string }) => item.id === generated.id)).toBe(true);
    await app.close();
  });

  it("returns pending confirmations", async () => {
    const app = buildServer({ dbPath: tempDbPath(), today: "2026-06-17" });

    await app.inject({
      method: "POST",
      url: "/api/imports",
      payload: {
        policyWorkbookPath: "tests/fixtures/policy-performance.xlsx",
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/pending-confirmations",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items.some((item: { reason: string }) => item.reason)).toBe(true);
    await app.close();
  });

  it("resolves a pending confirmation and hides it from the default list", async () => {
    const app = buildServer({ dbPath: tempDbPath(), today: "2026-06-17" });

    await app.inject({
      method: "POST",
      url: "/api/imports",
      payload: {
        policyWorkbookPath: "tests/fixtures/policy-performance.xlsx",
      },
    });

    const beforeResponse = await app.inject({
      method: "GET",
      url: "/api/pending-confirmations",
    });
    const target = beforeResponse.json().items[0];

    const resolveResponse = await app.inject({
      method: "POST",
      url: `/api/pending-confirmations/${encodeURIComponent(target.id)}/resolve`,
      payload: {
        note: "已人工确认",
      },
    });
    expect(resolveResponse.statusCode).toBe(200);

    const openResponse = await app.inject({
      method: "GET",
      url: "/api/pending-confirmations",
    });
    expect(openResponse.json().items.some((item: { id: string }) => item.id === target.id)).toBe(
      false,
    );

    const resolvedResponse = await app.inject({
      method: "GET",
      url: "/api/pending-confirmations?status=resolved",
    });
    expect(resolvedResponse.json().items[0]).toMatchObject({
      id: target.id,
      status: "resolved",
      resolutionNote: "已人工确认",
    });
    await app.close();
  });

  it("applies a policy correction before resolving a pending confirmation", async () => {
    const app = buildServer({ dbPath: tempDbPath(), today: "2026-06-17" });

    await app.inject({
      method: "POST",
      url: "/api/imports",
      payload: {
        policyWorkbookPath: "tests/fixtures/policy-performance.xlsx",
      },
    });

    const beforeResponse = await app.inject({
      method: "GET",
      url: "/api/pending-confirmations",
    });
    const target = beforeResponse
      .json()
      .items.find((item: { payload: { effectiveDate?: string; paymentPeriodRaw?: string } }) => {
        return item.payload.effectiveDate && item.payload.paymentPeriodRaw === "60周岁";
      });

    const resolveResponse = await app.inject({
      method: "POST",
      url: `/api/pending-confirmations/${encodeURIComponent(target.id)}/resolve`,
      payload: {
        note: "改为10年交",
        correction: {
          paymentPeriodRaw: "10年",
        },
      },
    });

    expect(resolveResponse.statusCode).toBe(200);
    expect(resolveResponse.json()).toMatchObject({
      ok: true,
      appliedCorrection: true,
    });
    expect(resolveResponse.json().remindersGenerated).toBeGreaterThan(0);

    const remindersResponse = await app.inject({
      method: "GET",
      url: "/api/reminders?status=pending",
    });
    expect(
      remindersResponse
        .json()
        .items.some((item: { policyId?: string }) => item.policyId === target.payload.policyId),
    ).toBe(true);

    const openResponse = await app.inject({
      method: "GET",
      url: "/api/pending-confirmations",
    });
    expect(openResponse.json().items.some((item: { id: string }) => item.id === target.id)).toBe(
      false,
    );
    await app.close();
  });

  it("accepts imported key field changes through pending confirmation resolution", async () => {
    const dbPath = tempDbPath();
    const db = openDatabase(dbPath);
    runMigrations(db);
    const customers = new CustomerRepository(db);
    const policies = new PolicyRepository(db);
    const pending = new PendingChangeRepository(db);
    customers.upsertFromImport({
      id: "customer:zhangsan",
      name: "张三",
      birthDate: "1980-01-01",
    });
    policies.upsertFromImport({
      id: "policy:one",
      applicantName: "张三",
      insuredName: "张三",
      insuredCustomerId: "customer:zhangsan",
      productName: "年金A",
      premium: 10000,
      paymentPeriodRaw: "10年",
      effectiveDate: "2023-06-01",
    });
    pending.create({
      id: "pending:key_field_changed:policy:policy:one",
      reason: "key_field_changed",
      title: "张三 - 年金A 的关键字段变化需确认",
      detail: "再次导入时发现保费、缴费期间与当前记录不一致。",
      payload: {
        entityType: "policy",
        policyId: "policy:one",
        changes: [
          { field: "premium", label: "保费", current: 10000, incoming: 12000 },
          { field: "paymentPeriodRaw", label: "缴费期间", current: "10年", incoming: "20年" },
        ],
      },
    });
    db.close();

    const app = buildServer({ dbPath, today: "2026-06-17" });
    const resolveResponse = await app.inject({
      method: "POST",
      url: "/api/pending-confirmations/pending%3Akey_field_changed%3Apolicy%3Apolicy%3Aone/resolve",
      payload: {
        note: "确认采用导入值",
      },
    });

    expect(resolveResponse.statusCode).toBe(200);
    expect(resolveResponse.json()).toMatchObject({
      ok: true,
      appliedCorrection: true,
    });

    const dbAfter = openDatabase(dbPath);
    runMigrations(dbAfter);
    const policiesAfter = new PolicyRepository(dbAfter);
    const pendingAfter = new PendingChangeRepository(dbAfter);
    expect(policiesAfter.findByBusinessKey("policy:one")).toMatchObject({
      premium: 12000,
      paymentPeriodRaw: "20年",
    });
    expect(pendingAfter.findById("pending:key_field_changed:policy:policy:one")?.status).toBe(
      "resolved",
    );
    dbAfter.close();
    await app.close();
  });

  it("rejects invalid pending correction values", async () => {
    const app = buildServer({ dbPath: tempDbPath(), today: "2026-06-17" });

    await app.inject({
      method: "POST",
      url: "/api/imports",
      payload: {
        policyWorkbookPath: "tests/fixtures/policy-performance.xlsx",
      },
    });

    const beforeResponse = await app.inject({
      method: "GET",
      url: "/api/pending-confirmations",
    });
    const target = beforeResponse.json().items.find((item: { payload: { policyId?: string } }) => {
      return item.payload.policyId;
    });

    const resolveResponse = await app.inject({
      method: "POST",
      url: `/api/pending-confirmations/${encodeURIComponent(target.id)}/resolve`,
      payload: {
        correction: {
          effectiveDate: "2026-13-99",
        },
      },
    });

    expect(resolveResponse.statusCode).toBe(400);
    expect(resolveResponse.json()).toEqual({ error: "invalid_effective_date" });
    await app.close();
  });

  it("returns a Feishu sync dry-run summary", async () => {
    const app = buildServer({ dbPath: tempDbPath(), today: "2026-06-17" });

    await app.inject({
      method: "POST",
      url: "/api/imports",
      payload: {
        customerWorkbookPath: "tests/fixtures/customer-info.xlsx",
        policyWorkbookPath: "tests/fixtures/policy-performance.xlsx",
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/sync/feishu/dry-run",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      mode: "dry-run",
      summary: {
        customers: expect.any(Number),
        policies: expect.any(Number),
        reminders: expect.any(Number),
        keyCalendarReminders: expect.any(Number),
      },
    });
    expect(response.json().summary.customers).toBeGreaterThan(0);
    expect(response.json().preview.customers[0].maskedIdNumber).toContain("*");
    await app.close();
  });

  it("returns a Feishu Calendar key reminder sync plan", async () => {
    const app = buildServer({ dbPath: tempDbPath(), today: "2026-06-17" });

    await app.inject({
      method: "POST",
      url: "/api/todos",
      payload: {
        title: "关键客户跟进",
        reminderDate: "2026-06-18",
        isKey: true,
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/sync/feishu/calendar",
      payload: {
        mode: "plan",
        calendarId: "primary",
        limit: 10,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      mode: "plan",
      calendarId: "primary",
      summary: {
        planned: 1,
        created: 0,
        failed: 0,
      },
    });
    expect(response.json().commands[0].argv).toEqual(
      expect.arrayContaining(["calendar", "+create", "--summary", "关键客户跟进"]),
    );
    await app.close();
  });

  it("requires confirmation before executing all Feishu Calendar events", async () => {
    const app = buildServer({ dbPath: tempDbPath(), today: "2026-06-17" });

    const response = await app.inject({
      method: "POST",
      url: "/api/sync/feishu/calendar",
      payload: {
        mode: "execute",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "full_sync_confirmation_required" });
    await app.close();
  });

  it("validates Feishu Base sync requests before writing externally", async () => {
    const app = buildServer({ dbPath: tempDbPath(), today: "2026-06-17" });

    const missingTokenResponse = await app.inject({
      method: "POST",
      url: "/api/sync/feishu/base",
      payload: {
        mode: "plan",
      },
    });
    expect(missingTokenResponse.statusCode).toBe(400);
    expect(missingTokenResponse.json()).toEqual({ error: "base_token_required" });

    const fullSyncResponse = await app.inject({
      method: "POST",
      url: "/api/sync/feishu/base",
      payload: {
        mode: "execute",
        baseToken: "app_test_token",
      },
    });
    expect(fullSyncResponse.statusCode).toBe(400);
    expect(fullSyncResponse.json()).toEqual({ error: "full_sync_confirmation_required" });
    await app.close();
  });

  it("returns a masked Feishu Base schema plan", async () => {
    const app = buildServer({ dbPath: tempDbPath(), today: "2026-06-17" });

    const response = await app.inject({
      method: "POST",
      url: "/api/sync/feishu/base/schema",
      payload: {
        mode: "plan",
        baseToken: "app_schema_token",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      mode: "plan",
      summary: {
        planned: 3,
      },
    });
    expect(JSON.stringify(response.json())).toContain("<base-token>");
    expect(JSON.stringify(response.json())).not.toContain("app_schema_token");
    await app.close();
  });

  it("returns a masked Feishu Base calendar view plan", async () => {
    const app = buildServer({ dbPath: tempDbPath(), today: "2026-06-17" });

    const response = await app.inject({
      method: "POST",
      url: "/api/sync/feishu/base/calendar-view",
      payload: {
        mode: "plan",
        baseToken: "app_view_token",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      mode: "plan",
      summary: {
        planned: 3,
      },
      tableName: "提醒",
      viewName: "提醒日历",
    });
    expect(JSON.stringify(response.json())).toContain("<base-token>");
    expect(JSON.stringify(response.json())).not.toContain("app_view_token");
    await app.close();
  });
});
