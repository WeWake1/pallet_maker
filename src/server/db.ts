import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { newId, today } from '../ids.js';

/**
 * One local SQLite file. No server, no accounts, no cloud: the tool runs on the
 * owner's machine and this is the whole of its persistence.
 *
 * A pallet is stored as its document, with the few fields the dashboard needs
 * lifted out into columns. The document is the truth; the columns are an index.
 *
 * A design is edited in place. There is no history: saving overwrites what was
 * there. To keep an old design, duplicate it before reworking it — the copy is
 * a separate row and the two never meet again.
 */

export type Db = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS clients (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pallets (
  id          TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  pallet_code TEXT NOT NULL,
  pallet_name TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  doc         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS pallets_by_client ON pallets (client_id, pallet_code);
CREATE INDEX IF NOT EXISTS pallets_by_code ON pallets (pallet_code);
`;

/** The default location of the database file. */
export const DEFAULT_DB_PATH = resolve(process.cwd(), 'data', 'pallets.sqlite');

export function openDb(path: string = DEFAULT_DB_PATH): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db, path);
  db.exec(SCHEMA);
  return db;
}

/**
 * A copy of the database as it stands, kept beside it under a name that says
 * what it is a copy of.
 *
 * The migration below only runs once and cannot be undone, and the routine
 * backup at startup is taken after the database is opened — which is after the
 * migration has already run. So the migration takes its own snapshot first,
 * and does not proceed without one.
 */
function snapshotBefore(db: Db, path: string): void {
  if (path === ':memory:') return;
  const copy = join(dirname(path), `${basename(path, '.sqlite')}-before-revisions-removed.sqlite`);
  if (existsSync(copy)) return;
  // VACUUM INTO writes a clean, self-contained copy, WAL and all.
  db.prepare('VACUUM INTO ?').run(copy);
  console.log(`Designs as they were before this version: ${copy}`);
}

function columns(db: Db, table: string): string[] {
  return db
    .prepare<[], { name: string }>(`PRAGMA table_info(${table})`)
    .all()
    .map((row) => row.name);
}

/**
 * Bring a database written by the version that had revisions up to date.
 *
 * Every row it holds is a design somebody drew, so nothing is dropped. Each
 * distinct client name becomes a client record, each pallet row is re-pointed
 * at it, and the revision letter is folded into the pallet name — rev B of a
 * design becomes "1000 x 800 (rev B)" — so that two rows which were revisions
 * of each other stay told apart on the dashboard, and neither is lost.
 */
function migrate(db: Db, path: string): void {
  const existing = columns(db, 'pallets');
  if (existing.length === 0 || existing.includes('client_id')) return;

  snapshotBefore(db, path);
  db.exec('PRAGMA foreign_keys = OFF');
  db.transaction(() => {
    // The triggers guarded frozen rows against being written. There is no such
    // thing now, and they would block the copy below.
    db.exec('DROP TRIGGER IF EXISTS pallets_frozen_no_update');
    db.exec('DROP TRIGGER IF EXISTS pallets_frozen_no_delete');
    // Indexes follow their table through a rename, and these names are wanted
    // for the new one.
    db.exec('DROP INDEX IF EXISTS pallets_by_client');
    db.exec('DROP INDEX IF EXISTS pallets_by_code');
    db.exec('DROP INDEX IF EXISTS pallets_by_supersedes');
    db.exec('ALTER TABLE pallets RENAME TO pallets_old_revisions');
    db.exec(SCHEMA);

    const rows = db
      .prepare<[], { id: string; client_name: string; pallet_code: string; pallet_name: string;
                     revision: string; revision_date: string; updated_at: string; doc: string }>(
        'SELECT * FROM pallets_old_revisions',
      )
      .all();

    const clientId = new Map<string, string>();
    const addClient = db.prepare('INSERT INTO clients (id, name, created_at) VALUES (?, ?, ?)');
    const addPallet = db.prepare(
      `INSERT INTO pallets (id, client_id, pallet_code, pallet_name, updated_at, doc)
       VALUES (@id, @client_id, @pallet_code, @pallet_name, @updated_at, @doc)`,
    );

    for (const row of rows) {
      const name = row.client_name.trim() || 'Unnamed client';
      let client = clientId.get(name);
      if (!client) {
        client = newId();
        clientId.set(name, client);
        addClient.run(client, name, row.updated_at ?? today());
      }

      // Rev A was the first of its line and needs no qualifier; anything later
      // was a separate row already and keeps its letter so the two stay apart.
      const suffix = row.revision && row.revision !== 'A' ? ` (rev ${row.revision})` : '';
      const palletName = `${row.pallet_name}${suffix}`;
      const updatedAt = (row.revision_date || row.updated_at || today()).slice(0, 10);

      const doc = JSON.parse(row.doc) as Record<string, unknown>;
      delete doc.revision;
      delete doc.revisionDate;
      delete doc.supersedes;
      delete doc.frozen;
      doc.clientId = client;
      doc.clientName = name;
      doc.palletName = palletName;
      doc.updatedAt = updatedAt;

      addPallet.run({
        id: row.id,
        client_id: client,
        pallet_code: row.pallet_code,
        pallet_name: palletName,
        updated_at: updatedAt,
        doc: JSON.stringify(doc),
      });
    }

    db.exec('DROP TABLE pallets_old_revisions');
  })();
  db.exec('PRAGMA foreign_keys = ON');
}
