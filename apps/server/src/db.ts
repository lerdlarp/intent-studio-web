import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export type Db = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY, sha256 TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL,
  size INTEGER NOT NULL, created_at TEXT NOT NULL, UNIQUE (sha256, kind)
);
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label TEXT NOT NULL, room_json TEXT NOT NULL, source_asset_id TEXT REFERENCES assets(id),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS rooms_project ON rooms(project_id);
CREATE TABLE IF NOT EXISTS designs (
  room_id TEXT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
  intents_json TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL, data_json TEXT NOT NULL, ies_asset_id TEXT REFERENCES assets(id), created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS products_project ON products(project_id);
CREATE TABLE IF NOT EXISTS ai_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, task TEXT NOT NULL, project_id TEXT, model TEXT,
  source TEXT NOT NULL, outcome TEXT NOT NULL, latency_ms INTEGER NOT NULL, prompt TEXT, response TEXT
);
`;

/** Open (creating if needed) the SQLite database and ensure the schema. `:memory:` is allowed. */
export function openDb(dbPath: string): Db {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}
