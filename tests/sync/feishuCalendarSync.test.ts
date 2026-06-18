import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../src/db/connection";
import { runMigrations } from "../../src/db/migrations";
import { ReminderRepository } from "../../src/db/repositories/reminderRepository";
import { syncFeishuCalendar } from "../../src/sync/feishuCalendarSync";
import type { LarkCliRunner } from "../../src/sync/larkCli";

const tempDirs: string[] = [];

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "customer-reminders-calendar-"));
  tempDirs.push(dir);
  return join(dir, "app.sqlite");
}

function seedReminder(
  dbPath: string,
  input: {
    id: string;
    title: string;
    isKey: boolean;
    status?: "pending" | "completed";
  },
) {
  const db = openDatabase(dbPath);
  runMigrations(db);
  new ReminderRepository(db).createManual({
    id: input.id,
    group: "manual_todo",
    title: input.title,
    reminderDate: "2026-06-17",
    status: input.status ?? "pending",
    isKey: input.isKey,
    source: "manual",
  });
  db.close();
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("feishu calendar sync", () => {
  it("builds calendar commands only for pending key reminders", async () => {
    const dbPath = tempDbPath();
    seedReminder(dbPath, { id: "reminder:key", title: "关键提醒", isKey: true });
    seedReminder(dbPath, { id: "reminder:normal", title: "普通提醒", isKey: false });
    seedReminder(dbPath, {
      id: "reminder:completed-key",
      title: "已完成关键提醒",
      isKey: true,
      status: "completed",
    });

    const result = await syncFeishuCalendar({
      dbPath,
      mode: "plan",
      calendarId: "primary",
    });

    expect(result.summary).toEqual({
      planned: 1,
      created: 0,
      skippedExisting: 0,
      failed: 0,
      skippedByLimit: 0,
    });
    expect(result.commands[0]).toMatchObject({
      externalId: "reminder:key",
      title: "关键提醒",
      operation: "create",
      calendarId: "primary",
    });
    expect(result.commands[0].argv).toEqual(
      expect.arrayContaining([
        "calendar",
        "+create",
        "--as",
        "user",
        "--summary",
        "关键提醒",
        "--start",
        "2026-06-17T09:00:00+08:00",
        "--end",
        "2026-06-17T09:30:00+08:00",
      ]),
    );
    expect(result.commands[0].argv).not.toContain("--calendar-id");
  });

  it("stores event ids and skips existing synced reminders", async () => {
    const dbPath = tempDbPath();
    seedReminder(dbPath, { id: "reminder:key", title: "关键提醒", isKey: true });
    const calls: string[][] = [];
    const runner: LarkCliRunner = async (argv) => {
      calls.push(argv);
      return { stdout: JSON.stringify({ event: { event_id: "evt_existing" } }), stderr: "" };
    };

    const first = await syncFeishuCalendar({
      dbPath,
      mode: "execute",
      calendarId: "primary",
      runner,
    });
    const second = await syncFeishuCalendar({
      dbPath,
      mode: "execute",
      calendarId: "primary",
      runner,
    });

    expect(first.summary).toMatchObject({ planned: 1, created: 1, skippedExisting: 0 });
    expect(second.summary).toMatchObject({ planned: 1, created: 0, skippedExisting: 1 });
    expect(second.commands[0]).toMatchObject({
      operation: "skip_existing",
      eventId: "evt_existing",
    });
    expect(calls).toHaveLength(1);
  });

  it("fails safely when the created event id is missing", async () => {
    const dbPath = tempDbPath();
    seedReminder(dbPath, { id: "reminder:key", title: "关键提醒", isKey: true });
    const runner: LarkCliRunner = async () => {
      return { stdout: JSON.stringify({ ok: true }), stderr: "" };
    };

    const result = await syncFeishuCalendar({
      dbPath,
      mode: "execute",
      calendarId: "primary",
      runner,
    });

    expect(result.summary).toMatchObject({ planned: 1, created: 0, failed: 1 });
    expect(result.errors[0]).toMatchObject({
      externalId: "reminder:key",
      message: "event_id_missing",
    });
  });
});
