import { newId, today } from '../ids.js';
import type {
  BlockCell,
  BlockGrid,
  Direction,
  Layer,
  LayerKind,
  NailSpec,
  Pallet,
  Slot,
} from '../types.js';

/** The pallet dimensions a new layer has to fit. */
export interface Extent {
  overallLength: number;
  overallWidth: number;
}

/** How long a board is depends on which way its layer runs. */
export function runLength(extent: Extent, direction: Direction): number {
  return direction === 'along_length' ? extent.overallLength : extent.overallWidth;
}

export function newSlot(material: string, length: number, overrides: Partial<Slot> = {}): Slot {
  return {
    length,
    width: 100,
    thickness: 18,
    material,
    joinedToPrev: false,
    nudgeMm: 0,
    ...overrides,
  };
}

export function newCell(material: string): BlockCell {
  return { lengthMm: 100, widthMm: 100, heightMm: 100, material };
}

export function newGrid(rows: number, cols: number, material: string): BlockGrid {
  return {
    rows,
    cols,
    cells: Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => newCell(material)),
    ),
    rowSpanMm: null,
    rowOffsetMm: 0,
    colSpanMm: null,
    colOffsetMm: 0,
  };
}

/** A layer of the given kind, with content of the shape that kind normally has. */
export function newLayer(
  kind: LayerKind,
  order: number,
  material: string,
  extent: Extent,
  count = 1,
): Layer {
  const base = {
    id: newId(),
    kind,
    order,
    spanMm: null,
    offsetMm: 0,
    runSpanMm: null,
    runOffsetMm: 0,
  };

  if (kind === 'panel') {
    return {
      ...base,
      direction: 'along_length' as const,
      content: {
        type: 'sheet',
        sheet: {
          length: extent.overallLength,
          width: extent.overallWidth,
          thickness: 12,
          material: 'plywood',
        },
      },
    };
  }

  if (kind === 'block') {
    return {
      ...base,
      direction: 'along_length' as const,
      content: { type: 'grid', grid: newGrid(3, 3, material) },
    };
  }

  // Top boards run along the length by definition; everything under them
  // normally runs across it. A board is as long as the run it sits in.
  const direction: Direction = kind === 'top_deck' ? 'along_length' : 'across_width';
  const length = runLength(extent, direction);
  return {
    ...base,
    direction,
    content: {
      type: 'sequence',
      slots: Array.from({ length: count }, () => newSlot(material, length)),
    },
  };
}

/**
 * No sizes and no counts: those come from the drawing. What these carry is the
 * nail type, which is what costing prices the joint by.
 */
export const DEFAULT_NAILS: NailSpec[] = [
  { label: 'top board to centre board', type: 'wire nail' },
  { label: 'centre board to block', type: 'wire nail' },
  { label: 'bottom board to block', type: 'wire nail' },
];

/**
 * A whole plain 1000 x 800 block pallet to start from.
 *
 * Nearly every design is a variation on this one, so a new pallet starts as a
 * complete pallet and the work is changing numbers rather than building a stack
 * of empty layers before anything can be seen.
 */
export function newPallet(client: { id: string; name: string }): Pallet {
  const { id: clientId, name: clientName } = client;
  const species = 'pine';
  const extent = { overallLength: 1000, overallWidth: 800 };
  return {
    id: newId(),
    palletCode: '',
    clientId,
    clientName,
    palletName: '1000 x 800',
    overallLength: extent.overallLength,
    overallWidth: extent.overallWidth,
    overallHeight: 0,
    palletType: 'block_4way',
    deckType: 'double_face_non_reversible',
    entry: '4_way',
    species,
    planing: 'none',
    nails: DEFAULT_NAILS.map((nail) => ({ ...nail })),
    updatedAt: today(),
    layers: [
      newLayer('top_deck', 1, species, extent, 7),
      newLayer('bearer', 2, species, extent, 3),
      newLayer('block', 3, species, extent),
      newLayer('bottom_deck', 4, species, extent, 3),
    ],
  };
}
