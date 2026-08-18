import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId, today } from '../src/ids.js';
import { LIBRARY_FORMAT, parseLibrary } from '../src/library.js';
import type { Library } from '../src/library.js';
import { exportLibrary, importDesign, importLibrary } from '../src/server/library.js';
import { ClientRepository, PalletRepository } from '../src/server/repository.js';
import type { Client, Pallet } from '../src/types.js';
import type { FileStore } from '../src/store/files.js';
import { cleanupStores, loadFixture, tempStore } from './helpers.js';

/**
 * The library in and out of a file.
 *
 * This is the only copy of the designs that outlives the machine they are on,
 * so what matters is that it comes back as what it was, and that reading one in
 * can never cost you a design you already had.
 */

let folder: FileStore;
let pallets: PalletRepository;
let clients: ClientRepository;
let acme: Client;

function named(code: string, client: Client = acme): Pallet {
  const pallet = loadFixture('block-1000x800');
  return {
    ...pallet,
    id: newId(),
    palletCode: code,
    palletName: code,
    clientId: client.id,
    clientName: client.name,
  };
}

/** A second, empty store, standing for another computer. */
function elsewhere(): { pallets: PalletRepository; clients: ClientRepository; store: FileStore } {
  const other = tempStore();
  return { store: other, pallets: new PalletRepository(other), clients: new ClientRepository(other) };
}

beforeEach(() => {
  folder = tempStore();
  pallets = new PalletRepository(folder);
  clients = new ClientRepository(folder);
  acme = clients.create('Acme Ltd');
});

afterEach(cleanupStores);

describe('exporting the library', () => {
  it('writes every client and every design', () => {
    const other = clients.create('Beta Packaging');
    pallets.save(named('AP-001'), clients);
    pallets.save(named('AP-002'), clients);
    pallets.save(named('BP-001', other), clients);

    const library = exportLibrary(pallets, clients);

    expect(library.format).toBe(LIBRARY_FORMAT);
    expect(library.clients.map((client) => client.name).sort()).toEqual([
      'Acme Ltd',
      'Beta Packaging',
    ]);
    expect(library.designs.map((design) => design.palletCode).sort()).toEqual([
      'AP-001',
      'AP-002',
      'BP-001',
    ]);
  });

  // A customer can be on the books before anything is drawn for them, which is
  // the point of their being a record of their own. An export that dropped them
  // would lose that on every restore.
  it('keeps a client who has no designs', () => {
    clients.create('Not Started Yet');
    const library = exportLibrary(pallets, clients);
    expect(library.clients.map((client) => client.name)).toContain('Not Started Yet');
  });

  it('is a document that reads back as a library', () => {
    pallets.save(named('AP-001'), clients);
    const round = parseLibrary(JSON.parse(JSON.stringify(exportLibrary(pallets, clients))));
    expect(round.designs).toHaveLength(1);
  });

  it('refuses a file that is not one', () => {
    expect(() => parseLibrary({ clients: [], designs: [] })).toThrow(/Invalid library/);
  });
});

describe('importing a library', () => {
  it('restores the designs onto a machine that has none', () => {
    pallets.save(named('AP-001'), clients);
    pallets.save(named('AP-002'), clients);
    const file = exportLibrary(pallets, clients);

    const there = elsewhere();
    const report = importLibrary(there.store, file, there.pallets, there.clients, 'skip');

    expect(report.designsAdded).toBe(2);
    expect(report.clientsAdded).toBe(1);
    expect(there.pallets.all().map((design) => design.palletCode).sort()).toEqual([
      'AP-001',
      'AP-002',
    ]);
  });

  /**
   * The date is what says how current a design is, and the dashboard sorts on
   * it. A restore is not an edit, so stamping today over it would make every
   * design in a five year old backup look like this morning's work.
   */
  it('keeps the date each design was last actually edited', () => {
    const old: Pallet = { ...named('AP-001'), updatedAt: '2024-03-11' };
    pallets.save(old, clients);
    const file: Library = {
      ...exportLibrary(pallets, clients),
      designs: [{ ...old, updatedAt: '2024-03-11' }],
    };

    const there = elsewhere();
    importLibrary(there.store, file, there.pallets, there.clients);

    expect(there.pallets.get(old.id).updatedAt).toBe('2024-03-11');
  });

  // The same file twice is the case that happens by accident: a folder synced
  // again, a button pressed twice. Ids survive the export precisely so that the
  // second time round every design is recognised rather than copied.
  it('does nothing the second time the same file is read', () => {
    pallets.save(named('AP-001'), clients);
    const file = exportLibrary(pallets, clients);

    const there = elsewhere();
    importLibrary(there.store, file, there.pallets, there.clients);
    const again = importLibrary(there.store, file, there.pallets, there.clients);

    expect(again.designsAdded).toBe(0);
    expect(again.designsSkipped).toBe(1);
    expect(there.pallets.all()).toHaveLength(1);
  });

  /**
   * The one that must never go wrong. A design in the store is one the shop may
   * be building to, and a file arriving from anywhere else has no right to
   * overwrite it without being asked.
   */
  it('leaves a design that is already held exactly as it was', () => {
    const mine = named('AP-001');
    pallets.save({ ...mine, palletName: 'What I have now' }, clients);

    const file: Library = {
      format: LIBRARY_FORMAT,
      version: 1,
      exportedAt: today(),
      clients: [acme],
      designs: [{ ...mine, palletName: 'What the file says' }],
    };

    const report = importLibrary(folder, file, pallets, clients, 'skip');

    expect(report.designsSkipped).toBe(1);
    expect(report.designsReplaced).toBe(0);
    expect(pallets.get(mine.id).palletName).toBe('What I have now');
  });

  it('overwrites those same designs when replacing is asked for', () => {
    const mine = named('AP-001');
    pallets.save({ ...mine, palletName: 'What I have now' }, clients);

    const file: Library = {
      format: LIBRARY_FORMAT,
      version: 1,
      exportedAt: today(),
      clients: [acme],
      designs: [{ ...mine, palletName: 'What the file says' }],
    };

    const report = importLibrary(folder, file, pallets, clients, 'replace');

    expect(report.designsReplaced).toBe(1);
    expect(report.designsSkipped).toBe(0);
    expect(pallets.get(mine.id).palletName).toBe('What the file says');
  });

  /**
   * Ids are made on whichever machine the client was first entered on, so the
   * same customer typed in twice has two of them and one name. Matching on the
   * id would put Acme on the dashboard twice, each with half their designs.
   */
  it('matches a client by name rather than by id', () => {
    const there = elsewhere();
    there.clients.create('acme ltd'); // Same customer, entered by another hand.

    pallets.save(named('AP-001'), clients);
    const report = importLibrary(
      there.store,
      exportLibrary(pallets, clients),
      there.pallets,
      there.clients,
    );

    expect(report.clientsAdded).toBe(0);
    expect(there.clients.list()).toHaveLength(1);
    expect(there.pallets.all()[0]?.clientId).toBe(there.clients.list()[0]?.id);
  });

  // Nothing this program writes has a design whose client is missing from the
  // list, but a hand-written file can. Dropping it silently would lose a design
  // that the person importing believes they have just imported.
  it('places a design whose client is not in the file', () => {
    const file: Library = {
      format: LIBRARY_FORMAT,
      version: 1,
      exportedAt: today(),
      clients: [],
      designs: [{ ...named('AP-001'), clientName: 'Someone Else' }],
    };

    const report = importLibrary(folder, file, pallets, clients);

    expect(report.clientsAdded).toBe(1);
    expect(report.designsAdded).toBe(1);
    expect(clients.findByName('Someone Else')).toBeDefined();
  });

  /**
   * Half an import is worse than none: it leaves a store nobody can reason
   * about, and no way to tell which designs made it in.
   *
   * The second design here parses — a client name of spaces is a string like
   * any other — and only fails once the import tries to file it under a client
   * that cannot be created. So the first design has already been written by the
   * time it goes wrong, which is exactly the case the transaction is for.
   */
  it('leaves the store untouched when part of the file will not go in', () => {
    const file = parseLibrary({
      format: LIBRARY_FORMAT,
      version: 1,
      exportedAt: today(),
      clients: [],
      designs: [named('AP-001'), { ...named('AP-002'), clientName: '   ' }],
    });

    expect(() => importLibrary(folder, file, pallets, clients)).toThrow(/needs a name/);
    expect(pallets.all()).toHaveLength(0);
  });
});

describe('importing one design', () => {
  it('adds it as a new design of the chosen client', () => {
    const file = named('AP-001');
    const added = importDesign(file, acme.id, pallets, clients);

    expect(added.palletCode).toBe('AP-001');
    expect(added.clientId).toBe(acme.id);
    expect(pallets.all()).toHaveLength(1);
  });

  /**
   * A design arriving from somewhere else is a new design, not a claim on one
   * this store may already hold under that id. Were it to keep the id, importing
   * a colleague's file would silently overwrite whatever happened to share it.
   */
  it('gives it an identity of its own rather than the file’s', () => {
    const mine = named('AP-001');
    pallets.save({ ...mine, palletName: 'Mine' }, clients);

    const added = importDesign({ ...mine, palletName: 'Theirs' }, acme.id, pallets, clients);

    expect(added.id).not.toBe(mine.id);
    expect(added.layers.map((layer) => layer.id)).not.toEqual(mine.layers.map((l) => l.id));
    expect(pallets.get(mine.id).palletName).toBe('Mine');
    expect(pallets.all()).toHaveLength(2);
  });

  // Whose design it is gets settled by the person importing it, on the
  // dashboard. Whatever the file says about that is somebody else's filing.
  it('files it under the client chosen, not the one the file names', () => {
    const beta = clients.create('Beta Packaging');
    const added = importDesign(named('AP-001'), beta.id, pallets, clients);

    expect(added.clientId).toBe(beta.id);
    expect(added.clientName).toBe('Beta Packaging');
  });

  it('refuses a file that is not a design', () => {
    expect(() => importDesign({ hello: true }, acme.id, pallets, clients)).toThrow(
      /Invalid pallet/,
    );
  });
});
