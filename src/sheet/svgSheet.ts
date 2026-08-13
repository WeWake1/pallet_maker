import { COMPANY_NAME } from '../brand/brand.js';
import { LOGO_ASPECT, LOGO_BOX, logoPaths } from '../brand/logo.js';
import type { Layout } from '../geometry/types.js';
import { mmLabel } from '../render/scene.js';
import { el, esc, fmt, fragmentSize, line, rect, text } from '../render/svg.js';
import type { Pallet } from '../types.js';
import type { ComponentRow, Pair, SheetContent } from './content.js';
import { PROJECTION_NOTE, sheetContent } from './content.js';
import { DRAWING, LOGO, PAGE, PX_PER_MM, SHEET, WATERMARK } from './layout.js';
import { drawingRows, sheetViews } from './sheet.js';
import type { DrawingRows } from './sheet.js';

/**
 * The same specification sheet, as one SVG.
 *
 * The PDF is the document that goes to the shop and to the client. This is the
 * one for when a sheet has to be taken somewhere else and worked on — dropped
 * into Canva to be annotated, or opened in a drawing program — which the DXF
 * could never do, being a CAD file that page-layout software does not read.
 *
 * What is on it comes from `content.ts`, the same as the printed sheet, so the
 * two never say different things. How it is set out is written out by hand
 * here, because SVG has no text layout of its own: every box is placed, and the
 * measurements below are the millimetre grid the printed sheet is built on.
 *
 * **Everything here is a shape or a letter, and nothing else.** No nested
 * `<svg>`, no `<clipPath>`, no `<style>`, no `<image>` — the four things a
 * page-layout program is most likely to meet and give up on, and giving up
 * means flattening the whole page to a picture rather than failing. Keep it
 * that way: a file nothing can take apart is a file that may as well be a PNG.
 * `tests/branding.test.ts` holds the line.
 */

/** Points to pixels, the unit the drawing views are already rendered in. */
const pt = (value: number): number => (value * 96) / 72;

/** Millimetres to pixels, unrounded — this file measures in millimetres. */
const px = (value: number): number => value * PX_PER_MM;

const INK = '#111111';
const MUTED = '#333333';
const FAINT = '#555555';
const RULE = '#9aa1aa';
const HEAD_FILL = '#eceff3';
const FOOT_FILL = '#f4f6f8';

const BODY_FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";

/** The written column, inside the rule that separates it from the drawings. */
const DATA_INNER = SHEET.dataWidth - SHEET.columnGap / 2;

/** Row heights, in millimetres, matching what the printed sheet comes out at. */
const ROW = {
  pair: 5,
  blockHeading: 4.4,
  blockGap: 3.2,
  componentHead: 5.6,
  component: 6,
  nailHead: 5.4,
  nail: 5.4,
} as const;

export interface SvgSheetOptions {
  greyscale?: boolean;
}

export function renderSheetSvg(
  pallet: Pallet,
  layout: Layout,
  options: SvgSheetOptions = {},
): string {
  const content = sheetContent(pallet, layout);
  const rows = drawingRows(layout);
  const views = sheetViews(layout, rows, options.greyscale === true, true);

  const body = [
    headerBand(content),
    dataColumn(content),
    drawingColumn(views, rows),
    footer(),
    // Last, so it lies over the drawings. Each view carries a white background
    // of its own and a watermark beneath them would show only in the gaps.
    watermark(),
  ].join('');

  return (
    `<svg xmlns="http://www.w3.org/2000/svg"` +
    ` width="${fmt(px(PAGE.width))}" height="${fmt(px(PAGE.height))}"` +
    ` viewBox="0 0 ${fmt(px(PAGE.width))} ${fmt(px(PAGE.height))}">` +
    el('title', {}, esc(content.title)) +
    // No <style>, and so no embedded @font-face: a stylesheet inside an SVG is
    // one more thing to choke on, and the readers that would honour the font
    // are the ones that could open the PDF instead. Faces are named on each
    // run, and anything without them substitutes, which is what Canva does with
    // an embedded face anyway.
    rect(0, 0, px(PAGE.width), px(PAGE.height), { fill: '#ffffff' }) +
    body +
    `</svg>`
  );
}

/* ------------------------------------------------------------------ bands */

/** Whose drawing this is, corner to corner in the company's own face. */
function watermark(): string {
  const cx = px(PAGE.width / 2);
  const cy = px(PAGE.height / 2);
  return el(
    'g',
    { transform: `rotate(-${WATERMARK.angle.toFixed(2)} ${fmt(cx)} ${fmt(cy)})` },
    label(PAGE.width / 2, PAGE.height / 2, COMPANY_NAME, {
      // Sized for the sans this will actually be set in — see WATERMARK.
      size: WATERMARK.svgFontSize,
      anchor: 'middle',
      family: BODY_FONT,
      'letter-spacing': fmt(pt(WATERMARK.svgFontSize) * WATERMARK.tracking),
      fill: INK,
      opacity: WATERMARK.opacity,
      // Centred on the diagonal rather than sitting on it, which is what the
      // printed sheet's flexbox does for the same text.
      baseline: 'central',
    }),
  );
}

function headerBand(content: SheetContent): string {
  const { heading } = content;
  const top = PAGE.padding;
  const bottom = top + SHEET.headerHeight;
  const left = PAGE.padding;
  const right = PAGE.padding + SHEET.contentWidth;

  // Both lines sit on the rule, the sub line just above it, as the printed
  // header does by aligning its cells to their shared bottom edge.
  const subBaseline = bottom - 1.9;
  const nameBaseline = subBaseline - 4.4;

  const cell = (x: number, anchor: 'start' | 'middle' | 'end', name: string, sub: string): string =>
    label(x, nameBaseline, name, { size: 15, weight: 600, anchor }) +
    (sub === '' ? '' : label(x, subBaseline, sub, { size: 10, anchor, fill: MUTED }));

  return (
    cell(left, 'start', heading.clientName, heading.clientPartNo ? `Client part ${heading.clientPartNo}` : '') +
    cell(PAGE.width / 2, 'middle', heading.palletName, heading.subtitle) +
    cell(right, 'end', heading.date, heading.note) +
    line(px(left), px(bottom), px(right), px(bottom), { stroke: INK, 'stroke-width': px(0.21) })
  );
}

/* ----------------------------------------------------------- data column */

/**
 * The written side, block after block down the column.
 *
 * The printed column hides what will not fit; this one stops emitting it. Same
 * result, and no `<clipPath>` — which is the point, since a reader that cannot
 * clip would otherwise flatten the page. Stopping is also the more honest of
 * the two: nothing is drawn off the page and then hidden.
 */
function dataColumn(content: SheetContent): string {
  const left = PAGE.padding;
  const top = PAGE.padding + SHEET.headerHeight + SHEET.headerGap;
  const bottom = PAGE.height - PAGE.padding;

  let y = top;
  const parts: string[] = [];

  const heading = (name: string): void => {
    if (y + ROW.blockHeading > bottom) return;
    parts.push(
      label(left, y + 3, name.toUpperCase(), {
        size: 9,
        weight: 700,
        fill: MUTED,
        'letter-spacing': fmt(px(0.23)),
      }),
    );
    y += ROW.blockHeading;
  };

  heading('Overall');
  y = pairs(parts, content.overall, left, y, bottom);

  y += ROW.blockGap;
  heading('Components');
  y = componentsTable(parts, content.components, left, y, bottom);

  if (content.nails) {
    y += ROW.blockGap;
    heading('Nails');
    y = nailsTable(parts, content.nails, left, y, bottom);
  }

  y += ROW.blockGap;
  heading('Load and material');
  y = pairs(parts, content.material, left, y, bottom);
  if (content.notes !== '') {
    y += 1.4;
    for (const wrapped of wrap(content.notes, 62)) {
      if (y + 3.6 > bottom) break;
      y += 3.6;
      parts.push(label(left, y, wrapped, { size: 9, fill: MUTED }));
    }
  }

  return (
    parts.join('') +
    // The rule between the written side and the drawings.
    line(
      px(left + SHEET.dataWidth),
      px(top),
      px(left + SHEET.dataWidth),
      px(bottom),
      { stroke: '#bbbbbb', 'stroke-width': px(0.14) },
    )
  );
}

/** Label on the left, value in the second column, one row each. */
function pairs(parts: string[], rows: Pair[], left: number, from: number, bottom: number): number {
  let y = from;
  for (const [name, value] of rows) {
    if (y + ROW.pair > bottom) break;
    y += ROW.pair;
    parts.push(label(left, y - 1.4, name, { size: 9.5, fill: '#444444' }));
    parts.push(label(left + 38, y - 1.4, value, { size: 9.5 }));
  }
  return y;
}

/**
 * The components table, ruled on every side. This is the one the bench works
 * from, so it is the biggest thing on the written side.
 */
function componentsTable(
  parts: string[],
  rows: ComponentRow[],
  left: number,
  from: number,
  bottom: number,
): number {
  const widths = [12, DATA_INNER - 70, 46, 12];
  const x = columnEdges(left, widths);

  let y = from;
  if (y + ROW.componentHead + ROW.component > bottom) return y;
  parts.push(
    ...ruledRow(x, y, ROW.componentHead, HEAD_FILL),
    ...cells(x, y + ROW.componentHead - 1.7, [
      ['Part', 'middle'],
      ['Component', 'start'],
      ['L × W × T (mm)', 'middle'],
      ['Qty', 'middle'],
    ], { size: 9.5, weight: 700 }),
  );
  y += ROW.componentHead;

  for (const row of rows) {
    if (y + ROW.component > bottom) break;
    const baseline = y + ROW.component - 1.9;
    parts.push(...ruledRow(x, y, ROW.component, null));
    parts.push(
      label(mid(x[0]!, x[1]!), baseline, String(row.partNo), { size: 10.5, anchor: 'middle' }),
      label(x[1]! + 1.4, baseline, row.name, { size: 10.5, weight: 600 }),
      // The three figures in fixed boxes, so they stand in the same places
      // down the column and the eye reads a column of lengths.
      ...dims(x[2]!, x[3]!, baseline, row),
      label(mid(x[3]!, x[4]!), baseline, String(row.quantity), { size: 10.5, anchor: 'middle' }),
    );
    // The variant qualifies the name — "outer", "inner". Set against the right
    // of the same cell rather than trailing the name, because SVG cannot
    // measure the name to know where it ended.
    if (row.variant !== '') {
      parts.push(
        label(x[2]! - 1.4, baseline, row.variant, { size: 10.5, fill: FAINT, anchor: 'end' }),
      );
    }
    y += ROW.component;
  }

  parts.push(border(x[0]!, from, x[4]!, y));
  return y;
}

function dims(from: number, to: number, baseline: number, row: ComponentRow): string[] {
  const values = [mmLabel(row.length), mmLabel(row.width), mmLabel(row.thickness)];
  const box = 13.5;
  const cross = 4;
  const total = 3 * box + 2 * cross;
  let x = from + (to - from - total) / 2;
  const out: string[] = [];
  for (const [index, value] of values.entries()) {
    out.push(label(x + box / 2, baseline, value, { size: 10.5, anchor: 'middle' }));
    x += box;
    if (index < values.length - 1) {
      out.push(label(x + cross / 2, baseline, '×', { size: 10.5, anchor: 'middle', fill: FAINT }));
      x += cross;
    }
  }
  return out;
}

function nailsTable(
  parts: string[],
  nails: NonNullable<SheetContent['nails']>,
  left: number,
  from: number,
  bottom: number,
): number {
  const widths = [44, DATA_INNER - 79, 17.5, 17.5];
  const x = columnEdges(left, widths);

  let y = from;
  if (y + ROW.nailHead + 2 * ROW.nail > bottom) return y;
  parts.push(
    ...ruledRow(x, y, ROW.nailHead, HEAD_FILL),
    ...cells(x, y + ROW.nailHead - 1.6, [
      ['Joint', 'start'],
      ['Type', 'start'],
      ['Size', 'end'],
      ['Qty', 'end'],
    ], { size: 9, weight: 700 }),
  );
  y += ROW.nailHead;

  for (const nail of nails.rows) {
    // The total row below has to fit as well: a schedule that stops without one
    // would read as a schedule that adds up to nothing.
    if (y + 2 * ROW.nail > bottom) break;
    const baseline = y + ROW.nail - 1.6;
    parts.push(...ruledRow(x, y, ROW.nail, null));
    parts.push(
      label(x[0]! + 1.4, baseline, nail.label, { size: 9.5, weight: 600 }),
      label(x[1]! + 1.4, baseline, nail.type, { size: 9.5 }),
      label(x[3]! - 1.4, baseline, nail.size, { size: 9.5, anchor: 'end' }),
      label(x[4]! - 1.4, baseline, nail.quantity, { size: 9.5, anchor: 'end' }),
    );
    y += ROW.nail;
  }

  const baseline = y + ROW.nail - 1.6;
  parts.push(...ruledRow(x, y, ROW.nail, FOOT_FILL));
  parts.push(
    label(x[0]! + 1.4, baseline, 'Total', { size: 9.5, weight: 700 }),
    label(x[4]! - 1.4, baseline, String(nails.total), { size: 9.5, weight: 700, anchor: 'end' }),
  );
  y += ROW.nail;

  parts.push(border(x[0]!, from, x[4]!, y));
  return y;
}

/* -------------------------------------------------------- drawing column */

function drawingColumn(views: Record<string, string>, rows: DrawingRows): string {
  const left = PAGE.padding + SHEET.dataWidth + SHEET.columnGap;
  const top = PAGE.padding + SHEET.headerHeight + SHEET.headerGap;

  /** One row of views, each in the cell `drawingRows` measured out for it. */
  const row = (names: string[], cells: number[], y: number, height: number): string => {
    let x = left;
    return names
      .map((name, i) => {
        const cell = cells[i]!;
        const placed = place(views[name]!, x, y, cell, height);
        x += cell + SHEET.columnGap;
        return placed;
      })
      .join('');
  };

  let y = top;
  const parts = [row(['top', 'bottom'], rows.cells.plan, y, rows.plan)];
  y += rows.plan + SHEET.rowGap;
  parts.push(row(['side', 'end'], rows.cells.elevation, y, rows.elevation));
  y += rows.elevation + SHEET.rowGap;
  parts.push(place(views.iso!, left, y, DRAWING.width, rows.iso));

  return parts.join('');
}

/**
 * One rendered view, moved into its cell.
 *
 * A view arrives as a `<g>` drawn at its natural size from the origin, so
 * placing it is a translate and nothing else — no nested viewport, no scaling,
 * and the stroke weights land exactly as the printed sheet's do.
 */
function place(view: string, left: number, top: number, width: number, height: number): string {
  const size = fragmentSize(view);
  if (!size) throw new Error('A view was not rendered as a sized fragment');
  const x = px(left) + (px(width) - size.width) / 2;
  const y = px(top) + (px(height) - size.height) / 2;
  return el('g', { transform: `translate(${fmt(x)} ${fmt(y)})` }, view);
}

/** The projection note across the middle, the mark in the corner. */
function footer(): string {
  const left = PAGE.padding + SHEET.dataWidth + SHEET.columnGap;
  const bottom = PAGE.height - PAGE.padding;
  const centre = left + DRAWING.width / 2;

  // Nearly square, so the height is what is set and the width follows.
  const logoWidth = Math.min(LOGO.maxWidth, LOGO.height * LOGO_ASPECT);

  return (
    label(centre, bottom - SHEET.footerHeight / 2 + 1, PROJECTION_NOTE, {
      size: 8.5,
      anchor: 'middle',
      fill: MUTED,
    }) +
    // Two plain paths, scaled out of the artwork's own 1460 x 1278 box. Not an
    // <image>: a base64 PNG is exactly the kind of thing that makes a reader
    // give up and flatten the page.
    el(
      'g',
      {
        transform:
          `translate(${fmt(px(PAGE.padding + SHEET.contentWidth - logoWidth))} ${fmt(px(bottom - LOGO.height))})` +
          ` scale(${fmt(px(logoWidth) / LOGO_BOX.width)})`,
      },
      logoPaths(),
    )
  );
}

/* ----------------------------------------------------------------- pieces */

interface LabelOptions {
  /** Point size, as the printed sheet states its type. */
  size: number;
  weight?: number;
  anchor?: 'start' | 'middle' | 'end';
  fill?: string;
  family?: string;
  'letter-spacing'?: string;
  opacity?: number;
  /** Centre the text on its y rather than sitting it on that line. */
  baseline?: 'central';
}

/** One run of text, positioned in millimetres and set in points. */
function label(x: number, baseline: number, value: string, options: LabelOptions): string {
  if (value === '') return '';
  return text(px(x), px(baseline), value, {
    'font-family': options.family ?? BODY_FONT,
    'font-size': fmt(pt(options.size)),
    'font-weight': options.weight,
    'text-anchor': options.anchor === 'start' ? undefined : options.anchor,
    'dominant-baseline': options.baseline,
    'letter-spacing': options['letter-spacing'],
    fill: options.fill ?? INK,
    opacity: options.opacity,
  });
}

/** Left edge of every column, plus the right edge of the last. */
function columnEdges(left: number, widths: number[]): number[] {
  const edges = [left];
  for (const width of widths) edges.push(edges[edges.length - 1]! + width);
  return edges;
}

const mid = (a: number, b: number): number => (a + b) / 2;

/** A table row: its fill, and the vertical rules that divide its cells. */
function ruledRow(x: number[], top: number, height: number, fill: string | null): string[] {
  const parts: string[] = [];
  if (fill) parts.push(rect(px(x[0]!), px(top), px(x[x.length - 1]! - x[0]!), px(height), { fill }));
  for (const edge of x) {
    parts.push(line(px(edge), px(top), px(edge), px(top + height), {
      stroke: RULE,
      'stroke-width': px(0.14),
    }));
  }
  parts.push(line(px(x[0]!), px(top + height), px(x[x.length - 1]!), px(top + height), {
    stroke: RULE,
    'stroke-width': px(0.14),
  }));
  return parts;
}

/** A heading row's text, one run per column. */
function cells(
  x: number[],
  baseline: number,
  columns: Array<[string, 'start' | 'middle' | 'end']>,
  options: Omit<LabelOptions, 'anchor'>,
): string[] {
  return columns.map(([value, anchor], index) => {
    const from = x[index]!;
    const to = x[index + 1]!;
    const at = anchor === 'start' ? from + 1.4 : anchor === 'end' ? to - 1.4 : mid(from, to);
    return label(at, baseline, value, { ...options, anchor });
  });
}

/** The outer rule of a table, drawn last so it sits over the cell rules. */
function border(left: number, top: number, right: number, bottom: number): string {
  return rect(px(left), px(top), px(right - left), px(bottom - top), {
    fill: 'none',
    stroke: INK,
    'stroke-width': px(0.25),
  });
}

/**
 * Break free text into lines of roughly `columns` characters. SVG has no text
 * wrapping of its own, and the notes are the one field on the sheet long enough
 * to need it.
 */
function wrap(value: string, columns: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of value.split(/\s+/)) {
    if (current === '') current = word;
    else if (current.length + 1 + word.length <= columns) current += ` ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current !== '') lines.push(current);
  return lines;
}
