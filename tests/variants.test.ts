import { describe, expect, it } from 'vitest';
import { computeCosting } from '../src/costing/costing.js';
import { parseRates } from '../src/costing/rates.js';
import { palletToDxf } from '../src/dxf/drawing.js';
import { computeLayout } from '../src/geometry/layout.js';
import { renderIsometric } from '../src/render/isoView.js';
import { projectPieces } from '../src/render/project.js';
import { renderView } from '../src/render/views.js';
import { componentTable } from '../src/sheet/components.js';
import { renderSheet } from '../src/sheet/sheet.js';
import { loadFixture } from './helpers.js';

/**
 * Shapes the model has to carry that are not the plain block pallet: the three
 * plywood pallets, and runners in place of blocks. All of them are meant to be
 * data rather than a code path, so each is taken the whole way through to the
 * sheet, the DXF and the costing.
 */

const rates = parseRates({
  currency: 'INR',
  timberPerCft: { default: 850, pine: 850, plywood: 2200 },
  nailsPerThousand: { default: 900 },
  overhead: { perPallet: 60, percentOfMaterial: 8 },
});

describe('the three plywood pallets', () => {
  const type1 = computeLayout(loadFixture('plywood-type1'));
  const type2 = computeLayout(loadFixture('plywood-type2'));
  const type3 = computeLayout(loadFixture('plywood-type3'));

  it('type 1 puts the sheet straight onto the blocks', () => {
    expect(type1.issues).toEqual([]);
    expect(type1.layers.map((layer) => layer.kind)).toEqual([
      'top_deck',
      'block',
      'bottom_deck',
    ]);
    const sheet = type1.pieces.find((piece) => piece.source.kind === 'sheet')!;
    expect(sheet).toMatchObject({ layerKind: 'top_deck', dx: 1200, dy: 1000, dz: 12 });
    expect(type1.nailDots.filter((dot) => dot.face === 'top')).toHaveLength(18);
  });

  it('type 2 puts centre boards between the blocks and the sheet', () => {
    expect(type2.issues).toEqual([]);
    expect(type2.layers.map((layer) => layer.kind)).toEqual([
      'top_deck',
      'bearer',
      'block',
      'bottom_deck',
    ]);
    const onTop = type2.nailDots.filter((dot) => dot.face === 'top');
    expect(onTop).toHaveLength(24);
    expect(new Set(onTop.map((dot) => dot.lowerKind))).toEqual(new Set(['bearer']));
    // Three crossings, so the count divides eight apiece.
    const perCrossing = new Map<number, number>();
    for (const dot of onTop) {
      const key = Math.round(dot.x / 100);
      perCrossing.set(key, (perCrossing.get(key) ?? 0) + 1);
    }
    expect([...perCrossing.values()]).toEqual([8, 8, 8]);
  });

  /**
   * The sheet on a type 3 does not replace the top boards, it lies over them,
   * so it is a layer of its own rather than a deck made of a sheet.
   */
  it('type 3 lays a sheet over a whole boarded pallet', () => {
    expect(type3.issues).toEqual([]);
    expect(type3.layers.map((layer) => layer.kind)).toEqual([
      'panel',
      'top_deck',
      'bearer',
      'block',
      'bottom_deck',
    ]);
    expect(type3.derivedHeight).toBe(12 + 18 + 20 + 100 + 18);

    const panel = type3.pieces.find((piece) => piece.layerKind === 'panel')!;
    const boards = type3.pieces.filter((piece) => piece.layerKind === 'top_deck');
    expect(boards).toHaveLength(7);
    // The sheet sits on the boards, not instead of them.
    expect(panel.z).toBe(boards[0]!.z + boards[0]!.dz);
  });

  it('nails the sheet to whatever it lands on, whichever type that is', () => {
    const joint = (layout: typeof type1): string =>
      layout.nailDots
        .filter((dot) => dot.face === 'top')
        .map((dot) => `${dot.upperKind}->${dot.lowerKind}`)[0]!;
    expect(joint(type1)).toBe('top_deck->block');
    expect(joint(type2)).toBe('top_deck->bearer');
    expect(joint(type3)).toBe('panel->top_deck');
    expect(type3.nailDots.filter((dot) => dot.face === 'top')).toHaveLength(28);
  });

  it('only draws the nails that can be seen from the face being viewed', () => {
    // The top boards of a type 3 are nailed to the centre boards underneath,
    // but that joint is under the sheet and is not drawn on either view.
    const inside = type3.nailDots.filter((dot) => dot.face === null);
    expect(inside.length).toBeGreaterThan(0);
    const top = renderView(type3, 'top');
    expect([...top.matchAll(/<circle/g)]).toHaveLength(28);
    expect([...renderView(type3, 'bottom').matchAll(/<circle/g)]).toHaveLength(9);
  });

  it('calls the sheet a plywood sheet on the sheet, whichever type it is', () => {
    for (const [pallet, layout] of [
      [loadFixture('plywood-type1'), type1],
      [loadFixture('plywood-type2'), type2],
      [loadFixture('plywood-type3'), type3],
    ] as const) {
      const groups = componentTable(pallet, layout);
      expect(groups[0]!.heading).toBe('Plywood sheet');
      expect(groups[0]!.rows[0]).toMatchObject({
        description: 'Plywood sheet',
        quantity: 1,
        thickness: 12,
        material: 'plywood',
      });
      const html = renderSheet(pallet, layout);
      expect(html).toContain('Plywood panel');
      expect(html).toContain('Plywood type');
    }
  });

  it('prices the sheet at the plywood rate, not the timber one', () => {
    const pallet = loadFixture('plywood-type2');
    const costing = computeCosting(type2, pallet.nails, rates);
    const plywood = costing.materials.find((line) => line.material === 'plywood')!;
    expect(plywood.ratePerCft).toBe(2200);
    expect(plywood.pieces).toBe(1);
    expect(costing.materials.find((line) => line.material === 'pine')!.ratePerCft).toBe(850);
  });

  it('draws in every output', () => {
    for (const layout of [type1, type2, type3]) {
      for (const view of ['top', 'bottom', 'side', 'end'] as const) {
        expect(renderView(layout, view)).toContain('<svg');
      }
      expect(renderIsometric(layout)).toContain('<svg');
    }
    expect(palletToDxf(type3)).toContain('PLYWOOD_PANEL');
  });
});

describe('runners in place of blocks', () => {
  const pallet = loadFixture('stringer-2way');
  const layout = computeLayout(pallet);

  it('lays out with nothing to complain about', () => {
    expect(layout.issues).toEqual([]);
    expect(layout.pieces).toHaveLength(7 + 3 + 3);
    expect(layout.derivedHeight).toBe(18 + 90 + 18);
  });

  it('runs each runner the whole length of the pallet', () => {
    const runners = layout.pieces.filter((piece) => piece.layerKind === 'runner');
    expect(runners).toHaveLength(3);
    expect(runners.every((runner) => runner.x === 0 && runner.dx === 1200)).toBe(true);
    expect(runners.map((runner) => runner.y)).toEqual([0, 450, 900]);
  });

  it('takes the base footprint from the runners, since there are no blocks', () => {
    expect(layout.base).toEqual({ x0: 0, x1: 1200, y0: 0, y1: 1000 });
    expect(layout.topOverhang).toEqual({
      lengthStart: 0,
      lengthEnd: 0,
      widthStart: 0,
      widthEnd: 0,
    });
  });

  it('nails both decks to the runners', () => {
    const top = layout.nailDots.filter((dot) => dot.face === 'top');
    const bottom = layout.nailDots.filter((dot) => dot.face === 'bottom');
    expect(top).toHaveLength(21);
    expect(bottom).toHaveLength(9);
    // The runners are under the top boards and over the bottom ones.
    for (const dot of top) expect(dot.lowerKind).toBe('runner');
    for (const dot of bottom) expect(dot.upperKind).toBe('runner');
  });

  it('emphasises the near layer in the flat views as it does anywhere else', () => {
    const svg = renderView(layout, 'top');
    // Seven top boards solid, the six pieces behind them faint.
    expect([...svg.matchAll(/stroke-width="1.2"/g)]).toHaveLength(7);
    expect([...svg.matchAll(/opacity="0.3"/g)]).toHaveLength(6 * 2);
  });

  it('gives the runners their own CAD layer', () => {
    const dxf = palletToDxf(layout);
    expect(dxf).toContain('RUNNERS');
    expect([...dxf.matchAll(/^RUNNERS$/gm)].length).toBeGreaterThan(3);
  });

  it('reaches the sheet with the right vocabulary on it', () => {
    const html = renderSheet(pallet, layout);
    expect(html).toContain('Runners');
    expect(html).toContain('Runner');
    expect(html).toContain('Stringer, 2-way');
    expect(html).toContain('2-way');
  });
});

describe('the near layer follows the stack', () => {
  it('emphasises the sheet on a type 3, not the boards beneath it', () => {
    const layout = computeLayout(loadFixture('plywood-type3'));
    const near = projectPieces(layout, 'top').filter((item) => item.near);
    expect(near).toHaveLength(1);
    expect(near[0]!.piece.layerKind).toBe('panel');

    // Everything under it, boards included, is drawn faint.
    const faint = projectPieces(layout, 'top').filter((item) => !item.near);
    expect(faint.map((item) => item.piece.layerKind)).toContain('top_deck');
  });

  it('still emphasises the top boards when they are the top', () => {
    for (const name of ['block-1000x800', 'plywood-type1', 'stringer-2way']) {
      const layout = computeLayout(loadFixture(name));
      const near = projectPieces(layout, 'top').filter((item) => item.near);
      expect(near.every((item) => item.piece.layerKind === 'top_deck')).toBe(true);
      const below = projectPieces(layout, 'bottom').filter((item) => item.near);
      expect(below.every((item) => item.piece.layerKind === 'bottom_deck')).toBe(true);
    }
  });
});
