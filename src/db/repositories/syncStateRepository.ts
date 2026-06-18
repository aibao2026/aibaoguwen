import { createHash } from "node:crypto";
import type { AppDatabase } from "../connection";

export class SyncStateRepository {
  constructor(private readonly db: AppDatabase) {}

  get(key: string): string | undefined {
    const row = this.db
      .prepare("SELECT value FROM sync_state WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row?.value;
  }

  set(key: string, value: string): void {
    this.db
      .prepare(
        `
        INSERT INTO sync_state (key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `,
      )
      .run(key, value);
  }
}

export function feishuRecordStateKey(input: {
  baseToken: string;
  tableRef: string;
  externalId: string;
}) {
  const baseHash = createHash("sha256").update(input.baseToken).digest("hex").slice(0, 16);
  return `feishu:${baseHash}:${input.tableRef}:${input.externalId}`;
}

export function feishuCalendarEventStateKey(input: {
  calendarId: string;
  externalId: string;
}) {
  const calendarHash = createHash("sha256").update(input.calendarId).digest("hex").slice(0, 16);
  return `feishu-calendar:${calendarHash}:${input.externalId}`;
}
