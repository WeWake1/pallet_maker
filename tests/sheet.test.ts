import { describe, expect, it } from 'vitest';
import { computeLayout } from '../src/geometry/layout.js';
import { parsePallet } from '../src/schema.js';
import { packLanes, Scene, TIER } from '../src/render/scene.js';
import type { DimSpec, DimTier } from '../src/render/scene.js';
import { measureView, renderView } from '../src/render/views.js';
import { componentTable, totalPieces } from '../src/sheet/components.js';
import { sheetContent } from '../src/sheet/content.js';
import { contentDisposition, downloadName } from '../src/sheet/filename.js';
import { DRAWING, mmToPx, PAGE, SHEET } from '../src/sheet/layout.js';
import { drawingRows, renderSheet, sheetViews } from '../src/sheet/sheet.js';
import { loadFixture } from './helpers.js';

/**
 * What the sheet reads as. The stylesheet goes first — it carries the embedded
 * font as base64, which is not text on the page and would answer to almost any
 * substring asked about below.
 */
function textOf(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
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
      length: 1000,
      width: 100,
      thickness: 18,
      quantity: 7,
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
    expect(blocks.rows.map((r) => [r.length, r.width, r.thickness, r.quantity])).toEqual([
      [100, 100, 100, 6],
      [150, 100, 100, 3],
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

  it('heads the sheet with client, pallet, date and note', () => {
    const header = /<header>([\s\S]*?)<\/header>/.exec(html)![1]!;
    const text = textOf(header);
    expect(text).toContain('Demo Client');
    expect(text).toContain('1200 x 1000 wing');
    expect(text).toContain('AP-005');
    // The date the design was last saved, which is what says how current it is.
    expect(text).toContain(pallet.updatedAt);
  });

  it('prints the free-text note beside the date, and nothing when there is none', () => {
    const noted = textOf(
      /<header>([\s\S]*?)<\/header>/.exec(
        renderSheet({ ...pallet, note: 'supersedes AP-004 (old)' }, layout),
      )![1]!,
    );
    expect(noted).toContain('supersedes AP-004 (old)');
    expect(textOf(/<header>([\s\S]*?)<\/header>/.exec(html)![1]!)).not.toContain('supersedes');
  });

  it('carries all five views, each once', () => {
    for (const title of ['ISOMETRIC', 'TOP VIEW', 'BOTTOM VIEW', 'END VIEW', 'SIDE VIEW']) {
      // Once as the drawn caption; the <title> element is the accessible name.
      expect([...html.matchAll(new RegExp(`<text[^>]*>${title}</text>`, 'g'))]).toHaveLength(1);
    }
    // Six drawings inline on the sheet: the five views, and the logo in the
    // corner, which is vector too rather than a picture of itself.
    expect([...html.matchAll(/<svg/g)]).toHaveLength(6);
    expect([...html.matchAll(/<svg[^>]*class="logo"/g)]).toHaveLength(1);
  });

  it('lays the views out the way a drawing office reads them', () => {
    // Plans together, elevations together, the picture of the finished pallet
    // across the bottom.
    const order = [...html.matchAll(/<text[^>]*>([A-Z ]+VIEW|ISOMETRIC)<\/text>/g)].map(
      (m) => m[1],
    );
    expect(order).toEqual([
      'TOP VIEW',
      'BOTTOM VIEW',
      'SIDE VIEW',
      'END VIEW',
      'ISOMETRIC',
    ]);
    expect(html).toContain(`.row.iso { height: ${drawingRows(layout).iso.toFixed(2)}mm; }`);
  });

  /**
   * The bug this guards: every view used to be fitted to its own cell, so the
   * end elevation — the short way across the pallet, in a cell as wide as the
   * side elevation's — came out half again as large, and the pallet's one height
   * printed as two heights. A drawing that measures the same thing two ways is
   * read as a drawing of something built wrong.
   */
  it('draws all four flat views to one scale', () => {
    const rows = drawingRows(layout);
    for (const view of ['top', 'bottom', 'side', 'end'] as const) {
      expect(measureView(layout, view, { scale: rows.scale }).scale).toBe(rows.scale);
    }

    // And it shows on the page. The pallet drawn in each view is the extent of
    // its boards: as deep as the pallet is high in both elevations, as wide as
    // the pallet is long in both plans. The views' own boxes are not compared —
    // they carry different dimension lanes and are not the same size, which is
    // why each is centred in its cell rather than aligned to a corner.
    const svgs = sheetViews(layout, rows);
    const drawn = (svg: string) => {
      // Stroked rectangles only: the first rect in the view is its white
      // background, which is the size of the whole box and not of the pallet.
      const rects = [
        ...svg.matchAll(
          /<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)"[^>]*stroke="/g,
        ),
      ].map((m) => ({ x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) }));
      return {
        width: Math.max(...rects.map((r) => r.x + r.w)) - Math.min(...rects.map((r) => r.x)),
        height: Math.max(...rects.map((r) => r.y + r.h)) - Math.min(...rects.map((r) => r.y)),
      };
    };

    // To within the 2dp the SVG rounds its coordinates to.
    const drawnAt = (mm: number) => ({
      toBe: (px: number) => expect(Math.abs(px - mm * rows.scale)).toBeLessThan(0.05),
    });
    // The pallet's one height, drawn once.
    drawnAt(layout.overallHeight).toBe(drawn(svgs.side!).height);
    drawnAt(layout.overallHeight).toBe(drawn(svgs.end!).height);
    // Its one length, drawn once.
    drawnAt(layout.overallLength).toBe(drawn(svgs.top!).width);
    drawnAt(layout.overallLength).toBe(drawn(svgs.side!).width);
    // And the end elevation comes out the narrower of the two, as the pallet is.
    expect(drawn(svgs.end!).width).toBeLessThan(drawn(svgs.side!).width);
  });

  it('gives the rows the depth their views turned out to need', () => {
    const rows = drawingRows(layout);
    // The three rows fill the drawing area between them, exactly.
    expect(rows.plan + rows.elevation + rows.iso).toBeCloseTo(DRAWING.rowsHeight, 6);
    // A plan is about as deep as it is wide; an elevation is a thin band.
    expect(rows.plan).toBeGreaterThan(rows.elevation);
    // The isometric is never squeezed out by a deep footprint.
    expect(rows.iso).toBeGreaterThanOrEqual(DRAWING.minIsoRowHeight - 1e-6);
    // And every view is inside the cell it was measured for.
    for (const [view, room, cell] of [
      ['top', rows.plan, rows.cells.plan[0]!],
      ['bottom', rows.plan, rows.cells.plan[1]!],
      ['side', rows.elevation, rows.cells.elevation[0]!],
      ['end', rows.elevation, rows.cells.elevation[1]!],
    ] as const) {
      const drawn = measureView(layout, view, { scale: rows.scale });
      expect(drawn.width).toBeLessThanOrEqual(mmToPx(cell) + 1);
      expect(drawn.height).toBeLessThanOrEqual(mmToPx(room) + 1);
    }
  });

  /**
   * A row is divided by what its views need, not down the middle. The plans
   * carry board spacings down one side and an overall dimension down the other;
   * the elevations carry far less, and used to leave that width unused while the
   * lanes on the plans held the shared scale down.
   */
  it('divides each row by what its views need', () => {
    const rows = drawingRows(layout);
    for (const row of ['plan', 'elevation'] as const) {
      const cells = rows.cells[row];
      // The cells and the gap between them fill the drawing column exactly.
      expect(cells.reduce((a, b) => a + b, 0) + SHEET.columnGap).toBeCloseTo(DRAWING.width, 6);
    }
    // The end elevation is the short way across the pallet and carries the same
    // lanes as the side, so it is given the smaller cell of its row.
    expect(rows.cells.elevation[1]!).toBeLessThan(rows.cells.elevation[0]!);
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
    const rows = drawingRows(layout);
    // In the order the sheet lays them out: the two plans, the two elevations,
    // then the isometric alone on a full-width row.
    const cells = [
      { width: rows.cells.plan[0]!, height: rows.plan },
      { width: rows.cells.plan[1]!, height: rows.plan },
      { width: rows.cells.elevation[0]!, height: rows.elevation },
      { width: rows.cells.elevation[1]!, height: rows.elevation },
      { width: DRAWING.width, height: rows.iso },
    ];
    sizes.forEach((size, i) => {
      const cell = cells[i]!;
      expect(size.width).toBeLessThanOrEqual(mmToPx(cell.width) + 1);
      expect(size.height).toBeLessThanOrEqual(mmToPx(cell.height) + 1);
    });
  });

  it('states the projection and the units once, under the drawings', () => {
    expect([...html.matchAll(/First-angle projection, all dimensions in mm/g)]).toHaveLength(1);
  });

  it('lists the components and the load and material', () => {
    const text = textOf(html);
    expect(text).toContain('Top board');
    // Length, then width, then thickness: the order the shop floor says them in.
    expect(text).toContain('1200 × 100 × 18');
    expect(text).toContain('Static load 3000 kg');
    expect(text).toContain('Species pine');
  });

  /**
   * The schedule is typed, not derived, and most designs have none. A sheet
   * only carries the table where somebody has written the rows out.
   */
  it('prints the nail schedule as typed, and no table where none is typed', () => {
    expect(textOf(html)).not.toContain('Nails');

    const scheduled = { ...pallet, nails: [{ label: 'top board to centre board', type: 'wire nail' }] };
    const text = textOf(renderSheet(scheduled, layout));
    expect(text).toContain('Nails');
    expect(text).toContain('top board to centre board');
    expect(text).toContain('wire nail');
  });

  it('states the two tolerances on every sheet, whatever the design', () => {
    for (const name of ['block-1000x800', 'plywood-type2', 'stringer-2way']) {
      const other = loadFixture(name);
      const text = textOf(renderSheet(other, computeLayout(other)));
      expect(text).toContain('Component tolerance ± 2 mm');
      expect(text).toContain('Total pallet tolerance ± 5 mm');
    }
  });

  it('drops the surface row, which the components table already says', () => {
    expect(textOf(html)).not.toContain('Surface');
  });

  it('does not repeat the material on every component row', () => {
    // The species is stated once, under load and material.
    const components = /<h2>Components<\/h2>([\s\S]*?)<\/table>/.exec(html)![1]!;
    expect(components).not.toContain('Material');
    expect(components).not.toContain('pine');
    expect([...components.matchAll(/<th[ >]/g)]).toHaveLength(4);
  });

  it('names each component once, with no heading row restating it', () => {
    const components = /<h2>Components<\/h2>([\s\S]*?)<\/table>/.exec(html)![1]!;
    expect(components).not.toContain('class="group"');
    // One row per part, and the row is the name: no "Top boards" over a lone
    // "Top board" beneath it.
    expect([...components.matchAll(/Top board/g)]).toHaveLength(1);
  });

  it('numbers the components off only when a layer makes more than one', () => {
    const one = loadFixture('block-1000x800');
    const single = componentTable(one, computeLayout(one));
    expect(single[0]!.rows.map((r) => r.name)).toEqual(['Top boards']);

    const many = loadFixture('two-top-widths');
    const split = componentTable(many, computeLayout(many));
    expect(split[0]!.rows.map((r) => r.name)).toEqual(['Top board-1', 'Top board-2']);
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
      // The five views, plus the logo in the corner.
      expect([...sheet.matchAll(/<svg/g)]).toHaveLength(6);
    }
  });
});

/**
 * Not every design answers every question, and there are two different ways of
 * not answering one. A blank is a question still open, and the shop has to see
 * that it is open; `na` is closed — there is no such thing on this pallet — and
 * a line saying so is a line of the specification wasted.
 */
describe('an attribute the design does not state', () => {
  const pallet = loadFixture('block-1000x800');
  const layout = computeLayout(pallet);
  /**
   * The text of one block of the data column. Scoped to the block because
   * "Type" is also a column of the nail schedule, and a row of the specification
   * being gone is not the same as the word being gone from the page.
   */
  const sheetText = (patch: Partial<typeof pallet>, heading = 'Load and material'): string => {
    const html = renderSheet({ ...pallet, ...patch }, layout);
    return textOf(new RegExp(`<h2>${heading}</h2>([\\s\\S]*?)</table>`).exec(html)![1]!);
  };
  const overall = (patch: Partial<typeof pallet>): string => sheetText(patch, 'Overall');

  it('prints a dash for a blank, and keeps the line on the sheet', () => {
    expect(sheetText({ species: '' })).toContain('Species —');
    expect(overall({ deckType: '' })).toContain('Deck —');
    expect(sheetText({ staticLoadKg: undefined })).toContain('Static load —');
  });

  it('takes the whole line off the sheet for na, typed or picked', () => {
    expect(sheetText({ species: 'na' })).not.toContain('Species');
    expect(sheetText({ planing: 'na' })).not.toContain('Planing');
    expect(sheetText({ staticLoadKg: 'na' })).not.toContain('Static load');
    expect(overall({ deckType: 'na' })).not.toContain('Deck');
    expect(overall({ entry: 'na' })).not.toContain('Entry');
    expect(overall({ palletType: 'na' })).not.toContain('Type');
    // The size is what the sheet is for, and is never one of the droppable rows.
    expect(overall({ palletType: 'na', entry: 'na', deckType: 'na' })).toContain('Overall size');
  });

  it('reads na however it was typed, and only when it is the whole answer', () => {
    expect(sheetText({ species: 'NA' })).not.toContain('Species');
    expect(sheetText({ species: ' na ' })).not.toContain('Species');
    // A species really called this keeps its line: only the word alone means it.
    expect(sheetText({ species: 'nagpur pine' })).toContain('Species nagpur pine');
  });

  it('closes the rows below up rather than leaving a gap', () => {
    const text = sheetText({ species: 'na', staticLoadKg: 'na' });
    expect(text).toContain('Dynamic load');
    expect(text).toContain('Planing None');
    // The two tolerances are the same on every sheet and are never dropped.
    expect(text).toContain('Component tolerance ± 2 mm');
  });

  it('leaves the design saveable with nothing stated at all', () => {
    const bare = {
      ...pallet,
      species: '',
      palletType: '' as const,
      deckType: '' as const,
      entry: '' as const,
      planing: '' as const,
    };
    expect(() => parsePallet(bare)).not.toThrow();
    expect(renderSheet(bare, layout)).toContain('</html>');
  });
});

/**
 * A design is often only a size for a while, so it is allowed to have no name —
 * but the middle of the header is what the sheet is of, and that cell must never
 * come out blank.
 */
describe('a design with no name', () => {
  const pallet = loadFixture('block-1000x800');
  const layout = computeLayout(pallet);
  const headingOf = (patch: Partial<typeof pallet>) =>
    sheetContent({ ...pallet, ...patch }, layout).heading;

  it('is saveable', () => {
    expect(() => parsePallet({ ...pallet, palletName: '' })).not.toThrow();
    expect(parsePallet({ ...pallet, palletName: '' }).palletName).toBe('');
  });

  it('heads the sheet with its overall size, and puts the code underneath', () => {
    const heading = headingOf({ palletName: '', palletCode: 'AP-001' });
    expect(heading.palletName).toBe(sheetContent(pallet, layout).size);
    expect(heading.subtitle).toBe('AP-001');
  });

  it('leaves the second line off when there is no code either', () => {
    const heading = headingOf({ palletName: '', palletCode: '' });
    expect(heading.palletName).toContain('1000');
    expect(heading.subtitle).toBe('');
  });

  it('still prints, and names itself by whatever it does have', () => {
    const bare = { ...pallet, palletName: '', palletCode: '' };
    expect(renderSheet(bare, layout)).toContain('</html>');
    expect(sheetContent(bare, layout).title).toBe(`${pallet.clientName} - ${pallet.updatedAt}`);
  });

  it('changes nothing for a design that has a name', () => {
    const heading = headingOf({ palletCode: 'AP-001' });
    expect(heading.palletName).toBe(pallet.palletName);
    expect(heading.subtitle).toBe(`AP-001 · ${sheetContent(pallet, layout).size}`);
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
    const svg = renderView(layout, 'top', { scale: drawingRows(layout).scale });
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
    expect(DRAWING.rowsHeight + 2 * SHEET.rowGap).toBeLessThanOrEqual(DRAWING.height + 1e-6);
  });

  it('fills the drawing area whatever the pallet, and never overruns it', () => {
    for (const name of [
      'block-1000x800',
      'm-pallet',
      'plywood-type3',
      'stringer-2way',
      'wing-both-decks',
      'wide-centre-block-row',
    ]) {
      const rows = drawingRows(computeLayout(loadFixture(name)));
      expect(rows.plan + rows.elevation + rows.iso).toBeCloseTo(DRAWING.rowsHeight, 6);
      expect(rows.iso).toBeGreaterThanOrEqual(DRAWING.minIsoRowHeight - 1e-6);
      expect(rows.scale).toBeGreaterThan(0);
    }
  });

  /**
   * The awkward shape. A deep footprint makes the plans square enough to take
   * the page, and the plan and elevation rows can then overrun the drawing area
   * between them while neither overruns its own share of it.
   */
  it('does not let a deep footprint crowd the isometric out', () => {
    const base = loadFixture('m-pallet');
    for (const overallWidth of [1200, 1300, 1400, 1500]) {
      const layout = computeLayout({ ...base, overallWidth });
      const rows = drawingRows(layout);
      expect(rows.plan + rows.elevation + rows.iso).toBeCloseTo(DRAWING.rowsHeight, 6);
      expect(rows.iso).toBeGreaterThanOrEqual(DRAWING.minIsoRowHeight - 1e-6);
      for (const [view, room] of [
        ['top', rows.plan],
        ['bottom', rows.plan],
        ['side', rows.elevation],
        ['end', rows.elevation],
      ] as const) {
        const drawn = measureView(layout, view, { scale: rows.scale });
        expect(drawn.height).toBeLessThanOrEqual(mmToPx(room) + 1);
      }
    }
  });
});

/**
 * A downloaded sheet lands in a folder of other people's files, so its name has
 * to say what it is: the design, whose it is, and when it was saved.
 */
describe('the name a sheet downloads as', () => {
  const pallet = loadFixture('block-1000x800');
  const named = {
    ...pallet,
    palletName: 'Export crate base',
    palletCode: 'AP-001',
    clientName: 'Acme Ltd',
    updatedAt: '2026-08-06',
  };

  it('is the design, the client and the date', () => {
    expect(downloadName(named, 'pdf')).toBe('Export crate base - Acme Ltd - 2026-08-06.pdf');
    expect(downloadName(named, 'dxf')).toBe('Export crate base - Acme Ltd - 2026-08-06.dxf');
  });

  it('falls back to the code while a design has no name', () => {
    expect(downloadName({ ...named, palletName: '' }, 'pdf')).toBe(
      'AP-001 - Acme Ltd - 2026-08-06.pdf',
    );
  });

  it('still has something to save under when a design has neither', () => {
    expect(downloadName({ ...named, palletName: '', palletCode: '', clientName: '' }, 'pdf')).toBe(
      '2026-08-06.pdf',
    );
  });

  it('drops what a file system would not take', () => {
    const awkward = { ...named, palletName: '1000/800 pallet', clientName: 'A: B' };
    expect(downloadName(awkward, 'pdf')).toBe('1000800 pallet - A B - 2026-08-06.pdf');
  });

  it('carries the name in full as well as in ASCII, for every browser', () => {
    const header = contentDisposition('Palé - Café Ltd - 2026-08-06.pdf', 'inline');
    expect(header).toContain('inline; filename="Pal_ - Caf_ Ltd - 2026-08-06.pdf"');
    expect(header).toContain("filename*=UTF-8''Pal%C3%A9%20-%20Caf%C3%A9%20Ltd%20-%202026-08-06.pdf");
  });
});
