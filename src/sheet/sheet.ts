import { brandFontFace, BRAND_FONT_STACK, COMPANY_NAME } from '../brand/brand.js';
import { LOGO_ASPECT, logoSvg } from '../brand/logo.js';
import type { Layout } from '../geometry/types.js';
import { renderIsometric } from '../render/isoView.js';
import { mmLabel } from '../render/scene.js';
import { esc } from '../render/svg.js';
import { measureView, renderView, sharedScale } from '../render/views.js';
import type { ViewKind } from '../render/project.js';
import type { Pallet } from '../types.js';
import type { ComponentRow, NailRow, Pair, SheetContent } from './content.js';
import { PROJECTION_NOTE, sheetContent } from './content.js';
import { DRAWING, LOGO, mmToPx, PAGE, PX_PER_MM, SHEET, WATERMARK } from './layout.js';

/**
 * The specification sheet, as HTML for a browser to print. What is on it is
 * settled in `content.ts`; this file only sets it out.
 *
 * The sheet carries the company's name across the diagonal as a watermark and
 * its mark in the bottom right corner. Both are embedded in the document rather
 * than linked, because the printer is handed the HTML with no base URL to
 * resolve against.
 */

export interface SheetOptions {
  /** Desaturate every view, to check the sheet the way the shop floor prints it. */
  greyscale?: boolean;
}

/** A row height as CSS wants it: enough precision for the printer, no more. */
const fmtMm = (mm: number): string => String(Math.round(mm * 100) / 100);

/** The three drawing rows, in mm, and the scale the flat views agreed on. */
export interface DrawingRows {
  plan: number;
  elevation: number;
  iso: number;
  /** px per mm, shared by all four flat views. */
  scale: number;
}

/**
 * How deep each row has to be, and the one scale the flat views are drawn at.
 *
 * Views on a drawing share a scale — that is what makes them one drawing rather
 * than four pictures of the same pallet. So the scale is settled first, across
 * all four at once, and the rows are then made as deep as the views come out.
 *
 * The two are not independent, so it takes a pass or two. The first asks what
 * the cell width allows, which is the most any of them could be drawn at, and on
 * an ordinary pallet that is the answer. A deep footprint is the awkward case:
 * the plans are then square enough to take the page, and the two rows, each
 * sized to its own views, can overrun the drawing area between them without
 * either one overrunning its own budget.
 *
 * So when they do, the plans are handed what is left after the elevations have
 * had theirs, which binds the plans by height and pulls the shared scale — and
 * the elevations with it — down until the three rows fit.
 */
export function drawingRows(layout: Layout): DrawingRows {
  const flat = DRAWING.rowsHeight - DRAWING.minIsoRowHeight;

  let plans = flat;
  let rows = measure(layout, plans, flat);

  for (let pass = 0; pass < 4 && rows.plan + rows.elevation > flat; pass++) {
    // Never below a quarter of the area: a plan squeezed past that is no longer
    // a drawing anyone can read, and the isometric can give the rest back.
    const next = Math.max(flat - rows.elevation, flat / 4);
    if (next >= plans) break;
    plans = next;
    rows = measure(layout, plans, flat);
  }

  return { ...rows, iso: DRAWING.rowsHeight - rows.plan - rows.elevation };
}

/** The flat views at the widest scale all four can share in the room given. */
function measure(
  layout: Layout,
  planBudget: number,
  elevationBudget: number,
): { plan: number; elevation: number; scale: number } {
  const cell = (budget: number) => ({
    fitWidth: mmToPx(DRAWING.pairCellWidth),
    fitHeight: mmToPx(budget),
  });
  const options: Record<ViewKind, ReturnType<typeof cell>> = {
    top: cell(planBudget),
    bottom: cell(planBudget),
    side: cell(elevationBudget),
    end: cell(elevationBudget),
  };

  const views = (['top', 'bottom', 'side', 'end'] as const).map((view) => ({
    view,
    options: options[view],
  }));
  const maxScale = sharedScale(layout, views);

  const height = (view: ViewKind): number =>
    measureView(layout, view, { ...options[view], maxScale }).height / PX_PER_MM;

  return {
    plan: Math.max(height('top'), height('bottom')),
    elevation: Math.max(height('side'), height('end')),
    scale: maxScale,
  };
}

/**
 * The five views, each rendered to fit its row.
 *
 * The four flat views are drawn to the one shared scale, so a length is the same
 * length wherever it appears: the pallet's height measures the same in the side
 * and end elevations, and its footprint the same under the plans as across them.
 * A view narrower than its cell — the end elevation, which is the short way
 * across the pallet — is centred in it by the sheet. The isometric is a picture
 * rather than a projection and keeps a scale of its own.
 *
 * `fragment` gives each one back as a `<g>` with no nested `<svg>` and no
 * `<clipPath>`, for the SVG sheet — see `SvgDocument.fragment`.
 */
export function sheetViews(
  layout: Layout,
  rows: DrawingRows,
  greyscale = false,
  fragment = false,
): Record<string, string> {
  const common = {
    greyscale,
    fragment,
    idPrefix: 'sheet',
    fitWidth: mmToPx(DRAWING.pairCellWidth),
    scale: rows.scale,
  };
  const iso = {
    fitWidth: mmToPx(DRAWING.width),
    fitHeight: mmToPx(rows.iso),
  };

  return {
    top: renderView(layout, 'top', common),
    bottom: renderView(layout, 'bottom', common),
    side: renderView(layout, 'side', common),
    end: renderView(layout, 'end', common),
    iso: renderIsometric(layout, { ...iso, greyscale, fragment, idPrefix: 'sheet' }),
  };
}

export function renderSheet(pallet: Pallet, layout: Layout, options: SheetOptions = {}): string {
  const content = sheetContent(pallet, layout);
  const rows = drawingRows(layout);
  const views = sheetViews(layout, rows, options.greyscale === true);
  const { heading } = content;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(content.title)}</title>
<style>${styles(rows)}</style>
</head>
<body>
<div class="sheet">
  <header>
    <div class="who">
      <div class="name">${esc(heading.clientName)}</div>
      ${heading.clientPartNo ? `<div class="sub">Client part ${esc(heading.clientPartNo)}</div>` : '<div class="sub"></div>'}
    </div>
    <div class="what">
      <div class="name">${esc(heading.palletName)}</div>
      <div class="sub">${esc(heading.subtitle)}</div>
    </div>
    <!-- The date is stamped by the store on every save, so it is always the
         date of the drawing on this page. The note underneath is free text and
         says whatever the shop or the client needs it to. -->
    <div class="when">
      <div class="name">${esc(heading.date)}</div>
      <div class="sub">${esc(heading.note)}</div>
    </div>
  </header>

  <div class="body">
    <section class="data">
      ${block('Overall', pairTable(content.overall))}
      ${componentsBlock(content.components)}
      ${nailsBlock(content.nails)}
      ${block('Load and material', pairTable(content.material) + notesHtml(content.notes))}
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
      <!-- The mark in the bottom right corner, where a title block's owner
           belongs on a drawing. -->
      <div class="footer">
        <p class="projection">${esc(PROJECTION_NOTE)}</p>
        ${logoSvg({ width: `${LOGO.height * LOGO_ASPECT}mm`, height: `${LOGO.height}mm`, title: COMPANY_NAME })}
      </div>
    </section>
  </div>

  <!-- Whose drawing this is, corner to corner. Last, so it lies over the
       drawings: every view carries a white background of its own and a
       watermark beneath them would show only in the gaps. -->
  <div class="watermark" aria-hidden="true"><span>${esc(COMPANY_NAME)}</span></div>
</div>
</body>
</html>
`;
}

function componentsBlock(rows: ComponentRow[]): string {
  const body = rows
    .map(
      (row) =>
        `<tr>` +
        `<td class="mid narrow">${row.partNo}</td>` +
        `<td class="name">${esc(row.name)}${row.variant ? ` <span class="variant">${esc(row.variant)}</span>` : ''}</td>` +
        `<td class="dims">${dimsCell(row.length, row.width, row.thickness)}</td>` +
        `<td class="mid narrow">${row.quantity}</td>` +
        `</tr>`,
    )
    .join('');

  return block(
    'Components',
    `<table class="grid components">
      <thead><tr><th class="mid narrow">Part</th><th>Component</th><th class="mid">L × W × T (mm)</th><th class="mid narrow">Qty</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`,
    'wide',
  );
}

/**
 * Length, width and thickness each in a box of the same width, with the × marks
 * between them. Every row measures out the same, so the three figures and the
 * two × marks stand in the same five places down the column, and the eye reads
 * a column of lengths rather than three ragged numbers.
 */
function dimsCell(length: number, width: number, thickness: number): string {
  return [mmLabel(length), mmLabel(width), mmLabel(thickness)]
    .map((value) => `<span class="d">${value}</span>`)
    .join('<span class="x">×</span>');
}

function nailsBlock(nails: SheetContent['nails']): string {
  if (!nails) return '';
  const rows = nails.rows
    .map(
      (nail: NailRow) =>
        `<tr><td class="name">${esc(nail.label)}</td><td>${esc(nail.type)}</td>` +
        `<td class="num">${esc(nail.size)}</td><td class="num">${esc(nail.quantity)}</td></tr>`,
    )
    .join('');
  return block(
    'Nails',
    `<table class="grid">
      <thead><tr><th>Joint</th><th>Type</th><th class="num">Size</th><th class="num">Qty</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td class="name">Total</td><td></td><td></td><td class="num">${nails.total}</td></tr></tfoot>
    </table>`,
  );
}

function notesHtml(notes: string): string {
  return notes ? `<p class="notes">${esc(notes)}</p>` : '';
}

function pairTable(rows: Pair[]): string {
  return `<table class="pairs"><tbody>${rows
    .map(([label, value]) => `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`)
    .join('')}</tbody></table>`;
}

function block(heading: string, body: string, modifier = ''): string {
  const cls = modifier ? `block ${modifier}` : 'block';
  return `<div class="${cls}"><h2>${esc(heading)}</h2>${body}</div>`;
}

function styles(rows: DrawingRows): string {
  return `
  @page { size: ${PAGE.width}mm ${PAGE.height}mm; margin: 0; }
  ${brandFontFace()}
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    color: #111;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .sheet {
    position: relative;
    width: ${PAGE.width}mm;
    height: ${PAGE.height}mm;
    padding: ${PAGE.padding}mm;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* Corner to corner, over everything, in the company's own face. Never a
     click target and never read aloud: it is not information, it is whose
     drawing this is. */
  .watermark {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    pointer-events: none;
    z-index: 2;
  }
  .watermark span {
    font-family: ${BRAND_FONT_STACK};
    font-size: ${WATERMARK.fontSize}pt;
    letter-spacing: ${WATERMARK.tracking}em;
    white-space: nowrap;
    color: #111;
    opacity: ${WATERMARK.opacity};
    transform: rotate(-${WATERMARK.angle.toFixed(2)}deg);
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
  .grid .mid { text-align: center; white-space: nowrap; }
  .grid .dims { white-space: nowrap; text-align: center; }
  .grid .name { font-weight: 600; }

  /* The components table is the one the bench works from, so it is the biggest
     thing on the written side. */
  .components { font-size: 10.5pt; }
  .components th { font-size: 9.5pt; }
  .components .narrow { width: 12mm; }

  /* Fixed boxes, so the figures and the × marks line up down the column. */
  .dims .d { display: inline-block; width: 13.5mm; text-align: center; }
  .dims .x { display: inline-block; width: 4mm; text-align: center; color: #555; }

  .variant { color: #555; font-weight: 400; }
  .notes { font-size: 9pt; color: #333; margin: 1.4mm 0 0; }

  .drawing { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .row { display: flex; gap: ${SHEET.columnGap}mm; margin-bottom: ${SHEET.rowGap}mm; }
  /* Deep enough for the views this pallet produced — see drawingRows. */
  .row.plan { height: ${fmtMm(rows.plan)}mm; }
  .row.elevation { height: ${fmtMm(rows.elevation)}mm; }
  .row.iso { height: ${fmtMm(rows.iso)}mm; }
  .row figure {
    margin: 0;
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 0;
  }
  .row svg { display: block; }

  /* The projection note keeps the middle of the page; the logo takes the
     corner. The note is centred on the column, not on what is left of it, so
     the logo does not push it off centre. */
  .footer {
    margin: auto 0 0;
    height: ${SHEET.footerHeight}mm;
    position: relative;
    display: flex;
    align-items: center;
  }
  .projection {
    margin: 0;
    flex: 1;
    font-size: 8.5pt;
    color: #333;
    text-align: center;
  }
  .footer .logo {
    position: absolute;
    right: 0;
    bottom: 0;
    display: block;
  }
  `;
}
