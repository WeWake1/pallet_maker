import { describe, expect, it } from 'vitest';
import {
  clearDraft,
  clearDrafts,
  draftAge,
  listDrafts,
  readDraft,
  writeDraft,
} from '../src/editor/drafts.js';
import type { DraftStorage } from '../src/editor/drafts.js';
import { newPallet } from '../src/editor/templates.js';
import type { Pallet } from '../src/types.js';

/**
 * Drafts are what stands between an accidental tab close and an afternoon's
 * work. The rules that matter are that a draft holds a design too unfinished to
 * save, and that nothing storage does can take the editor down with it.
 */

const CLIENT = { id: 'client-test', name: 'Demo Client' };

/** `localStorage`, near enough: the five members the draft store uses. */
class FakeStorage implements DraftStorage {
  readonly items = new Map<string, string>();
  /** Set to make every write fail, the way a full quota does. */
  full = false;
  /** Writes refused so far, to check the store tries again after clearing out. */
  refusals = 0;

  get length(): number {
    return this.items.size;
  }
  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.full) {
      this.refusals += 1;
      throw new Error('QuotaExceededError');
    }
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

const DAY = 24 * 60 * 60 * 1000;

function named(name: string): Pallet {
  return { ...newPallet(CLIENT), palletName: name };
}

describe('a draft', () => {
  it('holds a design too unfinished to save, which is the point of it', () => {
    const storage = new FakeStorage();
    const pallet = newPallet(CLIENT);
    // A new design has no pallet code, so the store would refuse it outright.
    expect(pallet.palletCode).toBe('');

    writeDraft(pallet, storage);
    expect(readDraft(pallet.id, storage)?.pallet).toEqual(pallet);
  });

  it('is overwritten by the next write, not piled up beside it', () => {
    const storage = new FakeStorage();
    const pallet = newPallet(CLIENT);
    writeDraft(pallet, storage);
    writeDraft({ ...pallet, palletName: 'second thoughts' }, storage);

    expect(listDrafts(storage)).toHaveLength(1);
    expect(readDraft(pallet.id, storage)?.pallet.palletName).toBe('second thoughts');
  });

  it('goes when the design it was holding is saved or thrown away', () => {
    const storage = new FakeStorage();
    const pallet = newPallet(CLIENT);
    writeDraft(pallet, storage);
    clearDraft(pallet.id, storage);

    expect(readDraft(pallet.id, storage)).toBeNull();
    expect(listDrafts(storage)).toEqual([]);
  });

  it('is not there when nothing was ever written', () => {
    expect(readDraft('never-seen', new FakeStorage())).toBeNull();
  });
});

describe('the list of drafts', () => {
  it('is newest first, which is the order they are worth looking at', () => {
    const storage = new FakeStorage();
    const now = Date.parse('2026-08-03T12:00:00.000Z');
    writeDraft(named('oldest'), storage, now - 2 * DAY);
    writeDraft(named('newest'), storage, now);
    writeDraft(named('middle'), storage, now - DAY);

    expect(listDrafts(storage, now).map((draft) => draft.pallet.palletName)).toEqual([
      'newest',
      'middle',
      'oldest',
    ]);
  });

  it('drops what has gone stale, so abandoned work does not pile up forever', () => {
    const storage = new FakeStorage();
    const now = Date.parse('2026-08-03T12:00:00.000Z');
    writeDraft(named('last week'), storage, now - 7 * DAY);
    writeDraft(named('last year'), storage, now - 365 * DAY);

    expect(listDrafts(storage, now).map((draft) => draft.pallet.palletName)).toEqual(['last week']);
    // Gone from storage as well, not merely hidden from the list.
    expect(storage.items.size).toBe(1);
  });

  it('leaves alone anything in storage that is not a draft', () => {
    const storage = new FakeStorage();
    storage.setItem('some-other-app', 'not mine');
    writeDraft(newPallet(CLIENT), storage);

    expect(listDrafts(storage)).toHaveLength(1);
    expect(storage.getItem('some-other-app')).toBe('not mine');
  });

  it('throws away a draft it cannot read rather than breaking the screen', () => {
    const storage = new FakeStorage();
    const good = newPallet(CLIENT);
    writeDraft(good, storage);
    storage.setItem('pallet-draft:mangled', '{ this is not json');
    storage.setItem('pallet-draft:half', JSON.stringify({ at: '2026-08-03', pallet: null }));

    expect(listDrafts(storage).map((draft) => draft.pallet.id)).toEqual([good.id]);
    expect(storage.getItem('pallet-draft:mangled')).toBeNull();
    expect(storage.getItem('pallet-draft:half')).toBeNull();
    expect(readDraft('mangled', storage)).toBeNull();
  });

  it('clears several at once, for a client who is no longer on the books', () => {
    const storage = new FakeStorage();
    const first = named('one');
    const second = named('two');
    writeDraft(first, storage);
    writeDraft(second, storage);

    clearDrafts([first.id, second.id], storage);
    expect(listDrafts(storage)).toEqual([]);
  });
});

describe('storage that will not cooperate', () => {
  it('never takes the editor down with it', () => {
    const storage = new FakeStorage();
    storage.full = true;
    const pallet = newPallet(CLIENT);

    // A browser with site data switched off, or a full quota. Losing drafts is
    // a bad afternoon; refusing to open the editor would be a worse one.
    expect(() => writeDraft(pallet, storage)).not.toThrow();
    expect(readDraft(pallet.id, storage)).toBeNull();
  });

  it('makes room by clearing out stale drafts, then writes again', () => {
    const storage = new FakeStorage();
    const now = Date.parse('2026-08-03T12:00:00.000Z');
    writeDraft(named('long abandoned'), storage, now - 365 * DAY);

    const pallet = named('being worked on');
    storage.full = true;
    // The first attempt fails; clearing out the stale draft makes room.
    const freeUpOnRefusal = storage.setItem.bind(storage);
    storage.setItem = (key, value) => {
      if (storage.full && storage.items.size <= 1) {
        storage.full = false;
        storage.refusals += 1;
        throw new Error('QuotaExceededError');
      }
      freeUpOnRefusal(key, value);
    };

    writeDraft(pallet, storage, now);
    expect(storage.refusals).toBe(1);
    expect(readDraft(pallet.id, storage)?.pallet.palletName).toBe('being worked on');
    // The stale one was cleared out on the way.
    expect(listDrafts(storage, now)).toHaveLength(1);
  });

  it('does nothing at all when there is no storage to be had', () => {
    const pallet = newPallet(CLIENT);
    expect(() => writeDraft(pallet, null)).not.toThrow();
    expect(readDraft(pallet.id, null)).toBeNull();
    expect(listDrafts(null)).toEqual([]);
    expect(() => clearDraft(pallet.id, null)).not.toThrow();
  });
});

describe('how old a draft says it is', () => {
  const now = Date.parse('2026-08-03T12:00:00.000Z');
  const ago = (ms: number): string => draftAge(new Date(now - ms).toISOString(), now);

  it('reads the way somebody would say it out loud', () => {
    expect(ago(5_000)).toBe('just now');
    expect(ago(60_000)).toBe('1 minute ago');
    expect(ago(14 * 60_000)).toBe('14 minutes ago');
    expect(ago(60 * 60_000)).toBe('1 hour ago');
    expect(ago(5 * 60 * 60_000)).toBe('5 hours ago');
    expect(ago(DAY)).toBe('1 day ago');
    expect(ago(3 * DAY)).toBe('3 days ago');
  });

  it('says something rather than nothing when the date makes no sense', () => {
    expect(draftAge('not a date', now)).toBe('earlier');
  });
});
