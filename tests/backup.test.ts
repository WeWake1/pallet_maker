import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { backupDirectoryFor, backupLibrary, listBackups } from '../src/server/backup.js';
import { parseLibrary } from '../src/library.js';
import { ClientRepository, PalletRepository } from '../src/server/repository.js';
import type { FileStore } from '../src/store/files.js';
import { cleanupStores, loadFixture, tempStore } from './helpers.js';

let folder: FileStore;

beforeEach(() => {
  folder = tempStore();
});

afterEach(cleanupStores);

/** A stored design, with the client it needs to belong to. */
function store(target: FileStore, code: string) {
  const clients = new ClientRepository(target);
  const client = clients.list()[0] ?? clients.create('ACME Logistics');
  const fixture = loadFixture('block-1000x800');
  return new PalletRepository(target).save(
    { ...fixture, palletCode: code, clientId: client.id, clientName: client.name },
    clients,
  );
}

/** A snapshot read back, as the import would read it. */
function read(path: string) {
  return parseLibrary(JSON.parse(readFileSync(path, 'utf8')));
}

describe('backups', () => {
  it('take a copy that holds the designs that were in it', () => {
    const saved = store(folder, 'AP-500');

    const library = read(backupLibrary(folder));
    expect(library.designs.map((design) => design.palletCode)).toEqual(['AP-500']);
    expect(library.designs[0]!.id).toBe(saved.id);
  });

  /**
   * Backups are the whole of the safety net now that saving overwrites, so a
   * snapshot has to be a library that goes back in, not only a file on disk.
   */
  it('carry the clients across, so the copy reads as a whole library', () => {
    store(folder, 'AP-501');

    const library = read(backupLibrary(folder));
    expect(library.clients.map((client) => client.name)).toEqual(['ACME Logistics']);
    expect(library.designs).toHaveLength(1);
  });

  /**
   * A client entered before anything is drawn for them exists only in the
   * clients file. A snapshot that took the designs alone would lose them.
   */
  it('keep a client who has no designs yet', () => {
    new ClientRepository(folder).create('Britannia Foods');

    const library = read(backupLibrary(folder));
    expect(library.clients.map((client) => client.name)).toEqual(['Britannia Foods']);
    expect(library.designs).toEqual([]);
  });

  it('go in the store folder, newest first', () => {
    const first = backupLibrary(folder, { now: new Date('2026-01-01T09:00:00') });
    const second = backupLibrary(folder, { now: new Date('2026-01-02T09:00:00') });
    const found = listBackups(backupDirectoryFor(folder.root));
    expect(found).toHaveLength(2);
    expect(found).toContain(first);
    expect(found).toContain(second);
    expect(found[0]).toMatch(/pallets-\d{8}-\d{6}\.json$/);
  });

  it('drop the oldest beyond the number to keep', () => {
    for (let day = 1; day <= 6; day++) {
      backupLibrary(folder, { keep: 3, now: new Date(`2026-03-0${day}T09:00:00`) });
    }
    const found = listBackups(backupDirectoryFor(folder.root));
    expect(found).toHaveLength(3);
    // The three that survive are the three most recent.
    const dates = found.map((path) => /pallets-(\d{8})-/.exec(path)![1]!).sort();
    expect(dates).toEqual(['20260304', '20260305', '20260306']);
  });

  it('report nothing rather than throwing when there are none yet', () => {
    expect(listBackups(join(folder.root, 'nowhere'))).toEqual([]);
  });
});
