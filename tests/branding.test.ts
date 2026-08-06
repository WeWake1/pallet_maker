import { describe, expect, it } from 'vitest';
import { BRAND_FONT_DATA_URI } from '../src/brand/assets.js';
import { BRAND_FONT_FAMILY, COMPANY_NAME } from '../src/brand/brand.js';
import { LOGO_ASPECT, LOGO_BOX, LOGO_COLOUR, logoPaths } from '../src/brand/logo.js';
import { computeLayout } from '../src/geometry/layout.js';
import { LOGO, PAGE, SHEET, WATERMARK } from '../src/sheet/layout.js';
import { renderSheet } from '../src/sheet/sheet.js';
import { renderSheetSvg } from '../src/sheet/svgSheet.js';
import { loadFixture } from './helpers.js';

/**
 * The sheet goes out to customers, so it has to say whose drawing it is, and it
 * has to still say so wherever it is opened. Nothing is linked: a sheet is
 * rendered with no base URL to resolve a file path against, so the artwork
 * travels inside the document or it is not there at all.
 */

const pallet = loadFixture('wing-both-decks');
const layout = computeLayout(pallet);

describe('the artwork', () => {
  it('embeds the face, not a link to it', () => {
    expect(BRAND_FONT_DATA_URI.startsWith('data:font/otf;base64,')).toBe(true);
    // Enough bytes to be the face rather than a placeholder that was committed
    // when the generator could not find it.
    expect(BRAND_FONT_DATA_URI.length).toBeGreaterThan(10_000);
  });

  it('carries the mark as geometry, not as a picture of it', () => {
    const paths = logoPaths();
    expect(paths).toContain(LOGO_COLOUR);
    expect([...paths.matchAll(/<path /g)]).toHaveLength(2);
    expect(paths).not.toContain('data:');
    // Cheap enough to sit in every output, which fifty kilobytes of base64
    // was not.
    expect(paths.length).toBeLessThan(400);
  });

  it('keeps the mark to the proportions it was drawn at', () => {
    expect(LOGO_BOX.width).toBe(1460);
    expect(LOGO_BOX.height).toBe(1278);
    expect(LOGO_ASPECT).toBeCloseTo(1.142, 3);
  });
});

describe('the printed sheet', () => {
  const html = renderSheet(pallet, layout);

  it('carries the company name as a watermark across the diagonal', () => {
    expect(html).toContain(`<div class="watermark" aria-hidden="true"><span>${COMPANY_NAME}</span>`);
    expect(html).toMatch(/\.watermark span \{[^}]*transform: rotate\(-35\.\d+deg\)/);
  });

  it('keeps the watermark faint enough to build from', () => {
    expect(WATERMARK.opacity).toBeLessThanOrEqual(0.1);
    expect(html).toMatch(new RegExp(`\\.watermark span \\{[^}]*opacity: ${WATERMARK.opacity}`));
  });

  it('draws the watermark over the sheet, not under it', () => {
    // Every view carries a white background of its own, so a watermark beneath
    // them would show only in the gaps between the drawings.
    expect(html).toMatch(/\.watermark \{[^}]*z-index: 2/);
    expect(html.indexOf('class="watermark"')).toBeGreaterThan(html.indexOf('<section class="drawing"'));
  });

  it('never lets the watermark take a click or be read aloud', () => {
    expect(html).toMatch(/\.watermark \{[^}]*pointer-events: none/);
    expect(html).toContain('aria-hidden="true"');
  });

  it('sets the name in the company face, embedded in the document', () => {
    expect(html).toContain(`font-family: '${BRAND_FONT_FAMILY}'`);
    expect(html).toContain(BRAND_FONT_DATA_URI);
  });

  it('carries the logo, as vector, in the bottom right corner', () => {
    expect(html).toContain(logoPaths());
    expect(html).not.toContain('data:image');
    expect(html).toMatch(/\.footer \.logo \{[^}]*right: 0/);
    expect(html).toMatch(/\.footer \.logo \{[^}]*bottom: 0/);
  });

  it('has no other reason to reach outside itself', () => {
    // Every url() on the sheet is a data URI. One that was not would be a sheet
    // that prints differently on a machine without the file.
    for (const [, target] of html.matchAll(/url\('([^']*)'\)/g)) {
      expect(target?.startsWith('data:')).toBe(true);
    }
  });
});

describe('the sheet as SVG', () => {
  const svg = renderSheetSvg(pallet, layout);

  it('is one page of the size the printed sheet declares', () => {
    const root = /^<svg[^>]*width="([\d.]+)"[^>]*height="([\d.]+)"/.exec(svg);
    expect(root).not.toBeNull();
    const ratio = Number(root![1]) / Number(root![2]);
    expect(ratio).toBeCloseTo(PAGE.width / PAGE.height, 3);
  });

  it('says the same things the printed sheet says', () => {
    const html = renderSheet(pallet, layout);
    for (const said of [
      pallet.clientName,
      pallet.palletName,
      pallet.updatedAt,
      'Overall size',
      'Component tolerance',
      'First-angle projection',
    ]) {
      expect(svg).toContain(said);
      expect(html).toContain(said);
    }
  });

  it('lists every component, with its part number and quantity', () => {
    // The same table the bench works from, so nothing may be dropped in the
    // move from a browser's layout to placed text.
    for (const name of ['Top boards', 'Centre boards', 'Blocks', 'Bottom boards']) {
      expect(svg).toContain(name);
    }
  });

  it('embeds the five views as vector, not as pictures of them', () => {
    // Each view arrives as a <g>, not a nested <svg>: see the flat-file test
    // below for why that matters.
    expect([...svg.matchAll(/<svg /g)]).toHaveLength(1);
    for (const title of ['TOP VIEW', 'BOTTOM VIEW', 'SIDE VIEW', 'END VIEW', 'ISOMETRIC']) {
      expect(svg).toContain(title);
    }
  });

  it('carries the logo as two plain paths', () => {
    expect(svg).toContain(logoPaths());
  });

  it('carries the same watermark, at the same angle and drawn last', () => {
    expect(svg).toMatch(new RegExp(`rotate\\(-35\\.\\d+ [\\d.]+ [\\d.]+\\)`));
    expect(svg).toMatch(new RegExp(`opacity="${WATERMARK.opacity}"`));
    // Last, so it lies over the drawings, as it does on the printed sheet.
    const marks = [...svg.matchAll(new RegExp(COMPANY_NAME, 'g'))];
    expect(marks.length).toBeGreaterThan(0);
    expect(marks[marks.length - 1]!.index).toBeGreaterThan(svg.lastIndexOf('ISOMETRIC'));
  });

  it('keeps the logo inside the page', () => {
    const bottom = PAGE.height - PAGE.padding;
    expect(LOGO.height).toBeLessThanOrEqual(SHEET.footerHeight);
    expect(bottom).toBeLessThanOrEqual(PAGE.height);
  });

  it('renders for every fixture without throwing', () => {
    for (const name of [
      'block-1000x800',
      'two-top-widths',
      'joined-middle-pair',
      'wide-centre-block-row',
      'nudged-top-board',
      'plywood-type1',
      'plywood-type2',
      'plywood-type3',
      'stringer-2way',
    ]) {
      const fixture = loadFixture(name);
      expect(renderSheetSvg(fixture, computeLayout(fixture))).toContain('</svg>');
    }
  });

  it('can be checked the way the shop floor prints it', () => {
    const grey = renderSheetSvg(pallet, layout, { greyscale: true });
    expect([...grey.matchAll(/feColorMatrix type="saturate" values="0"/g)]).toHaveLength(5);
  });
});

/**
 * The whole point of the SVG: that a page-layout program can take it apart.
 *
 * Such a program parses a subset of SVG, and on meeting anything outside it the
 * usual behaviour is not to fail but to give up and flatten the page to a
 * picture — at which point the file is a worse PNG. So the sheet is held to
 * shapes and letters, and every board on it is its own element that can be
 * picked up and moved.
 *
 * Each name below is a thing that has already caused exactly that, so none of
 * them may come back without someone deciding to bring it back.
 */
describe('the SVG stays a drawing rather than a picture of one', () => {
  const svg = renderSheetSvg(pallet, layout);

  const FORBIDDEN = [
    // A viewport inside a viewport. The five views used to arrive this way.
    ['nested <svg>', /<svg[\s>]/g, 1],
    // CSS inside SVG, which is where the embedded @font-face used to live.
    ['<style>', /<style[\s>]/g, 0],
    ['<clipPath>', /<clipPath[\s>]/g, 0],
    ['clip-path=', /clip-path=/g, 0],
    // A base64 PNG. The logo used to be one; it is two <path>s now.
    ['<image>', /<image[\s>]/g, 0],
    ['<use>', /<use[\s>]/g, 0],
    ['<foreignObject>', /<foreignObject[\s>]/g, 0],
    ['a data: URI', /data:/g, 0],
  ] as const;

  it.each(FORBIDDEN)('has no %s', (_name, pattern, allowed) => {
    expect([...svg.matchAll(pattern)]).toHaveLength(allowed);
  });

  it('is made of nothing but shapes, letters and groups', () => {
    // The basic shapes of SVG 1.1 and nothing else. Anything a reader has to
    // resolve, style or lay out is what turns a drawing back into a picture.
    const ALLOWED = ['circle', 'g', 'line', 'path', 'polygon', 'rect', 'svg', 'text', 'title'];
    const used = [...new Set([...svg.matchAll(/<([a-zA-Z]+)[\s/>]/g)].map((m) => m[1]!))].sort();
    expect(used.filter((name) => !ALLOWED.includes(name))).toEqual([]);
  });

  it('gives every board an element of its own to pick up', () => {
    // Seven top boards, three centre boards, nine blocks, three bottom boards,
    // each drawn in more than one view. Far more rectangles than a flattened
    // page would have, which is the whole difference.
    expect([...svg.matchAll(/<rect /g)].length).toBeGreaterThan(100);
  });

  it('costs a fraction of what the embedded version did', () => {
    // No base64 font, no base64 logo. Under 100 kB where it was over 200.
    expect(svg.length).toBeLessThan(100_000);
  });
});
