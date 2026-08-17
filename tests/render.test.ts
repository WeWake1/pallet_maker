import { describe, expect, it } from 'vitest';
import { computeLayout } from '../src/geometry/layout.js';
import { projectPieces, projectPlanPoint, viewFrame } from '../src/render/project.js';
import { MAX_NAILS_PER_CROSSING } from '../src/types.js';
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
    const crossings = layout.nailCrossings.filter((c) => c.face === 'top');
    expect(crossings).toHaveLength(21);
    expect(new Set(crossings.map((c) => c.lowerKind))).toEqual(new Set(['bearer']));
    // Nailed up from below, so the blocks are the upper member of that joint.
    const under = layout.nailCrossings.filter((c) => c.face === 'bottom');
    expect(new Set(under.map((c) => c.upperKind))).toEqual(new Set(['block']));
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

  /**
   * The targets are what makes a crossing clickable, and they exist only while
   * the editor is placing nails. Nothing printed ever asks for them.
   */
  it('offers a click target per crossing, only when asked for one', () => {
    const printed = renderView(layout, 'top');
    expect(count(printed, /data-crossing/g)).toBe(0);

    const editing = renderView(layout, 'top', { nailTargets: true });
    expect(count(editing, /data-crossing/g)).toBe(21);
    // Unpainted, so a click has to be told to land on it rather than fall
    // through to the board underneath.
    expect(editing).toContain('pointer-events="all"');
    // The bottom face has its own crossings and none of the top face's.
    expect(count(renderView(layout, 'bottom', { nailTargets: true }), /data-crossing/g)).toBe(9);
    expect(count(renderView(layout, 'side', { nailTargets: true }), /data-crossing/g)).toBe(0);
  });

  /** The document a click on `crossing` would produce. */
  function withPlacement(index: number, count: number) {
    const pallet = loadFixture('block-1000x800');
    const crossing = computeLayout(pallet).nailCrossings[index]!;
    pallet.nailPlacements = [
      {
        upperLayerId: crossing.upperLayerId,
        upperSource: crossing.upperSource,
        lowerLayerId: crossing.lowerLayerId,
        lowerSource: crossing.lowerSource,
        count,
      },
    ];
    return { pallet, crossing };
  }

  it('gives a clicked crossing the count it was clicked to, and leaves the rest', () => {
    const { pallet } = withPlacement(0, 4);
    const clicked = computeLayout(pallet);

    expect(clicked.nailCrossings[0]!.count).toBe(4);
    expect(clicked.nailCrossings[0]!.manual).toBe(true);
    expect(clicked.nailCrossings.slice(1).every((c) => !c.manual)).toBe(true);
    // The clicked crossing was a corner of 3, so the face gains exactly one.
    expect(clicked.nailDots.filter((d) => d.face === 'top')).toHaveLength(TOP_NAILS + 1);
    expect(clicked.nailDots.filter((d) => d.face === 'bottom')).toHaveLength(BOTTOM_NAILS);
  });

  it('draws no nails at a crossing clicked round to zero', () => {
    const { pallet } = withPlacement(0, 0);
    const cleared = computeLayout(pallet);
    expect(cleared.nailCrossings[0]!.count).toBe(0);
    expect(cleared.nailDots.filter((d) => d.face === 'top')).toHaveLength(TOP_NAILS - 3);
  });

  it('holds a placement at four however large a count reaches it', () => {
    const { pallet } = withPlacement(0, 99);
    expect(computeLayout(pallet).nailCrossings[0]!.count).toBe(MAX_NAILS_PER_CROSSING);
  });

  /**
   * A placement names the two boards that cross, not a position, so the pallet
   * can be resized under it without the nails ending up on a different board.
   */
  it('keeps a placement on its boards when the pallet is resized', () => {
    const { pallet } = withPlacement(0, 1);
    pallet.overallLength = 1200;
    for (const layer of pallet.layers) {
      if (layer.content.type === 'sequence' && layer.direction === 'along_length') {
        for (const slot of layer.content.slots) slot.length = 1200;
      }
    }
    const wider = computeLayout(pallet);
    const manual = wider.nailCrossings.filter((c) => c.manual);
    expect(manual).toHaveLength(1);
    expect(manual[0]!.count).toBe(1);
  });

  /**
   * The schedule is a written statement of what the pallet is built with. It is
   * priced and printed; it does not move a dot.
   */
  it('is not touched by the nail schedule typed on the document', () => {
    const pallet = loadFixture('block-1000x800');
    pallet.nails = [{ label: 'anything at all', type: 'ring shank', sizeMm: 90, count: 500 }];
    const typed = computeLayout(pallet);
    expect(typed.issues).toEqual([]);
    expect(typed.nailDots).toHaveLength(TOP_NAILS + BOTTOM_NAILS);

    pallet.nails = [];
    expect(computeLayout(pallet).nailDots).toHaveLength(TOP_NAILS + BOTTOM_NAILS);
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

  /**
   * The clearance under the deck, which is the same opening seen two ways and
   * so honestly two numbers. See `entryOpening` in views.ts.
   */
  describe('the entry clearance', () => {
    it('reaches the ground where the pocket is clear and the plank where it is not', () => {
      // 18 bottom plank, 100 blocks, 20 bearer, 18 top boards. The planks run
      // across the width, tucked under the blocks: looking along them, from the
      // side, the pocket is open to the floor and the clearance is 18 greater.
      const layout = computeLayout(loadFixture('block-1000x800'));
      expect(labels(renderView(layout, 'side'))).toContain('118');
      expect(labels(renderView(layout, 'end'))).toContain('100');
    });

    it('is the block height both ways where there is no bottom deck to ride over', () => {
      const layout = computeLayout(loadFixture('joined-middle-pair'));
      expect(labels(renderView(layout, 'side'))).toContain('100');
      expect(labels(renderView(layout, 'end'))).toContain('100');
    });

    it('is the block height both ways where the bottom deck runs both ways', () => {
      // The m-pallet's bottom deck crosses the width at the ends and runs the
      // length between, so there is a plank across every pocket either way on.
      const layout = computeLayout(loadFixture('m-pallet'));
      expect(labels(renderView(layout, 'side'))).toContain('100');
      expect(labels(renderView(layout, 'end'))).toContain('100');
    });

    it('is not floored by a plank that only laps the mouth of the pocket', () => {
      // Bottom planks are cut wider than the blocks they are nailed to, so a
      // plank laps a few mm into the pocket beside it without ever being in a
      // fork's way. Widen this pallet's bottom boards from 100 to 108 and the
      // side view must still read as clear to the ground.
      const lipped = loadFixture('block-1000x800');
      const deck = lipped.layers.find((layer) => layer.kind === 'bottom_deck')!;
      if (deck.content.type !== 'sequence') throw new Error('expected a boarded bottom deck');
      deck.content.slots = deck.content.slots.map((slot) => ({ ...slot, width: 108 }));
      expect(labels(renderView(computeLayout(lipped), 'side'))).toContain('118');
    });

    it('sits inside the overall height rather than displacing it', () => {
      const layout = computeLayout(loadFixture('block-1000x800'));
      expect(labels(renderView(layout, 'end'))).toEqual(expect.arrayContaining(['100', '156']));
    });

    it('is left off a pallet that has nothing holding its deck up', () => {
      const flat = loadFixture('block-1000x800');
      flat.layers = flat.layers.filter((layer) => layer.kind !== 'block');
      const found = labels(renderView(computeLayout(flat), 'side'));
      // Only the two overall dimensions are left.
      expect(found.filter((label) => /^\d/.test(label))).toHaveLength(2);
    });
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

/**
 * The caption belongs to the drawing, not to the box the drawing came in. A
 * view's dimension lanes are not the same depth on both sides — two detail lanes
 * on the left against one overall lane on the right is ordinary — so a caption
 * centred in the box sits visibly off the drawing it names.
 */
describe('view captions', () => {
  const layout = computeLayout(loadFixture('block-1000x800'));

  /** Where the drawing sits in the view: the extent of its stroked pieces. */
  function drawing(svg: string): { left: number; right: number; centre: number } {
    const rects = [
      ...svg.matchAll(
        /<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)"[^>]*stroke="/g,
      ),
    ].map((m) => ({ x: Number(m[1]), w: Number(m[3]) }));
    const left = Math.min(...rects.map((r) => r.x));
    const right = Math.max(...rects.map((r) => r.x + r.w));
    return { left, right, centre: (left + right) / 2 };
  }

  function caption(svg: string, label: string): { x: number; y: number } {
    const m = new RegExp(`<text x="([\\d.-]+)" y="([\\d.-]+)"[^>]*>${label}</text>`).exec(svg);
    if (!m) throw new Error(`no caption "${label}"`);
    return { x: Number(m[1]), y: Number(m[2]) };
  }

  it('centres the name on the drawing, not on the view box', () => {
    const offBoxCentre: number[] = [];
    for (const view of ALL_VIEWS) {
      const svg = renderView(layout, view);
      const width = Number(/<svg[^>]*width="([\d.]+)"/.exec(svg)![1]);
      const at = caption(svg, `${view.toUpperCase()} VIEW`);
      expect(at.x).toBeCloseTo(drawing(svg).centre, 6);
      offBoxCentre.push(Math.abs(at.x - width / 2));
    }
    // The two are the same place only when a view's lanes happen to balance. At
    // least one of the four does not, or this test proves nothing: the side
    // elevation carries its height on one side and nothing on the other.
    expect(Math.max(...offBoxCentre)).toBeGreaterThan(1);
  });

  it('captions the plans above and the elevations below', () => {
    for (const view of ALL_VIEWS) {
      const svg = renderView(layout, view);
      const at = caption(svg, `${view.toUpperCase()} VIEW`);
      const box = drawing(svg);
      const height = Number(/<svg[^>]*height="([\d.]+)"/.exec(svg)![1]);
      const above = view === 'top' || view === 'bottom';
      expect(at.y < height / 2).toBe(above);
      // Clear of the drawing either way, never over it.
      expect(at.x).toBeGreaterThanOrEqual(box.left - height);
    }
  });
});
