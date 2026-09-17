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

import type { Direction, LayerKind, PieceSource } from '../types.js';
import type { NailCrossing, NailDot } from './nails.js';

/** Defined with the document types, since a nail placement is stored against one. */
export type { PieceSource };

/**
 * A notch, placed: the box of timber that is not there, in pallet coordinates.
 * Lies inside its piece's box, on the underside, and spans the piece right
 * across. A renderer that knows nothing of notches draws the piece whole and is
 * merely out of date; one that does cuts the bite out of the silhouette.
 */
export interface PlacedNotch {
  x: number;
  y: number;
  z: number;
  dx: number;
  dy: number;
  dz: number;
  /**
   * The radius its top corners are rounded to. The box above is the mouth
   * and the depth; the shape of the cut inside it is `notchOutline`.
   */
  radius: number;
}

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
  /**
   * Cuts in the underside, in the order they run along the piece. Absent on a
   * plain box, which is every piece but a notched runner. The box above is the
   * whole stick, notches included: bounds, footprints and painter ordering all
   * read the box, since a notch never reaches outside it.
   */
  notches?: PlacedNotch[];
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
  /**
   * Which course of timber this layer is part of, counted from the top. Layers
   * that share a level share a height: see `sameLevelAsPrev` on Layer. Normally
   * one layer per level, so normally this is just the layer's position.
   */
  level: number;
  /** Underside of the layer, measured up from the underside of the pallet. */
  zBottom: number;
  /** This layer's own thickness. Its level may be thicker; nothing else is. */
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
  /**
   * Every place a board of one layer crosses a board of the next, with the nail
   * count it currently carries. The editor draws these as click targets; the
   * dots above are what those counts come out as.
   */
  nailCrossings: NailCrossing[];
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
