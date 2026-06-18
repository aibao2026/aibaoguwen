import { openDatabase } from "../db/connection";
import { runMigrations } from "../db/migrations";
import {
  feishuCalendarEventStateKey,
  SyncStateRepository,
} from "../db/repositories/syncStateRepository";
import { buildFeishuSyncSnapshot, type FeishuReminderRow } from "./feishuSnapshot";
import { defaultLarkCliRunner, type LarkCliRunner } from "./larkCli";

type CalendarSyncMode = "plan" | "execute";

export interface FeishuCalendarSyncInput {
  dbPath: string;
  mode: CalendarSyncMode;
  calendarId?: string;
  startTime?: string;
  durationMinutes?: number;
  limit?: number;
  today?: string;
  runner?: LarkCliRunner;
}

export interface FeishuCalendarSyncCommand {
  externalId: string;
  title: string;
  reminderDate: string;
  operation: "create" | "skip_existing";
  calendarId: string;
  eventId?: string;
  argv: string[];
}

export interface FeishuCalendarSyncResult {
  mode: CalendarSyncMode;
  calendarId: string;
  summary: {
    planned: number;
    created: number;
    skippedExisting: number;
    failed: number;
    skippedByLimit: number;
  };
  commands: FeishuCalendarSyncCommand[];
  errors: Array<{ externalId: string; message: string }>;
}

function isDateOnly(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function parseClock(value: string): { hour: number; minute: number } {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    throw new Error("invalid_calendar_start_time");
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    throw new Error("invalid_calendar_start_time");
  }
  return { hour, minute };
}

function formatIsoWithChinaOffset(date: string, clock: { hour: number; minute: number }) {
  return `${date}T${String(clock.hour).padStart(2, "0")}:${String(clock.minute).padStart(2, "0")}:00+08:00`;
}

function addMinutes(clock: { hour: number; minute: number }, durationMinutes: number) {
  const total = clock.hour * 60 + clock.minute + durationMinutes;
  if (total > 24 * 60) {
    throw new Error("invalid_calendar_duration");
  }
  return {
    hour: Math.floor(total / 60),
    minute: total % 60,
  };
}

function descriptionFor(row: FeishuReminderRow) {
  return [
    "AI保顾问自动同步",
    `分组：${row.group}`,
    `来源：${row.source}`,
    `外部ID：${row.externalId}`,
    row.customerExternalId ? `客户ID：${row.customerExternalId}` : undefined,
    row.policyExternalId ? `保单ID：${row.policyExternalId}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

function parseEventId(stdout: string): string | undefined {
  try {
    const parsed = JSON.parse(stdout) as {
      event?: { event_id?: string; id?: string };
      data?: { event?: { event_id?: string; id?: string }; event_id?: string };
      event_id?: string;
    };
    return (
      parsed.event?.event_id ??
      parsed.event?.id ??
      parsed.data?.event?.event_id ??
      parsed.data?.event?.id ??
      parsed.data?.event_id ??
      parsed.event_id
    );
  } catch {
    return undefined;
  }
}

function argvForReminder(input: {
  row: FeishuReminderRow;
  calendarId: string;
  startTime: string;
  durationMinutes: number;
}) {
  if (!isDateOnly(input.row.reminderDate)) {
    throw new Error(`invalid_reminder_date:${input.row.externalId}`);
  }
  const startClock = parseClock(input.startTime);
  const endClock = addMinutes(startClock, input.durationMinutes);
  const argv = [
    "calendar",
    "+create",
    "--as",
    "user",
    "--summary",
    input.row.title,
    "--start",
    formatIsoWithChinaOffset(input.row.reminderDate, startClock),
    "--end",
    formatIsoWithChinaOffset(input.row.reminderDate, endClock),
    "--description",
    descriptionFor(input.row),
  ];
  if (input.calendarId !== "primary") {
    argv.splice(4, 0, "--calendar-id", input.calendarId);
  }
  return argv;
}

function keyReminderRows(dbPath: string, today?: string) {
  return buildFeishuSyncSnapshot(dbPath, { today }).reminders.filter(
    (row) => row.isKey && row.status === "pending",
  );
}

export async function syncFeishuCalendar(
  input: FeishuCalendarSyncInput,
): Promise<FeishuCalendarSyncResult> {
  const calendarId = input.calendarId?.trim() || "primary";
  const startTime = input.startTime?.trim() || "09:00";
  const durationMinutes = input.durationMinutes ?? 30;
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    throw new Error("invalid_calendar_duration");
  }

  const db = openDatabase(input.dbPath);
  runMigrations(db);
  const syncState = new SyncStateRepository(db);
  const runner = input.runner ?? defaultLarkCliRunner;
  const commands: FeishuCalendarSyncCommand[] = [];
  const errors: FeishuCalendarSyncResult["errors"] = [];
  let created = 0;
  let skippedExisting = 0;
  let failed = 0;

  try {
    const allRows = keyReminderRows(input.dbPath, input.today);
    const limitedRows = input.limit && input.limit > 0 ? allRows.slice(0, input.limit) : allRows;

    for (const row of limitedRows) {
      const stateKey = feishuCalendarEventStateKey({ calendarId, externalId: row.externalId });
      const existingEventId = syncState.get(stateKey);
      if (existingEventId) {
        skippedExisting += 1;
        commands.push({
          externalId: row.externalId,
          title: row.title,
          reminderDate: row.reminderDate,
          operation: "skip_existing",
          calendarId,
          eventId: existingEventId,
          argv: [],
        });
        continue;
      }

      const argv = argvForReminder({ row, calendarId, startTime, durationMinutes });
      commands.push({
        externalId: row.externalId,
        title: row.title,
        reminderDate: row.reminderDate,
        operation: "create",
        calendarId,
        argv,
      });

      if (input.mode === "plan") {
        continue;
      }

      try {
        const eventId = parseEventId((await runner(argv)).stdout);
        if (!eventId) {
          throw new Error("event_id_missing");
        }
        syncState.set(stateKey, eventId);
        created += 1;
      } catch (error) {
        failed += 1;
        errors.push({
          externalId: row.externalId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      mode: input.mode,
      calendarId,
      summary: {
        planned: limitedRows.length,
        created,
        skippedExisting,
        failed,
        skippedByLimit: allRows.length - limitedRows.length,
      },
      commands,
      errors,
    };
  } finally {
    db.close();
  }
}
