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

export type PalletType =
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
  | 'single_face'
  | 'double_face_reversible'
  | 'double_face_non_reversible';

export type Entry = '2_way' | '4_way' | 'partial_4way';

export type Planing = 'none' | '1_side' | '2_side' | '4_side';

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

export interface NailSpec {
  /** e.g. "top board to centre board" */
  label: string;
  /** e.g. "wire nail" */
  type: string;
  sizeMm: number;
  count: number;
}

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
  /** e.g. "1000 x 800" */
  palletName: string;

  overallLength: number;
  overallWidth: number;
  /** Derived from the layer stack by default, overridable. */
  overallHeight: number;

  palletType: PalletType;
  deckType: DeckType;
  entry: Entry;

  species: string;
  planing: Planing;
  staticLoadKg?: number;
  dynamicLoadKg?: number;

  nails: NailSpec[];
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
