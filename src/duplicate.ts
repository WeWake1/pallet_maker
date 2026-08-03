import { newId, today } from './ids.js';
import type { Pallet } from './types.js';

/**
 * A copy of a design: a new design, related to nothing.
 *
 * This is how an old design is kept. A design is edited in place and overwrites
 * what was there, so before reworking one that has been built to, copy it — the
 * copy is a separate row from that moment on and nothing done to either can
 * reach the other. Name the one being kept "… (old)" and it will read plainly
 * on the dashboard.
 *
 * Designs are never linked. Editing one client's pallet must never affect
 * another's, even when the two started from the same original, so the copy
 * shares no object with its source and keeps no reference back to it.
 */
export function duplicatePallet(pallet: Pallet): Pallet {
  const copy = structuredClone(pallet);
  copy.id = newId();
  copy.updatedAt = today();
  for (const layer of copy.layers) layer.id = newId();
  return copy;
}
