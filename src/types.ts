/**
 * Domain types for the pallet specification generator.
 *
 * Every dimension in this system is millimetres. Integers except where the
 * layout engine computes a shared gap, which may be fractional.
 *
 * `length` always runs the same direction as the top boards. `width` is across
 * them. `height` is vertical.
 */

export type Direction = 'along_length' | 'across_width';

/**
 * What an attribute is set to when it does not apply to this pallet.
 *
 * Blank and this are not the same answer. Blank is a question still open: the
 * sheet prints a dash, and the line stays where the shop can see it has not
 * been settled. `na` is the closed answer — there is no such thing on this
 * design — and a specification is not improved by a line saying so, so the
 * whole row comes off the sheet.
 */
export const NOT_APPLICABLE = 'na';

/** The two ways an attribute declines to have a value of its own. */
export type Unstated = '' | typeof NOT_APPLICABLE;

/** Whether a value says the attribute does not apply. Typed in any case. */
export function notApplicable(value: string | number | undefined): boolean {
  return typeof value === 'string' && value.trim().toLowerCase() === NOT_APPLICABLE;
}

/** Kilograms, or `na` where the design does not state a load at all. */
export type LoadKg = number | typeof NOT_APPLICABLE;

export type PalletType =
  | Unstated
  | 'block_4way'
  | 'stringer_2way'
  /** Blocks and a bottom deck, with a plywood sheet straight on top. */
  | 'plywood_type1'
  /** As type 1, with centre boards between the blocks and the sheet. */
  | 'plywood_type2'
  /** A whole boarded pallet, with a plywood sheet laid over its top deck. */
  | 'plywood_type3'
  | 'wing'
  | 'other';

export type DeckType =
  | Unstated
  | 'single_face'
  | 'double_face_reversible'
  | 'double_face_non_reversible';

export type Entry = Unstated | '2_way' | '4_way' | 'partial_4way';

export type Planing = Unstated | 'none' | '1_side' | '2_side' | '4_side';

export type LayerKind =
  | 'top_deck'
  | 'bearer'
  | 'block'
  | 'runner'
  | 'bottom_deck'
  /**
   * A plywood sheet laid over a deck that is already there, rather than one
   * replacing the top boards. A sheet that replaces them is a `top_deck` whose
   * content is a sheet; this kind exists for the pallet that has both.
   */
  | 'panel';

/**
 * One line of the nail schedule, as typed.
 *
 * This is a written statement of what the pallet takes, printed on the sheet and
 * priced by costing. It is deliberately not derived from the drawing and does
 * not have to agree with it: the dots in the top and bottom views say where
 * nails go, this says how many are bought and what they cost. Working out the
 * quantity is the estimator's job, and an earlier attempt to infer it from the
 * geometry got it wrong more often than it got it right.
 */
export interface NailSpec {
  /** e.g. "top board to centre board". Free text; printed as written. */
  label: string;
  /** e.g. "wire nail". Costing prices by this. */
  type: string;
  sizeMm?: number;
  count?: number;
}

/**
 * Where a piece came from in the document. The editor needs it to take a click
 * on a board back to the row that produced it, which is the only way a nudge
 * can be a number on a component rather than an edit to the drawing.
 */
export type PieceSource =
  | { kind: 'slot'; index: number }
  | { kind: 'cell'; row: number; col: number }
  | { kind: 'sheet' };

/**
 * A crossing whose nail count has been set by hand.
 *
 * Every crossing gets nails without one of these — two on a diagonal, three at
 * the four corners of the top face — so the document only records the crossings
 * you clicked. Keyed by the two pieces that cross rather than by a position, so
 * resizing a board or nudging it carries its nails along with it.
 */
export interface NailPlacement {
  upperLayerId: string;
  upperSource: PieceSource;
  lowerLayerId: string;
  lowerSource: PieceSource;
  /** 0 to MAX_NAILS_PER_CROSSING. Zero means deliberately not nailed. */
  count: number;
}

/**
 * One centre, two diagonal, three triangle, four square. Past four there is no
 * pattern a fitter would read off a printed sheet, so a crossing stops there.
 * Here rather than in the layout engine because it bounds a stored field.
 */
export const MAX_NAILS_PER_CROSSING = 4;

export interface Slot {
  /** Extent along the direction the boards run. */
  length: number;
  /** Extent across the direction the boards run. */
  width: number;
  thickness: number;
  material: string;
  /** No gap between this slot and the previous one. */
  joinedToPrev: boolean;
  /** Manual override across the run. Default 0. */
  nudgeMm: number;
  /** e.g. "outer", "inner" */
  variant?: string;
}

export interface BlockCell {
  /** Along the pallet length. */
  lengthMm: number;
  /** Across the pallet width. */
  widthMm: number;
  heightMm: number;
  material: string;
  variant?: string;
}

export interface BlockGrid {
  /** Normally 3. Rows are distributed along the pallet length. */
  rows: number;
  /** Normally 3. Columns are distributed across the pallet width. */
  cols: number;
  /** [row][col] */
  cells: BlockCell[][];
  rowSpanMm: number | null;
  rowOffsetMm: number;
  colSpanMm: number | null;
  colOffsetMm: number;
}

export interface SheetSpec {
  /** Along the pallet length. */
  length: number;
  /** Across the pallet width. */
  width: number;
  thickness: number;
  /** 'plywood' */
  material: string;
}

export type LayerContent =
  | { type: 'sequence'; slots: Slot[] }
  | { type: 'grid'; grid: BlockGrid }
  | { type: 'sheet'; sheet: SheetSpec };

export interface Layer {
  id: string;
  kind: LayerKind;
  /** Ordered top to bottom. Lower order sits higher. */
  order: number;
  /** Ignored for grid layers. */
  direction: Direction;

  /**
   * Sit at the same height as the layer above instead of underneath it.
   *
   * A layer runs one way. That is right for nearly every deck, and wrong for
   * the deck whose boards do not all run the same way — the M pallet's bottom
   * deck, where two boards run across the width at the ends and three run along
   * the length between them, every one of the five nailed straight to the
   * blocks. Those five are not two decks stacked; they are one deck of timber
   * at one height, and a stack of layers cannot say so.
   *
   * So a layer may be marked as belonging to the level above rather than to the
   * one below it. Layers sharing a level share a `zBottom`, the level is as
   * thick as its thickest member, and each member keeps its own direction,
   * span, offset and run — which is exactly what the cross-running group needs
   * to be shortened and placed between the boards it sits between.
   *
   * Ignored on the topmost layer, which has nothing above to share with.
   */
  sameLevelAsPrev: boolean;

  /**
   * Extent ACROSS the direction the boards run.
   * null means the full pallet dimension.
   */
  spanMm: number | null;
  offsetMm: number;

  /**
   * Extent ALONG the direction the boards run. Only needed when the base is
   * inset on all four sides. null means flush.
   */
  runSpanMm: number | null;
  runOffsetMm: number;

  content: LayerContent;
}

/**
 * A customer. Kept as a record of its own rather than as a name typed on each
 * design, so that a client can be on the books before they have ordered
 * anything, and so that correcting a spelling corrects it once.
 */
export interface Client {
  id: string;
  name: string;
  createdAt: string;
}

export interface Pallet {
  id: string;
  /**
   * e.g. AP-001. Empty until the shop has one to give it — a design is saved,
   * printed and worked on by name long before it is assigned a code.
   */
  palletCode: string;
  /** Which client this design belongs to. The clients list is the authority. */
  clientId: string;
  /**
   * The client's name as it stood when this was last written. A copy, kept so
   * that a sheet can be printed from the document alone; renaming a client
   * refreshes it on every design of theirs.
   */
  clientName: string;
  clientPartNo?: string;
  /**
   * e.g. "1000 x 800". Empty where the design has not been named; the sheet
   * heading and the dashboard fall back to the overall size and "Untitled".
   */
  palletName: string;

  overallLength: number;
  overallWidth: number;
  /** Derived from the layer stack by default, overridable. */
  overallHeight: number;

  palletType: PalletType;
  deckType: DeckType;
  entry: Entry;

  /**
   * Free text, and the material a new board is given. Blank prints a dash;
   * `na` takes the line off the sheet. See {@link NOT_APPLICABLE}.
   */
  species: string;
  planing: Planing;
  staticLoadKg?: LoadKg;
  dynamicLoadKg?: LoadKg;

  /** The written nail schedule. Independent of the dots on the drawing. */
  nails: NailSpec[];
  /** Crossings clicked in the editor, overriding the default nail count. */
  nailPlacements: NailPlacement[];
  notes?: string;

  /**
   * ISO date, set by the store every time the design is written. A design is
   * edited in place and overwrites what was there, so this date is the whole of
   * what says how current it is.
   */
  updatedAt: string;
  /**
   * Free text printed in the title block beside the date. Whatever the shop or
   * the client needs it to say — "(old)", a client drawing number, nothing.
   */
  note?: string;

  /** Ordered top to bottom. */
  layers: Layer[];
}
