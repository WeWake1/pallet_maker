import type { LayerKind, NailSpec } from '../types.js';
import { EPSILON } from './distribute.js';
import type { LayerLayout, LayoutIssue, PlacedPiece } from './types.js';

/**
 * One nail, positioned in plan.
 *
 * A joint is any two layers that meet, and nails go wherever a piece of one
 * crosses a piece of the other. How many, and how long, is a rule rather than a
 * number somebody typed:
 *
 *   - three nails where the crossing sits at a corner of the pallet,
 *   - two nails, on a diagonal, at every other crossing,
 *   - 64mm through the outermost boards of a face and everywhere on the
 *     underside, 50mm through the rest.
 *
 * A NailSpec whose label names the pair of layers may override the size, the
 * count, or both; anything it leaves blank stays derived.
 *
 * Computed here rather than in a renderer so that the sheet and the DXF place
 * their dots in exactly the same spot.
 */
export interface NailDot {
  x: number;
  y: number;
  upperLayerId: string;
  upperKind: LayerKind;
  lowerLayerId: string;
  lowerKind: LayerKind;
  /**
   * Which face of the pallet this joint is nailed from, if either. Only these
   * are drawn: the top view shows what is nailed down from above, the bottom
   * view what is nailed up from below, and an internal joint is under timber
   * and cannot be seen.
   */
  face: 'top' | 'bottom' | null;
  /** Nail length, in mm. */
  sizeMm: number;
  /** True when this dot is in one of the outermost boards of its face. */
  extreme: boolean;
  /** The NailSpec label the joint matched, or the derived description. */
  label: string;
}

/**
 * A line of the nail schedule: every nail of one length, in one face, of one
 * type, counted together. The sheet prints these and costing prices them, so
 * neither can disagree with the dots on the drawing.
 */
export interface NailLine {
  label: string;
  type: string;
  sizeMm: number;
  count: number;
  face: 'top' | 'bottom';
  /** False when a NailSpec supplied the size or the count. */
  derived: boolean;
}

/** The long nail: corners, the outermost boards, and the whole underside. */
export const EXTREME_NAIL_MM = 64;
/** The short nail: everywhere the timber is not doubled up at an edge. */
export const FIELD_NAIL_MM = 50;

const CORNER_COUNT = 3;
const FIELD_COUNT = 2;

/** When no spec names the joint, the nails are still nails. */
const DEFAULT_NAIL_TYPE = 'wire nail';

/** Words a user is likely to write in a NailSpec label, per layer kind. */
const LABEL_TERMS: Array<{ kind: LayerKind; terms: string[] }> = [
  { kind: 'panel', terms: ['plywood sheet', 'plywood', 'panel'] },
  { kind: 'top_deck', terms: ['top board', 'top deck', 'top'] },
  { kind: 'bottom_deck', terms: ['bottom board', 'bottom deck', 'bottom'] },
  { kind: 'bearer', terms: ['centre board', 'center board', 'connector', 'bearer', 'centre', 'center'] },
  { kind: 'block', terms: ['block'] },
  { kind: 'runner', terms: ['runner', 'stringer'] },
];

/** Which layer kinds a label mentions, in the order they are mentioned. */
function kindsMentioned(label: string): LayerKind[] {
  const text = label.toLowerCase();
  const hits: Array<{ kind: LayerKind; at: number }> = [];
  for (const { kind, terms } of LABEL_TERMS) {
    let at = -1;
    for (const term of terms) {
      const found = text.indexOf(term);
      if (found >= 0 && (at < 0 || found < at)) at = found;
    }
    if (at >= 0) hits.push({ kind, at });
  }
  return hits.sort((a, b) => a.at - b.at).map((hit) => hit.kind);
}

/**
 * What a layer may be called in a nail spec. A top deck made of a plywood sheet
 * answers to "top board" and to "plywood" alike, because it is both: the sheet
 * that replaces the top boards.
 */
export function aliasesOf(layer: LayerLayout): LayerKind[] {
  return layer.kind === 'top_deck' && layer.contentType === 'sheet'
    ? ['top_deck', 'panel']
    : [layer.kind];
}

/** The NailSpec whose label names this pair of layers, in either order. */
export function matchNailSpec(
  nails: NailSpec[],
  upper: LayerKind[],
  lower: LayerKind[],
): NailSpec | null {
  for (const spec of nails) {
    const kinds = kindsMentioned(spec.label);
    if (kinds.length < 2) continue;
    const [first, second] = kinds as [LayerKind, LayerKind];
    if (
      (upper.includes(first) && lower.includes(second)) ||
      (lower.includes(first) && upper.includes(second))
    ) {
      return spec;
    }
  }
  return null;
}

/** Whole numbers of nails per crossing, shared as evenly as the count allows. */
function shareEvenly(count: number, crossings: number): number[] {
  const shares: number[] = [];
  for (let i = 0; i < crossings; i++) {
    shares.push(
      Math.floor(((i + 1) * count) / crossings) - Math.floor((i * count) / crossings),
    );
  }
  return shares;
}

interface Crossing {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** True when the upper piece is one of the outermost boards of its layer. */
  upperExtreme: boolean;
}

/**
 * Where the nails go inside one crossing.
 *
 * Two nails sit on a diagonal, which is how a board is pinned against turning
 * on its fixing. Three — the corners of the pallet — add a second nail on the
 * top edge, so the cluster reads as a triangle. Any other count is a manual
 * override, and those are spread along the longer side of the crossing.
 */
const DIAGONAL_PAIR = [
  { u: 0.3, v: 0.28 },
  { u: 0.7, v: 0.72 },
];

const CORNER_TRIANGLE = [
  { u: 0.28, v: 0.26 },
  { u: 0.72, v: 0.26 },
  { u: 0.32, v: 0.72 },
];

function dotsIn(crossing: Crossing, count: number): Array<{ x: number; y: number }> {
  const w = crossing.x1 - crossing.x0;
  const h = crossing.y1 - crossing.y0;

  const pattern =
    count === FIELD_COUNT ? DIAGONAL_PAIR : count === CORNER_COUNT ? CORNER_TRIANGLE : null;
  if (pattern) {
    // The pattern is written for a crossing taller than it is wide, which is
    // how a board crosses a bearer on the pallets these rules came from. A wide
    // crossing turns it a quarter so the nails still straddle the long side.
    const upright = h >= w;
    return pattern.map(({ u, v }) =>
      upright
        ? { x: crossing.x0 + u * w, y: crossing.y0 + v * h }
        : { x: crossing.x0 + v * w, y: crossing.y0 + u * h },
    );
  }

  const alongX = w >= h;
  const span = alongX ? w : h;
  const dots: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < count; i++) {
    const at = ((i + 0.5) / count) * span;
    dots.push(
      alongX
        ? { x: crossing.x0 + at, y: (crossing.y0 + crossing.y1) / 2 }
        : { x: (crossing.x0 + crossing.x1) / 2, y: crossing.y0 + at },
    );
  }
  return dots;
}

function describe(layer: LayerLayout): string {
  return `the ${layer.kind.replace('_', ' ')} layer at position ${layer.order}`;
}

/**
 * The outermost pieces of a layer, across the direction they are arrayed in.
 *
 * Boards are laid out in a run, so the run has two ends and the boards at those
 * ends are the ones that carry the long nails. A layer of one piece — a plywood
 * sheet — is its own outermost piece, and gets them throughout.
 */
function extremePieces(pieces: PlacedPiece[]): Set<PlacedPiece> {
  const extremes = new Set<PlacedPiece>();
  if (pieces.length === 0) return extremes;

  const centreX = (p: PlacedPiece): number => p.x + p.dx / 2;
  const centreY = (p: PlacedPiece): number => p.y + p.dy / 2;
  const spread = (at: (p: PlacedPiece) => number): number =>
    Math.max(...pieces.map(at)) - Math.min(...pieces.map(at));

  // Which way the run goes is not stored, so read it off the pieces: they are
  // spread out along the axis they are arrayed in and lined up on the other.
  const at = spread(centreX) >= spread(centreY) ? centreX : centreY;
  const lo = Math.min(...pieces.map(at));
  const hi = Math.max(...pieces.map(at));
  for (const piece of pieces) {
    if (Math.abs(at(piece) - lo) < EPSILON || Math.abs(at(piece) - hi) < EPSILON) {
      extremes.add(piece);
    }
  }
  return extremes;
}

/**
 * Which crossings sit at a corner of the pallet: outermost in both directions
 * in plan, which is the four of them on a rectangular pallet.
 */
function cornerCrossings(crossings: Crossing[]): boolean[] {
  const cx = crossings.map((c) => (c.x0 + c.x1) / 2);
  const cy = crossings.map((c) => (c.y0 + c.y1) / 2);
  const atEdge = (value: number, all: number[]): boolean =>
    Math.abs(value - Math.min(...all)) < EPSILON || Math.abs(value - Math.max(...all)) < EPSILON;

  return crossings.map((_, i) => atEdge(cx[i]!, cx) && atEdge(cy[i]!, cy));
}

/**
 * @param layers ordered top to bottom, as the document lists them.
 */
export function computeNailDots(
  nails: NailSpec[],
  layers: LayerLayout[],
  pieces: PlacedPiece[],
): { dots: NailDot[]; lines: NailLine[]; issues: LayoutIssue[] } {
  const dots: NailDot[] = [];
  const issues: LayoutIssue[] = [];

  for (let i = 0; i + 1 < layers.length; i++) {
    const upper = layers[i]!;
    const lower = layers[i + 1]!;
    // The topmost joint is nailed from above and the lowest from below. On a
    // two layer pallet the one joint is both, and above is what you see.
    const face = i === 0 ? 'top' : i + 1 === layers.length - 1 ? 'bottom' : null;

    const uppers = pieces.filter((piece) => piece.layerId === upper.layerId);
    const lowers = pieces.filter((piece) => piece.layerId === lower.layerId);
    const outermost = extremePieces(uppers);

    const crossings: Crossing[] = [];
    for (const a of uppers) {
      for (const b of lowers) {
        const x0 = Math.max(a.x, b.x);
        const x1 = Math.min(a.x + a.dx, b.x + b.dx);
        const y0 = Math.max(a.y, b.y);
        const y1 = Math.min(a.y + a.dy, b.y + b.dy);
        if (x1 - x0 > EPSILON && y1 - y0 > EPSILON) {
          crossings.push({ x0, y0, x1, y1, upperExtreme: outermost.has(a) });
        }
      }
    }

    if (crossings.length === 0) {
      if (face) {
        issues.push({
          severity: 'warning',
          code: 'no_crossings',
          layerId: upper.layerId,
          layerKind: upper.kind,
          message: `${describe(upper)} never crosses ${describe(lower)}, so it has nothing to nail to`,
        });
      }
      continue;
    }

    // An internal joint is under timber: it is neither drawn nor scheduled.
    if (!face) continue;

    const spec = matchNailSpec(nails, aliasesOf(upper), aliasesOf(lower));
    const label = spec?.label ?? `${upper.kind.replace('_', ' ')} to ${lower.kind.replace('_', ' ')}`;

    // A spec may say how many nails the joint takes in total, in which case the
    // rule steps aside and the count is shared across the crossings as before.
    const override = spec?.count !== undefined && spec.count >= 0;
    const shares = override ? shareEvenly(spec!.count!, crossings.length) : null;
    const corners = cornerCrossings(crossings);

    crossings.forEach((crossing, index) => {
      // The underside is nailed up into the blocks through a single thickness
      // of board, so it takes the long nail throughout and has no corner extra.
      const extreme = face === 'bottom' ? true : crossing.upperExtreme;
      const count = shares
        ? shares[index]!
        : face === 'top' && corners[index]
          ? CORNER_COUNT
          : FIELD_COUNT;
      const sizeMm = spec?.sizeMm ?? (extreme ? EXTREME_NAIL_MM : FIELD_NAIL_MM);

      for (const dot of dotsIn(crossing, count)) {
        dots.push({
          x: dot.x,
          y: dot.y,
          upperLayerId: upper.layerId,
          upperKind: upper.kind,
          lowerLayerId: lower.layerId,
          lowerKind: lower.kind,
          face,
          sizeMm,
          extreme,
          label,
        });
      }
    });
  }

  return { dots, lines: nailLines(dots, nails, layers), issues };
}

const FACE_NAME: Record<'top' | 'bottom', string> = { top: 'Top face', bottom: 'Bottom face' };

/**
 * The nail schedule, counted off the dots themselves. Nails of one length in
 * one face are one line, which is how the shop buys and drives them.
 */
function nailLines(
  dots: NailDot[],
  nails: NailSpec[],
  layers: LayerLayout[],
): NailLine[] {
  const typeFor = (dot: NailDot): string => {
    const upper = layers.find((l) => l.layerId === dot.upperLayerId);
    const lower = layers.find((l) => l.layerId === dot.lowerLayerId);
    if (!upper || !lower) return DEFAULT_NAIL_TYPE;
    const spec = matchNailSpec(nails, aliasesOf(upper), aliasesOf(lower));
    return spec?.type ?? DEFAULT_NAIL_TYPE;
  };
  const overridden = (dot: NailDot): boolean => {
    const upper = layers.find((l) => l.layerId === dot.upperLayerId);
    const lower = layers.find((l) => l.layerId === dot.lowerLayerId);
    if (!upper || !lower) return false;
    const spec = matchNailSpec(nails, aliasesOf(upper), aliasesOf(lower));
    return spec?.sizeMm !== undefined || spec?.count !== undefined;
  };

  const groups = new Map<string, NailLine & { extreme: boolean }>();
  for (const dot of dots) {
    if (dot.face === null) continue;
    const type = typeFor(dot);
    const key = `${dot.face}|${dot.sizeMm}|${type}|${dot.extreme}`;
    const found = groups.get(key);
    if (found) {
      found.count += 1;
      continue;
    }
    groups.set(key, {
      label: FACE_NAME[dot.face],
      type,
      sizeMm: dot.sizeMm,
      count: 1,
      face: dot.face,
      extreme: dot.extreme,
      derived: !overridden(dot),
    });
  }

  const lines = [...groups.values()];
  // Only say which boards a line is for when a face has more than one kind of
  // nail in it; on the underside there is nothing to tell apart.
  for (const line of lines) {
    const others = lines.filter((other) => other.face === line.face).length;
    if (others > 1) {
      line.label = `${FACE_NAME[line.face]}, ${line.extreme ? 'outer boards' : 'inner boards'}`;
    }
  }

  return lines
    .sort((a, b) => (a.face === b.face ? b.sizeMm - a.sizeMm : a.face === 'top' ? -1 : 1))
    .map(({ extreme: _extreme, ...line }) => line);
}
