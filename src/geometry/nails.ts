import type { LayerKind, NailSpec } from '../types.js';
import { EPSILON } from './distribute.js';
import type { LayerLayout, LayoutIssue, PlacedPiece } from './types.js';

/**
 * One nail, positioned in plan. Nail dots are placed automatically wherever a
 * deck board crosses the bearer, block or runner layer next to it, and the
 * count from the matching NailSpec is shared evenly across those crossings.
 *
 * Computed here rather than in a renderer so that the sheet and the DXF place
 * their dots in exactly the same spot.
 */
export interface NailDot {
  x: number;
  y: number;
  deckLayerId: string;
  deckKind: LayerKind;
  supportLayerId: string;
  supportKind: LayerKind;
  /** The NailSpec label the count came from. */
  label: string;
}

const DECK_KINDS: LayerKind[] = ['top_deck', 'bottom_deck'];
const SUPPORT_KINDS: LayerKind[] = ['bearer', 'block', 'runner'];

/** Words a user is likely to write in a NailSpec label, per layer kind. */
const LABEL_TERMS: Array<{ kind: LayerKind; terms: string[] }> = [
  { kind: 'top_deck', terms: ['top board', 'top deck', 'top'] },
  { kind: 'bottom_deck', terms: ['bottom board', 'bottom deck', 'bottom'] },
  { kind: 'bearer', terms: ['centre board', 'center board', 'bearer', 'centre', 'center'] },
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

/** The NailSpec whose label names this pair of layers, in either order. */
export function matchNailSpec(
  nails: NailSpec[],
  deckKind: LayerKind,
  supportKind: LayerKind,
): NailSpec | null {
  for (const spec of nails) {
    const kinds = kindsMentioned(spec.label);
    if (kinds.length < 2) continue;
    const [first, second] = kinds;
    if (
      (first === deckKind && second === supportKind) ||
      (first === supportKind && second === deckKind)
    ) {
      return spec;
    }
  }
  return null;
}

/** The support layer immediately against this deck: below a top deck, above a bottom deck. */
function adjacentSupport(deck: LayerLayout, supports: LayerLayout[]): LayerLayout | null {
  let best: LayerLayout | null = null;
  for (const support of supports) {
    if (deck.kind === 'top_deck') {
      if (support.zBottom + support.thickness > deck.zBottom + EPSILON) continue;
      if (!best || support.zBottom + support.thickness > best.zBottom + best.thickness) {
        best = support;
      }
    } else {
      if (support.zBottom + EPSILON < deck.zBottom + deck.thickness) continue;
      if (!best || support.zBottom < best.zBottom) best = support;
    }
  }
  return best;
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
  deckLayerId: string;
  supportLayerId: string;
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

export function computeNailDots(
  nails: NailSpec[],
  layers: LayerLayout[],
  pieces: PlacedPiece[],
): { dots: NailDot[]; issues: LayoutIssue[] } {
  const dots: NailDot[] = [];
  const issues: LayoutIssue[] = [];

  const decks = layers.filter((l) => DECK_KINDS.includes(l.kind));
  const supports = layers.filter((l) => SUPPORT_KINDS.includes(l.kind));

  for (const deck of decks) {
    const support = adjacentSupport(deck, supports);
    if (!support) continue;

    const crossings: Crossing[] = [];
    for (const d of pieces.filter((p) => p.layerId === deck.layerId)) {
      for (const s of pieces.filter((p) => p.layerId === support.layerId)) {
        const x0 = Math.max(d.x, s.x);
        const x1 = Math.min(d.x + d.dx, s.x + s.dx);
        const y0 = Math.max(d.y, s.y);
        const y1 = Math.min(d.y + d.dy, s.y + s.dy);
        if (x1 - x0 > EPSILON && y1 - y0 > EPSILON) {
          crossings.push({
            x0,
            y0,
            x1,
            y1,
            deckLayerId: deck.layerId,
            supportLayerId: support.layerId,
          });
        }
      }
    }

    if (crossings.length === 0) {
      issues.push({
        severity: 'warning',
        code: 'no_crossings',
        layerId: deck.layerId,
        layerKind: deck.kind,
        message: `Layer "${deck.layerId}" (${deck.kind}) never crosses layer "${support.layerId}" (${support.kind}), so it has nothing to nail to`,
      });
      continue;
    }

    const spec = matchNailSpec(nails, deck.kind, support.kind);
    if (!spec) {
      issues.push({
        severity: 'warning',
        code: 'no_nail_spec',
        layerId: deck.layerId,
        layerKind: deck.kind,
        message: `No nail spec names ${deck.kind} to ${support.kind}, so layer "${deck.layerId}" gets no nail dots`,
      });
      continue;
    }

    const shares = shareEvenly(spec.count, crossings.length);
    crossings.forEach((crossing, i) => {
      for (const dot of dotsIn(crossing, shares[i]!)) {
        dots.push({
          x: dot.x,
          y: dot.y,
          deckLayerId: deck.layerId,
          deckKind: deck.kind,
          supportLayerId: support.layerId,
          supportKind: support.kind,
          label: spec.label,
        });
      }
    });
  }

  return { dots, issues };
}
