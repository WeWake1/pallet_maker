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

export function newSlot(
  partNo: number,
  material: string,
  length: number,
  overrides: Partial<Slot> = {},
): Slot {
  return {
    partNo,
    thickness: 18,
    width: 100,
    length,
    material,
    joinedToPrev: false,
    nudgeMm: 0,
    ...overrides,
  };
}

export function newCell(partNo: number, material: string): BlockCell {
  return { partNo, lengthMm: 100, widthMm: 100, heightMm: 100, material };
}

export function newGrid(rows: number, cols: number, partNo: number, material: string): BlockGrid {
  return {
    rows,
    cols,
    cells: Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => newCell(partNo, material)),
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
  partNo: number,
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
          partNo,
          thickness: 12,
          width: extent.overallWidth,
          length: extent.overallLength,
          material: 'plywood',
        },
      },
    };
  }

  if (kind === 'block') {
    return {
      ...base,
      direction: 'along_length' as const,
      content: { type: 'grid', grid: newGrid(3, 3, partNo, material) },
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
      slots: Array.from({ length: count }, () => newSlot(partNo, material, length)),
    },
  };
}

export const DEFAULT_NAILS: NailSpec[] = [
  { label: 'top board to centre board', type: 'wire nail', sizeMm: 50, count: 21 },
  { label: 'centre board to block', type: 'wire nail', sizeMm: 65, count: 18 },
  { label: 'bottom board to block', type: 'wire nail', sizeMm: 65, count: 9 },
];

/**
 * A whole plain 1000 x 800 block pallet to start from.
 *
 * Nearly every design is a variation on this one, so a new pallet starts as a
 * complete pallet and the work is changing numbers rather than building a stack
 * of empty layers before anything can be seen.
 */
export function newPallet(): Pallet {
  const species = 'pine';
  const extent = { overallLength: 1000, overallWidth: 800 };
  return {
    id: newId(),
    palletCode: '',
    clientName: '',
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
    revision: 'A',
    revisionDate: today(),
    frozen: false,
    layers: [
      newLayer('top_deck', 1, 1, species, extent, 7),
      newLayer('bearer', 2, 2, species, extent, 3),
      newLayer('block', 3, 3, species, extent),
      newLayer('bottom_deck', 4, 4, species, extent, 3),
    ],
  };
}

/** The next free part number, so a new row never collides with an existing one. */
export function nextPartNo(pallet: Pallet): number {
  let max = 0;
  for (const layer of pallet.layers) {
    const content = layer.content;
    if (content.type === 'sequence') {
      for (const slot of content.slots) max = Math.max(max, slot.partNo);
    } else if (content.type === 'grid') {
      for (const cell of content.grid.cells.flat()) max = Math.max(max, cell.partNo);
    } else {
      max = Math.max(max, content.sheet.partNo);
    }
  }
  return max + 1;
}
