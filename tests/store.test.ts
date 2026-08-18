import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId } from '../src/ids.js';
import { ClientRepository, PalletRepository, reconcileClients } from '../src/server/repository.js';
import { FileStore, StoreUnavailableError, fileNameFor } from '../src/store/files.js';
import type { Client, Pallet } from '../src/types.js';
import { cleanupStores, loadFixture, missingStoreRoot, tempStore } from './helpers.js';

/**
 * The folder the designs live in.
 *
 * It is expected to be one Google Drive syncs, which is the whole reason these
 * tests exist: a sync client writes files underneath a running program, hands
 * over half-finished ones, and delivers them in whatever order it likes. None
 * of that may cost a design or take the dashboard down.
 */

let folder: FileStore;
let pallets: PalletRepository;
let clients: ClientRepository;
let acme: Client;

function named(code: string, client: Client = acme): Pallet {
  const pallet = loadFixture('block-1000x800');
  return { ...pallet, id: newId(), palletCode: code, clientId: client.id, clientName: client.name };
}

beforeEach(() => {
  folder = tempStore();
  pallets = new PalletRepository(folder);
  clients = new ClientRepository(folder);
  acme = clients.create('ACME Logistics');
});

afterEach(() => {
  cleanupStores();
  vi.restoreAllMocks();
});

describe('an empty folder', () => {
  it('starts a fresh library rather than failing', () => {
    const fresh = tempStore();
    expect(new ClientRepository(fresh).list()).toEqual([]);
    expect(new PalletRepository(fresh).list()).toEqual([]);
    expect(new PalletRepository(fresh).dashboard(new ClientRepository(fresh))).toEqual([]);
  });

  it('is made when somebody has just said to use it', () => {
    const root = missingStoreRoot();
    const made = new FileStore(root, { create: true });
    expect(made.listDesigns()).toEqual([]);
  });
});

describe('a folder that has gone missing', () => {
  /**
   * Drive not running, the folder renamed, an external disk unplugged. Making
   * an empty one would show an empty library, and somebody would redraw designs
   * that were never lost — and then Drive would come back and there would be
   * two of everything.
   */
  it('is refused rather than quietly made again', () => {
    const root = missingStoreRoot();
    expect(() => new FileStore(root)).toThrow(StoreUnavailableError);
    expect(existsSync(root)).toBe(false);
  });

  it('says which folder and why, so it can be put right', () => {
    const root = missingStoreRoot();
    expect(() => new FileStore(root)).toThrow(new RegExp(root.replace(/[/\\]/g, '.')));
    expect(() => new FileStore(root)).toThrow(/no such folder/);
  });

  it('is not confused with a file of the same name', () => {
    const root = missingStoreRoot();
    mkdirSync(dirname(root), { recursive: true });
    writeFileSync(root, 'not a folder');
    expect(() => new FileStore(root)).toThrow(/not a folder/);
    rmSync(root, { force: true });
  });

  /** An empty folder is a new library, not a broken one. */
  it('is told apart from a folder that is simply empty', () => {
    const empty = tempStore();
    expect(new PalletRepository(empty).list()).toEqual([]);
  });
});

describe('writing a design', () => {
  it('puts it in one file named by its id', () => {
    const saved = pallets.save(named('AP-100'), clients);
    expect(readdirSync(folder.designsDir)).toEqual([fileNameFor(saved.id)]);
  });

  /**
   * A design is written to a temporary name and renamed into place, so that a
   * sync client copying the folder never catches one half-written. The
   * temporary file must not be left behind, or the folder fills with rubbish
   * that Drive then dutifully uploads.
   */
  it('leaves no temporary file behind', () => {
    pallets.save(named('AP-101'), clients);
    pallets.save(named('AP-102'), clients);
    expect(readdirSync(folder.designsDir).filter((name) => name.includes('.tmp'))).toEqual([]);
  });

  it('writes it as readable JSON, so it outlives this program', () => {
    const saved = pallets.save(named('AP-103'), clients);
    const raw = JSON.parse(readFileSync(join(folder.designsDir, fileNameFor(saved.id)), 'utf8'));
    expect(raw.palletCode).toBe('AP-103');
    expect(raw.clientName).toBe('ACME Logistics');
  });
});

describe('a file that will not parse', () => {
  it('is skipped rather than taking the dashboard down', () => {
    const kept = pallets.save(named('AP-200'), clients);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // Drive part way through a download looks exactly like this.
    writeFileSync(join(folder.designsDir, 'half-written.json'), '{"palletCode": "AP-2');

    expect(pallets.list().map((design) => design.id)).toEqual([kept.id]);
    expect(folder.lastProblems().map((problem) => problem.file)).toEqual(['half-written.json']);
  });

  it('is reported, so it is not lost silently', () => {
    const complaint = vi.spyOn(console, 'error').mockImplementation(() => {});
    writeFileSync(join(folder.designsDir, 'rubbish.json'), 'not json at all');
    pallets.list();
    expect(complaint).toHaveBeenCalledWith(expect.stringContaining('rubbish.json'));
  });

  /** Valid JSON that is not a design — somebody's notes dropped in the folder. */
  it('does not have to be broken JSON to be skipped', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    writeFileSync(join(folder.designsDir, 'notes.json'), '{"note": "order 40 more blocks"}');
    expect(pallets.list()).toEqual([]);
  });
});

describe('a design whose client has not arrived yet', () => {
  /**
   * The designs and the clients file sync separately, and either can land
   * first. A design on disk must never be missing from the dashboard because
   * the file naming its client is still on its way.
   */
  it('still shows on the dashboard, under the name the design carries', () => {
    const orphan = { ...named('AP-300'), clientId: 'not-here-yet', clientName: 'Britannia Foods' };
    folder.writeDesign(orphan);

    const sections = pallets.dashboard(clients);
    const britannia = sections.find((section) => section.client.name === 'Britannia Foods');
    expect(britannia?.designs.map((design) => design.palletCode)).toEqual(['AP-300']);
  });

  it('is taken into the clients file when the folder is reconciled', () => {
    folder.writeDesign({ ...named('AP-301'), clientId: 'not-here-yet', clientName: 'Britannia Foods' });

    expect(reconcileClients(folder)).toBe(1);
    expect(clients.list().map((client) => client.name)).toEqual([
      'ACME Logistics',
      'Britannia Foods',
    ]);
    // Run again and it has nothing left to do.
    expect(reconcileClients(folder)).toBe(0);
  });
});

describe('a batch of writes', () => {
  it('leaves the folder as it was when one of them fails', () => {
    const before = pallets.save(named('AP-400'), clients);

    expect(() =>
      folder.transaction(() => {
        folder.writeDesign(named('AP-401'));
        throw new Error('bad document halfway through');
      }),
    ).toThrow('bad document halfway through');

    expect(pallets.list().map((design) => design.palletCode)).toEqual(['AP-400']);
    expect(pallets.get(before.id).palletCode).toBe('AP-400');
  });

  it('applies all of them when it succeeds', () => {
    folder.transaction(() => {
      folder.writeDesign(named('AP-402'));
      folder.writeDesign(named('AP-403'));
    });
    expect(pallets.list().map((design) => design.palletCode).sort()).toEqual(['AP-402', 'AP-403']);
  });
});

describe('a design edited outside this program', () => {
  /** A colleague's save, arriving through Drive while the tool is open. */
  it('is picked up rather than served from a stale copy', () => {
    const saved = pallets.save(named('AP-500'), clients);
    expect(pallets.get(saved.id).palletCode).toBe('AP-500');

    const path = join(folder.designsDir, fileNameFor(saved.id));
    const doc = JSON.parse(readFileSync(path, 'utf8'));
    writeFileSync(path, JSON.stringify({ ...doc, palletCode: 'AP-501' }));

    expect(pallets.get(saved.id).palletCode).toBe('AP-501');
  });
});

describe('the name a design gets on disk', () => {
  it('is the id for the ids this program makes', () => {
    expect(fileNameFor('7f3a9c21-0000-4000-8000-000000000000')).toBe(
      '7f3a9c21-0000-4000-8000-000000000000.json',
    );
  });

  /** Ids from elsewhere must not escape the folder or upset Windows. */
  it('takes out anything a file name cannot hold', () => {
    for (const id of ['../escape', 'a/b', 'a:b', 'a*b', 'a?b', 'a|b']) {
      const name = fileNameFor(id);
      expect(name).not.toMatch(/[\\/:*?"<>|]/);
      expect(name.endsWith('.json')).toBe(true);
    }
  });

  it('never gives two ids the same file', () => {
    const names = new Set(['a/b', 'a%2Fb', 'a:b', 'a b'].map(fileNameFor));
    expect(names.size).toBe(4);
  });
});
