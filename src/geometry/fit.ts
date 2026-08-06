import type { Layout } from './types.js';
import { EPSILON } from './distribute.js';

/**
 * The run a layer has to itself, once the boards it shares its level with are
 * out of the way.
 *
 * A deck whose boards run two ways is several layers at one height, and the
 * cross-running group has to stop short of the boards it sits between. Working
 * out where it stops is subtraction — the M pallet's three inner boards run
 * 1200 less the two 200 end boards, from 200 to 1000 — and it is subtraction
 * that gets done again every time an end board changes width.
 *
 * So this does the arithmetic, and the editor writes the two numbers it returns
 * into the layer's run span and run offset. It is not applied by the engine:
 * the drawing stays a straight read of the numbers on the form, and a run typed
 * over afterwards stays typed over.
 *
 * Only the group that *joined* a level is offered this, never the group that
 * established it. Both halves of a two-way deck share a level, but only one of
 * them is the inset one, and there is nothing in the geometry that says which:
 * the end boards of the M pallet run the full width and would be cut to the
 * gap between the inner boards if this were offered on them too. So the layer
 * marked as joining the level above is the one that gets cut to fit, which is
 * also the order it was built in.
 *
 * Returns null where there is nothing to fit between — a layer with its level
 * to itself, the layer that starts a level, or nothing blocking its run.
 */
export function fitRun(
  layout: Layout,
  layerId: string,
): { runOffsetMm: number; runSpanMm: number } | null {
  const layer = layout.layers.find((one) => one.layerId === layerId);
  if (!layer) return null;

  // In document order, so the first is the one that established the level.
  const level = layout.layers.filter((one) => one.level === layer.level);
  if (level.length < 2 || level[0]!.layerId === layerId) return null;
  const mates = level.filter((other) => other.layerId !== layerId);

  const runsAlongX = layer.direction === 'along_length';
  const full = runsAlongX ? layout.overallLength : layout.overallWidth;

  // Every mate board, as the stretch of the run axis it takes up. A board is
  // taken as blocking the whole run at its position: an end board that only
  // half crosses this group's boards still has to be cleared by all of them.
  const blocked = layout.pieces
    .filter((piece) => mates.some((mate) => mate.layerId === piece.layerId))
    .map((piece) =>
      runsAlongX
        ? { from: piece.x, to: piece.x + piece.dx }
        : { from: piece.y, to: piece.y + piece.dy },
    )
    .sort((a, b) => a.from - b.from);

  if (blocked.length === 0) return null;

  // The widest stretch of the run that no mate reaches into.
  let best: { from: number; to: number } | null = null;
  let cursor = 0;
  const consider = (from: number, to: number): void => {
    if (to - from <= EPSILON) return;
    if (!best || to - from > best.to - best.from) best = { from, to };
  };
  for (const span of blocked) {
    consider(cursor, span.from);
    cursor = Math.max(cursor, span.to);
  }
  consider(cursor, full);

  if (!best) return null;
  // Rounded inward, so a fractional gap gives a board that fits rather than one
  // that overruns by half a millimetre.
  const found: { from: number; to: number } = best;
  const runOffsetMm = Math.ceil(found.from - EPSILON);
  const runSpanMm = Math.floor(found.to + EPSILON) - runOffsetMm;
  return runSpanMm > 0 ? { runOffsetMm, runSpanMm } : null;
}
