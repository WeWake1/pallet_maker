import { describe, expect, it } from 'vitest';
import { computeLayout } from '../src/geometry/layout.js';
import { packLanes, Scene, TIER } from '../src/render/scene.js';
import type { DimSpec, DimTier } from '../src/render/scene.js';
import { renderView } from '../src/render/views.js';
import { componentTable, totalPieces } from '../src/sheet/components.js';
import { DRAWING, mmToPx, PAGE, SHEET } from '../src/sheet/layout.js';
import { renderSheet } from '../src/sheet/sheet.js';
import { loadFixture } from './helpers.js';

function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

describe('the components table', () => {
  it('groups by layer and gives one row per part number', () => {
    const pallet = loadFixture('block-1000x800');
    const groups = componentTable(pallet, computeLayout(pallet));
    expect(groups.map((g) => g.heading)).toEqual([
      'Top boards',
      'Centre boards',
      'Blocks',
      'Bottom boards',
    ]);
    expect(groups.map((g) => g.rows.length)).toEqual([1, 1, 1, 1]);
    expect(groups[0]!.rows[0]).toMatchObject({
      partNo: 1,
      description: 'Top board',
      quantity: 7,
      thickness: 18,
      width: 100,
      length: 1000,
    });
    expect(totalPieces(groups)).toBe(22);
  });

  it('gives a layer with two board widths two rows under one heading', () => {
    const pallet = loadFixture('two-top-widths');
    const groups = componentTable(pallet, computeLayout(pallet));
    const top = groups[0]!;
    expect(top.heading).toBe('Top boards');
    expect(top.rows).toHaveLength(2);
    expect(top.rows.map((r) => r.variant)).toEqual(['outer', 'inner']);
    expect(top.rows.map((r) => r.quantity)).toEqual([2, 5]);
    // Every board is accounted for exactly once.
    expect(totalPieces(groups)).toBe(computeLayout(pallet).pieces.length);
  });

  it('reads a block off its own three dimensions', () => {
    const pallet = loadFixture('wide-centre-block-row');
    const groups = componentTable(pallet, computeLayout(pallet));
    const blocks = groups.find((g) => g.heading === 'Blocks')!;
    expect(blocks.rows.map((r) => [r.quantity, r.thickness, r.width, r.length])).toEqual([
      [6, 100, 100, 100],
      [3, 100, 100, 150],
    ]);
  });
});

describe('the sheet', () => {
  const pallet = loadFixture('wing-both-decks');
  const layout = computeLayout(pallet);
  const html = renderSheet(pallet, layout);

  it('is one A4 landscape page with no margin beyond its own', () => {
    expect(html).toContain(`@page { size: ${PAGE.width}mm ${PAGE.height}mm; margin: 0; }`);
    expect(html).toContain(`width: ${PAGE.width}mm`);
    expect(html).toContain(`height: ${PAGE.height}mm`);
  });

  it('heads the sheet with client, pallet and revision', () => {
    const header = /<header>([\s\S]*?)<\/header>/.exec(html)![1]!;
    const text = textOf(header);
    expect(text).toContain('Demo Client');
    expect(text).toContain('1200 x 1000 wing');
    expect(text).toContain('AP-005');
    expect(text).toContain('Rev A');
    expect(text).toContain('2026-07-27');
  });

  it('carries all five views, each once', () => {
    for (const title of ['ISOMETRIC', 'TOP VIEW', 'BOTTOM VIEW', 'END VIEW', 'SIDE VIEW']) {
      // Once as the drawn caption; the <title> element is the accessible name.
      expect([...html.matchAll(new RegExp(`<text[^>]*>${title}</text>`, 'g'))]).toHaveLength(1);
    }
    expect([...html.matchAll(/<svg/g)]).toHaveLength(5);
  });

  it('keeps every id unique across the five inlined views', () => {
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('sizes each view to its cell so nothing has to be scaled to fit', () => {
    const sizes = [...html.matchAll(/<svg[^>]*width="([\d.]+)"[^>]*height="([\d.]+)"/g)].map(
      (m) => ({ width: Number(m[1]), height: Number(m[2]) }),
    );
    expect(sizes).toHaveLength(5);
    const wideCell = { w: mmToPx(DRAWING.width), h: mmToPx(DRAWING.wideRowHeight) };
    const pairCell = { w: mmToPx(DRAWING.pairCellWidth), h: mmToPx(DRAWING.pairRowHeight) };
    for (const size of sizes) {
      expect(size.width).toBeLessThanOrEqual(wideCell.w + 1);
      const cell = size.width > pairCell.w ? wideCell : pairCell;
      expect(size.height).toBeLessThanOrEqual(cell.h + 1);
    }
  });

  it('states the projection and the units once, under the drawings', () => {
    expect([...html.matchAll(/First-angle projection, all dimensions in mm/g)]).toHaveLength(1);
  });

  it('lists the components, the nails and the load and material', () => {
    const text = textOf(html);
    expect(text).toContain('Top board');
    expect(text).toContain('18 × 100 × 1200');
    expect(text).toContain('top board to centre board');
    expect(text).toContain('wire nail');
    expect(text).toContain('Static load 3000 kg');
    expect(text).toContain('Species pine');
  });

  it('reports the wing overhang in the data column as well as on the drawing', () => {
    expect(textOf(html)).toContain('50 / 50 along length, 50 / 50 across width');
  });

  it('leaves out the sections that were deliberately cut', () => {
    const text = textOf(html).toLowerCase();
    expect(text).not.toContain('drawn by');
    expect(text).not.toContain('approved');
    expect(text).not.toContain('qc');
    expect(text).not.toContain('colour key');
  });

  it('can be checked the way the shop floor prints it', () => {
    const grey = renderSheet(pallet, layout, { greyscale: true });
    expect([...grey.matchAll(/feColorMatrix type="saturate" values="0"/g)]).toHaveLength(5);
  });

  it('renders for every fixture', () => {
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
      const sheet = renderSheet(fixture, computeLayout(fixture));
      expect(sheet).toContain('</html>');
      expect([...sheet.matchAll(/<svg/g)]).toHaveLength(5);
    }
  });
});

describe('dimension lanes', () => {
  const dim = (a: number, b: number, label: string, tier: DimTier = TIER.detail): DimSpec => ({
    side: 'left',
    tier,
    lane: 0,
    a,
    b,
    anchor: 0,
    label,
  });

  it('puts labels that would print on top of each other in separate lanes', () => {
    const dims = [dim(0, 120, '120'), dim(120, 220, '100')];
    // A view small enough that 100 mm is only about 15 px.
    const scene = new Scene({ uSpan: 1000, vSpan: 800 }, dims, { scale: 0.15 });
    const packed = packLanes(dims, scene);
    expect(packed.map((d) => d.lane)).toEqual([0, 1]);
  });

  it('leaves them in one lane when there is room', () => {
    const dims = [dim(0, 120, '120'), dim(120, 220, '100')];
    const scene = new Scene({ uSpan: 1000, vSpan: 800 }, dims, { scale: 1 });
    expect(packLanes(dims, scene).map((d) => d.lane)).toEqual([0, 0]);
  });

  it('keeps overall dimensions outside the detail ones however many lanes they take', () => {
    const dims = [
      dim(0, 120, '120'),
      dim(120, 220, '100'),
      dim(0, 800, '800', TIER.overall),
    ];
    const scene = new Scene({ uSpan: 1000, vSpan: 800 }, dims, { scale: 0.15 });
    const packed = packLanes(dims, scene);
    const overall = packed.find((d) => d.tier === TIER.overall)!;
    const details = packed.filter((d) => d.tier === TIER.detail);
    expect(overall.lane).toBeGreaterThan(Math.max(...details.map((d) => d.lane)));
  });

  it('does not collide any two labels in a real view', () => {
    const layout = computeLayout(loadFixture('two-top-widths'));
    const svg = renderView(layout, 'top', {
      fitWidth: mmToPx(DRAWING.pairCellWidth),
      fitHeight: mmToPx(DRAWING.pairRowHeight),
    });
    // Rotated labels carry their centre in the transform, upright ones in x/y.
    const placed = [...svg.matchAll(/<text x="([\d.-]+)" y="([\d.-]+)"[^>]*>([^<]+)</g)].map(
      (m) => ({ x: Number(m[1]), y: Number(m[2]), label: m[3]! }),
    );
    for (const a of placed) {
      for (const b of placed) {
        if (a === b) continue;
        const apart = Math.abs(a.x - b.x) > 6 || Math.abs(a.y - b.y) > 6;
        expect(apart).toBe(true);
      }
    }
  });
});

describe('the sheet fits its page', () => {
  it('adds up to the page it declares', () => {
    expect(SHEET.dataWidth + SHEET.columnGap + DRAWING.width).toBeCloseTo(
      PAGE.width - 2 * PAGE.padding,
      6,
    );
    expect(
      SHEET.headerHeight +
        SHEET.headerGap +
        DRAWING.height +
        SHEET.footerHeight,
    ).toBeCloseTo(PAGE.height - 2 * PAGE.padding, 6);
    expect(2 * DRAWING.pairRowHeight + DRAWING.wideRowHeight + 2 * SHEET.rowGap).toBeLessThanOrEqual(
      DRAWING.height + 1e-6,
    );
  });
});
