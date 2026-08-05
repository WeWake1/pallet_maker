import type { Layout } from '../geometry/types.js';
import { renderIsometric } from '../render/isoView.js';
import { mmLabel } from '../render/scene.js';
import { esc } from '../render/svg.js';
import { renderView } from '../render/views.js';
import type { Pallet } from '../types.js';
import { componentTable } from './components.js';
import type { ComponentGroup } from './components.js';
import { DRAWING, mmToPx, PAGE, SHEET } from './layout.js';

/**
 * The specification sheet. Reads the layout and the pallet document; recomputes
 * no geometry of its own.
 */

const DECK_TYPE: Record<Pallet['deckType'], string> = {
  single_face: 'Single face',
  double_face_reversible: 'Double face, reversible',
  double_face_non_reversible: 'Double face, non-reversible',
};

const PALLET_TYPE: Record<Pallet['palletType'], string> = {
  block_4way: 'Block, 4-way',
  stringer_2way: 'Stringer, 2-way',
  plywood_type1: 'Plywood type 1, sheet on blocks',
  plywood_type2: 'Plywood type 2, sheet on centre boards',
  plywood_type3: 'Plywood type 3, sheet over a boarded deck',
  wing: 'Wing',
  other: 'Other',
};

const ENTRY: Record<Pallet['entry'], string> = {
  '2_way': '2-way',
  '4_way': '4-way',
  partial_4way: 'Partial 4-way',
};

const PLANING: Record<Pallet['planing'], string> = {
  none: 'None',
  '1_side': '1 side',
  '2_side': '2 sides',
  '4_side': '4 sides',
};

/**
 * Shop tolerances. The same on every drawing this generator produces, so they
 * are stated here rather than being one more thing to fill in per design.
 */
const COMPONENT_TOLERANCE = '± 2 mm';
const PALLET_TOLERANCE = '± 5 mm';

export interface SheetOptions {
  /** Desaturate every view, to check the sheet the way the shop floor prints it. */
  greyscale?: boolean;
}

export function renderSheet(
  pallet: Pallet,
  layout: Layout,
  options: SheetOptions = {},
): string {
  const groups = componentTable(pallet, layout);
  const grey = options.greyscale === true;

  const plan = {
    fitWidth: mmToPx(DRAWING.pairCellWidth),
    fitHeight: mmToPx(DRAWING.planRowHeight),
  };
  const elevation = {
    fitWidth: mmToPx(DRAWING.pairCellWidth),
    fitHeight: mmToPx(DRAWING.elevationRowHeight),
  };
  const iso = {
    fitWidth: mmToPx(DRAWING.width),
    fitHeight: mmToPx(DRAWING.isoRowHeight),
  };

  const views = {
    top: renderView(layout, 'top', { ...plan, greyscale: grey, idPrefix: 'sheet' }),
    bottom: renderView(layout, 'bottom', { ...plan, greyscale: grey, idPrefix: 'sheet' }),
    side: renderView(layout, 'side', { ...elevation, greyscale: grey, idPrefix: 'sheet' }),
    end: renderView(layout, 'end', { ...elevation, greyscale: grey, idPrefix: 'sheet' }),
    iso: renderIsometric(layout, { ...iso, greyscale: grey, idPrefix: 'sheet' }),
  };

  const size = `${mmLabel(layout.overallLength)} × ${mmLabel(layout.overallWidth)} × ${mmLabel(layout.overallHeight)}`;
  // A design without a code is a normal design, so the line under the name is
  // the size alone rather than the size behind a dangling separator.
  const subtitle = pallet.palletCode ? `${pallet.palletCode} · ${size}` : size;
  const title = [pallet.palletCode, pallet.palletName, pallet.updatedAt]
    .filter((part) => part !== '')
    .join(' ');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>${styles()}</style>
</head>
<body>
<div class="sheet">
  <header>
    <div class="who">
      <div class="name">${esc(pallet.clientName)}</div>
      ${pallet.clientPartNo ? `<div class="sub">Client part ${esc(pallet.clientPartNo)}</div>` : '<div class="sub"></div>'}
    </div>
    <div class="what">
      <div class="name">${esc(pallet.palletName)}</div>
      <div class="sub">${esc(subtitle)}</div>
    </div>
    <!-- The date is stamped by the store on every save, so it is always the
         date of the drawing on this page. The note underneath is free text and
         says whatever the shop or the client needs it to. -->
    <div class="when">
      <div class="name">${esc(pallet.updatedAt)}</div>
      <div class="sub">${pallet.note ? esc(pallet.note) : ''}</div>
    </div>
  </header>

  <div class="body">
    <section class="data">
      ${overallBlock(pallet, layout, size)}
      ${componentsBlock(groups)}
      ${nailsBlock(layout)}
      ${materialBlock(pallet)}
    </section>

    <section class="drawing">
      <div class="row plan">
        <figure>${views.top}</figure>
        <figure>${views.bottom}</figure>
      </div>
      <div class="row elevation">
        <figure>${views.side}</figure>
        <figure>${views.end}</figure>
      </div>
      <div class="row iso">
        <figure>${views.iso}</figure>
      </div>
      <p class="projection">First-angle projection, all dimensions in mm</p>
    </section>
  </div>
</div>
</body>
</html>
`;
}

function overallBlock(pallet: Pallet, layout: Layout, size: string): string {
  const rows: Array<[string, string]> = [
    ['Overall size', size],
    ['Type', PALLET_TYPE[pallet.palletType]],
    ['Entry', ENTRY[pallet.entry]],
    ['Deck', DECK_TYPE[pallet.deckType]],
  ];
  const overhang = layout.topOverhang;
  if (overhang && (overhang.lengthStart || overhang.lengthEnd)) {
    rows.push([
      'Wing',
      `${mmLabel(overhang.lengthStart)} / ${mmLabel(overhang.lengthEnd)} along length, ` +
        `${mmLabel(overhang.widthStart)} / ${mmLabel(overhang.widthEnd)} across width`,
    ]);
  }
  return block('Overall', pairTable(rows));
}

/**
 * One row per part, named for itself. A layer that makes a single part carries
 * that layer's name; a layer that makes several numbers them off. Nothing is a
 * heading over one row of its own restatement.
 */
function componentsBlock(groups: ComponentGroup[]): string {
  const body = groups
    .flatMap((group) => group.rows)
    .map(
      (row) =>
        `<tr>` +
        `<td class="num">${row.partNo}</td>` +
        `<td class="name">${esc(row.name)}${row.variant ? ` <span class="variant">${esc(row.variant)}</span>` : ''}</td>` +
        `<td class="dims">${mmLabel(row.length)} × ${mmLabel(row.width)} × ${mmLabel(row.thickness)}</td>` +
        `<td class="num">${row.quantity}</td>` +
        `</tr>`,
    )
    .join('');

  return block(
    'Components',
    `<table class="grid components">
      <thead><tr><th class="num">Part</th><th>Component</th><th>L × W × T (mm)</th><th class="num">Qty</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`,
    'wide',
  );
}

/**
 * The nail schedule, counted off the drawing rather than typed in: the sheet
 * cannot state a nail the top and bottom views do not show.
 */
function nailsBlock(layout: Layout): string {
  if (layout.nailLines.length === 0) return '';
  const rows = layout.nailLines
    .map(
      (nail) =>
        `<tr><td class="name">${esc(nail.label)}</td><td>${esc(nail.type)}</td>` +
        `<td class="num">${mmLabel(nail.sizeMm)}</td><td class="num">${nail.count}</td></tr>`,
    )
    .join('');
  const total = layout.nailLines.reduce((sum, nail) => sum + nail.count, 0);
  return block(
    'Nails',
    `<table class="grid">
      <thead><tr><th>Joint</th><th>Type</th><th class="num">Size</th><th class="num">Qty</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td class="name">Total</td><td></td><td></td><td class="num">${total}</td></tr></tfoot>
    </table>`,
  );
}

function materialBlock(pallet: Pallet): string {
  const rows: Array<[string, string]> = [
    ['Static load', pallet.staticLoadKg === undefined ? '—' : `${pallet.staticLoadKg} kg`],
    ['Dynamic load', pallet.dynamicLoadKg === undefined ? '—' : `${pallet.dynamicLoadKg} kg`],
    ['Species', pallet.species],
    ['Planing', PLANING[pallet.planing]],
    ['Component tolerance', COMPONENT_TOLERANCE],
    ['Total pallet tolerance', PALLET_TOLERANCE],
  ];
  const notes = pallet.notes
    ? `<p class="notes">${esc(pallet.notes)}</p>`
    : '';
  return block('Load and material', pairTable(rows) + notes);
}

function pairTable(rows: Array<[string, string]>): string {
  return `<table class="pairs"><tbody>${rows
    .map(([label, value]) => `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`)
    .join('')}</tbody></table>`;
}

function block(heading: string, body: string, modifier = ''): string {
  const cls = modifier ? `block ${modifier}` : 'block';
  return `<div class="${cls}"><h2>${esc(heading)}</h2>${body}</div>`;
}

function styles(): string {
  return `
  @page { size: ${PAGE.width}mm ${PAGE.height}mm; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    color: #111;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .sheet {
    width: ${PAGE.width}mm;
    height: ${PAGE.height}mm;
    padding: ${PAGE.padding}mm;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  header {
    height: ${SHEET.headerHeight}mm;
    margin-bottom: ${SHEET.headerGap}mm;
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 6mm;
    border-bottom: 0.6pt solid #111;
    padding-bottom: 1.5mm;
  }
  header .name { font-size: 15pt; font-weight: 600; line-height: 1.15; }
  header .sub { font-size: 10pt; color: #333; line-height: 1.3; }
  header .what { text-align: center; }
  header .when { text-align: right; }

  .body { flex: 1; display: flex; gap: ${SHEET.columnGap}mm; min-height: 0; }

  .data {
    width: ${SHEET.dataWidth}mm;
    border-right: 0.4pt solid #bbb;
    padding-right: ${SHEET.columnGap / 2}mm;
    display: flex;
    flex-direction: column;
    gap: 3.2mm;
    overflow: hidden;
  }
  .block h2 {
    font-size: 9pt;
    font-weight: 700;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: #333;
    margin: 0 0 1.2mm;
  }
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  .pairs th {
    text-align: left;
    font-weight: 400;
    color: #444;
    width: 38mm;
    padding: 0.7mm 0;
    vertical-align: top;
  }
  .pairs td { padding: 0.7mm 0; }

  /* Ruled on every side, so a row reads across the page as one row and a
     column heading sits over its own numbers. */
  .grid { border: 0.7pt solid #111; }
  .grid th {
    text-align: left;
    font-weight: 700;
    font-size: 9pt;
    color: #111;
    background: #eceff3;
    border: 0.5pt solid #111;
    padding: 1mm 1.4mm;
    white-space: nowrap;
  }
  .grid td {
    padding: 0.9mm 1.4mm;
    border: 0.4pt solid #9aa1aa;
    vertical-align: top;
  }
  .grid tfoot td { font-weight: 700; background: #f4f6f8; }
  .grid .num { text-align: right; white-space: nowrap; }
  .grid .dims { white-space: nowrap; }
  .grid .name { font-weight: 600; }

  /* The components table is the one the bench works from, so it is the biggest
     thing on the written side. */
  .components { font-size: 10.5pt; }
  .components th { font-size: 9.5pt; }
  .components .num { width: 11mm; }

  .variant { color: #555; font-weight: 400; }
  .notes { font-size: 9pt; color: #333; margin: 1.4mm 0 0; }

  .drawing { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .row { display: flex; gap: ${SHEET.columnGap}mm; margin-bottom: ${SHEET.rowGap}mm; }
  .row.plan { height: ${DRAWING.planRowHeight}mm; }
  .row.elevation { height: ${DRAWING.elevationRowHeight}mm; }
  .row.iso { height: ${DRAWING.isoRowHeight}mm; }
  .row figure {
    margin: 0;
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 0;
  }
  .row svg { display: block; }
  .projection {
    margin: auto 0 0;
    font-size: 8.5pt;
    color: #333;
    text-align: center;
    height: ${SHEET.footerHeight}mm;
  }
  `;
}
