import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/server/db.js';
import type { Db } from '../src/server/db.js';
import { FrozenPalletError, PalletNotFoundError, PalletRepository } from '../src/server/repository.js';
import { nextRevision } from '../src/revisions.js';
import type { Pallet } from '../src/types.js';
import { loadFixture } from './helpers.js';

function named(code: string): Pallet {
  const pallet = loadFixture('block-1000x800');
  return { ...pallet, palletCode: code };
}

let db: Db;
let pallets: PalletRepository;

beforeEach(() => {
  db = openDb(':memory:');
  pallets = new PalletRepository(db);
});

describe('revision letters', () => {
  it('count like spreadsheet columns, not like numbers', () => {
    expect(nextRevision('A')).toBe('B');
    expect(nextRevision('Y')).toBe('Z');
    expect(nextRevision('Z')).toBe('AA');
    expect(nextRevision('AA')).toBe('AB');
    expect(nextRevision('AZ')).toBe('BA');
    expect(nextRevision('ZZ')).toBe('AAA');
    expect(nextRevision('a')).toBe('B');
    expect(nextRevision('')).toBe('A');
  });
});

describe('storing a design', () => {
  it('comes back exactly as it went in', () => {
    const pallet = named('AP-001');
    pallets.save(pallet);
    expect(pallets.get(pallet.id)).toEqual(pallet);
  });

  it('lists what the design list needs without opening every document', () => {
    pallets.save(named('AP-001'));
    const summaries = pallets.list();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      palletCode: 'AP-001',
      clientName: 'Demo Client',
      revision: 'A',
      frozen: false,
      supersedes: null,
      supersededBy: null,
    });
  });

  it('refuses a document that is not a pallet', () => {
    expect(() => pallets.save({ id: 'x' } as unknown as Pallet)).toThrow(/Invalid pallet document/);
  });

  it('says so when there is no such design', () => {
    expect(() => pallets.get('nothing')).toThrow(PalletNotFoundError);
  });

  it('saves an edit over the top of the draft it came from', () => {
    const pallet = named('AP-001');
    pallets.save(pallet);
    pallets.save({ ...pallet, palletName: 'renamed' });
    expect(pallets.list()).toHaveLength(1);
    expect(pallets.get(pallet.id).palletName).toBe('renamed');
  });
});

describe('freezing and revising', () => {
  it('produces rev B and leaves rev A intact', () => {
    const revA = pallets.save(named('AP-001'));
    pallets.freeze(revA.id);

    const revB = pallets.revise(revA.id);
    expect(revB.revision).toBe('B');
    expect(revB.supersedes).toBe(revA.id);
    expect(revB.frozen).toBe(false);
    expect(revB.id).not.toBe(revA.id);

    // Rev A is exactly as it was published.
    const stored = pallets.get(revA.id);
    expect(stored.revision).toBe('A');
    expect(stored.frozen).toBe(true);
    expect(stored.layers).toEqual(revA.layers);
    expect(pallets.list()).toHaveLength(2);
  });

  it('will not edit a published revision', () => {
    const revA = pallets.save(named('AP-001'));
    pallets.freeze(revA.id);
    expect(() => pallets.save({ ...revA, frozen: true, palletName: 'meddled' })).toThrow(
      FrozenPalletError,
    );
    expect(pallets.get(revA.id).palletName).toBe('1000 x 800');
  });

  it('will not delete a published revision', () => {
    const revA = pallets.save(named('AP-001'));
    pallets.freeze(revA.id);
    expect(() => pallets.delete(revA.id)).toThrow(FrozenPalletError);
    expect(pallets.has(revA.id)).toBe(true);
  });

  /**
   * The rule has to hold even if a later version of this program forgets it,
   * because the record is what a complaint will be judged against.
   */
  it('is enforced by the database, not only by the code above it', () => {
    const revA = pallets.save(named('AP-001'));
    pallets.freeze(revA.id);

    expect(() =>
      db.prepare('UPDATE pallets SET pallet_name = ? WHERE id = ?').run('meddled', revA.id),
    ).toThrow(/frozen revision is never edited/);
    expect(() => db.prepare('DELETE FROM pallets WHERE id = ?').run(revA.id)).toThrow(
      /frozen revision is never deleted/,
    );
  });

  it('gives each revision a fresh date', () => {
    const revA = pallets.save({ ...named('AP-001'), revisionDate: '2019-04-02' });
    pallets.freeze(revA.id);
    const revB = pallets.revise(revA.id);
    expect(revB.revisionDate).toBe(new Date().toISOString().slice(0, 10));
    expect(pallets.get(revA.id).revisionDate).toBe('2019-04-02');
  });

  it('keeps the whole chain readable, oldest first', () => {
    const revA = pallets.save(named('AP-001'));
    pallets.freeze(revA.id);
    const revB = pallets.revise(revA.id);
    pallets.freeze(revB.id);
    const revC = pallets.revise(revB.id);

    for (const from of [revA.id, revB.id, revC.id]) {
      expect(pallets.history(from).map((entry) => entry.revision)).toEqual(['A', 'B', 'C']);
    }
    expect(pallets.history(revA.id).map((entry) => entry.supersededBy)).toEqual([
      revB.id,
      revC.id,
      null,
    ]);
  });

  it('freezes only once and does not mind being asked twice', () => {
    const revA = pallets.save(named('AP-001'));
    pallets.freeze(revA.id);
    expect(() => pallets.freeze(revA.id)).not.toThrow();
    expect(pallets.get(revA.id).frozen).toBe(true);
  });
});

describe('copying a design', () => {
  it('is a new design that is linked to nothing', () => {
    const original = pallets.save(named('AP-001'));
    pallets.freeze(original.id);
    const copy = pallets.duplicate(original.id);

    expect(copy.id).not.toBe(original.id);
    expect(copy.revision).toBe('A');
    expect(copy.frozen).toBe(false);
    expect(copy.supersedes).toBeUndefined();
    expect(copy.layers.map((layer) => layer.id)).not.toEqual(
      original.layers.map((layer) => layer.id),
    );
    expect(pallets.history(copy.id).map((entry) => entry.id)).toEqual([copy.id]);
  });

  it('leaves the original alone when the copy is edited', () => {
    const original = pallets.save(named('AP-001'));
    const copy = pallets.duplicate(original.id);
    pallets.save({ ...copy, clientName: 'Another client', overallLength: 1200 });

    const stored = pallets.get(original.id);
    expect(stored.clientName).toBe('Demo Client');
    expect(stored.overallLength).toBe(1000);
  });
});

describe('drafts', () => {
  it('can be deleted while they are still drafts', () => {
    const draft = pallets.save(named('AP-009'));
    pallets.delete(draft.id);
    expect(pallets.has(draft.id)).toBe(false);
    expect(() => pallets.delete(draft.id)).toThrow(PalletNotFoundError);
  });
});
