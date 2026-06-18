import type { AppDatabase } from "./connection";
import { makeCustomerBusinessKey } from "../domain/ids";

interface LegacyCustomerRow {
  id: string;
  name: string;
  full_id_number?: string;
  masked_id_number?: string;
  phone?: string;
  birth_date?: string;
}

interface LegacyPolicyRow {
  id: string;
  policy_number?: string;
  insured_name: string;
  product_name: string;
}

function normalizePart(value: string | undefined, fallback = "unknown"): string {
  const normalized = value?.trim().replace(/\s+/g, " ");
  return normalized ? normalized : fallback;
}

function upgradedPolicyId(policy: LegacyPolicyRow): string {
  return [
    "policy",
    normalizePart(policy.policy_number, ""),
    normalizePart(policy.insured_name),
    normalizePart(policy.product_name),
  ].join(":");
}

function migrateLegacyCustomerBusinessKeys(db: AppDatabase): void {
  const candidateCustomers = db
    .prepare(
      `
      SELECT id, name, full_id_number, masked_id_number, phone, birth_date
      FROM customers
      WHERE id LIKE 'customer:%'
    `,
    )
    .all() as LegacyCustomerRow[];

  const legacyCustomers = candidateCustomers
    .map((customer) => ({
      ...customer,
      nextId: makeCustomerBusinessKey({
        name: customer.name,
        idNumber: customer.full_id_number ?? customer.masked_id_number,
      }),
    }))
    .filter((customer) => customer.nextId !== customer.id);

  if (legacyCustomers.length === 0) {
    return;
  }

  const findCustomer = db.prepare("SELECT id FROM customers WHERE id = ?");
  const mergeCustomer = db.prepare(
    `
    UPDATE customers
    SET
      full_id_number = COALESCE(full_id_number, @fullIdNumber),
      masked_id_number = COALESCE(masked_id_number, @maskedIdNumber),
      phone = COALESCE(phone, @phone),
      birth_date = COALESCE(birth_date, @birthDate)
    WHERE id = @id
  `,
  );
  const updateCustomerId = db.prepare("UPDATE customers SET id = ? WHERE id = ?");
  const deleteCustomer = db.prepare("DELETE FROM customers WHERE id = ?");
  const updatePolicyApplicant = db.prepare(
    "UPDATE policies SET applicant_customer_id = ? WHERE applicant_customer_id = ?",
  );
  const updatePolicyInsured = db.prepare(
    "UPDATE policies SET insured_customer_id = ? WHERE insured_customer_id = ?",
  );
  const updateReminderCustomer = db.prepare(
    "UPDATE reminders SET customer_id = ? WHERE customer_id = ?",
  );
  const remindersByIdText = db.prepare("SELECT id FROM reminders WHERE instr(id, ?) > 0");
  const findReminder = db.prepare("SELECT id FROM reminders WHERE id = ?");
  const updateReminderId = db.prepare("UPDATE reminders SET id = ? WHERE id = ?");
  const deleteReminder = db.prepare("DELETE FROM reminders WHERE id = ?");
  const pendingByIdText = db.prepare(
    "SELECT id FROM pending_confirmations WHERE instr(id, ?) > 0",
  );
  const findPending = db.prepare("SELECT id FROM pending_confirmations WHERE id = ?");
  const updatePendingId = db.prepare("UPDATE pending_confirmations SET id = ? WHERE id = ?");
  const deletePending = db.prepare("DELETE FROM pending_confirmations WHERE id = ?");
  const updatePendingPayload = db.prepare(
    "UPDATE pending_confirmations SET payload_json = REPLACE(payload_json, ?, ?)",
  );
  const syncStatesByCustomer = db.prepare("SELECT key FROM sync_state WHERE instr(key, ?) > 0");
  const findSyncState = db.prepare("SELECT key FROM sync_state WHERE key = ?");
  const updateSyncStateKey = db.prepare("UPDATE sync_state SET key = ? WHERE key = ?");
  const deleteSyncState = db.prepare("DELETE FROM sync_state WHERE key = ?");

  const migrate = db.transaction(() => {
    for (const customer of legacyCustomers) {
      const oldId = customer.id;
      const nextId = customer.nextId;

      updatePolicyApplicant.run(nextId, oldId);
      updatePolicyInsured.run(nextId, oldId);
      updateReminderCustomer.run(nextId, oldId);

      const oldReminders = remindersByIdText.all(oldId) as Array<{ id: string }>;
      for (const reminder of oldReminders) {
        const nextReminderId = reminder.id.replace(oldId, nextId);
        if (nextReminderId === reminder.id) {
          continue;
        }
        if (findReminder.get(nextReminderId)) {
          deleteReminder.run(reminder.id);
        } else {
          updateReminderId.run(nextReminderId, reminder.id);
        }
      }

      const oldPendingItems = pendingByIdText.all(oldId) as Array<{ id: string }>;
      for (const item of oldPendingItems) {
        const nextPendingId = item.id.replace(oldId, nextId);
        if (nextPendingId === item.id) {
          continue;
        }
        if (findPending.get(nextPendingId)) {
          deletePending.run(item.id);
        } else {
          updatePendingId.run(nextPendingId, item.id);
        }
      }
      updatePendingPayload.run(oldId, nextId);

      const oldSyncStates = syncStatesByCustomer.all(oldId) as Array<{ key: string }>;
      for (const state of oldSyncStates) {
        const nextKey = state.key.replace(oldId, nextId);
        if (nextKey === state.key) {
          continue;
        }
        if (findSyncState.get(nextKey)) {
          deleteSyncState.run(state.key);
        } else {
          updateSyncStateKey.run(nextKey, state.key);
        }
      }

      if (findCustomer.get(nextId)) {
        mergeCustomer.run({
          id: nextId,
          fullIdNumber: customer.full_id_number ?? null,
          maskedIdNumber: customer.masked_id_number ?? null,
          phone: customer.phone ?? null,
          birthDate: customer.birth_date ?? null,
        });
        deleteCustomer.run(oldId);
      } else {
        updateCustomerId.run(nextId, oldId);
      }
    }
  });

  migrate();
}

function migrateLegacyPolicyBusinessKeys(db: AppDatabase): void {
  const legacyPolicies = db
    .prepare(
      `
      SELECT id, policy_number, insured_name, product_name
      FROM policies
      WHERE policy_number IS NOT NULL
        AND TRIM(policy_number) <> ''
        AND id = 'policy:' || TRIM(policy_number)
    `,
    )
    .all() as LegacyPolicyRow[];

  if (legacyPolicies.length === 0) {
    return;
  }

  const updatePolicyId = db.prepare("UPDATE policies SET id = ? WHERE id = ?");
  const deletePolicy = db.prepare("DELETE FROM policies WHERE id = ?");
  const findPolicy = db.prepare("SELECT id FROM policies WHERE id = ?");
  const findReminder = db.prepare("SELECT id FROM reminders WHERE id = ?");
  const updateReminder = db.prepare(
    "UPDATE reminders SET id = ?, policy_id = ? WHERE id = ?",
  );
  const deleteReminder = db.prepare("DELETE FROM reminders WHERE id = ?");
  const remindersByPolicy = db.prepare("SELECT id FROM reminders WHERE policy_id = ?");
  const updatePendingPayload = db.prepare(
    "UPDATE pending_confirmations SET payload_json = REPLACE(payload_json, ?, ?)",
  );
  const syncStatesByPolicy = db.prepare("SELECT key FROM sync_state WHERE instr(key, ?) > 0");
  const findSyncState = db.prepare("SELECT key FROM sync_state WHERE key = ?");
  const updateSyncStateKey = db.prepare("UPDATE sync_state SET key = ? WHERE key = ?");
  const deleteSyncState = db.prepare("DELETE FROM sync_state WHERE key = ?");

  const migrate = db.transaction(() => {
    for (const policy of legacyPolicies) {
      const oldId = policy.id;
      const nextId = upgradedPolicyId(policy);
      if (!nextId || nextId === oldId) {
        continue;
      }

      const oldReminders = remindersByPolicy.all(oldId) as Array<{ id: string }>;
      for (const reminder of oldReminders) {
        const nextReminderId = reminder.id.replace(oldId, nextId);
        if (nextReminderId !== reminder.id && findReminder.get(nextReminderId)) {
          deleteReminder.run(reminder.id);
        } else {
          updateReminder.run(nextReminderId, nextId, reminder.id);
        }
      }

      updatePendingPayload.run(oldId, nextId);

      const oldSyncStates = syncStatesByPolicy.all(oldId) as Array<{ key: string }>;
      for (const state of oldSyncStates) {
        const nextKey = state.key.replace(oldId, nextId);
        if (nextKey === state.key) {
          continue;
        }
        if (findSyncState.get(nextKey)) {
          deleteSyncState.run(state.key);
        } else {
          updateSyncStateKey.run(nextKey, state.key);
        }
      }

      if (findPolicy.get(nextId)) {
        deletePolicy.run(oldId);
      } else {
        updatePolicyId.run(nextId, oldId);
      }
    }
  });

  migrate();
}

export function runMigrations(db: AppDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      full_id_number TEXT,
      masked_id_number TEXT,
      phone TEXT,
      birth_date TEXT
    );

    CREATE TABLE IF NOT EXISTS policies (
      id TEXT PRIMARY KEY,
      policy_number TEXT,
      applicant_customer_id TEXT,
      insured_customer_id TEXT,
      applicant_name TEXT NOT NULL,
      applicant_masked_id_number TEXT,
      insured_name TEXT NOT NULL,
      insured_masked_id_number TEXT,
      product_name TEXT NOT NULL,
      insurer_name TEXT,
      premium REAL,
      payment_method TEXT,
      payment_period_raw TEXT,
      effective_date TEXT
    );

    CREATE TABLE IF NOT EXISTS reminders (
      id TEXT PRIMARY KEY,
      group_name TEXT NOT NULL,
      title TEXT NOT NULL,
      reminder_date TEXT NOT NULL,
      status TEXT NOT NULL,
      is_key INTEGER NOT NULL DEFAULT 0,
      customer_id TEXT,
      policy_id TEXT,
      source TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pending_confirmations (
      id TEXT PRIMARY KEY,
      reason TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      resolution_note TEXT,
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sync_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const pendingColumns = db
    .prepare("PRAGMA table_info(pending_confirmations)")
    .all() as Array<{ name: string }>;
  const columnNames = new Set(pendingColumns.map((column) => column.name));
  if (!columnNames.has("status")) {
    db.exec("ALTER TABLE pending_confirmations ADD COLUMN status TEXT NOT NULL DEFAULT 'open'");
  }
  if (!columnNames.has("resolution_note")) {
    db.exec("ALTER TABLE pending_confirmations ADD COLUMN resolution_note TEXT");
  }
  if (!columnNames.has("resolved_at")) {
    db.exec("ALTER TABLE pending_confirmations ADD COLUMN resolved_at TEXT");
  }

  migrateLegacyCustomerBusinessKeys(db);
  migrateLegacyPolicyBusinessKeys(db);
}
