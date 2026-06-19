import Database from "better-sqlite3-multiple-ciphers";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { databaseKeyFor, databaseNeedsKey } from "./encryption";

export type AppDatabase = Database.Database;

export function openDatabase(path: string): AppDatabase {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  if (path !== ":memory:" && databaseNeedsKey(path)) {
    const key = databaseKeyFor(path);
    if (!key) {
      db.close();
      throw new Error("database_locked");
    }
    db.key(Buffer.from(key));
  }
  return db;
}
