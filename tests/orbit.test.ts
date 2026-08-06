import { describe, expect, it } from 'vitest';
import { computeLayout } from '../src/geometry/layout.js';
import type { PlacedPiece } from '../src/geometry/types.js';
import { projectIso } from '../src/render/isometric.js';
import {
  ISO_ORIENTATION,
  MAX_PITCH,
  boundsOf,
  modelExtent,
  orderForOrbit,
  project,
  viewFor,
  visibleFaces,
} from '../src/render/orbit.js';
import type { Orientation } from '../src/render/orbit.js';
import { renderOrbit } from '../src/render/orbitView.js';
import { renderView } from '../src/render/views.js';
import { loadFixture } from './helpers.js';

const layout = computeLayout(loadFixture('block-1000x800'));

/**
 * Orthographic foreshortening along (1, 1, 1). The printed isometric draws its
 * axes at full length instead, so the two differ by exactly this and nothing
 * else — which is what makes the 3D view open on the drawing that is already
 * on the sheet rather than on something merely similar.
 */
const ISO_SCALE = Math.sqrt(3 / 2);

describe('the free axonometric', () => {
  it('is the printed isometric at its default orientation, to a uniform scale', () => {
    const view = viewFor(ISO_ORIENTATION);
    for (const [x, y, z] of [
      [0, 0, 0],
      [1000, 0, 0],
      [0, 800, 0],
      [0, 0, 140],
      [1000, 800, 140],
      [317, 604, 55],
    ]) {
      const free = project(view, x!, y!, z!);
      const fixed = projectIso(x!, y!, z!);
      expect(free.sx * ISO_SCALE).toBeCloseTo(fixed.sx, 9);
      expect(free.sy * ISO_SCALE).toBeCloseTo(fixed.sy, 9);
    }
  });

  it('keeps a millimetre the same length wherever it is', () => {
    const view = viewFor({ yaw: 1.1, pitch: 0.4 });
    const near = project(view, 0, 0, 0);
    const far = project(view, 1000, 0, 0);
    const offset = project(view, 900, 800, 140);
    const alsoOffset = project(view, 1900, 800, 140);
    expect(Math.hypot(far.sx - near.sx, far.sy - near.sy)).toBeCloseTo(
      Math.hypot(alsoOffset.sx - offset.sx, alsoOffset.sy - offset.sy),
      9,
    );
  });

  it('turns the pallet, not the light: height still runs up the page', () => {
    for (const yaw of [0, 0.7, 2.5, -1.9]) {
      const view = viewFor({ yaw, pitch: 0.6 });
      const floor = project(view, 400, 400, 0);
      const ceiling = project(view, 400, 400, 140);
      expect(ceiling.sy).toBeLessThan(floor.sy);
    }
  });
});

describe('which faces show', () => {
  const piece = layout.pieces[0]!;

  it('shows the deck face from above and the underside from below', () => {
    const above = visibleFaces(piece, viewFor({ yaw: 0.8, pitch: 0.6 }));
    const below = visibleFaces(piece, viewFor({ yaw: 0.8, pitch: -0.6 }));
    // The face square to the height, taken at whichever end the eye is on.
    const top = (faces: ReturnType<typeof visibleFaces>): number =>
      faces.find((f) => f.name === 'top')!.points[0]!.sy;
    // Seen from above that face is the highest thing on the piece, so it is the
    // furthest up the page; seen from below it is the lowest.
    expect(top(above)).toBeLessThan(top(below));
  });

  it('gives three faces of four corners each, whatever the angle', () => {
    for (const orientation of [
      ISO_ORIENTATION,
      { yaw: 0, pitch: 0 },
      { yaw: -2.2, pitch: -1.1 },
      { yaw: 3.9, pitch: MAX_PITCH },
    ]) {
      const faces = visibleFaces(piece, viewFor(orientation));
      expect(faces.map((f) => f.name)).toEqual(['left', 'right', 'top']);
      expect(faces.every((f) => f.points.length === 4)).toBe(true);
    }
  });
});

describe('painter ordering from anywhere', () => {
  /** The same behind-ness the renderer works out, decided independently here. */
  function behind(a: PlacedPiece, b: PlacedPiece, eye: { x: number; y: number; z: number }) {
    const far = (a0: number, da: number, b0: number, db: number, e: number): boolean =>
      e > 1e-6 ? a0 + da <= b0 : e < -1e-6 ? a0 >= b0 + db : false;
    return (
      far(a.x, a.dx, b.x, b.dx, eye.x) ||
      far(a.y, a.dy, b.y, b.dy, eye.y) ||
      far(a.z, a.dz, b.z, b.dz, eye.z)
    );
  }

  function overlaps(a: PlacedPiece, b: PlacedPiece, view: ReturnType<typeof viewFor>) {
    const p = boundsOf([a], view);
    const q = boundsOf([b], view);
    return p.minSx < q.maxSx && q.minSx < p.maxSx && p.minSy < q.maxSy && q.minSy < p.maxSy;
  }

  const orientations: Orientation[] = [
    ISO_ORIENTATION,
    { yaw: Math.PI / 4 + Math.PI, pitch: 0.6 },
    { yaw: -1.2, pitch: -0.9 },
    { yaw: 2.7, pitch: 0.15 },
  ];

  it('keeps every piece exactly once, from every angle', () => {
    for (const orientation of orientations) {
      const ordered = orderForOrbit(layout.pieces, viewFor(orientation));
      expect(ordered).toHaveLength(layout.pieces.length);
      expect(new Set(ordered).size).toBe(layout.pieces.length);
    }
  });

  it('draws what is behind first, for every overlapping pair, from every angle', () => {
    for (const orientation of orientations) {
      const view = viewFor(orientation);
      const ordered = orderForOrbit(layout.pieces, view);
      const at = (piece: PlacedPiece): number => ordered.indexOf(piece);

      let checked = 0;
      for (const a of layout.pieces) {
        for (const b of layout.pieces) {
          if (a === b || !overlaps(a, b, view)) continue;
          // Pieces that read as behind each other on different axes are
          // diagonal to one another and their real silhouettes never meet.
          if (!behind(a, b, view.eye) || behind(b, a, view.eye)) continue;
          expect(at(a)).toBeLessThan(at(b));
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(20);
    }
  });

  it('reverses when the eye moves to the opposite corner', () => {
    const front = orderForOrbit(layout.pieces, viewFor({ yaw: Math.PI / 4, pitch: 0.6 }));
    const back = orderForOrbit(
      layout.pieces,
      viewFor({ yaw: Math.PI / 4 + Math.PI, pitch: -0.6 }),
    );
    // A block sits under the deck. Seen from above the block goes down first;
    // seen from underneath the deck does.
    const block = layout.pieces.find((p) => p.layerKind === 'block')!;
    const board = layout.pieces.find((p) => p.layerKind === 'top_deck')!;
    expect(front.indexOf(block)).toBeLessThan(front.indexOf(board));
    expect(back.indexOf(board)).toBeLessThan(back.indexOf(block));
  });
});

describe('the 3D view', () => {
  const size = { width: 400, height: 320 };

  it('draws three faces per piece and takes the size it is given', () => {
    const svg = renderOrbit(layout, { orientation: ISO_ORIENTATION, ...size });
    expect((svg.match(/<polygon/g) ?? []).length).toBe(layout.pieces.length * 3);
    expect(svg).toContain(`width="${size.width}"`);
    expect(svg).toContain(`height="${size.height}"`);
  });

  it('holds that size at every angle, so the drawing does not jump while it is turned', () => {
    const spans = new Set<string>();
    for (let yaw = 0; yaw < 2 * Math.PI; yaw += Math.PI / 8) {
      const svg = renderOrbit(layout, { orientation: { yaw, pitch: 0.5 }, ...size });
      spans.add(/width="([\d.]+)" height="([\d.]+)"/.exec(svg)![0]);
    }
    expect(spans.size).toBe(1);
  });

  it('never puts a corner outside the drawing, whatever the angle', () => {
    // The scale is fitted to the pallet's longest diagonal rather than to what
    // it happens to project to, which is what guarantees this.
    for (let yaw = 0; yaw < 2 * Math.PI; yaw += Math.PI / 6) {
      for (const pitch of [-MAX_PITCH, -0.4, 0, 0.4, MAX_PITCH]) {
        const svg = renderOrbit(layout, { orientation: { yaw, pitch }, ...size });
        for (const match of svg.matchAll(/points="([^"]+)"/g)) {
          for (const pair of match[1]!.split(' ')) {
            const [x, y] = pair.split(',').map(Number) as [number, number];
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThanOrEqual(size.width);
            expect(y).toBeGreaterThanOrEqual(0);
            expect(y).toBeLessThanOrEqual(size.height);
          }
        }
      }
    }
  });

  it('zooms about the middle of the pallet', () => {
    const extent = modelExtent(layout.pieces);
    const centre = boundsOf(layout.pieces, viewFor(ISO_ORIENTATION));
    expect(extent.x1 - extent.x0).toBeGreaterThan(0);
    expect(centre.maxSx).toBeGreaterThan(centre.minSx);

    const plain = renderOrbit(layout, { orientation: ISO_ORIENTATION, ...size });
    const zoomed = renderOrbit(layout, { orientation: ISO_ORIENTATION, ...size, zoom: 2 });
    const span = (svg: string): number => {
      const xs = [...svg.matchAll(/points="([^"]+)"/g)].flatMap((m) =>
        m[1]!.split(' ').map((pair) => Number(pair.split(',')[0])),
      );
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(span(zoomed)).toBeCloseTo(span(plain) * 2, 0);
  });

  it('tags pieces for selection only when asked, as the flat views do', () => {
    const plain = renderOrbit(layout, { orientation: ISO_ORIENTATION, ...size });
    expect(plain).not.toContain('data-piece');

    const live = renderOrbit(layout, {
      orientation: ISO_ORIENTATION,
      ...size,
      interactive: true,
      selectedPiece: 3,
    });
    expect([...live.matchAll(/data-piece="/g)]).toHaveLength(layout.pieces.length);
    expect(live).toContain('stroke-dasharray');
  });

  it('keeps its ids clear of the flat views', () => {
    const all = [
      renderOrbit(layout, { orientation: ISO_ORIENTATION, ...size, idPrefix: 'sheet' }),
      renderView(layout, 'top', { greyscale: true, idPrefix: 'sheet' }),
    ].flatMap((svg) => [...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!));
    expect(new Set(all).size).toBe(all.length);
  });

  it('draws nothing rather than throwing when there is nothing to draw', () => {
    const empty = { ...layout, pieces: [] };
    const svg = renderOrbit(empty, { orientation: ISO_ORIENTATION, ...size });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).not.toContain('<polygon');
  });

  it('renders every fixture without throwing', () => {
    for (const name of [
      'block-1000x800',
      'two-top-widths',
      'joined-middle-pair',
      'wide-centre-block-row',
      'wing-both-decks',
      'nudged-top-board',
      'plywood-type3',
      'stringer-2way',
    ]) {
      const svg = renderOrbit(computeLayout(loadFixture(name)), {
        orientation: { yaw: 1.3, pitch: 0.35 },
        ...size,
      });
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg.endsWith('</svg>')).toBe(true);
    }
  });

  /**
   * Turning the pallet over is what this view is for, so the nails follow the
   * eye: raised above the deck it shows what is nailed down from above, dropped
   * below it shows what is nailed up from beneath.
   */
  it('shows the nails of whichever face the eye has been dragged round to', () => {
    const dots = (svg: string): number => (svg.match(/<circle/g) ?? []).length;
    const top = layout.nailDots.filter((dot) => dot.face === 'top').length;
    const bottom = layout.nailDots.filter((dot) => dot.face === 'bottom').length;
    expect(top).not.toBe(bottom);

    const above = renderOrbit(layout, { orientation: { yaw: 0.7, pitch: 0.6 }, ...size });
    const below = renderOrbit(layout, { orientation: { yaw: 0.7, pitch: -0.6 }, ...size });
    expect(dots(above)).toBe(top);
    expect(dots(below)).toBe(bottom);
  });
});

describe('screen emphasis', () => {
  it('leaves the printed views exactly as they were', () => {
    expect(renderView(layout, 'top')).toBe(renderView(layout, 'top', { emphasis: 'print' }));
  });

  it('brings the layers under the top one up where they can be read', () => {
    const printed = renderView(layout, 'top');
    const onScreen = renderView(layout, 'top', { emphasis: 'screen' });
    const faintest = (svg: string): number =>
      Math.min(...[...svg.matchAll(/\sopacity="([\d.]+)"/g)].map((m) => Number(m[1])));
    expect(faintest(printed)).toBeCloseTo(0.3, 6);
    expect(faintest(onScreen)).toBeGreaterThan(0.8);
  });

  it('leaves the layer the view is of solid, with nothing drawn over it', () => {
    // On paper a bearer is outlined through the deck boards above it, so the
    // run of the bearers can be read off a printed top view. On screen the deck
    // is what is being positioned, so it stays solid and the bearers are seen
    // through the gaps — which is what you would see standing over the pallet.
    const printed = renderView(layout, 'top');
    const onScreen = renderView(layout, 'top', { emphasis: 'screen' });
    expect(printed).toContain('clip-path');
    expect(onScreen).not.toContain('clip-path');
    expect(onScreen).not.toContain('fill="none"');
  });

  it('draws every piece exactly once on screen, however the layers overlap', () => {
    const onScreen = renderView(layout, 'top', { emphasis: 'screen', interactive: true });
    expect([...onScreen.matchAll(/<rect /g)]).toHaveLength(layout.pieces.length + 1);
  });
});
