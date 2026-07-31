import type { LayerKind, NailSpec } from '../types.js';
import { EPSILON } from './distribute.js';
import type { LayerLayout, LayoutIssue, PlacedPiece } from './types.js';

/**
 * One nail, positioned in plan.
 *
 * A joint is any two layers that meet, and a nail dot goes wherever a piece of
 * one crosses a piece of the other. The count from the matching NailSpec is
 * shared evenly across those crossings.
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
  /** The NailSpec label the count came from. */
  label: string;
}

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
}

/** Dots inside one crossing, spread along its longer side. */
function dotsIn(crossing: Crossing, count: number): Array<{ x: number; y: number }> {
  const w = crossing.x1 - crossing.x0;
  const h = crossing.y1 - crossing.y0;
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
 * @param layers ordered top to bottom, as the document lists them.
 */
export function computeNailDots(
  nails: NailSpec[],
  layers: LayerLayout[],
  pieces: PlacedPiece[],
): { dots: NailDot[]; issues: LayoutIssue[] } {
  const dots: NailDot[] = [];
  const issues: LayoutIssue[] = [];

  for (let i = 0; i + 1 < layers.length; i++) {
    const upper = layers[i]!;
    const lower = layers[i + 1]!;
    // The topmost joint is nailed from above and the lowest from below. On a
    // two layer pallet the one joint is both, and above is what you see.
    const face = i === 0 ? 'top' : i + 1 === layers.length - 1 ? 'bottom' : null;

    const crossings: Crossing[] = [];
    for (const a of pieces.filter((piece) => piece.layerId === upper.layerId)) {
      for (const b of pieces.filter((piece) => piece.layerId === lower.layerId)) {
        const x0 = Math.max(a.x, b.x);
        const x1 = Math.min(a.x + a.dx, b.x + b.dx);
        const y0 = Math.max(a.y, b.y);
        const y1 = Math.min(a.y + a.dy, b.y + b.dy);
        if (x1 - x0 > EPSILON && y1 - y0 > EPSILON) crossings.push({ x0, y0, x1, y1 });
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

    const spec = matchNailSpec(nails, aliasesOf(upper), aliasesOf(lower));
    if (!spec) {
      // Only worth saying for a joint that would have been drawn.
      if (face) {
        issues.push({
          severity: 'warning',
          code: 'no_nail_spec',
          layerId: upper.layerId,
          layerKind: upper.kind,
          message:
            `No nail spec names ${upper.kind.replace('_', ' ')} to ${lower.kind.replace('_', ' ')}, ` +
            `so the ${face} face gets no nail dots`,
        });
      }
      continue;
    }

    const shares = shareEvenly(spec.count, crossings.length);
    crossings.forEach((crossing, index) => {
      for (const dot of dotsIn(crossing, shares[index]!)) {
        dots.push({
          x: dot.x,
          y: dot.y,
          upperLayerId: upper.layerId,
          upperKind: upper.kind,
          lowerLayerId: lower.layerId,
          lowerKind: lower.kind,
          face,
          label: spec.label,
        });
      }
    });
  }

  return { dots, issues };
}
