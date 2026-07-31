import { z } from 'zod';
import type { Pallet } from './types.js';

/**
 * Runtime shape of a pallet document. Every dimension is millimetres, integer.
 * Kept out of `src/geometry/` so the layout engine stays dependency free.
 */

const mm = z.number().int();
const positiveMm = z.number().int().positive();

export const DirectionSchema = z.enum(['along_length', 'across_width']);

export const LayerKindSchema = z.enum([
  'top_deck',
  'bearer',
  'block',
  'runner',
  'bottom_deck',
]);

export const NailSpecSchema = z.object({
  label: z.string().min(1),
  type: z.string().min(1),
  sizeMm: positiveMm,
  count: z.number().int().nonnegative(),
});

export const SlotSchema = z.object({
  partNo: z.number().int().positive(),
  thickness: positiveMm,
  width: positiveMm,
  length: positiveMm,
  material: z.string().min(1),
  joinedToPrev: z.boolean().default(false),
  nudgeMm: mm.default(0),
  variant: z.string().min(1).optional(),
});

export const BlockCellSchema = z.object({
  partNo: z.number().int().positive(),
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
  partNo: z.number().int().positive(),
  thickness: positiveMm,
  width: positiveMm,
  length: positiveMm,
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
  spanMm: positiveMm.nullable().default(null),
  offsetMm: mm.default(0),
  runSpanMm: positiveMm.nullable().default(null),
  runOffsetMm: mm.default(0),
  content: LayerContentSchema,
});

export const PalletSchema = z.object({
  id: z.string().min(1),
  palletCode: z.string().min(1),
  clientName: z.string().min(1),
  clientPartNo: z.string().min(1).optional(),
  palletName: z.string().min(1),

  overallLength: positiveMm,
  overallWidth: positiveMm,
  /** Derived from the layer stack when left at 0. */
  overallHeight: z.number().int().nonnegative().default(0),

  palletType: z.enum([
    'block_4way',
    'stringer_2way',
    'plywood_type1',
    'plywood_type2',
    'wing',
    'other',
  ]),
  deckType: z.enum([
    'single_face',
    'double_face_reversible',
    'double_face_non_reversible',
  ]),
  entry: z.enum(['2_way', '4_way', 'partial_4way']),

  species: z.string().min(1),
  planing: z.enum(['none', '1_side', '2_side', '4_side']),
  staticLoadKg: z.number().nonnegative().optional(),
  dynamicLoadKg: z.number().nonnegative().optional(),

  nails: z.array(NailSpecSchema).default([]),
  notes: z.string().optional(),

  revision: z.string().min(1).default('A'),
  revisionDate: z.string().min(1),
  supersedes: z.string().min(1).optional(),
  frozen: z.boolean().default(false),

  layers: z.array(LayerSchema).min(1),
});

/** Compile-time check that the schema output really is a `Pallet`. */
export type ParsedPallet = z.infer<typeof PalletSchema>;
const _typeCheck: (p: ParsedPallet) => Pallet = (p) => p;
void _typeCheck;

/** Parse and validate a pallet document, throwing a readable error. */
export function parsePallet(input: unknown): Pallet {
  const result = PalletSchema.safeParse(input);
  if (!result.success) {
    const lines = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid pallet document:\n${lines}`);
  }
  return result.data;
}
