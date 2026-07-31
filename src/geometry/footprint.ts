import type { BoundingBox, Overhang, PlacedPiece } from './types.js';

/** Plan-view bounding box of a set of pieces. Null when there are none. */
export function boundingBox(pieces: PlacedPiece[]): BoundingBox | null {
  if (pieces.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pieces) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x + p.dx);
    y1 = Math.max(y1, p.y + p.dy);
  }
  return { x0, y0, x1, y1 };
}

/**
 * Gaps are shared out by division, so a deck that ends flush can land a
 * ten-thousandth of a nanometre past its base. Flush is flush.
 */
const FLUSH = 1e-6;

function settle(value: number): number {
  return Math.abs(value) < FLUSH ? 0 : value;
}

/**
 * A wing is not a special case: it is the difference between a deck outline and
 * the base footprint below it. Positive on a side means the deck hangs out.
 */
export function overhangOf(
  deck: BoundingBox | null,
  base: BoundingBox | null,
): Overhang | null {
  if (!deck || !base) return null;
  return {
    lengthStart: settle(base.x0 - deck.x0),
    lengthEnd: settle(deck.x1 - base.x1),
    widthStart: settle(base.y0 - deck.y0),
    widthEnd: settle(deck.y1 - base.y1),
  };
}

/** True when any side hangs out. Every non-zero overhang must be dimensioned. */
export function hasOverhang(overhang: Overhang | null, tolerance = 1e-6): boolean {
  if (!overhang) return false;
  return (
    Math.abs(overhang.lengthStart) > tolerance ||
    Math.abs(overhang.lengthEnd) > tolerance ||
    Math.abs(overhang.widthStart) > tolerance ||
    Math.abs(overhang.widthEnd) > tolerance
  );
}
