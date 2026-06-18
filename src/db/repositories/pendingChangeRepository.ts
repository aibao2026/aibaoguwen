import type { PendingConfirmation } from "../../domain/types";
import type { AppDatabase } from "../connection";

interface PendingRow {
  id: string;
  reason: PendingConfirmation["reason"];
  title: string;
  detail: string;
  payload_json: string;
  status: "open" | "resolved";
  resolution_note?: string;
  resolved_at?: string;
}

function fromRow(row: PendingRow): PendingConfirmation {
  return {
    id: row.id,
    reason: row.reason,
    title: row.title,
    detail: row.detail,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    status: row.status,
    resolutionNote: row.resolution_note,
    resolvedAt: row.resolved_at,
  };
}

export class PendingChangeRepository {
  constructor(private readonly db: AppDatabase) {}

  create(pending: PendingConfirmation): void {
    this.db
      .prepare(
        `
        INSERT INTO pending_confirmations (id, reason, title, detail, payload_json, status)
        VALUES (@id, @reason, @title, @detail, @payloadJson, 'open')
        ON CONFLICT(id) DO UPDATE SET
          reason = excluded.reason,
          title = excluded.title,
          detail = excluded.detail,
          payload_json = excluded.payload_json,
          status = pending_confirmations.status,
          resolution_note = pending_confirmations.resolution_note,
          resolved_at = pending_confirmations.resolved_at
      `,
      )
      .run({ ...pending, payloadJson: JSON.stringify(pending.payload) });
  }

  resolve(id: string, note?: string, resolvedAt: string = new Date().toISOString()): boolean {
    const result = this.db
      .prepare(
        `
        UPDATE pending_confirmations
        SET status = 'resolved', resolution_note = @note, resolved_at = @resolvedAt
        WHERE id = @id AND status = 'open'
      `,
      )
      .run({ id, note: note ?? null, resolvedAt });
    return result.changes > 0;
  }

  resolveStaleOpen(validIds: Set<string>, note: string, resolvedAt: string = new Date().toISOString()): number {
    const validIdsClause =
      validIds.size > 0
        ? `AND id NOT IN (${[...validIds].map((_, index) => `@id${index}`).join(", ")})`
        : "";
    const params: Record<string, string> = { note, resolvedAt };
    [...validIds].forEach((id, index) => {
      params[`id${index}`] = id;
    });

    const result = this.db
      .prepare(
        `
        UPDATE pending_confirmations
        SET status = 'resolved', resolution_note = @note, resolved_at = @resolvedAt
        WHERE status = 'open'
          ${validIdsClause}
      `,
      )
      .run(params);
    return result.changes;
  }

  findById(id: string): PendingConfirmation | undefined {
    const row = this.db
      .prepare("SELECT * FROM pending_confirmations WHERE id = ?")
      .get(id) as PendingRow | undefined;
    return row ? fromRow(row) : undefined;
  }

  list(filters: { status?: "open" | "resolved" | "all" } = {}): PendingConfirmation[] {
    const status = filters.status ?? "open";
    const where = status === "all" ? "" : "WHERE status = @status";
    return (this.db
      .prepare(`SELECT * FROM pending_confirmations ${where} ORDER BY reason, title`)
      .all(status === "all" ? {} : { status }) as PendingRow[]).map(fromRow);
  }
}
