import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3-multiple-ciphers";

const SQLITE_HEADER = Buffer.from("SQLite format 3\0", "utf8");
const runtimeKeys = new Map<string, string>();

function normalizedPath(dbPath: string): string {
  return resolve(dbPath);
}

function envPassword(): string | undefined {
  const value = process.env.CUSTOMER_REMINDERS_DB_PASSWORD?.trim();
  return value || undefined;
}

function timestampLabel(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
}

function isPlainSqliteFile(dbPath: string): boolean {
  if (!existsSync(dbPath)) {
    return true;
  }
  if (statSync(dbPath).size === 0) {
    return true;
  }
  const header = readFileSync(dbPath).subarray(0, SQLITE_HEADER.length);
  return header.equals(SQLITE_HEADER);
}

function verifyEncryptedDatabase(dbPath: string, password: string): void {
  const db = new Database(dbPath, { fileMustExist: true });
  try {
    db.key(Buffer.from(password));
    db.prepare("SELECT name FROM sqlite_master LIMIT 1").get();
  } catch {
    throw new Error("database_password_invalid");
  } finally {
    db.close();
  }
}

export function databaseKeyFor(dbPath: string): string | undefined {
  return runtimeKeys.get(normalizedPath(dbPath)) ?? envPassword();
}

export function databaseNeedsKey(dbPath: string): boolean {
  return Boolean(databaseKeyFor(dbPath)) || !isPlainSqliteFile(dbPath);
}

export interface DatabaseEncryptionStatus {
  encrypted: boolean;
  unlocked: boolean;
  canEnable: boolean;
}

export function getDatabaseEncryptionStatus(dbPath: string): DatabaseEncryptionStatus {
  const encrypted = existsSync(dbPath) && !isPlainSqliteFile(dbPath);
  return {
    encrypted,
    unlocked: !encrypted || Boolean(databaseKeyFor(dbPath)),
    canEnable: !encrypted,
  };
}

export function unlockDatabase(dbPath: string, password: string): DatabaseEncryptionStatus {
  const trimmed = password.trim();
  if (!trimmed) {
    throw new Error("database_password_required");
  }
  if (!existsSync(dbPath) || isPlainSqliteFile(dbPath)) {
    throw new Error("database_not_encrypted");
  }
  verifyEncryptedDatabase(dbPath, trimmed);
  runtimeKeys.set(normalizedPath(dbPath), trimmed);
  return getDatabaseEncryptionStatus(dbPath);
}

export function enableDatabaseEncryption(dbPath: string, password: string): DatabaseEncryptionStatus {
  const trimmed = password.trim();
  if (trimmed.length < 8) {
    throw new Error("database_password_too_short");
  }
  mkdirSync(dirname(dbPath), { recursive: true });

  if (!existsSync(dbPath)) {
    const db = new Database(dbPath);
    db.prepare("CREATE TABLE IF NOT EXISTS __encryption_bootstrap (id INTEGER PRIMARY KEY)").run();
    db.prepare("DROP TABLE __encryption_bootstrap").run();
    db.close();
  }

  if (!isPlainSqliteFile(dbPath)) {
    unlockDatabase(dbPath, trimmed);
    return getDatabaseEncryptionStatus(dbPath);
  }

  const stats = statSync(dbPath);
  if (stats.size > 0) {
    copyFileSync(dbPath, `${dbPath}.bak-before-encryption-${timestampLabel()}`);
  }

  const db = new Database(dbPath, { fileMustExist: true });
  try {
    db.rekey(Buffer.from(trimmed));
  } finally {
    db.close();
  }
  runtimeKeys.set(normalizedPath(dbPath), trimmed);
  return getDatabaseEncryptionStatus(dbPath);
}

export function changeDatabasePassword(
  dbPath: string,
  currentPassword: string,
  nextPassword: string,
): DatabaseEncryptionStatus {
  const current = currentPassword.trim();
  const next = nextPassword.trim();
  if (next.length < 8) {
    throw new Error("database_password_too_short");
  }
  try {
    unlockDatabase(dbPath, current);
  } catch {
    throw new Error("database_current_password_invalid");
  }
  const db = new Database(dbPath, { fileMustExist: true });
  try {
    db.key(Buffer.from(current));
    db.rekey(Buffer.from(next));
  } finally {
    db.close();
  }
  runtimeKeys.set(normalizedPath(dbPath), next);
  return getDatabaseEncryptionStatus(dbPath);
}

export function replaceEncryptedDatabase(dbPath: string, sourcePath: string): void {
  const key = databaseKeyFor(dbPath);
  if (!key) {
    throw new Error("database_locked");
  }
  verifyEncryptedDatabase(sourcePath, key);
  mkdirSync(dirname(dbPath), { recursive: true });
  const tempPath = `${dbPath}.restore-${randomBytes(6).toString("hex")}`;
  copyFileSync(sourcePath, tempPath);
  renameSync(tempPath, dbPath);
}
