/**
 * Output types of the layout engine.
 *
 * Framework free. No React, no zod, no I/O. Usable from a plain Node script.
 *
 * Coordinate system: origin at the bottom-left-bottom corner of the pallet.
 *   x runs along the pallet length (the direction the top boards run)
 *   y runs across the pallet width
 *   z runs up from the underside of the bottom-most layer
 */

import type { Direction, LayerKind } from '../types.js';
import type { NailDot, NailLine } from './nails.js';

/**
 * Where a piece came from in the document. The editor needs it to take a click
 * on a board back to the row that produced it, which is the only way a nudge
 * can be a number on a component rather than an edit to the drawing.
 */
export type PieceSource =
  | { kind: 'slot'; index: number }
  | { kind: 'cell'; row: number; col: number }
  | { kind: 'sheet' };

export interface PlacedPiece {
  /**
   * Which part this piece is one of. Derived from its kind, size, material and
   * variant — see `parts.ts` — never typed in, so pieces that share a number
   * really are the same piece of timber.
   */
  partNo: number;
  layerKind: LayerKind;
  /** Which layer produced this piece. Renderers group and emphasise by this. */
  layerId: string;
  source: PieceSource;
  x: number;
  y: number;
  z: number;
  dx: number;
  dy: number;
  dz: number;
  material: string;
  variant?: string;
  /** True when a manual nudge moved this piece off its evenly spaced position. */
  nudged: boolean;
}

/**
 * Per-layer results that are computed once here so that nothing downstream ever
 * recomputes geometry. Dimension callouts read the gap from this.
 */
export interface LayerLayout {
  layerId: string;
  kind: LayerKind;
  order: number;
  direction: Direction;
  contentType: 'sequence' | 'grid' | 'sheet';
  /** Underside of the layer, measured up from the underside of the pallet. */
  zBottom: number;
  thickness: number;
  /** Spacing across the direction the boards run. Null for grid layers. */
  spread: SpacingResult | null;
  /** Rows down the pallet length. Grid layers only. */
  rows: SpacingResult | null;
  /** Columns across the pallet width. Grid layers only. */
  cols: SpacingResult | null;
}

export interface SpacingResult {
  /** Extent the items are distributed across. */
  available: number;
  /** Where the run of items starts. */
  offset: number;
  /** Sum of the item extents. */
  used: number;
  /** available - used. Negative means the layer is over-full. */
  slack: number;
  /** The single shared gap. Always computed, never entered by the user. */
  gap: number;
  /** Number of gaps the slack was divided between. */
  gapCount: number;
  /** Start position of each item, nudges included. */
  positions: number[];
}

export interface BoundingBox {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Positive values mean the deck hangs out past the base below it. */
export interface Overhang {
  /** x- side */
  lengthStart: number;
  /** x+ side */
  lengthEnd: number;
  /** y- side */
  widthStart: number;
  /** y+ side */
  widthEnd: number;
}

export type IssueSeverity = 'error' | 'warning';

export interface LayoutIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
  layerId?: string;
  layerKind?: LayerKind;
}

export interface Layout {
  /** The flat list. Every renderer and every exporter consumes only this. */
  pieces: PlacedPiece[];
  layers: LayerLayout[];
  /** Sum of the layer thicknesses. */
  derivedHeight: number;
  /** The pallet's stated height, which may be overridden by the user. */
  overallHeight: number;
  overallLength: number;
  overallWidth: number;
  /** Bounding box of the block or runner layer. Null when there is none. */
  base: BoundingBox | null;
  topDeck: BoundingBox | null;
  bottomDeck: BoundingBox | null;
  /** Deck outline minus base footprint. Null when either is missing. */
  topOverhang: Overhang | null;
  bottomOverhang: Overhang | null;
  /** Nail positions in plan. Drawn in the top and bottom views only. */
  nailDots: NailDot[];
  /** The nail schedule, counted off the dots. What the sheet prints. */
  nailLines: NailLine[];
  issues: LayoutIssue[];
}

export class PalletLayoutError extends Error {
  readonly issues: LayoutIssue[];

  constructor(issues: LayoutIssue[]) {
    const lines = issues.map((i) => `  - ${i.message}`).join('\n');
    super(`Pallet cannot be laid out:\n${lines}`);
    this.name = 'PalletLayoutError';
    this.issues = issues;
  }
}
