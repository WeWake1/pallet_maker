import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * One local SQLite file. No server, no accounts, no cloud: the tool runs on the
 * owner's machine and this is the whole of its persistence.
 *
 * A pallet is stored as its document, with the few fields the design list needs
 * lifted out into columns. The document is the truth; the columns are an index.
 */

export type Db = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS pallets (
  id            TEXT PRIMARY KEY,
  pallet_code   TEXT NOT NULL,
  client_name   TEXT NOT NULL,
  pallet_name   TEXT NOT NULL,
  revision      TEXT NOT NULL,
  revision_date TEXT NOT NULL,
  supersedes    TEXT,
  frozen        INTEGER NOT NULL DEFAULT 0,
  updated_at    TEXT NOT NULL,
  doc           TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS pallets_by_client ON pallets (client_name, pallet_code);
CREATE INDEX IF NOT EXISTS pallets_by_code ON pallets (pallet_code);
CREATE INDEX IF NOT EXISTS pallets_by_supersedes ON pallets (supersedes);

-- A published revision is never edited. The rule is worth nothing if only the
-- application enforces it, because the record has to survive being wrong about
-- itself: a pallet built last year was built to rev A, and that row has to
-- still say what it said then.
CREATE TRIGGER IF NOT EXISTS pallets_frozen_no_update
BEFORE UPDATE ON pallets
WHEN old.frozen = 1
BEGIN
  SELECT RAISE(ABORT, 'a frozen revision is never edited');
END;

CREATE TRIGGER IF NOT EXISTS pallets_frozen_no_delete
BEFORE DELETE ON pallets
WHEN old.frozen = 1
BEGIN
  SELECT RAISE(ABORT, 'a frozen revision is never deleted');
END;
`;

/** The default location of the database file. */
export const DEFAULT_DB_PATH = resolve(process.cwd(), 'data', 'pallets.sqlite');

export function openDb(path: string = DEFAULT_DB_PATH): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}
