// Opens the SQLite database and applies the migrations in ./drizzle. Called once by server.ts and by tests.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';

export type Database = BetterSQLite3Database<typeof schema>;

const IN_MEMORY_PATH = ':memory:';
const MIGRATIONS_FOLDER = './drizzle';

export function openDatabase(path: string): Database {
  if (path !== IN_MEMORY_PATH) {
    mkdirSync(dirname(path), { recursive: true });
  }

  const sqlite = new BetterSqlite3(path);
  // WAL lets readers run while a write is in progress; SQLite leaves foreign keys off unless asked.
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}
