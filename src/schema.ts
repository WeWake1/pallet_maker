import { z } from 'zod';
import { today } from './ids.js';
import { MAX_NAILS_PER_CROSSING, NOT_APPLICABLE } from './types.js';
import type { Client, Pallet } from './types.js';

/**
 * Runtime shape of a pallet document. Every dimension is millimetres, integer.
 * Kept out of `src/geometry/` so the layout engine stays dependency free.
 */

const mm = z.number().int();
const positiveMm = z.number().int().positive();

/** A load in kilograms, or the word that keeps it off the sheet entirely. */
const loadKg = z.union([z.number().nonnegative(), z.literal(NOT_APPLICABLE)]);

export const DirectionSchema = z.enum(['along_length', 'across_width']);

export const LayerKindSchema = z.enum([
  'top_deck',
  'bearer',
  'block',
  'runner',
  'bottom_deck',
  'panel',
]);

// A line of the written nail schedule. Nothing is derived: size and qty are
// blank only because a row is typed a field at a time and half of one has to be
// storable. See NailSpec in types.ts.
export const NailSpecSchema = z.object({
  label: z.string().min(1),
  type: z.string().min(1),
  sizeMm: positiveMm.optional(),
  count: z.number().int().nonnegative().optional(),
});

export const PieceSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('slot'), index: z.number().int().nonnegative() }),
  z.object({
    kind: z.literal('cell'),
    row: z.number().int().nonnegative(),
    col: z.number().int().nonnegative(),
  }),
  z.object({ kind: z.literal('sheet') }),
]);

// One crossing whose nail count was clicked. Anything absent takes the default.
export const NailPlacementSchema = z.object({
  upperLayerId: z.string().min(1),
  upperSource: PieceSourceSchema,
  lowerLayerId: z.string().min(1),
  lowerSource: PieceSourceSchema,
  count: z.number().int().min(0).max(MAX_NAILS_PER_CROSSING),
});

export const SlotSchema = z.object({
  length: positiveMm,
  width: positiveMm,
  thickness: positiveMm,
  material: z.string().min(1),
  joinedToPrev: z.boolean().default(false),
  nudgeMm: mm.default(0),
  variant: z.string().min(1).optional(),
});

export const BlockCellSchema = z.object({
  lengthMm: positiveMm,
  widthMm: positiveMm,
  heightMm: positiveMm,
  material: z.string().min(1),
  variant: z.string().min(1).optional(),
});

export const BlockGridSchema = z.object({
  rows: z.number().int().positive(),
  cols: z.number().int().positive(),
  cells: z.array(z.array(BlockCellSchema)),
  rowSpanMm: positiveMm.nullable().default(null),
  rowOffsetMm: mm.default(0),
  colSpanMm: positiveMm.nullable().default(null),
  colOffsetMm: mm.default(0),
});

export const SheetSpecSchema = z.object({
  length: positiveMm,
  width: positiveMm,
  thickness: positiveMm,
  material: z.string().min(1),
});

export const LayerContentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('sequence'), slots: z.array(SlotSchema) }),
  z.object({ type: z.literal('grid'), grid: BlockGridSchema }),
  z.object({ type: z.literal('sheet'), sheet: SheetSpecSchema }),
]);

export const LayerSchema = z.object({
  id: z.string().min(1),
  kind: LayerKindSchema,
  order: z.number().int(),
  direction: DirectionSchema,
  // Absent on every document written before decks could run two ways at once,
  // and false is what those all meant: one layer, one height. See Layer.
  sameLevelAsPrev: z.boolean().default(false),
  spanMm: positiveMm.nullable().default(null),
  offsetMm: mm.default(0),
  runSpanMm: positiveMm.nullable().default(null),
  runOffsetMm: mm.default(0),
  content: LayerContentSchema,
});

export const PalletSchema = z.object({
  id: z.string().min(1),
  // Optional. A design is drawn, saved and printed long before the shop has a
  // code to give it, and refusing to save one without a code only meant a
  // placeholder was typed in and never corrected.
  palletCode: z.string().default(''),
  clientId: z.string().min(1),
  clientName: z.string().min(1),
  clientPartNo: z.string().min(1).optional(),
  // Optional, for the same reason as the code above: a design is often only a
  // size until someone settles on what to call it, and the sheet prints that
  // size in the name's place until then. See sheetContent.
  palletName: z.string().default(''),

  overallLength: positiveMm,
  overallWidth: positiveMm,
  /** Derived from the layer stack when left at 0. */
  overallHeight: z.number().int().nonnegative().default(0),

  // Every stated attribute below also takes '' and 'na'. Neither is a value:
  // blank is not settled yet and prints as a dash, 'na' does not apply to this
  // design and takes its row off the sheet. See NOT_APPLICABLE in types.ts.
  palletType: z.enum([
    '',
    'na',
    'block_4way',
    'stringer_2way',
    'plywood_type1',
    'plywood_type2',
    'plywood_type3',
    'wing',
    'other',
  ]),
  deckType: z.enum([
    '',
    'na',
    'single_face',
    'double_face_reversible',
    'double_face_non_reversible',
  ]),
  entry: z.enum(['', 'na', '2_way', '4_way', 'partial_4way']),

  species: z.string().default(''),
  planing: z.enum(['', 'na', 'none', '1_side', '2_side', '4_side']),
  staticLoadKg: loadKg.optional(),
  dynamicLoadKg: loadKg.optional(),

  nails: z.array(NailSpecSchema).default([]),
  // Absent on a document written before nails were placed by hand: every
  // crossing then simply takes its default.
  nailPlacements: z.array(NailPlacementSchema).default([]),
  notes: z.string().optional(),

  // The store stamps this on every write. A document arriving from an older
  // export, or from a hand-written fixture, is dated today rather than refused.
  updatedAt: z.string().min(1).default(() => today()),
  note: z.string().optional(),

  layers: z.array(LayerSchema).min(1),
});

/** Compile-time check that the schema output really is a `Pallet`. */
export type ParsedPallet = z.infer<typeof PalletSchema>;
const _typeCheck: (p: ParsedPallet) => Pallet = (p) => p;
void _typeCheck;

export const ClientSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  createdAt: z.string().min(1).default(() => today()),
});

const _clientCheck: (c: z.infer<typeof ClientSchema>) => Client = (c) => c;
void _clientCheck;

/** Parse and validate a pallet document, throwing a readable error. */
export function parsePallet(input: unknown): Pallet {
  return parsed(PalletSchema.safeParse(input), 'pallet');
}

export function parseClient(input: unknown): Client {
  return parsed(ClientSchema.safeParse(input), 'client');
}

function parsed<T>(result: z.SafeParseReturnType<unknown, T>, what: string): T {
  if (!result.success) {
    const lines = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid ${what} document:\n${lines}`);
  }
  return result.data;
}
