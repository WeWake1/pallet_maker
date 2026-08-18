import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { convert } from '../src/cli/convert.js';
import { ClientRepository, PalletRepository } from '../src/server/repository.js';
import { FileStore, fileNameFor } from '../src/store/files.js';
import { cleanupStores, loadFixture, tempStore } from './helpers.js';

/**
 * Converting a database written by the version that had revisions.
 *
 * Every row in it is a design somebody drew, so the test that matters is that
 * none of them is lost and none of them is quietly changed into a different
 * pallet on the way into the folder.
 */

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pallet-migration-'));
  path = join(dir, 'pallets.sqlite');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  cleanupStores();
});

/** The database converted into a folder, ready to be read back. */
function converted(): { store: FileStore; pallets: PalletRepository; clients: ClientRepository } {
  const store = tempStore();
  convert(path, store.root);
  return { store, pallets: new PalletRepository(store), clients: new ClientRepository(store) };
}

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

describe('converting a database from the version that had revisions', () => {
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
    expect(converted().pallets.list()).toHaveLength(3);
  });

  it('turns each distinct client name into a client of their own', () => {
    expect(converted().clients.list().map((client) => client.name)).toEqual([
      'ACME Logistics',
      'Britannia Foods',
    ]);
  });

  it('points every design at its client, name and all', () => {
    const { pallets, clients } = converted();
    const acme = clients.list().find((client) => client.name === 'ACME Logistics')!;

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
    const { pallets } = converted();
    expect(pallets.get('p1').palletName).toBe('1000 x 800');
    expect(pallets.get('p2').palletName).toBe('1000 x 800 (rev B)');
    expect(pallets.get('p3').palletName).toBe('1200 x 1000');
  });

  it('carries the revision date over as the date the design was last saved', () => {
    const { pallets } = converted();
    expect(pallets.get('p1').updatedAt).toBe('2025-03-04');
    expect(pallets.get('p2').updatedAt).toBe('2025-09-18');
    expect(pallets.get('p3').updatedAt).toBe('2026-01-22');
  });

  it('leaves the geometry untouched', () => {
    const original = loadFixture('block-1000x800');
    expect(converted().pallets.get('p1').layers).toEqual(original.layers);
  });

  it('drops every trace of the old model', () => {
    const { store } = converted();
    // Read the file rather than the parsed design: the schema would drop an
    // unknown field on the way through, and the point is that it is not there.
    const doc = JSON.parse(
      readFileSync(join(store.designsDir, fileNameFor('p1')), 'utf8'),
    ) as Record<string, unknown>;
    expect(doc).not.toHaveProperty('revision');
    expect(doc).not.toHaveProperty('revisionDate');
    expect(doc).not.toHaveProperty('supersedes');
    expect(doc).not.toHaveProperty('frozen');
  });

  /** What used to be frozen is now an ordinary design, and can be edited. */
  it('lets a design that was published be edited like any other', () => {
    const { pallets, clients } = converted();
    const published = pallets.get('p1');
    expect(() => pallets.save({ ...published, palletName: 'reworked' }, clients)).not.toThrow();
    expect(pallets.get('p1').palletName).toBe('reworked');
    expect(() => pallets.delete('p1')).not.toThrow();
  });

  /** Every design lands in the file its id names, so the second run is a no-op. */
  it('can be run twice over the same folder without duplicating anything', () => {
    const store = tempStore();
    convert(path, store.root);
    convert(path, store.root);
    expect(new PalletRepository(store).list()).toHaveLength(3);
    expect(new ClientRepository(store).list()).toHaveLength(2);
  });

  /**
   * The conversion works on a copy, so the database it read is still the
   * database it was — revisions, frozen rows, triggers and all. That is the
   * whole safety net while the folder is being trusted for the first time:
   * running the old version again has to bring everything back.
   */
  it('leaves the database it read exactly as it found it', () => {
    const before = readFileSync(path);
    converted();
    expect(readFileSync(path).equals(before)).toBe(true);

    const old = new Database(path, { readonly: true });
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
      const triggers = old
        .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'trigger'")
        .all();
      expect(triggers).toHaveLength(2);
    } finally {
      old.close();
    }
  });
});

describe('converting a database in the shape this version writes', () => {
  /** The current schema, with a clients table and ids that mean something. */
  function writeCurrentDatabase(): { clientId: string } {
    const db = new Database(path);
    db.exec(`
      CREATE TABLE clients (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
      CREATE TABLE pallets (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, pallet_code TEXT NOT NULL,
        pallet_name TEXT NOT NULL, updated_at TEXT NOT NULL, doc TEXT NOT NULL);
    `);
    const clientId = 'client-acme';
    db.prepare('INSERT INTO clients VALUES (?, ?, ?)').run(clientId, 'ACME Logistics', '2025-01-05');
    const doc = {
      ...loadFixture('block-1000x800'),
      id: 'design-1',
      palletCode: 'AP-001',
      palletName: '1000 x 800',
      clientId,
      clientName: 'ACME Logistics',
      updatedAt: '2026-02-11',
    };
    db.prepare('INSERT INTO pallets VALUES (?, ?, ?, ?, ?, ?)').run(
      'design-1', clientId, 'AP-001', '1000 x 800', '2026-02-11', JSON.stringify(doc),
    );
    db.close();
    return { clientId };
  }

  /**
   * A conversion is the same library in a different shape, not a merge of two
   * of them. If the ids moved, the folder would only be equivalent to the
   * database rather than equal to it, and there would be no way left to check
   * that the move lost nothing.
   */
  it('carries the ids over exactly', () => {
    const { clientId } = writeCurrentDatabase();
    const { pallets, clients } = converted();

    expect(clients.list().map((client) => client.id)).toEqual([clientId]);
    expect(pallets.get('design-1').clientId).toBe(clientId);
    expect(clients.list()[0]!.createdAt).toBe('2025-01-05');
  });

  it('keeps the date the design was last saved rather than stamping today', () => {
    writeCurrentDatabase();
    expect(converted().pallets.get('design-1').updatedAt).toBe('2026-02-11');
  });

  it('does not make a second client of the same name when run again', () => {
    writeCurrentDatabase();
    const store = tempStore();
    convert(path, store.root);
    convert(path, store.root);
    expect(new ClientRepository(store).list()).toHaveLength(1);
    expect(new PalletRepository(store).list()).toHaveLength(1);
  });
});

describe('a database that never had revisions', () => {
  it('converts without migrating anything', () => {
    new Database(path).exec(
      'CREATE TABLE clients (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);' +
        'CREATE TABLE pallets (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, pallet_code TEXT NOT NULL,' +
        ' pallet_name TEXT NOT NULL, updated_at TEXT NOT NULL, doc TEXT NOT NULL);',
    );
    const { pallets, clients } = converted();
    expect(pallets.list()).toEqual([]);
    expect(clients.list()).toEqual([]);
  });
});
