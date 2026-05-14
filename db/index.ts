import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

let _sqlite: Database.Database | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (_db) return _db;
  _sqlite = new Database(process.env.DATABASE_URL ?? "./local.db");
  _sqlite.pragma("journal_mode = WAL");
  _sqlite.pragma("foreign_keys = ON");
  _db = drizzle(_sqlite, { schema });
  return _db;
}

export function closeDb() {
  _sqlite?.close();
  _sqlite = null;
  _db = null;
}

export type DB = ReturnType<typeof getDb>;
