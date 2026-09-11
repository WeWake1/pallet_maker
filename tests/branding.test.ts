import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_BRAND, brandNamed } from '../src/brand/defaults.js';
import { LogoError, readSvgLogo } from '../src/brand/logoFile.js';
import { logoBox } from '../src/brand/markup.js';
import { brandResolver, readBrand } from '../src/brand/resolve.js';
import type { Brand } from '../src/brand/types.js';
import { computeLayout } from '../src/geometry/layout.js';
import { PAGE, SHEET, WATERMARK } from '../src/sheet/layout.js';
import { renderSheet } from '../src/sheet/sheet.js';
import { renderSheetSvg } from '../src/sheet/svgSheet.js';
import {
  FALLBACK_ADVANCE_EM,
  MAX_SIZE_PT,
  MIN_SIZE_PT,
  WATERMARK_FILL,
  watermarkSizePt,
} from '../src/sheet/watermark.js';
import { loadFixture } from './helpers.js';

/**
 * Whose drawing this is.
 *
 * A sheet goes out to a customer over somebody's name, and which name is not
 * something this program knows: it is read off a file beside the designs. So
 * these check three sheets — one nobody has told, one for a company with a
 * drawn mark, one for a company that has only a picture of theirs — and that
 * each carries what it should and nothing it should not.
 */

const here = dirname(fileURLToPath(import.meta.url));
const brandsDir = resolve(here, 'fixtures', 'brands');

const pallet = loadFixture('wing-both-decks');
const layout = computeLayout(pallet);

const vector = readBrand(join(brandsDir, 'vector', 'brand.json')).brand;
const raster = readBrand(join(brandsDir, 'raster', 'brand.json')).brand;

const temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pallet-brand-'));
  temporary.push(dir);
  return dir;
}

describe('a sheet nobody has put a name on', () => {
  const html = renderSheet(pallet, layout);
  const svg = renderSheetSvg(pallet, layout);

  /**
   * The important one. An unbranded sheet is honest; a sheet carrying whatever
   * company the program was last built for is a document that says something
   * false about who drew it.
   */
  it('says whose it is nowhere, rather than guessing', () => {
    expect(DEFAULT_BRAND.companyName).toBe('');
    expect(html).not.toContain('class="watermark"');
    expect(html).not.toContain('class="logo"');
    expect(svg).not.toContain('<image');
  });

  it('carries no font and nothing else to fetch', () => {
    expect(html).not.toContain('@font-face');
    for (const [, target] of html.matchAll(/url\('([^']*)'\)/g)) {
      expect(target?.startsWith('data:')).toBe(true);
    }
    expect(svg).not.toContain('data:');
  });

  it('still states the conventions every pallet shop needs', () => {
    expect(html).toContain(DEFAULT_BRAND.projectionNote);
    expect(html).toContain(DEFAULT_BRAND.tolerances.component);
    expect(html).toContain(DEFAULT_BRAND.tolerances.pallet);
  });
});

describe('a sheet for a company with a drawn mark', () => {
  const html = renderSheet(pallet, layout, { brand: vector });
  const svg = renderSheetSvg(pallet, layout, { brand: vector });

  it('writes the name across the diagonal', () => {
    expect(html).toContain(`<div class="watermark" aria-hidden="true"><span>${vector.companyName}</span>`);
    expect(html).toMatch(/\.watermark span \{[^}]*transform: rotate\(-35\.\d+deg\)/);
    expect(svg).toContain(vector.companyName);
  });

  it('keeps the watermark faint enough to build from, and out of the way', () => {
    expect(vector.watermark.opacity).toBeLessThanOrEqual(0.1);
    expect(html).toMatch(new RegExp(`\\.watermark span \\{[^}]*opacity: ${vector.watermark.opacity}`));
    expect(html).toMatch(/\.watermark \{[^}]*pointer-events: none/);
    expect(html).toContain('aria-hidden="true"');
    // Over the drawings: each view has a white background of its own, so a
    // watermark beneath them would show only in the gaps.
    expect(html).toMatch(/\.watermark \{[^}]*z-index: 2/);
    expect(html.indexOf('class="watermark"')).toBeGreaterThan(html.indexOf('<section class="drawing"'));
  });

  it('draws the watermark last in the SVG too, so it lies over the drawings', () => {
    const marks = [...svg.matchAll(new RegExp(vector.companyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))];
    expect(marks.length).toBeGreaterThan(0);
    expect(marks[marks.length - 1]!.index).toBeGreaterThan(svg.lastIndexOf('ISOMETRIC'));
  });

  it('puts the mark in the corner, as the shapes it is made of', () => {
    expect(html).toContain('<circle cx="40" cy="40" r="30" fill="#2f6f4f"/>');
    expect(html).toMatch(/\.footer \.logo \{[^}]*right: 0/);
    expect(html).toMatch(/\.footer \.logo \{[^}]*bottom: 0/);
    expect(html).not.toContain('data:image');
    expect(svg).toContain('<circle cx="40" cy="40" r="30" fill="#2f6f4f"/>');
    expect(svg).not.toContain('<image');
  });

  it('states this company\'s own conventions, not the default ones', () => {
    expect(html).toContain('Third-angle projection');
    expect(html).toContain('± 1 mm');
    expect(html).toContain('± 3 mm');
    expect(html).not.toContain('First-angle');
  });
});

describe('a sheet for a company whose logo is a picture', () => {
  const html = renderSheet(pallet, layout, { brand: raster });
  const svg = renderSheetSvg(pallet, layout, { brand: raster });

  it('shows the picture on the printed sheet', () => {
    expect(html).toContain('<img class="logo" src="data:image/png;base64,');
    expect(html).toContain(`alt="${raster.companyName}"`);
  });

  /**
   * The one place the SVG's promise is given up, and only for the company that
   * asked for it. Everyone with vector artwork still gets a file a page-layout
   * program can take apart.
   */
  it('costs that company exactly one <image> in the vector sheet, and no more', () => {
    expect([...svg.matchAll(/<image[\s>]/g)]).toHaveLength(1);
    expect([...svg.matchAll(/data:/g)]).toHaveLength(1);
    expect(svg).toContain('preserveAspectRatio="xMaxYMax meet"');
  });

  it('keeps the mark inside the corner it is given', () => {
    const box = logoBox(raster)!;
    expect(box.width).toBeLessThanOrEqual(24);
    expect(box.height).toBeLessThanOrEqual(SHEET.footerHeight);
    // A wide mark takes the width and the height follows, rather than being
    // stretched to the band's depth.
    expect(box.width / box.height).toBeCloseTo(2, 5);
  });
});

describe('the watermark fits the page it is on', () => {
  it('reproduces the two sizes the sheet was built with', () => {
    // 29 characters, measured at 64 point in a plain sans and 80 in the
    // condensed face the sheet used to carry.
    const name = 'Ambica Patterns India Pvt Ltd';
    expect(watermarkSizePt(name)).toBe(64);
    expect(watermarkSizePt(name, 0.391078)).toBe(80);
  });

  it('shrinks a long name rather than running it off the corners', () => {
    const long = 'Somerset Industrial Packaging and Crating Company Limited';
    const size = watermarkSizePt(long);
    expect(size).toBeLessThan(watermarkSizePt('Acme Pallets'));
    // Still filling about the diagonal rather than overrunning it.
    const diagonalPt = (Math.hypot(PAGE.width, PAGE.height) * 72) / 25.4;
    expect(long.length * size * FALLBACK_ADVANCE_EM).toBeCloseTo(WATERMARK_FILL * diagonalPt, 0);
  });

  it('never becomes a headline or a whisper', () => {
    expect(watermarkSizePt('A')).toBe(MAX_SIZE_PT);
    expect(watermarkSizePt('x'.repeat(400))).toBe(MIN_SIZE_PT);
  });

  it('lets a company overrule it on paper, where its own face is used', () => {
    const pinned: Brand = {
      ...vector,
      watermark: { ...vector.watermark, sizePt: 50 },
    };
    expect(renderSheet(pallet, layout, { brand: pinned })).toContain('font-size: 50pt');
    // The SVG still works its own out: it cannot use the company's face, so a
    // size measured for that face would be the wrong size here.
    expect(renderSheetSvg(pallet, layout, { brand: pinned })).not.toContain('font-size="50"');
  });

  it('is left off the sheet entirely when a company does not want one', () => {
    const quiet: Brand = { ...vector, watermark: { ...vector.watermark, enabled: false } };
    expect(renderSheet(pallet, layout, { brand: quiet })).not.toContain('class="watermark"');
    expect(renderSheetSvg(pallet, layout, { brand: quiet })).not.toContain(vector.companyName);
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
  const svg = renderSheetSvg(pallet, layout, { brand: vector });

  const FORBIDDEN = [
    // A viewport inside a viewport. The five views used to arrive this way.
    ['nested <svg>', /<svg[\s>]/g, 1],
    // CSS inside SVG, which is where the embedded @font-face used to live.
    ['<style>', /<style[\s>]/g, 0],
    ['<clipPath>', /<clipPath[\s>]/g, 0],
    ['clip-path=', /clip-path=/g, 0],
    // A base64 picture. Only a company whose logo is one brings it back, and
    // then only for their own sheets — see above.
    ['<image>', /<image[\s>]/g, 0],
    ['<use>', /<use[\s>]/g, 0],
    ['<foreignObject>', /<foreignObject[\s>]/g, 0],
    ['a data: URI', /data:/g, 0],
  ] as const;

  it.each(FORBIDDEN)('has no %s', (_name, pattern, allowed) => {
    expect([...svg.matchAll(pattern)]).toHaveLength(allowed);
  });

  it('is made of nothing but shapes, letters and groups', () => {
    const ALLOWED = ['circle', 'g', 'line', 'path', 'polygon', 'rect', 'svg', 'text', 'title'];
    const used = [...new Set([...svg.matchAll(/<([a-zA-Z]+)[\s/>]/g)].map((m) => m[1]!))].sort();
    expect(used.filter((name) => !ALLOWED.includes(name))).toEqual([]);
  });

  it('gives every board an element of its own to pick up', () => {
    expect([...svg.matchAll(/<rect /g)].length).toBeGreaterThan(100);
  });

  it('costs a fraction of what the embedded version did', () => {
    expect(svg.length).toBeLessThan(100_000);
  });

  it('is one page of the size the printed sheet declares', () => {
    const root = /^<svg[^>]*width="([\d.]+)"[^>]*height="([\d.]+)"/.exec(svg);
    expect(root).not.toBeNull();
    expect(Number(root![1]) / Number(root![2])).toBeCloseTo(PAGE.width / PAGE.height, 3);
  });

  it('says the same things the printed sheet says', () => {
    const html = renderSheet(pallet, layout, { brand: vector });
    for (const said of [
      pallet.clientName,
      pallet.palletName,
      pallet.updatedAt,
      'Overall size',
      'Component tolerance',
      'Third-angle projection',
      vector.companyName,
    ]) {
      expect(svg).toContain(said);
      expect(html).toContain(said);
    }
  });

  it('renders for every fixture without throwing', () => {
    for (const name of [
      'block-1000x800', 'two-top-widths', 'joined-middle-pair', 'wide-centre-block-row',
      'nudged-top-board', 'plywood-type1', 'plywood-type2', 'plywood-type3', 'stringer-2way',
    ]) {
      const fixture = loadFixture(name);
      expect(renderSheetSvg(fixture, computeLayout(fixture), { brand: vector })).toContain('</svg>');
    }
  });

  it('can be checked the way the shop floor prints it', () => {
    const grey = renderSheetSvg(pallet, layout, { brand: vector, greyscale: true });
    expect([...grey.matchAll(/feColorMatrix type="saturate" values="0"/g)]).toHaveLength(5);
  });
});

describe('a logo file', () => {
  const wrap = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${inner}</svg>`;

  it('keeps the shapes, closed exactly as they came', () => {
    const logo = readSvgLogo(wrap('<path d="M0 0H1" fill="#123"/><rect width="1" height="1"></rect>'));
    expect(logo).toMatchObject({ kind: 'svg', width: 10, height: 10 });
    expect(logo.kind === 'svg' && logo.svg).toBe('<path d="M0 0H1" fill="#123"/><rect width="1" height="1"></rect>');
  });

  /**
   * The mark is dropped into a sheet that has ids of its own — the views are
   * rendered with a prefix for the same reason — and two elements answering to
   * one name is a gradient that goes missing on one of them.
   */
  it('moves the names inside it out of the sheet\'s way', () => {
    const logo = readSvgLogo(
      wrap('<defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/></linearGradient></defs><rect fill="url(#g)" width="1" height="1"/>'),
      'mark',
    );
    expect(logo.kind === 'svg' && logo.svg).toContain('id="mark-g"');
    expect(logo.kind === 'svg' && logo.svg).toContain('fill="url(#mark-g)"');
  });

  it('drops what a drawing has no use for', () => {
    const logo = readSvgLogo(wrap('<!-- drawn 2019 --><path d="M0 0" onclick="steal()" style="fill:red" fill="#000"/>'));
    expect(logo.kind === 'svg' && logo.svg).toBe('<path d="M0 0" fill="#000"/>');
  });

  it.each([
    ['a script', '<script>steal()</script>', /cannot carry/],
    ['a picture inside the vector', '<image href="http://example.com/x.png"/>', /cannot carry/],
    ['a reference to another file', '<use href="other.svg#a"/>', /cannot carry/],
  ])('refuses %s, and says what to do instead', (_what, inner, expected) => {
    expect(() => readSvgLogo(wrap(inner))).toThrow(expected);
  });

  it('refuses one that could read a file off the machine that opens it', () => {
    expect(() => readSvgLogo('<!DOCTYPE svg [<!ENTITY x SYSTEM "/etc/passwd">]>' + wrap('<path d="M0 0"/>'))).toThrow(
      LogoError,
    );
  });

  it('refuses one that says nothing about how big it is', () => {
    expect(() => readSvgLogo('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>')).toThrow(/no viewBox/);
  });

  it('takes the size from width and height when there is no viewBox', () => {
    const logo = readSvgLogo('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><path d="M0 0"/></svg>');
    expect(logo).toMatchObject({ width: 40, height: 20 });
  });

  it('reads a picture, and how big it is, from the file itself', () => {
    const brand = readBrand(join(brandsDir, 'raster', 'brand.json')).brand;
    expect(brand.logo).toMatchObject({ kind: 'raster', width: 2, height: 1 });
  });
});

describe('reading a brand from the folder the designs are in', () => {
  it('takes the folder\'s brand over the one that ships with the program', () => {
    const shipped = resolve(here, '..', 'config', 'brand.json');
    const inUse = brandResolver(() => join(brandsDir, 'vector'), shipped)();
    expect(inUse.from).toBe('folder');
    expect(inUse.brand.companyName).toBe('Northgate Pallets Ltd');
    expect(inUse.problem).toBeNull();
  });

  it('falls back to the shipped one when the folder has no brand of its own', () => {
    const shipped = resolve(here, '..', 'config', 'brand.json');
    const inUse = brandResolver(() => tempDir(), shipped)();
    expect(inUse.from).toBe('built-in');
    expect(inUse.brand.companyName).toBe('Ambica Patterns India Pvt Ltd');
  });

  it('carries no name at all when nothing ships and nothing is in the folder', () => {
    const inUse = brandResolver(() => null)();
    expect(inUse.brand).toEqual(DEFAULT_BRAND);
  });

  /**
   * The failure worth guarding against: a sheet going to a customer under the
   * wrong name, or under none, with nobody told. Work goes on, and it is said.
   */
  it('says so loudly when the folder\'s brand will not read', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const inUse = brandResolver(() => join(brandsDir, 'broken'), resolve(here, '..', 'config', 'brand.json'))();
    expect(inUse.from).toBe('built-in');
    expect(inUse.problem).toMatch(/could not be read/);
    expect(inUse.problem).toMatch(/built into this version/);
  });

  it('notices when the brand file changes, without anything restarting', () => {
    const folder = tempDir();
    const brandPath = join(folder, 'brand.json');
    writeFileSync(brandPath, JSON.stringify({ companyName: 'First Name Ltd' }));
    const resolver = brandResolver(() => folder);
    expect(resolver().brand.companyName).toBe('First Name Ltd');

    writeFileSync(brandPath, JSON.stringify({ companyName: 'Second Name Ltd' }));
    expect(resolver().brand.companyName).toBe('Second Name Ltd');
  });

  it('turns a bare name into a watermark, since that is what a name is for', () => {
    const folder = tempDir();
    writeFileSync(join(folder, 'brand.json'), JSON.stringify({ companyName: 'Bare Name Ltd' }));
    const brand = brandResolver(() => folder)().brand;
    expect(brand.watermark).toMatchObject({ enabled: true, text: 'Bare Name Ltd' });
    expect(brandNamed('Bare Name Ltd').watermark.text).toBe('Bare Name Ltd');
  });

  it('keeps the page geometry the sheet is built on', () => {
    expect(WATERMARK.opacity).toBeLessThanOrEqual(0.1);
    expect(logoBox(vector)!.height).toBeLessThanOrEqual(SHEET.footerHeight);
  });
});
