import type { Layout } from '../geometry/types.js';
import { mmLabel } from '../render/scene.js';
import { notApplicable } from '../types.js';
import type { LoadKg, Pallet } from '../types.js';
import { componentTable } from './components.js';
import type { ComponentRow } from './components.js';

export type { ComponentRow };

/**
 * What the specification sheet says, with nothing about how it looks.
 *
 * The sheet is presented twice — as HTML that a browser prints to PDF, and as
 * SVG for anyone who needs to take it into a drawing program. Both are the same
 * document, so what is on it is settled once, here, and each presenter only
 * decides how to set it out. A row added below appears on both.
 *
 * No geometry is computed here either: everything is read off the pallet
 * document and the layout it produced.
 */

/**
 * What each code prints as. Partial because the two states that are not values
 * — blank and `na` — are not printed names but instructions about the row
 * itself, and are handled by `stated` below.
 */
const DECK_TYPE: Partial<Record<Pallet['deckType'], string>> = {
  single_face: 'Single face',
  double_face_reversible: 'Double face, reversible',
  double_face_non_reversible: 'Double face, non-reversible',
};

const PALLET_TYPE: Partial<Record<Pallet['palletType'], string>> = {
  block_4way: 'Block, 4-way',
  stringer_2way: 'Stringer, 2-way',
  plywood_type1: 'Plywood type 1, sheet on blocks',
  plywood_type2: 'Plywood type 2, sheet on centre boards',
  plywood_type3: 'Plywood type 3, sheet over a boarded deck',
  wing: 'Wing',
  other: 'Other',
};

const ENTRY: Partial<Record<Pallet['entry'], string>> = {
  '2_way': '2-way',
  '4_way': '4-way',
  partial_4way: 'Partial 4-way',
};

const PLANING: Partial<Record<Pallet['planing'], string>> = {
  none: 'None',
  '1_side': '1 side',
  '2_side': '2 sides',
  '4_side': '4 sides',
};

/** What an attribute reads as when the design has not settled it. */
export const DASH = '—';

/**
 * Shop tolerances. The same on every drawing this generator produces, so they
 * are stated here rather than being one more thing to fill in per design.
 */
const COMPONENT_TOLERANCE = '± 2 mm';
const PALLET_TOLERANCE = '± 5 mm';

/** The projection note, printed under the drawings. */
export const PROJECTION_NOTE = 'First-angle projection, all dimensions in mm';

/** A label and its value, as they print. */
export type Pair = [label: string, value: string];

/** The four cells across the top: who it is for, what it is, and when. */
export interface SheetHeading {
  clientName: string;
  /** Empty when the client has not given the design a number of their own. */
  clientPartNo: string;
  palletName: string;
  /** The code and the overall size, or the size alone where there is no code. */
  subtitle: string;
  date: string;
  note: string;
}

export interface NailRow {
  label: string;
  type: string;
  /** Empty where the row has been typed only as far as its name. */
  size: string;
  quantity: string;
}

export interface SheetContent {
  heading: SheetHeading;
  /** The overall size as it prints, wanted by the heading and the first block. */
  size: string;
  overall: Pair[];
  components: ComponentRow[];
  /** Absent where the design has no nail schedule typed on it. */
  nails: { rows: NailRow[]; total: number } | null;
  material: Pair[];
  /** Free text under the material block, or empty. */
  notes: string;
  /** For the document title and the download's file name. */
  title: string;
}

export function sheetContent(pallet: Pallet, layout: Layout): SheetContent {
  const size = `${mmLabel(layout.overallLength)} × ${mmLabel(layout.overallWidth)} × ${mmLabel(layout.overallHeight)}`;
  // A design without a code is a normal design, so the line under the name is
  // the size alone rather than the size behind a dangling separator.
  const subtitle = pallet.palletCode ? `${pallet.palletCode} · ${size}` : size;

  return {
    heading: {
      clientName: pallet.clientName,
      clientPartNo: pallet.clientPartNo ?? '',
      palletName: pallet.palletName,
      subtitle,
      date: pallet.updatedAt,
      note: pallet.note ?? '',
    },
    size,
    overall: overallRows(pallet, layout, size),
    components: componentTable(pallet, layout).flatMap((group) => group.rows),
    nails: nailRows(pallet),
    material: materialRows(pallet),
    notes: pallet.notes ?? '',
    title: [pallet.palletCode, pallet.palletName, pallet.updatedAt]
      .filter((part) => part !== '')
      .join(' '),
  };
}

/**
 * One line of the data column — or none at all.
 *
 * Three states, not two. A value prints as itself. Blank is a question nobody
 * has answered yet, so it prints as a dash and stays on the sheet where the
 * shop can see it is still open. `na` says the attribute has no bearing on this
 * design, and a specification is not improved by a line saying so, so the row
 * is dropped and the ones below it close up.
 */
function stated(label: string, value: string): Pair[] {
  if (notApplicable(value)) return [];
  return [[label, value === '' ? DASH : value]];
}

/** A code as it prints. Blank and `na` carry through as themselves. */
function named<T extends string>(value: T, names: Partial<Record<T, string>>): string {
  return names[value] ?? value;
}

/** A load: a figure in kilograms, a dash, or no row. */
function loadRow(label: string, value: LoadKg | undefined): Pair[] {
  if (typeof value === 'number') return stated(label, `${value} kg`);
  return stated(label, value ?? '');
}

function overallRows(pallet: Pallet, layout: Layout, size: string): Pair[] {
  const rows: Pair[] = [
    ['Overall size', size],
    ...stated('Type', named(pallet.palletType, PALLET_TYPE)),
    ...stated('Entry', named(pallet.entry, ENTRY)),
    ...stated('Deck', named(pallet.deckType, DECK_TYPE)),
  ];
  const overhang = layout.topOverhang;
  if (overhang && (overhang.lengthStart || overhang.lengthEnd)) {
    rows.push([
      'Wing',
      `${mmLabel(overhang.lengthStart)} / ${mmLabel(overhang.lengthEnd)} along length, ` +
        `${mmLabel(overhang.widthStart)} / ${mmLabel(overhang.widthEnd)} across width`,
    ]);
  }
  return rows;
}

/**
 * The nail schedule as typed on the document. It states what the pallet is
 * built with and bought for; the dots in the top and bottom views state where
 * the nails go. The two are kept apart on purpose and neither is derived from
 * the other.
 */
function nailRows(pallet: Pallet): { rows: NailRow[]; total: number } | null {
  if (pallet.nails.length === 0) return null;
  return {
    rows: pallet.nails.map((nail) => ({
      label: nail.label,
      type: nail.type,
      size: nail.sizeMm === undefined ? '' : mmLabel(nail.sizeMm),
      quantity: nail.count === undefined ? '' : String(nail.count),
    })),
    total: pallet.nails.reduce((sum, nail) => sum + (nail.count ?? 0), 0),
  };
}

function materialRows(pallet: Pallet): Pair[] {
  return [
    ...loadRow('Static load', pallet.staticLoadKg),
    ...loadRow('Dynamic load', pallet.dynamicLoadKg),
    ...stated('Species', pallet.species),
    ...stated('Planing', named(pallet.planing, PLANING)),
    ['Component tolerance', COMPONENT_TOLERANCE],
    ['Total pallet tolerance', PALLET_TOLERANCE],
  ];
}
