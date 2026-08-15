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
    // A new layer goes under the rest, not alongside the last one. Sharing a
    // level is asked for on the layer once it is there.
    sameLevelAsPrev: false,
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
 * The three joints a block pallet is nailed at, as the rows of a schedule
 * waiting to be filled in. Sizes and counts are left blank because they are the
 * estimator's to work out — nothing can read them off the drawing.
 */
export const DEFAULT_NAILS: NailSpec[] = [
  { label: 'top board to centre board', type: 'wire nail' },
  { label: 'centre board to block', type: 'wire nail' },
  { label: 'bottom board to block', type: 'wire nail' },
];

/**
 * A whole plain 1200 x 800 block pallet to start from.
 *
 * Nearly every design is a variation on this one, so a new pallet starts as a
 * complete pallet and the work is changing numbers rather than building a stack
 * of empty layers before anything can be seen. The library bears that out: of
 * the designs drawn so far, nearly nine in ten are block 4-way and four fifths
 * have exactly these four layers.
 *
 * The size is the one thing it does not bear out — it is typed afresh on almost
 * every design — so it is set to the commonest one rather than to a round
 * number, which makes it right more often and no harder to change.
 */
export function newPallet(client: { id: string; name: string }): Pallet {
  const { id: clientId, name: clientName } = client;
  const species = 'pine';
  const extent = { overallLength: 1200, overallWidth: 800 };
  return {
    id: newId(),
    palletCode: '',
    clientId,
    clientName,
    palletName: '1200 x 800',
    overallLength: extent.overallLength,
    overallWidth: extent.overallWidth,
    overallHeight: 0,
    palletType: 'block_4way',
    deckType: 'double_face_non_reversible',
    entry: '4_way',
    species,
    planing: 'none',
    nails: DEFAULT_NAILS.map((nail) => ({ ...nail })),
    // Empty: every crossing takes the default until one is clicked.
    nailPlacements: [],
    updatedAt: today(),
    layers: [
      newLayer('top_deck', 1, species, extent, 7),
      newLayer('bearer', 2, species, extent, 3),
      newLayer('block', 3, species, extent),
      newLayer('bottom_deck', 4, species, extent, 3),
    ],
  };
}

/**
 * Nothing built yet: the size and the timber, and no layers at all.
 *
 * For the design that is not a variation on anything — a one-off, or a shape
 * the examples do not cover — where starting from a block pallet means deleting
 * four layers before the real work begins.
 *
 * The overall size stays at 1200 x 800 rather than dropping to nothing, because
 * a layer added to a pallet with no size gets boards no length at all. It is a
 * placeholder to be typed over, and every layer added after it is typed over
 * takes the new size. The species stays for the same reason: it is what a new
 * layer's timber is taken from.
 *
 * A pallet with no layers cannot be saved or printed — the schema asks for at
 * least one — so this opens saying what it still needs, which is the honest
 * description of a design nobody has built yet.
 */
export function emptyPallet(client: { id: string; name: string }): Pallet {
  const { id: clientId, name: clientName } = client;
  return {
    id: newId(),
    palletCode: '',
    clientId,
    clientName,
    palletName: '',
    overallLength: 1200,
    overallWidth: 800,
    overallHeight: 0,
    // Nothing is assumed about what this pallet is. Every one of these is
    // offered as "not stated", and that is what nobody having said yet means.
    palletType: '',
    deckType: '',
    entry: '',
    species: 'pine',
    planing: '',
    // The default schedule names the joints of a block pallet, and this is not
    // one yet.
    nails: [],
    nailPlacements: [],
    updatedAt: today(),
    layers: [],
  };
}
