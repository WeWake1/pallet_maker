import type { SpacingResult } from './types.js';

/** Tolerance for floating point comparisons, in mm. */
export const EPSILON = 1e-6;

export interface SpacingItem {
  /** Extent along the axis the items are distributed across. */
  extent: number;
  /** No gap between this item and the previous one. */
  joinedToPrev: boolean;
  /** Manual override, added to the computed position. */
  nudgeMm: number;
}

/**
 * The one spacing calculation in the system. Items are flush to both outer
 * edges of the span and the leftover is shared equally between the gaps.
 *
 * Gaps are never entered by the user. They are always computed here.
 */
export function distribute(
  available: number,
  offset: number,
  items: SpacingItem[],
): SpacingResult {
  const used = items.reduce((sum, item) => sum + item.extent, 0);
  const slack = available - used;

  // The first item has no previous item, so its joinedToPrev flag is ignored.
  const joins = items.slice(1).filter((item) => item.joinedToPrev).length;
  const gapCount = Math.max(items.length - 1 - joins, 0);
  const gap = gapCount > 0 ? slack / gapCount : 0;

  const positions: number[] = [];
  let cursor = offset;
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    positions.push(cursor + item.nudgeMm);
    cursor += item.extent;
    const next = items[i + 1];
    if (next && !next.joinedToPrev) cursor += gap;
  }

  return { available, offset, used, slack, gap, gapCount, positions };
}

/** Even distribution with no joins and no nudges, used by grid layers. */
export function distributeEvenly(
  available: number,
  offset: number,
  extents: number[],
): SpacingResult {
  return distribute(
    available,
    offset,
    extents.map((extent) => ({ extent, joinedToPrev: false, nudgeMm: 0 })),
  );
}
