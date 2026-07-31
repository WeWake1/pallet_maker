import { newId, today } from './ids.js';
import type { Pallet } from './types.js';

/**
 * Revisions.
 *
 * A published revision is frozen and never edited. Editing a frozen pallet
 * creates a new row with the next revision letter, `supersedes` pointing at the
 * previous id, and a fresh date. The old revision stays readable forever: a
 * pallet built last year was built to rev A, and if a client raises a complaint
 * the exact sheet from that date has to be retrievable.
 */

/** 'A' to 'B', 'Z' to 'AA', 'AZ' to 'BA'. Spreadsheet columns, not base 26. */
export function nextRevision(revision: string): string {
  const current = revision.trim().toUpperCase();
  if (!/^[A-Z]+$/.test(current)) return 'A';

  const letters = current.split('');
  let index = letters.length - 1;
  while (index >= 0) {
    if (letters[index] !== 'Z') {
      letters[index] = String.fromCharCode(letters[index]!.charCodeAt(0) + 1);
      return letters.join('');
    }
    letters[index] = 'A';
    index -= 1;
  }
  return `A${letters.join('')}`;
}

/**
 * The next revision of a design: a new row that supersedes the one it came
 * from. Nothing about the old row changes.
 */
export function revisePallet(pallet: Pallet): Pallet {
  const next = structuredClone(pallet);
  next.id = newId();
  next.revision = nextRevision(pallet.revision);
  next.revisionDate = today();
  next.supersedes = pallet.id;
  next.frozen = false;
  return next;
}

/**
 * A copy of a design: a new design, related to nothing.
 *
 * Designs are never linked. Editing one client's pallet must never affect
 * another's, even when the two started from the same original, so the copy
 * shares no object with its source and keeps no reference back to it.
 */
export function duplicatePallet(pallet: Pallet): Pallet {
  const copy = structuredClone(pallet);
  copy.id = newId();
  copy.revision = 'A';
  copy.revisionDate = today();
  copy.frozen = false;
  delete copy.supersedes;
  for (const layer of copy.layers) layer.id = newId();
  return copy;
}
