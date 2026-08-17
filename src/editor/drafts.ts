import { DEFAULT_HANDLING } from '../types.js';
import type { Pallet } from '../types.js';

/**
 * Work in progress, kept in the browser.
 *
 * A design is edited in place and the store is only ever written by Save, on
 * purpose: a half-finished edit must never overwrite a design the shop is
 * already building to. That leaves the work between one Save and the next with
 * nowhere to live, and closing the tab at the wrong moment used to lose all of
 * it — including designs never saved once, which the dashboard had no card for.
 *
 * So every edit is written here as it is typed. It is a draft and nothing more:
 * it is not a version, nothing reads it but the editor that wrote it, and it is
 * dropped the moment the design is saved and the store has the same thing.
 *
 * A draft is deliberately not validated on the way in or out. Half of the point
 * is to hold a design that is not finished enough to save.
 */

const PREFIX = 'pallet-draft:';

/** How long an abandoned draft is kept before it is cleaned up. */
const KEEP_DAYS = 30;

export interface Draft {
  pallet: Pallet;
  /** ISO timestamp of when this draft was last written. */
  at: string;
}

/**
 * The part of `localStorage` this needs, so the rules can be tested without a
 * browser. Real `localStorage` satisfies it as it stands.
 */
export interface DraftStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Storage is unavailable in a few real situations — private windows, a browser
 * with site data switched off — and merely touching it throws in some of them.
 * Losing drafts is a bad afternoon; refusing to open the editor is worse, so
 * every path here degrades to doing nothing.
 */
function browserStorage(): DraftStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function isPallet(value: unknown): value is Pallet {
  const candidate = value as Partial<Pallet> | null;
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof candidate.id === 'string' &&
    candidate.id !== '' &&
    Array.isArray(candidate.layers)
  );
}

/**
 * A draft written before a field existed, given that field.
 *
 * Everything else in this program reads a document through the schema, which is
 * where a field added later gets its default — the rule
 * `tests/compatibility.test.ts` exists to hold. A draft is the one document that
 * does not go through it, because half its purpose is to hold a design too
 * unfinished to pass. So the lists a draft is allowed to be missing are filled
 * in here instead: an old draft opens as a design with nothing ticked twice,
 * rather than taking the editor down on the first thing that counts them.
 *
 * The draft's own values win — this only supplies what is not there at all.
 */
function completed(pallet: Pallet): Pallet {
  // It was JSON a moment ago, whatever the type on it says, and an old one has
  // whichever of these the version that wrote it had never heard of.
  const held = pallet as Partial<Pallet>;
  return {
    ...pallet,
    handling: held.handling ?? [...DEFAULT_HANDLING],
    nails: held.nails ?? [],
    nailPlacements: held.nailPlacements ?? [],
  };
}

function read(storage: DraftStorage, key: string): Draft | null {
  const raw = storage.getItem(key);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Draft>;
    // A draft written by an older version, or one somebody hand-edited, is
    // thrown away rather than allowed to break the screen that lists them.
    if (!isPallet(parsed.pallet) || typeof parsed.at !== 'string') {
      storage.removeItem(key);
      return null;
    }
    return { pallet: completed(parsed.pallet), at: parsed.at };
  } catch {
    storage.removeItem(key);
    return null;
  }
}

/** Every draft key currently held, read out before anything is removed. */
function keys(storage: DraftStorage): string[] {
  const found: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key !== null && key.startsWith(PREFIX)) found.push(key);
  }
  return found;
}

export function readDraft(
  id: string,
  storage: DraftStorage | null = browserStorage(),
): Draft | null {
  if (!storage) return null;
  try {
    return read(storage, PREFIX + id);
  } catch {
    return null;
  }
}

/**
 * Every draft held, newest first, dropping any that have gone stale. This is
 * what the dashboard needs: a design that was never saved has no row in the
 * store, so its draft is the only trace of it anywhere.
 */
export function listDrafts(
  storage: DraftStorage | null = browserStorage(),
  now: number = Date.now(),
): Draft[] {
  if (!storage) return [];
  try {
    const cutoff = now - KEEP_DAYS * 24 * 60 * 60 * 1000;
    const drafts: Draft[] = [];
    for (const key of keys(storage)) {
      const draft = read(storage, key);
      if (!draft) continue;
      const at = Date.parse(draft.at);
      if (Number.isFinite(at) && at < cutoff) {
        storage.removeItem(key);
        continue;
      }
      drafts.push(draft);
    }
    return drafts.sort((a, b) => b.at.localeCompare(a.at));
  } catch {
    return [];
  }
}

/**
 * Write the design as it currently stands. Called on a short delay while typing
 * and again the moment the tab goes away, so what is here is never more than a
 * keystroke or two behind the screen.
 */
export function writeDraft(
  pallet: Pallet,
  storage: DraftStorage | null = browserStorage(),
  now: number = Date.now(),
): void {
  if (!storage) return;
  const draft: Draft = { pallet, at: new Date(now).toISOString() };
  try {
    storage.setItem(PREFIX + pallet.id, JSON.stringify(draft));
  } catch {
    // Out of room. Clear the drafts that have gone stale and try once more; if
    // it still will not fit, the design on screen is untouched and Save works.
    try {
      listDrafts(storage, now);
      storage.setItem(PREFIX + pallet.id, JSON.stringify(draft));
    } catch {
      // Nothing further to try.
    }
  }
}

/** Drop a draft: the design has been saved, or deleted, or the draft refused. */
export function clearDraft(id: string, storage: DraftStorage | null = browserStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(PREFIX + id);
  } catch {
    // Nothing to do about it.
  }
}

/** Drop several at once, for designs or clients that no longer exist. */
export function clearDrafts(ids: Iterable<string>, storage: DraftStorage | null = browserStorage()): void {
  for (const id of ids) clearDraft(id, storage);
}

/** "just now", "14 minutes ago" — how a recovered draft says how old it is. */
export function draftAge(at: string, now: number = Date.now()): string {
  const then = Date.parse(at);
  if (!Number.isFinite(then)) return 'earlier';
  const minutes = Math.floor((now - then) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
