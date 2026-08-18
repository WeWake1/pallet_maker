import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../src/ids.js';
import {
  ClientNotFoundError,
  ClientRepository,
  DuplicateClientError,
  PalletNotFoundError,
  PalletRepository,
} from '../src/server/repository.js';
import type { Client, Pallet } from '../src/types.js';
import type { FileStore } from '../src/store/files.js';
import { cleanupStores, loadFixture, tempStore } from './helpers.js';

let folder: FileStore;
let pallets: PalletRepository;
let clients: ClientRepository;
let acme: Client;

/**
 * A design for the client under test, with an id and a code of its own. Every
 * fixture carries the same id, so a fresh one is needed or two of these would
 * be the same row.
 */
function named(code: string, client: Client = acme): Pallet {
  const pallet = loadFixture('block-1000x800');
  return {
    ...pallet,
    id: newId(),
    palletCode: code,
    clientId: client.id,
    clientName: client.name,
  };
}

const store = (pallet: Pallet): Pallet => pallets.save(pallet, clients);

beforeEach(() => {
  folder = tempStore();
  pallets = new PalletRepository(folder);
  clients = new ClientRepository(folder);
  acme = clients.create('ACME Logistics');
});

afterEach(cleanupStores);

describe('clients', () => {
  it('can be on the books before anything is drawn for them', () => {
    const fresh = clients.create('Britannia Foods');
    expect(clients.list().map((client) => client.name)).toEqual([
      'ACME Logistics',
      'Britannia Foods',
    ]);
    // The point of a client being a record: an empty section on the dashboard.
    expect(pallets.dashboard(clients)).toContainEqual({ client: fresh, designs: [] });
  });

  it('refuses a second client of the same name, whatever the case', () => {
    expect(() => clients.create('acme logistics')).toThrow(DuplicateClientError);
    expect(clients.list()).toHaveLength(1);
  });

  it('refuses a blank name', () => {
    expect(() => clients.create('   ')).toThrow(/needs a name/);
  });

  it('says so when there is no such client', () => {
    expect(() => clients.get('nothing')).toThrow(ClientNotFoundError);
    expect(() => clients.rename('nothing', 'x')).toThrow(ClientNotFoundError);
  });

  /**
   * The name is copied onto every design so that a sheet can be printed from
   * the document alone. A rename that did not bring the copies along would
   * reprint yesterday's spelling.
   */
  it('carries a rename onto every design of theirs', () => {
    const one = store(named('AP-001'));
    const two = store(named('AP-002'));
    clients.rename(acme.id, 'ACME Pallets Ltd');

    expect(pallets.get(one.id).clientName).toBe('ACME Pallets Ltd');
    expect(pallets.get(two.id).clientName).toBe('ACME Pallets Ltd');
    expect(pallets.list().map((row) => row.clientName)).toEqual([
      'ACME Pallets Ltd',
      'ACME Pallets Ltd',
    ]);
  });

  it('lets a client keep their own name through a rename', () => {
    expect(() => clients.rename(acme.id, 'ACME Logistics')).not.toThrow();
  });

  it('will not rename onto another client', () => {
    const other = clients.create('Britannia Foods');
    expect(() => clients.rename(other.id, 'ACME Logistics')).toThrow(DuplicateClientError);
  });

  it('takes their designs with them when deleted', () => {
    const design = store(named('AP-001'));
    clients.delete(acme.id);
    expect(pallets.has(design.id)).toBe(false);
    expect(clients.list()).toHaveLength(0);
  });
});

describe('storing a design', () => {
  it('comes back as it went in, with the date and client name settled by the store', () => {
    const pallet = named('AP-001');
    const saved = store(pallet);
    expect(pallets.get(pallet.id)).toEqual(saved);
    expect(saved.updatedAt).toBe(new Date().toISOString().slice(0, 10));
    expect(saved.clientName).toBe('ACME Logistics');
    expect({ ...saved, updatedAt: pallet.updatedAt }).toEqual(pallet);
  });

  /**
   * The date says how current a design is, and it is the only thing that does.
   * A document claiming to be from 2019 must not be able to keep that claim
   * through a save.
   */
  it('stamps the date itself rather than believing the document', () => {
    const saved = store({ ...named('AP-001'), updatedAt: '2019-04-02' });
    expect(saved.updatedAt).toBe(new Date().toISOString().slice(0, 10));
  });

  it('lists what the dashboard needs without opening every document', () => {
    store(named('AP-001'));
    const summaries = pallets.list();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      palletCode: 'AP-001',
      clientId: acme.id,
      clientName: 'ACME Logistics',
      palletName: '1000 x 800',
    });
  });

  it('refuses a document that is not a pallet', () => {
    expect(() => store({ id: 'x' } as unknown as Pallet)).toThrow(/Invalid pallet document/);
  });

  it('refuses a design for a client that does not exist', () => {
    expect(() => store({ ...named('AP-001'), clientId: 'nobody' })).toThrow(ClientNotFoundError);
  });

  it('says so when there is no such design', () => {
    expect(() => pallets.get('nothing')).toThrow(PalletNotFoundError);
  });

  /** The whole of the new model: saving overwrites, and keeps nothing back. */
  it('overwrites, leaving one row and no trace of what was there', () => {
    const pallet = store(named('AP-001'));
    store({ ...pallet, palletName: 'renamed' });
    expect(pallets.list()).toHaveLength(1);
    expect(pallets.get(pallet.id).palletName).toBe('renamed');
  });

  it('can be deleted, and says so when it is already gone', () => {
    const design = store(named('AP-009'));
    pallets.delete(design.id);
    expect(pallets.has(design.id)).toBe(false);
    expect(() => pallets.delete(design.id)).toThrow(PalletNotFoundError);
  });
});

describe('the dashboard', () => {
  it('gives every client a section, in name order, designs and all', () => {
    const britannia = clients.create('Britannia Foods');
    clients.create('Zenith Freight');
    store(named('AP-001'));
    store(named('AP-002'));
    store(named('BF-001', britannia));

    const sections = pallets.dashboard(clients);
    expect(sections.map((section) => section.client.name)).toEqual([
      'ACME Logistics',
      'Britannia Foods',
      'Zenith Freight',
    ]);
    expect(sections.map((section) => section.designs.length)).toEqual([2, 1, 0]);
    expect(sections[0]!.designs.map((design) => design.palletCode)).toEqual(['AP-001', 'AP-002']);
  });
});

describe('copying a design', () => {
  /**
   * This is what replaced revisions. Before reworking a design that has been
   * built to, copy it; from that moment the two have nothing to do with each
   * other.
   */
  it('is a new design that is linked to nothing', () => {
    const original = store(named('AP-001'));
    const copy = pallets.duplicate(original.id, clients);

    expect(copy.id).not.toBe(original.id);
    expect(copy.layers.map((layer) => layer.id)).not.toEqual(
      original.layers.map((layer) => layer.id),
    );
    expect(pallets.list()).toHaveLength(2);
  });

  it('leaves the original alone when the copy is edited', () => {
    const britannia = clients.create('Britannia Foods');
    const original = store(named('AP-001'));
    const copy = pallets.duplicate(original.id, clients);
    store({ ...copy, clientId: britannia.id, overallLength: 1200 });

    const stored = pallets.get(original.id);
    expect(stored.clientName).toBe('ACME Logistics');
    expect(stored.overallLength).toBe(1000);
  });
});
