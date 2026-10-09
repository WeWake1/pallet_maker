import { DEFAULT_BRAND } from '../brand/defaults.js';
import type { Brand } from '../brand/types.js';
import { choiceLabel } from '../choices.js';
import type { Layout } from '../geometry/types.js';
import { dayMonthYear } from '../ids.js';
import { mmLabel } from '../render/scene.js';
import { HANDLING_METHODS, notApplicable } from '../types.js';
import type { HandlingMethod, LoadKg, Pallet } from '../types.js';
import { componentTable } from './components.js';
import type { ComponentRow } from './components.js';
import { documentName } from './filename.js';
import { HANDLING_LABEL } from './handling.js';

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

/** What an attribute reads as when the design has not settled it. */
export const DASH = '—';

/**
 * The projection convention is the same on every drawing a company produces,
 * so it is settled once in its brand. Tolerances are not: they are the
 * design's own, and print blank as a dash or come off the sheet entirely.
 */

/** A label and its value, as they print. */
export type Pair = [label: string, value: string];

/** The four cells across the top: who it is for, what it is, and when. */
export interface SheetHeading {
  clientName: string;
  /** Empty when the client has not given the design a number of their own. */
  clientPartNo: string;
  /** The design's name, or its overall size where it has not been named. */
  palletName: string;
  /** The code and the overall size, or whichever of the two is left over. */
  subtitle: string;
  /** When it was last saved, day first: 06-08-2026. */
  date: string;
}

/** One method of moving the pallet, and whether this design is cleared for it. */
export interface HandlingRow {
  method: HandlingMethod;
  label: string;
  allowed: boolean;
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
  /**
   * Every handling method, ticked or crossed. The whole list on every sheet:
   * what a pallet must not be lifted with is the half of the answer that gets
   * it dropped, and a method left off the sheet has not been answered at all.
   */
  handling: HandlingRow[];
  /** Free text under the material block, or empty. */
  notes: string;
  /** For the document title and the download's file name. */
  title: string;
  /** Printed under the drawings: the projection convention and the units. */
  projectionNote: string;
}

export function sheetContent(
  pallet: Pallet,
  layout: Layout,
  brand: Brand = DEFAULT_BRAND,
): SheetContent {
  const size = `${mmLabel(layout.overallLength)} × ${mmLabel(layout.overallWidth)} × ${mmLabel(layout.overallHeight)}`;
  // A design without a code is a normal design, so the line under the name is
  // the size alone rather than the size behind a dangling separator.
  //
  // A design without a name is normal too, and the middle of the header is the
  // one cell that must not come out blank. Unnamed, the size moves up into the
  // name's line and the code takes the line underneath, so the sheet still says
  // what it is drawing.
  const named = pallet.palletName !== '';
  const heading = named ? pallet.palletName : size;
  const subtitle = named
    ? (pallet.palletCode ? `${pallet.palletCode} · ${size}` : size)
    : pallet.palletCode;

  return {
    heading: {
      clientName: pallet.clientName,
      clientPartNo: pallet.clientPartNo ?? '',
      palletName: heading,
      subtitle,
      date: dayMonthYear(pallet.updatedAt),
    },
    size,
    overall: overallRows(pallet, layout, size),
    components: componentTable(pallet, layout).flatMap((group) => group.rows),
    nails: nailRows(pallet),
    material: materialRows(pallet),
    handling: handlingRows(pallet),
    notes: pallet.notes ?? '',
    title: documentName(pallet),
    projectionNote: brand.projectionNote,
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

/** A load: a figure in kilograms, a dash, or no row. */
function loadRow(label: string, value: LoadKg | undefined): Pair[] {
  if (typeof value === 'number') return stated(label, `${value} kg`);
  return stated(label, value ?? '');
}

function overallRows(pallet: Pallet, layout: Layout, size: string): Pair[] {
  const rows: Pair[] = [
    ['Overall size', size],
    ...stated('Type', choiceLabel('palletType', pallet.palletType)),
    ...stated('Entry', choiceLabel('entry', pallet.entry)),
    ...stated('Deck', choiceLabel('deckType', pallet.deckType)),
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

/**
 * What the pallet may be moved with, in the order the catalogue states it.
 *
 * Read off the document rather than out of it: the order is the catalogue's, so
 * two designs' sheets carry the same five rows in the same five places whatever
 * order somebody happened to tick them in, and a method the document names twice
 * is still one row.
 */
function handlingRows(pallet: Pallet): HandlingRow[] {
  return HANDLING_METHODS.map((method) => ({
    method,
    label: HANDLING_LABEL[method],
    allowed: pallet.handling.includes(method),
  }));
}

function materialRows(pallet: Pallet): Pair[] {
  return [
    ...loadRow('Static load', pallet.staticLoadKg),
    ...loadRow('Dynamic load', pallet.dynamicLoadKg),
    ...stated('Species', pallet.species),
    ...stated('Planing', choiceLabel('planing', pallet.planing)),
    ...stated('Component tolerance', pallet.componentTolerance),
    ...stated('Total pallet tolerance', pallet.palletTolerance),
  ];
}
