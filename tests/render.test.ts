import { describe, expect, it } from 'vitest';
import { computeLayout } from '../src/geometry/layout.js';
import { projectPieces, projectPlanPoint, viewFrame } from '../src/render/project.js';
import type { ViewKind } from '../src/render/project.js';
import { renderView } from '../src/render/views.js';
import { loadFixture } from './helpers.js';

const ALL_VIEWS: ViewKind[] = ['top', 'bottom', 'side', 'end'];

function count(svg: string, pattern: RegExp): number {
  return svg.match(pattern)?.length ?? 0;
}

function labels(svg: string): string[] {
  return [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]!);
}

function ids(svg: string): string[] {
  return [...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!);
}

describe('projection', () => {
  const layout = computeLayout(loadFixture('block-1000x800'));

  it('frames each view off the pallet dimensions', () => {
    expect(viewFrame(layout, 'top')).toEqual({ uSpan: 1000, vSpan: 800 });
    expect(viewFrame(layout, 'bottom')).toEqual({ uSpan: 1000, vSpan: 800 });
    expect(viewFrame(layout, 'side')).toEqual({ uSpan: 1000, vSpan: 156 });
    expect(viewFrame(layout, 'end')).toEqual({ uSpan: 800, vSpan: 156 });
  });

  it('emphasises the top boards in the top view and nothing else', () => {
    const near = projectPieces(layout, 'top').filter((p) => p.near);
    expect(near).toHaveLength(7);
    expect(near.every((p) => p.piece.layerKind === 'top_deck')).toBe(true);
  });

  it('emphasises the bottom boards in the bottom view', () => {
    const near = projectPieces(layout, 'bottom').filter((p) => p.near);
    expect(near).toHaveLength(3);
    expect(near.every((p) => p.piece.layerKind === 'bottom_deck')).toBe(true);
  });

  it('mirrors the bottom view so it is a real view from underneath', () => {
    const top = projectPieces(layout, 'top').find((p) => p.piece.layerKind === 'top_deck')!;
    const bottomOfSame = projectPieces(layout, 'bottom').find(
      (p) => p.piece === top.piece,
    )!;
    expect(top.v).toBe(0);
    expect(bottomOfSame.v).toBe(800 - top.piece.dy);
    expect(projectPlanPoint({ x: 50, y: 50 }, layout, 'bottom')).toEqual({ u: 50, v: 750 });
    expect(projectPlanPoint({ x: 50, y: 50 }, layout, 'top')).toEqual({ u: 50, v: 50 });
  });

  it('fades a piece in the side view only when something in front covers it', () => {
    const projected = projectPieces(layout, 'side');
    const near = projected.filter((p) => p.near);
    // One of the seven top boards, all three bearers, the front block of each
    // row, and all three bottom boards.
    expect(near.filter((p) => p.piece.layerKind === 'top_deck')).toHaveLength(1);
    expect(near.filter((p) => p.piece.layerKind === 'bearer')).toHaveLength(3);
    expect(near.filter((p) => p.piece.layerKind === 'block')).toHaveLength(3);
    expect(near.filter((p) => p.piece.layerKind === 'bottom_deck')).toHaveLength(3);
  });

  it('sorts back to front so a painter pass works', () => {
    for (const view of ALL_VIEWS) {
      const depths = projectPieces(layout, view).map((p) => p.depth);
      expect([...depths].sort((a, b) => a - b)).toEqual(depths);
    }
  });
});

describe('emphasis', () => {
  const layout = computeLayout(loadFixture('block-1000x800'));

  it('carries emphasis on three signals at once, not just colour', () => {
    const svg = renderView(layout, 'top');
    const nearRects = count(svg, /stroke-width="1.2"/g);
    const farRects = count(svg, /stroke-width="0.4"/g);
    expect(nearRects).toBe(7);
    // Every piece behind is drawn twice: filled underneath, outlined through
    // the boards. Extension lines share the faint weight, so only check pairs.
    expect(farRects).toBeGreaterThanOrEqual(15 * 2);
    expect(count(svg, /opacity="0.3"/g)).toBe(15 * 2);
  });

  it('shows the layers behind through the near layer, clipped to it', () => {
    const svg = renderView(layout, 'top');
    expect(svg).toContain('<clipPath');
    expect(svg).toContain('clip-path="url(#view-top-near)"');
  });

  it('desaturates the whole drawing for the greyscale check', () => {
    const svg = renderView(layout, 'top', { greyscale: true });
    expect(svg).toContain('feColorMatrix type="saturate" values="0"');
    expect(svg).toContain('filter="url(#view-top-greyscale)"');
  });
});

describe('nail dots', () => {
  const layout = computeLayout(loadFixture('block-1000x800'));

  // 7 top boards over 3 centre boards is 21 crossings: 4 of them at a corner
  // of the pallet take 3 nails, the other 17 take 2.
  const TOP_NAILS = 4 * 3 + 17 * 2;
  // 3 bottom boards under a 3 x 3 block grid is 9 crossings of 2.
  const BOTTOM_NAILS = 9 * 2;

  it('appear in the top and bottom views only', () => {
    expect(count(renderView(layout, 'top'), /<circle/g)).toBe(TOP_NAILS);
    expect(count(renderView(layout, 'bottom'), /<circle/g)).toBe(BOTTOM_NAILS);
    expect(count(renderView(layout, 'side'), /<circle/g)).toBe(0);
    expect(count(renderView(layout, 'end'), /<circle/g)).toBe(0);
  });

  it('sit at every crossing of a deck board and the layer against it', () => {
    const top = layout.nailDots.filter((d) => d.face === 'top');
    expect(top).toHaveLength(TOP_NAILS);
    expect(new Set(top.map((d) => d.lowerKind))).toEqual(new Set(['bearer']));
    const bottom = layout.nailDots.filter((d) => d.face === 'bottom');
    // Nailed up from below, so the blocks are the upper member of that joint.
    expect(new Set(bottom.map((d) => d.upperKind))).toEqual(new Set(['block']));
  });

  it('puts three at each corner of the pallet and two everywhere else', () => {
    const top = layout.nailDots.filter((d) => d.face === 'top');
    const corners = [
      [0, 0],
      [layout.overallLength, 0],
      [0, layout.overallWidth],
      [layout.overallLength, layout.overallWidth],
    ];
    // The corner crossing is one 100mm board over one 100mm centre board, so
    // everything within that square of the corner belongs to it and the next
    // board along — 117mm away — does not.
    const near = (x: number, y: number): number =>
      top.filter((d) => Math.abs(d.x - x) < 100 && Math.abs(d.y - y) < 100).length;

    for (const [x, y] of corners) expect(near(x!, y!)).toBe(3);
    // Twelve of the 46 are in those four clusters; the rest are in pairs.
    expect(top.length - 4 * 3).toBe(17 * 2);
  });

  it('drives the long nail through the outer boards and the whole underside', () => {
    const top = layout.nailDots.filter((d) => d.face === 'top');
    // Two outer boards, three centre boards: 4 corners of 3 and 2 middles of 2.
    expect(top.filter((d) => d.sizeMm === 64)).toHaveLength(4 * 3 + 2 * 2);
    expect(top.filter((d) => d.sizeMm === 50)).toHaveLength(5 * 3 * 2);
    const bottom = layout.nailDots.filter((d) => d.face === 'bottom');
    expect(bottom.every((d) => d.sizeMm === 64)).toBe(true);
  });

  it('schedules what it drew, and nothing else', () => {
    const total = layout.nailLines.reduce((sum, line) => sum + line.count, 0);
    expect(total).toBe(TOP_NAILS + BOTTOM_NAILS);
    expect(layout.nailLines.map((line) => [line.sizeMm, line.count])).toEqual([
      [64, 16],
      [50, 30],
      [64, 18],
    ]);
    expect(layout.nailLines.every((line) => line.derived)).toBe(true);
  });

  it('shares a hand-typed count evenly across the crossings it overrides', () => {
    const pallet = loadFixture('block-1000x800');
    pallet.nails[0]!.count = 25;
    const uneven = computeLayout(pallet).nailDots.filter((d) => d.face === 'top');
    expect(uneven).toHaveLength(25);
    // The bottom face was not named by that spec, so the rule still has it.
    const layout = computeLayout(pallet);
    expect(layout.nailDots.filter((d) => d.face === 'bottom')).toHaveLength(BOTTOM_NAILS);
    expect(layout.nailLines.find((line) => line.face === 'top')!.derived).toBe(false);
  });

  it('needs no nail spec at all: the drawing is what says where the nails go', () => {
    const pallet = loadFixture('block-1000x800');
    pallet.nails = [];
    const bare = computeLayout(pallet);
    expect(bare.issues).toEqual([]);
    expect(bare.nailDots.filter((d) => d.face === 'top')).toHaveLength(TOP_NAILS);
    expect(bare.nailLines.every((line) => line.type === 'wire nail')).toBe(true);
  });
});

describe('dimensions', () => {
  it('gives the overall size in the views that show it', () => {
    const layout = computeLayout(loadFixture('block-1000x800'));
    expect(labels(renderView(layout, 'top'))).toEqual(
      expect.arrayContaining(['1000', '800']),
    );
    expect(labels(renderView(layout, 'side'))).toEqual(
      expect.arrayContaining(['1000', '156']),
    );
    expect(labels(renderView(layout, 'end'))).toEqual(
      expect.arrayContaining(['800', '156']),
    );
  });

  it('gives the width of each distinct board variant and one gap per layer', () => {
    const layout = computeLayout(loadFixture('two-top-widths'));
    const found = labels(renderView(layout, 'top'));
    expect(found).toEqual(expect.arrayContaining(['120', '100', '10']));
    // One gap for the layer, not one per gap.
    expect(found.filter((label) => label === '10')).toHaveLength(1);
  });

  it('dimensions every non-zero overhang on a wing pallet', () => {
    const layout = computeLayout(loadFixture('wing-both-decks'));
    const top = labels(renderView(layout, 'top')).filter((l) => l === '50');
    // Four sides, plus the computed gap which is also 50 on this pallet.
    expect(top.length).toBeGreaterThanOrEqual(4);
    const bottom = labels(renderView(layout, 'bottom')).filter((l) => l === '25');
    expect(bottom).toHaveLength(4);
  });

  it('prints the real position of a nudged board, measured from the nearest edge', () => {
    const layout = computeLayout(loadFixture('nudged-top-board'));
    const found = labels(renderView(layout, 'top'));
    expect(found).toContain('141.7');
    // The gap callout skips the nudged pair and reports the computed spacing.
    expect(found).toContain('16.7');
  });
});

describe('the SVG itself', () => {
  const layout = computeLayout(loadFixture('wing-both-decks'));

  it('keeps every measurement as selectable text', () => {
    const svg = renderView(layout, 'top');
    expect(labels(svg).length).toBeGreaterThan(5);
    expect(svg).not.toContain('<image');
    expect(svg).not.toContain('http://www.w3.org/1999/xlink');
  });

  it('keeps ids unique so views can share one HTML document', () => {
    const all = ALL_VIEWS.flatMap((view) => ids(renderView(layout, view, { greyscale: true })));
    expect(new Set(all).size).toBe(all.length);
  });

  it('takes a forced scale so views can share one', () => {
    // The pallet is 1200 long, so at 0.25 px per mm a full length board is 300
    // px wide in both views however much room their dimension lanes take.
    for (const view of ['top', 'side'] as const) {
      const svg = renderView(layout, view, { scale: 0.25 });
      expect(svg).toContain('width="300"');
    }
    expect(renderView(layout, 'top', { scale: 0.5 })).toContain('width="600"');
  });

  it('renders every view of every fixture without throwing', () => {
    for (const name of [
      'block-1000x800',
      'two-top-widths',
      'joined-middle-pair',
      'wide-centre-block-row',
      'wing-both-decks',
      'nudged-top-board',
      'plywood-type1',
      'plywood-type2',
      'plywood-type3',
      'stringer-2way',
    ]) {
      const fixture = computeLayout(loadFixture(name));
      for (const view of ALL_VIEWS) {
        const svg = renderView(fixture, view);
        expect(svg.startsWith('<svg')).toBe(true);
        expect(svg.endsWith('</svg>')).toBe(true);
      }
    }
  });
});
