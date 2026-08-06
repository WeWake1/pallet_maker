import { MAX_NAILS_PER_CROSSING } from '../types.js';
import type { LayerKind, NailPlacement, PieceSource } from '../types.js';
import { EPSILON } from './distribute.js';
import type { LayerLayout, LayoutIssue, PlacedPiece } from './types.js';

/**
 * Where the nails go on the drawing.
 *
 * A joint is any two layers that meet, and a crossing is one place where a piece
 * of the upper crosses a piece of the lower. Every crossing carries nails: two
 * on a diagonal, which is how a board is pinned against turning on its fixing,
 * and three at the four corners of the top face, where the pallet is handled.
 *
 * That default is all most crossings ever need. Anywhere it is not enough — or
 * is too much — the crossing is clicked in the editor and the count it was given
 * is stored on the document as a NailPlacement. Nothing else decides: there is
 * no rule here inferring intent from board sizes or from typed labels, because
 * the one that used to got it wrong more often than it got it right.
 *
 * The nail schedule printed on the sheet is typed by hand and lives on the
 * document (`pallet.nails`). It is not counted off these dots and does not have
 * to agree with them.
 *
 * Computed here rather than in a renderer so that the sheet and the DXF place
 * their dots in exactly the same spot.
 */

/** One nail, positioned in plan. */
export interface NailDot {
  x: number;
  y: number;
  /**
   * The surface the head sits on, measured up from the underside of the pallet.
   * The flat views have no use for it; the pictorial views need it to put the
   * dot on the timber rather than on the ground.
   */
  z: number;
  /**
   * Which face of the pallet this joint is nailed from. The top view shows what
   * is nailed down from above and the bottom view what is nailed up from below.
   * An internal joint is under timber, cannot be seen, and produces no dots.
   */
  face: 'top' | 'bottom';
}

/** Which two pieces cross. What a placement is stored against. */
export interface NailCrossingKey {
  upperLayerId: string;
  upperSource: PieceSource;
  lowerLayerId: string;
  lowerSource: PieceSource;
}

/**
 * One place two boards cross, and the nails in it. The editor draws these as
 * click targets; a click cycles `count` and writes it to the document.
 */
export interface NailCrossing extends NailCrossingKey {
  face: 'top' | 'bottom';
  upperKind: LayerKind;
  lowerKind: LayerKind;
  /** The overlap rectangle, in plan. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /**
   * Where the heads sit: the top of the upper piece on the top face, the
   * underside of the lower piece on the bottom face — since that joint is
   * nailed up from below, and its heads are on the outside of the pallet.
   */
  z: number;
  count: number;
  /** What this crossing would carry with nothing stored against it. */
  defaultCount: number;
  /** True when `count` came from a click rather than from the default. */
  manual: boolean;
}

/** Two on a diagonal: enough to stop a board turning on its fixing. */
export const DEFAULT_NAIL_COUNT = 2;
/** The four corners of the top face, which is where the pallet is handled. */
export const CORNER_NAIL_COUNT = 3;

export { MAX_NAILS_PER_CROSSING };

export function sameNailCrossing(a: NailCrossingKey, b: NailCrossingKey): boolean {
  return (
    a.upperLayerId === b.upperLayerId &&
    a.lowerLayerId === b.lowerLayerId &&
    sameSource(a.upperSource, b.upperSource) &&
    sameSource(a.lowerSource, b.lowerSource)
  );
}

function sameSource(a: PieceSource, b: PieceSource): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'slot' && b.kind === 'slot') return a.index === b.index;
  if (a.kind === 'cell' && b.kind === 'cell') return a.row === b.row && a.col === b.col;
  return true;
}

/**
 * Where the nails sit inside one crossing, as fractions of it.
 *
 * Written for a crossing taller than it is wide, which is how a board crosses a
 * bearer on the pallets these came from. A wide crossing turns the pattern a
 * quarter so the nails still straddle the long side.
 */
const PATTERNS: Record<number, Array<{ u: number; v: number }>> = {
  0: [],
  1: [{ u: 0.5, v: 0.5 }],
  2: [
    { u: 0.3, v: 0.28 },
    { u: 0.7, v: 0.72 },
  ],
  // One at the head of the crossing and two abreast below it, so three reads as
  // a triangle at a glance rather than as a pair with one out of line.
  3: [
    { u: 0.5, v: 0.27 },
    { u: 0.27, v: 0.73 },
    { u: 0.73, v: 0.73 },
  ],
  4: [
    { u: 0.28, v: 0.26 },
    { u: 0.72, v: 0.26 },
    { u: 0.28, v: 0.74 },
    { u: 0.72, v: 0.74 },
  ],
};

function dotsIn(crossing: NailCrossing): Array<{ x: number; y: number }> {
  const pattern = PATTERNS[clampCount(crossing.count)] ?? [];
  const w = crossing.x1 - crossing.x0;
  const h = crossing.y1 - crossing.y0;
  const upright = h >= w;

  return pattern.map(({ u, v }) =>
    upright
      ? { x: crossing.x0 + u * w, y: crossing.y0 + v * h }
      : { x: crossing.x0 + v * w, y: crossing.y0 + u * h },
  );
}

export function clampCount(count: number): number {
  return Math.min(Math.max(Math.round(count), 0), MAX_NAILS_PER_CROSSING);
}

/**
 * The next count a click gives a crossing. Right round and back to the default,
 * so tapping on always returns a crossing to normal and no click can lose the
 * baseline nails for good.
 */
export function nextNailCount(count: number): number {
  return clampCount(count) >= MAX_NAILS_PER_CROSSING ? 0 : clampCount(count) + 1;
}

function describe(layer: LayerLayout): string {
  return `the ${layer.kind.replace('_', ' ')} layer at position ${layer.order}`;
}

/**
 * Which crossings sit at a corner of the pallet: outermost in both directions in
 * plan, which is the four of them on a rectangular pallet.
 */
function cornerCrossings(crossings: NailCrossing[]): boolean[] {
  const cx = crossings.map((c) => (c.x0 + c.x1) / 2);
  const cy = crossings.map((c) => (c.y0 + c.y1) / 2);
  const atEdge = (value: number, all: number[]): boolean =>
    Math.abs(value - Math.min(...all)) < EPSILON || Math.abs(value - Math.max(...all)) < EPSILON;

  return crossings.map((_, i) => atEdge(cx[i]!, cx) && atEdge(cy[i]!, cy));
}

/** The layers of each course of timber, in the order they were given. */
function byLevel(layers: LayerLayout[]): LayerLayout[][] {
  const levels: LayerLayout[][] = [];
  for (const layer of layers) {
    (levels[layer.level] ??= []).push(layer);
  }
  return levels.filter((level) => level !== undefined);
}

/**
 * @param placements the crossings the user has clicked. Anything not listed
 * takes the default.
 * @param layers ordered top to bottom, as the document lists them.
 */
export function computeNails(
  placements: NailPlacement[],
  layers: LayerLayout[],
  pieces: PlacedPiece[],
): { dots: NailDot[]; crossings: NailCrossing[]; issues: LayoutIssue[] } {
  const crossings: NailCrossing[] = [];
  const issues: LayoutIssue[] = [];

  // A joint is between two courses of timber, not between two layers. A deck
  // whose boards run two ways is several layers at one height, and every one of
  // them is nailed to the course below — not to each other. See Layer.
  const levels = byLevel(layers);

  for (let i = 0; i + 1 < levels.length; i++) {
    const upperLevel = levels[i]!;
    const lowerLevel = levels[i + 1]!;
    // The topmost joint is nailed from above and the lowest from below. On a
    // two layer pallet the one joint is both, and above is what you see.
    const face = i === 0 ? 'top' : i + 1 === levels.length - 1 ? 'bottom' : null;

    const found: NailCrossing[] = [];
    for (const upper of upperLevel) {
      for (const lower of lowerLevel) {
        const uppers = pieces.filter((piece) => piece.layerId === upper.layerId);
        const lowers = pieces.filter((piece) => piece.layerId === lower.layerId);

        const between: NailCrossing[] = [];
        for (const a of uppers) {
          for (const b of lowers) {
            const x0 = Math.max(a.x, b.x);
            const x1 = Math.min(a.x + a.dx, b.x + b.dx);
            const y0 = Math.max(a.y, b.y);
            const y1 = Math.min(a.y + a.dy, b.y + b.dy);
            if (x1 - x0 <= EPSILON || y1 - y0 <= EPSILON) continue;
            between.push({
              face: face ?? 'top',
              upperLayerId: upper.layerId,
              upperSource: a.source,
              upperKind: upper.kind,
              lowerLayerId: lower.layerId,
              lowerSource: b.source,
              lowerKind: lower.kind,
              x0,
              y0,
              x1,
              y1,
              z: face === 'bottom' ? b.z : a.z + a.dz,
              count: DEFAULT_NAIL_COUNT,
              defaultCount: DEFAULT_NAIL_COUNT,
              manual: false,
            });
          }
        }

        // Said per layer pair rather than per level, so the warning names the
        // group of boards that has nothing under it.
        if (between.length === 0 && face) {
          issues.push({
            severity: 'warning',
            code: 'no_crossings',
            layerId: upper.layerId,
            layerKind: upper.kind,
            message: `${describe(upper)} never crosses ${describe(lower)}, so it has nothing to nail to`,
          });
        }
        found.push(...between);
      }
    }

    // An internal joint is under timber: it is neither drawn nor clickable.
    if (!face || found.length === 0) continue;

    const corners = cornerCrossings(found);
    found.forEach((crossing, index) => {
      crossing.face = face;
      if (face === 'top' && corners[index]) {
        crossing.defaultCount = CORNER_NAIL_COUNT;
        crossing.count = CORNER_NAIL_COUNT;
      }

      const placed = placements.find((placement) => sameNailCrossing(placement, crossing));
      if (placed) {
        crossing.count = clampCount(placed.count);
        crossing.manual = true;
      }
    });

    crossings.push(...found);
  }

  const dots: NailDot[] = crossings.flatMap((crossing) =>
    dotsIn(crossing).map((dot) => ({
      x: dot.x,
      y: dot.y,
      z: crossing.z,
      face: crossing.face,
    })),
  );

  return { dots, crossings, issues };
}
