import { describe, expect, it } from 'vitest';
import { computeLayout } from '../src/geometry/layout.js';
import { hasOverhang } from '../src/geometry/footprint.js';
import { layerOf, loadFixture, piecesOf, round } from './helpers.js';

describe('a plain 1000 x 800 block pallet', () => {
  const layout = computeLayout(loadFixture('block-1000x800'));

  it('lays out with no issues', () => {
    expect(layout.issues).toEqual([]);
    expect(layout.pieces).toHaveLength(7 + 3 + 9 + 3);
  });

  it('spaces the top boards evenly across the width, flush to both edges', () => {
    const top = piecesOf(layout, 'top');
    expect(layerOf(layout, 'top').spread?.gap).toBeCloseTo(100 / 6, 9);
    expect(round(top.map((p) => p.y))).toEqual([
      0, 116.667, 233.333, 350, 466.667, 583.333, 700,
    ]);
    expect(top.at(-1)!.y + top.at(-1)!.dy).toBeCloseTo(800, 9);
    // Boards run along the length, so their long axis is x.
    expect(top.every((p) => p.dx === 1000 && p.dy === 100 && p.dz === 18)).toBe(true);
  });

  it('turns the centre boards across the width', () => {
    const centre = piecesOf(layout, 'centre');
    expect(centre.map((p) => p.x)).toEqual([0, 450, 900]);
    expect(centre.every((p) => p.y === 0 && p.dx === 100 && p.dy === 800)).toBe(true);
  });

  it('places the 3 x 3 block grid', () => {
    const blocks = piecesOf(layout, 'blocks');
    expect(blocks).toHaveLength(9);
    expect([...new Set(blocks.map((p) => p.x))]).toEqual([0, 450, 900]);
    expect([...new Set(blocks.map((p) => p.y))]).toEqual([0, 350, 700]);
  });

  it('stacks the layers from the underside up', () => {
    expect(layerOf(layout, 'bottom').zBottom).toBe(0);
    expect(layerOf(layout, 'blocks').zBottom).toBe(18);
    expect(layerOf(layout, 'centre').zBottom).toBe(118);
    expect(layerOf(layout, 'top').zBottom).toBe(138);
    expect(layout.derivedHeight).toBe(156);
    expect(layout.overallHeight).toBe(156);
  });

  it('has no overhang', () => {
    expect(hasOverhang(layout.topOverhang)).toBe(false);
    expect(hasOverhang(layout.bottomOverhang)).toBe(false);
  });
});

describe('a pallet with two top board widths', () => {
  const layout = computeLayout(loadFixture('two-top-widths'));
  const top = piecesOf(layout, 'top');

  it('keeps one shared gap across boards of different widths', () => {
    expect(layerOf(layout, 'top').spread?.gap).toBe(10);
    expect(top.map((p) => p.y)).toEqual([0, 130, 240, 350, 460, 570, 680]);
    expect(top.at(-1)!.y + top.at(-1)!.dy).toBe(800);
  });

  it('carries the variant and part number through to the pieces', () => {
    expect(top.map((p) => p.partNo)).toEqual([1, 2, 2, 2, 2, 2, 1]);
    expect(top.map((p) => p.variant)).toEqual([
      'outer', 'inner', 'inner', 'inner', 'inner', 'inner', 'outer',
    ]);
  });
});

describe('a pallet with a joined middle pair', () => {
  const layout = computeLayout(loadFixture('joined-middle-pair'));

  it('leaves no gap inside the pair and widens the rest', () => {
    expect(layerOf(layout, 'top').spread?.gapCount).toBe(5);
    expect(layerOf(layout, 'top').spread?.gap).toBe(20);
    const y = piecesOf(layout, 'top').map((p) => p.y);
    expect(y).toEqual([0, 120, 240, 360, 460, 580, 700]);
    expect(y[4]! - (y[3]! + 100)).toBe(0);
  });
});

describe('a pallet with a wider centre block row', () => {
  const layout = computeLayout(loadFixture('wide-centre-block-row'));

  it('drives each row extent from the widest cell in that row', () => {
    const blocks = piecesOf(layout, 'blocks');
    expect([...new Set(blocks.map((p) => p.x))]).toEqual([0, 425, 900]);
    const depthByRow = [0, 425, 900].map((x) => blocks.find((p) => p.x === x)!.dx);
    expect(depthByRow).toEqual([100, 150, 100]);
    // The deep row still ends flush with the far edge.
    const lastRow = blocks.filter((p) => p.x === 900);
    expect(lastRow[0]!.x + lastRow[0]!.dx).toBe(1000);
  });

  it('lines the centre boards up with the block rows', () => {
    expect(piecesOf(layout, 'centre').map((p) => p.x)).toEqual([0, 425, 900]);
  });

  it('spaces the columns off the widest cell in each column', () => {
    const blocks = piecesOf(layout, 'blocks');
    expect([...new Set(blocks.map((p) => p.y))]).toEqual([0, 350, 700]);
  });
});

describe('a wing pallet with both decks overhanging', () => {
  const layout = computeLayout(loadFixture('wing-both-decks'));

  it('reads the base footprint off the block layer', () => {
    expect(layout.base).toEqual({ x0: 50, x1: 1150, y0: 50, y1: 950 });
  });

  it('measures the top deck overhang on all four sides', () => {
    expect(layout.topOverhang).toEqual({
      lengthStart: 50,
      lengthEnd: 50,
      widthStart: 50,
      widthEnd: 50,
    });
  });

  it('measures the bottom deck overhang on all four sides', () => {
    expect(layout.bottomOverhang).toEqual({
      lengthStart: 25,
      lengthEnd: 25,
      widthStart: 25,
      widthEnd: 25,
    });
  });

  it('insets the bearer on both axes from span and offset alone', () => {
    const centre = piecesOf(layout, 'centre');
    expect(centre.map((p) => p.x)).toEqual([50, 550, 1050]);
    expect(centre.every((p) => p.y === 50 && p.dy === 900)).toBe(true);
  });
});

describe('a nudged board', () => {
  const layout = computeLayout(loadFixture('nudged-top-board'));
  const top = piecesOf(layout, 'top');

  it('moves only the nudged board and flags it', () => {
    expect(round([top[1]!.y])).toEqual([141.667]);
    expect(round([top[2]!.y])).toEqual([233.333]);
    expect(top.map((p) => p.nudged)).toEqual([
      false, true, false, false, false, false, false,
    ]);
  });

  it('treats a runner layer as a full length sequence', () => {
    const runners = piecesOf(layout, 'runners');
    expect(runners).toHaveLength(3);
    expect(runners.every((p) => p.dx === 1000 && p.dz === 100)).toBe(true);
    expect(runners.map((p) => p.y)).toEqual([0, 350, 700]);
  });
});
