import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/server/db.js';
import { ClientRepository, PalletRepository } from '../src/server/repository.js';
import { loadFixture } from './helpers.js';

/**
 * Opening a database written by the version that had revisions.
 *
 * Every row in it is a design somebody drew, so the test that matters is that
 * none of them is lost and none of them is quietly changed into a different
 * pallet.
 */

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pallet-migration-'));
  path = join(dir, 'pallets.sqlite');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** The schema exactly as the previous version wrote it. */
function writeOldDatabase(rows: Array<Record<string, unknown>>): void {
  const db = new Database(path);
  db.exec(`
    CREATE TABLE pallets (
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
    CREATE INDEX pallets_by_client ON pallets (client_name, pallet_code);
    CREATE INDEX pallets_by_code ON pallets (pallet_code);
    CREATE INDEX pallets_by_supersedes ON pallets (supersedes);
    CREATE TRIGGER pallets_frozen_no_update
    BEFORE UPDATE ON pallets WHEN old.frozen = 1
    BEGIN SELECT RAISE(ABORT, 'a frozen revision is never edited'); END;
    CREATE TRIGGER pallets_frozen_no_delete
    BEFORE DELETE ON pallets WHEN old.frozen = 1
    BEGIN SELECT RAISE(ABORT, 'a frozen revision is never deleted'); END;
  `);

  const insert = db.prepare(
    `INSERT INTO pallets
       (id, pallet_code, client_name, pallet_name, revision, revision_date,
        supersedes, frozen, updated_at, doc)
     VALUES (@id, @pallet_code, @client_name, @pallet_name, @revision, @revision_date,
             @supersedes, @frozen, @updated_at, @doc)`,
  );
  for (const row of rows) insert.run(row);
  db.close();
}

/** An old-shape row: a fixture document with the revision fields put back on. */
function oldRow(fields: {
  id: string;
  code: string;
  client: string;
  name: string;
  revision: string;
  date: string;
  supersedes?: string;
  frozen?: boolean;
}) {
  const doc: Record<string, unknown> = { ...loadFixture('block-1000x800') };
  delete doc.clientId;
  delete doc.updatedAt;
  Object.assign(doc, {
    id: fields.id,
    palletCode: fields.code,
    clientName: fields.client,
    palletName: fields.name,
    revision: fields.revision,
    revisionDate: fields.date,
    supersedes: fields.supersedes,
    frozen: fields.frozen ?? false,
  });
  return {
    id: fields.id,
    pallet_code: fields.code,
    client_name: fields.client,
    pallet_name: fields.name,
    revision: fields.revision,
    revision_date: fields.date,
    supersedes: fields.supersedes ?? null,
    frozen: fields.frozen ? 1 : 0,
    updated_at: `${fields.date}T09:00:00.000Z`,
    doc: JSON.stringify(doc),
  };
}

describe('opening a database from the version that had revisions', () => {
  beforeEach(() => {
    writeOldDatabase([
      oldRow({ id: 'p1', code: 'AP-001', client: 'ACME Logistics', name: '1000 x 800',
               revision: 'A', date: '2025-03-04', frozen: true }),
      oldRow({ id: 'p2', code: 'AP-001', client: 'ACME Logistics', name: '1000 x 800',
               revision: 'B', date: '2025-09-18', supersedes: 'p1' }),
      oldRow({ id: 'p3', code: 'BF-007', client: 'Britannia Foods', name: '1200 x 1000',
               revision: 'A', date: '2026-01-22' }),
    ]);
  });

  it('keeps every design', () => {
    const db = openDb(path);
    expect(new PalletRepository(db).list()).toHaveLength(3);
  });

  it('turns each distinct client name into a client of their own', () => {
    const db = openDb(path);
    expect(new ClientRepository(db).list().map((client) => client.name)).toEqual([
      'ACME Logistics',
      'Britannia Foods',
    ]);
  });

  it('points every design at its client, name and all', () => {
    const db = openDb(path);
    const clients = new ClientRepository(db);
    const acme = clients.list().find((client) => client.name === 'ACME Logistics')!;
    const pallets = new PalletRepository(db);

    for (const id of ['p1', 'p2']) {
      const design = pallets.get(id);
      expect(design.clientId).toBe(acme.id);
      expect(design.clientName).toBe('ACME Logistics');
    }
  });

  /**
   * Two rows that were revisions of each other are now two ordinary designs
   * with the same code and the same name. Folding the letter into the name is
   * what keeps them told apart on the dashboard.
   */
  it('keeps a chain of revisions apart by name', () => {
    const db = openDb(path);
    const pallets = new PalletRepository(db);
    expect(pallets.get('p1').palletName).toBe('1000 x 800');
    expect(pallets.get('p2').palletName).toBe('1000 x 800 (rev B)');
    expect(pallets.get('p3').palletName).toBe('1200 x 1000');
  });

  it('carries the revision date over as the date the design was last saved', () => {
    const db = openDb(path);
    const pallets = new PalletRepository(db);
    expect(pallets.get('p1').updatedAt).toBe('2025-03-04');
    expect(pallets.get('p2').updatedAt).toBe('2025-09-18');
    expect(pallets.get('p3').updatedAt).toBe('2026-01-22');
  });

  it('leaves the geometry untouched', () => {
    const db = openDb(path);
    const original = loadFixture('block-1000x800');
    expect(new PalletRepository(db).get('p1').layers).toEqual(original.layers);
  });

  it('drops every trace of the old model', () => {
    const db = openDb(path);
    const stored = db.prepare<[string], { doc: string }>('SELECT doc FROM pallets WHERE id = ?').get('p1')!;
    const doc = JSON.parse(stored.doc) as Record<string, unknown>;
    expect(doc).not.toHaveProperty('revision');
    expect(doc).not.toHaveProperty('revisionDate');
    expect(doc).not.toHaveProperty('supersedes');
    expect(doc).not.toHaveProperty('frozen');

    const triggers = db
      .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'trigger'")
      .all();
    expect(triggers).toHaveLength(0);
  });

  /** What used to be frozen is now an ordinary design, and can be edited. */
  it('lets a design that was published be edited like any other', () => {
    const db = openDb(path);
    const pallets = new PalletRepository(db);
    const clients = new ClientRepository(db);
    const published = pallets.get('p1');
    expect(() => pallets.save({ ...published, palletName: 'reworked' }, clients)).not.toThrow();
    expect(pallets.get('p1').palletName).toBe('reworked');
    expect(() => pallets.delete('p1')).not.toThrow();
  });

  it('runs once and is happy to be opened again afterwards', () => {
    openDb(path).close();
    const db = openDb(path);
    expect(new PalletRepository(db).list()).toHaveLength(3);
    expect(new ClientRepository(db).list()).toHaveLength(2);
  });

  /**
   * The conversion cannot be undone, and the routine backup at startup is taken
   * after the database is opened — by which time it has already happened. So
   * the migration keeps its own copy of what it found.
   */
  it('leaves a copy of the database as it was before it converted anything', () => {
    openDb(path).close();
    const before = join(dir, 'pallets-before-revisions-removed.sqlite');
    expect(existsSync(before)).toBe(true);

    const old = new Database(before, { readonly: true });
    try {
      const rows = old
        .prepare<[], { id: string; revision: string; frozen: number }>(
          'SELECT id, revision, frozen FROM pallets ORDER BY id',
        )
        .all();
      expect(rows).toEqual([
        { id: 'p1', revision: 'A', frozen: 1 },
        { id: 'p2', revision: 'B', frozen: 0 },
        { id: 'p3', revision: 'A', frozen: 0 },
      ]);
    } finally {
      old.close();
    }
  });
});

describe('a database that never had revisions', () => {
  it('opens without migrating anything', () => {
    const db = openDb(path);
    expect(new PalletRepository(db).list()).toEqual([]);
    expect(new ClientRepository(db).list()).toEqual([]);
  });
});
