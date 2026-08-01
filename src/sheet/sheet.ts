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

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(pallet.palletCode)} ${esc(pallet.palletName)} rev ${esc(pallet.revision)}</title>
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
      <div class="sub">${esc(pallet.palletCode)} · ${esc(size)}</div>
    </div>
    <div class="when">
      <div class="name">Rev ${esc(pallet.revision)}</div>
      <div class="sub">${esc(pallet.revisionDate)}</div>
    </div>
  </header>

  <div class="body">
    <section class="data">
      ${overallBlock(pallet, layout, size)}
      ${componentsBlock(groups)}
      ${nailsBlock(pallet)}
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

function componentsBlock(groups: ComponentGroup[]): string {
  const body = groups
    .filter((group) => group.rows.length > 0)
    .map(
      (group) =>
        `<tr class="group"><td colspan="4">${esc(group.heading)}</td></tr>` +
        group.rows
          .map(
            (row) =>
              `<tr>` +
              `<td class="num">${row.partNo}</td>` +
              `<td>${esc(row.description)}${row.variant ? ` <span class="variant">${esc(row.variant)}</span>` : ''}</td>` +
              `<td class="num">${row.quantity}</td>` +
              `<td class="dims">${mmLabel(row.thickness)} × ${mmLabel(row.width)} × ${mmLabel(row.length)}</td>` +
              `</tr>`,
          )
          .join(''),
    )
    .join('');

  return block(
    'Components',
    `<table class="grid">
      <thead><tr><th>Part</th><th>Description</th><th>Qty</th><th>T × W × L</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`,
  );
}

function nailsBlock(pallet: Pallet): string {
  if (pallet.nails.length === 0) return '';
  const rows = pallet.nails
    .map(
      (nail) =>
        `<tr><td>${esc(nail.label)}</td><td>${esc(nail.type)}</td>` +
        `<td class="num">${mmLabel(nail.sizeMm)}</td><td class="num">${nail.count}</td></tr>`,
    )
    .join('');
  return block(
    'Nails',
    `<table class="grid">
      <thead><tr><th>Joint</th><th>Type</th><th>Size</th><th>Qty</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`,
  );
}

function materialBlock(pallet: Pallet): string {
  // The deck surface is read off the topmost layer rather than stored: a sheet
  // there is a panel, whether it replaced the top boards or was laid over them.
  const topLayer = [...pallet.layers].sort((a, b) => a.order - b.order)[0];
  const surface = topLayer?.content.type === 'sheet' ? 'Plywood panel' : 'Slatted';

  const rows: Array<[string, string]> = [
    ['Static load', pallet.staticLoadKg === undefined ? '—' : `${pallet.staticLoadKg} kg`],
    ['Dynamic load', pallet.dynamicLoadKg === undefined ? '—' : `${pallet.dynamicLoadKg} kg`],
    ['Species', pallet.species],
    ['Planing', PLANING[pallet.planing]],
    ['Surface', surface],
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

function block(heading: string, body: string): string {
  return `<div class="block"><h2>${esc(heading)}</h2>${body}</div>`;
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
  header .name { font-size: 11pt; font-weight: 600; line-height: 1.15; }
  header .sub { font-size: 7.5pt; color: #444; line-height: 1.3; }
  header .what { text-align: center; }
  header .when { text-align: right; }

  .body { flex: 1; display: flex; gap: ${SHEET.columnGap}mm; min-height: 0; }

  .data {
    width: ${SHEET.dataWidth}mm;
    border-right: 0.4pt solid #bbb;
    padding-right: ${SHEET.columnGap / 2}mm;
    display: flex;
    flex-direction: column;
    gap: 2.5mm;
    overflow: hidden;
  }
  .block h2 {
    font-size: 6.5pt;
    font-weight: 700;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: #555;
    margin: 0 0 1mm;
  }
  table { width: 100%; border-collapse: collapse; font-size: 6.8pt; }
  .pairs th {
    text-align: left;
    font-weight: 400;
    color: #555;
    width: 26mm;
    padding: 0.3mm 0;
    vertical-align: top;
  }
  .pairs td { padding: 0.3mm 0; }
  .grid th {
    text-align: left;
    font-weight: 600;
    font-size: 6.2pt;
    color: #555;
    border-bottom: 0.5pt solid #999;
    padding: 0.4mm 1mm 0.4mm 0;
  }
  .grid td { padding: 0.4mm 1mm 0.4mm 0; border-bottom: 0.3pt solid #e2e2e2; }
  .grid tr.group td {
    font-weight: 600;
    padding-top: 1.2mm;
    border-bottom: 0.3pt solid #999;
  }
  .grid .num { text-align: right; padding-right: 2mm; white-space: nowrap; }
  .grid .dims { white-space: nowrap; }
  .variant { color: #666; }
  .notes { font-size: 6.5pt; color: #444; margin: 1mm 0 0; }

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
    font-size: 6.5pt;
    color: #555;
    text-align: center;
    height: ${SHEET.footerHeight}mm;
  }
  `;
}
