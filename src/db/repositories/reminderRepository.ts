import type { Reminder } from "../../domain/types";
import type { AppDatabase } from "../connection";

interface ReminderRow {
  id: string;
  group_name: Reminder["group"];
  title: string;
  reminder_date: string;
  status: Reminder["status"];
  is_key: number;
  customer_id?: string;
  policy_id?: string;
  source: Reminder["source"];
}

function fromRow(row: ReminderRow): Reminder {
  return {
    id: row.id,
    group: row.group_name,
    title: row.title,
    reminderDate: row.reminder_date,
    status: row.status,
    isKey: row.is_key === 1,
    customerId: row.customer_id,
    policyId: row.policy_id,
    source: row.source,
  };
}

export class ReminderRepository {
  constructor(private readonly db: AppDatabase) {}

  upsertGenerated(reminder: Reminder): void {
    const existing = this.findByBusinessKey(reminder.id);
    const status = existing?.status === "completed" ? "completed" : reminder.status;
    const params = {
      id: reminder.id,
      group: reminder.group,
      title: reminder.title,
      reminderDate: reminder.reminderDate,
      status,
      isKey: reminder.isKey ? 1 : 0,
      customerId: reminder.customerId ?? null,
      policyId: reminder.policyId ?? null,
      source: reminder.source,
    };

    this.db
      .prepare(
        `
        INSERT INTO reminders (
          id, group_name, title, reminder_date, status, is_key, customer_id, policy_id, source
        )
        VALUES (@id, @group, @title, @reminderDate, @status, @isKey, @customerId, @policyId, @source)
        ON CONFLICT(id) DO UPDATE SET
          group_name = excluded.group_name,
          title = excluded.title,
          reminder_date = excluded.reminder_date,
          status = excluded.status,
          is_key = reminders.is_key,
          customer_id = COALESCE(excluded.customer_id, reminders.customer_id),
          policy_id = COALESCE(excluded.policy_id, reminders.policy_id),
          source = excluded.source
      `,
      )
      .run(params);
  }

  markCompleted(id: string): boolean {
    const result = this.db.prepare("UPDATE reminders SET status = 'completed' WHERE id = ?").run(id);
    return result.changes > 0;
  }

  markCompletedByDate(reminderDate: string): number {
    const result = this.db
      .prepare("UPDATE reminders SET status = 'completed' WHERE reminder_date = ? AND status = 'pending'")
      .run(reminderDate);
    return result.changes;
  }

  markPending(id: string): boolean {
    const result = this.db.prepare("UPDATE reminders SET status = 'pending' WHERE id = ?").run(id);
    return result.changes > 0;
  }

  deleteManual(id: string): boolean {
    const result = this.db
      .prepare("DELETE FROM reminders WHERE id = ? AND group_name = 'manual_todo'")
      .run(id);
    return result.changes > 0;
  }

  deleteStaleGenerated(validIds: Set<string>, groups: Reminder["group"][]): number {
    if (groups.length === 0) {
      return 0;
    }

    const groupPlaceholders = groups.map((_, index) => `@group${index}`).join(", ");
    const params: Record<string, string> = Object.fromEntries(
      groups.map((group, index) => [`group${index}`, group]),
    );
    const validIdsClause =
      validIds.size > 0
        ? `AND id NOT IN (${[...validIds].map((_, index) => `@id${index}`).join(", ")})`
        : "";
    [...validIds].forEach((id, index) => {
      params[`id${index}`] = id;
    });

    const result = this.db
      .prepare(
        `
        DELETE FROM reminders
        WHERE group_name IN (${groupPlaceholders})
          AND source <> 'manual'
          ${validIdsClause}
      `,
      )
      .run(params);
    return result.changes;
  }

  updateManual(
    id: string,
    input: {
      title: string;
      reminderDate: string;
      isKey: boolean;
    },
  ): Reminder | undefined {
    const result = this.db
      .prepare(
        `
        UPDATE reminders
        SET title = @title, reminder_date = @reminderDate, is_key = @isKey
        WHERE id = @id AND group_name = 'manual_todo'
      `,
      )
      .run({
        id,
        title: input.title,
        reminderDate: input.reminderDate,
        isKey: input.isKey ? 1 : 0,
      });
    return result.changes > 0 ? this.findByBusinessKey(id) : undefined;
  }

  createManual(reminder: Reminder): void {
    this.db
      .prepare(
        `
        INSERT INTO reminders (
          id, group_name, title, reminder_date, status, is_key, customer_id, policy_id, source
        )
        VALUES (@id, @group, @title, @reminderDate, @status, @isKey, @customerId, @policyId, @source)
      `,
      )
      .run({
        id: reminder.id,
        group: reminder.group,
        title: reminder.title,
        reminderDate: reminder.reminderDate,
        status: reminder.status,
        isKey: reminder.isKey ? 1 : 0,
        customerId: reminder.customerId ?? null,
        policyId: reminder.policyId ?? null,
        source: reminder.source,
      });
  }

  findByBusinessKey(id: string): Reminder | undefined {
    const row = this.db
      .prepare("SELECT * FROM reminders WHERE id = ?")
      .get(id) as ReminderRow | undefined;
    return row ? fromRow(row) : undefined;
  }

  countGenerated(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS count FROM reminders WHERE source <> 'manual'")
      .get() as { count: number };
    return row.count;
  }

  list(filters: { status?: Reminder["status"]; group?: Reminder["group"] } = {}): Reminder[] {
    const where: string[] = [];
    const params: Record<string, string> = {};
    if (filters.status) {
      where.push("status = @status");
      params.status = filters.status;
    }
    if (filters.group) {
      where.push("group_name = @group");
      params.group = filters.group;
    }

    const sql = `
      SELECT * FROM reminders
      ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY reminder_date, title
    `;
    return (this.db.prepare(sql).all(params) as ReminderRow[]).map(fromRow);
  }
}
