import { distributeEvenly } from '../geometry/distribute.js';
import type { Notch, Slot } from '../types.js';

/**
 * Notches, as the form says them.
 *
 * The document holds each notch where it sits; the form asks how many, how
 * big, and how far in from the ends, because that is how a stringer is
 * specified and how every runner in a layer is cut alike. This is the
 * arithmetic between the two: a pattern to the notches it means on a board of
 * a given length, and back again, so the form can read what a board has.
 */
export interface NotchPattern {
  count: number;
  lengthMm: number;
  depthMm: number;
  /** From either end of the board to the near edge of the nearest notch. */
  fromEndMm: number;
}

/**
 * A notched runner has two notches, one for each fork: the form ticks a box
 * and cuts two. The count is still a number underneath, so a document cut
 * differently by hand still reads back; past this many is a slip.
 */
export const NOTCHES_PER_BOARD = 2;
export const MAX_NOTCHES = 4;

/**
 * What a board gets when it is first notched: the GMA pallet's notch — 9 in
 * at the mouth, 1.38 in deep, set in 6 in from each end of a 48 in stringer,
 * which is an eighth of its length. Numbers to be corrected, not kept.
 */
export function defaultNotchPattern(boardLength: number): NotchPattern {
  return { count: 0, lengthMm: 229, depthMm: 35, fromEndMm: Math.round(boardLength / 8) };
}

/**
 * The notches a pattern means on a board this long, or nothing for none.
 *
 * One sits centred; two sit in from each end; more are spaced evenly between
 * the two end margins, the way boards are spaced across a deck. Positions are
 * whole millimetres, like everything else typed into a design.
 */
export function notchesFor(boardLength: number, pattern: NotchPattern): Notch[] | undefined {
  const count = Math.min(Math.max(Math.round(pattern.count), 0), MAX_NOTCHES);
  if (count === 0) return undefined;
  const cut = (offsetMm: number): Notch => ({
    offsetMm: Math.round(offsetMm),
    lengthMm: pattern.lengthMm,
    depthMm: pattern.depthMm,
  });
  if (count === 1) return [cut((boardLength - pattern.lengthMm) / 2)];
  const spread = distributeEvenly(
    boardLength - 2 * pattern.fromEndMm,
    pattern.fromEndMm,
    Array.from({ length: count }, () => pattern.lengthMm),
  );
  return spread.positions.map(cut);
}

/**
 * The pattern a board's notches are, or null where they are not one — cut by
 * hand in the document to sizes or places the form has no words for. A board
 * with no notches is the pattern with a count of nought and the defaults
 * standing ready behind it.
 */
export function notchPattern(slot: Slot): NotchPattern | null {
  const notches = slot.notches ?? [];
  if (notches.length === 0) return defaultNotchPattern(slot.length);
  const first = notches[0]!;
  const pattern: NotchPattern = {
    count: notches.length,
    lengthMm: first.lengthMm,
    depthMm: first.depthMm,
    fromEndMm: first.offsetMm,
  };
  const expected = notchesFor(slot.length, pattern) ?? [];
  const sorted = [...notches].sort((a, b) => a.offsetMm - b.offsetMm);
  const same =
    expected.length === sorted.length &&
    expected.every(
      (notch, i) =>
        notch.offsetMm === sorted[i]!.offsetMm &&
        notch.lengthMm === sorted[i]!.lengthMm &&
        notch.depthMm === sorted[i]!.depthMm,
    );
  return same ? pattern : null;
}

/**
 * A board cut to a new length, its notches going with it. Notches that are a
 * pattern keep their distance from the ends, which is what was meant by them;
 * notches cut by hand stay where they are, and the layout says if that no
 * longer fits.
 */
export function resizeSlot(slot: Slot, length: number): void {
  const pattern = notchPattern(slot);
  slot.length = length;
  if (pattern && pattern.count > 0) slot.notches = notchesFor(length, pattern);
}
