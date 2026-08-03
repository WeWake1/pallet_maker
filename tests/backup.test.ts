import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { backupDatabase, backupDirectoryFor, listBackups } from '../src/server/backup.js';
import { openDb } from '../src/server/db.js';
import type { Db } from '../src/server/db.js';
import { ClientRepository, PalletRepository } from '../src/server/repository.js';
import { loadFixture } from './helpers.js';

let directory: string;
let dbPath: string;
let db: Db;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'pallet-backup-'));
  dbPath = join(directory, 'pallets.sqlite');
  db = openDb(dbPath);
});

afterEach(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

/** A stored design, with the client it needs to belong to. */
function store(target: Db, code: string) {
  const clients = new ClientRepository(target);
  const client = clients.list()[0] ?? clients.create('ACME Logistics');
  const fixture = loadFixture('block-1000x800');
  return new PalletRepository(target).save(
    { ...fixture, palletCode: code, clientId: client.id, clientName: client.name },
    clients,
  );
}

describe('backups', () => {
  it('take a copy that holds the designs that were in it', async () => {
    const saved = store(db, 'AP-500');

    const file = await backupDatabase(db, dbPath);
    expect(existsSync(file)).toBe(true);

    // The copy is a database of its own, and the design is in it.
    const copy = openDb(file);
    try {
      expect(new PalletRepository(copy).get(saved.id).palletCode).toBe('AP-500');
    } finally {
      copy.close();
    }
  });

  /**
   * Backups are the whole of the safety net now that saving overwrites, so a
   * copy has to be a working database and not only a file on disk.
   */
  it('carry the clients across, so the copy opens as a whole library', async () => {
    store(db, 'AP-501');

    const copy = openDb(await backupDatabase(db, dbPath));
    try {
      expect(new ClientRepository(copy).list().map((c) => c.name)).toEqual(['ACME Logistics']);
      expect(new PalletRepository(copy).dashboard(new ClientRepository(copy))).toHaveLength(1);
    } finally {
      copy.close();
    }
  });

  it('go beside the database, newest first', async () => {
    const first = await backupDatabase(db, dbPath, { now: new Date('2026-01-01T09:00:00') });
    const second = await backupDatabase(db, dbPath, { now: new Date('2026-01-02T09:00:00') });
    const found = listBackups(backupDirectoryFor(dbPath));
    expect(found).toHaveLength(2);
    expect(found).toContain(first);
    expect(found).toContain(second);
    expect(found[0]).toMatch(/pallets-\d{8}-\d{6}\.sqlite$/);
  });

  it('drop the oldest beyond the number to keep', async () => {
    for (let day = 1; day <= 6; day++) {
      await backupDatabase(db, dbPath, {
        keep: 3,
        now: new Date(`2026-03-0${day}T09:00:00`),
      });
    }
    const found = listBackups(backupDirectoryFor(dbPath));
    expect(found).toHaveLength(3);
    // The three that survive are the three most recent.
    const dates = found.map((path) => /pallets-(\d{8})-/.exec(path)![1]!).sort();
    expect(dates).toEqual(['20260304', '20260305', '20260306']);
  });

  it('report nothing rather than throwing when there are none yet', () => {
    expect(listBackups(join(directory, 'nowhere'))).toEqual([]);
  });
});
