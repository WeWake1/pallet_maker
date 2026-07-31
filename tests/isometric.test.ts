import { describe, expect, it } from 'vitest';
import { computeLayout } from '../src/geometry/layout.js';
import type { PlacedPiece } from '../src/geometry/types.js';
import { isoBounds, isoFaces, orderForPainter, projectIso } from '../src/render/isometric.js';
import { renderIsometric } from '../src/render/isoView.js';
import { renderView } from '../src/render/views.js';
import { loadFixture } from './helpers.js';

const COS30 = Math.cos(Math.PI / 6);

/** The same screen box the renderer works out, computed independently here. */
function box(p: PlacedPiece) {
  const b = isoBounds([p]);
  return { x0: b.minSx, x1: b.maxSx, y0: b.minSy, y1: b.maxSy };
}

function overlaps(a: PlacedPiece, b: PlacedPiece): boolean {
  const p = box(a);
  const q = box(b);
  return p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1;
}

describe('the isometric projection', () => {
  it('is a standard 30 degree axonometric', () => {
    expect(projectIso(0, 0, 0)).toEqual({ sx: 0, sy: 0 });
    // Length runs down and to the right, width down and to the left.
    expect(projectIso(1000, 0, 0).sx).toBeCloseTo(1000 * COS30, 6);
    expect(projectIso(1000, 0, 0).sy).toBeCloseTo(500, 6);
    expect(projectIso(0, 1000, 0).sx).toBeCloseTo(-1000 * COS30, 6);
    // Height runs up the page.
    expect(projectIso(0, 0, 100)).toEqual({ sx: 0, sy: -100 });
  });

  it('gives three visible faces per piece, four corners each', () => {
    const layout = computeLayout(loadFixture('block-1000x800'));
    const faces = isoFaces(layout.pieces[0]!);
    expect(faces.map((f) => f.name)).toEqual(['left', 'right', 'top']);
    expect(faces.every((f) => f.points.length === 4)).toBe(true);
  });
});

describe('painter ordering', () => {
  const layout = computeLayout(loadFixture('block-1000x800'));
  const ordered = orderForPainter(layout.pieces);
  const at = (piece: PlacedPiece): number => ordered.indexOf(piece);

  it('keeps every piece exactly once', () => {
    expect(ordered).toHaveLength(layout.pieces.length);
    expect(new Set(ordered).size).toBe(layout.pieces.length);
  });

  it('draws anything lower before what covers it, whatever its depth', () => {
    // A scalar depth sort gets this wrong: the far end of a long deck board is
    // deeper than a bearer at the near end, so the bearer would be painted over
    // the board it sits under.
    const bearer = layout.pieces.find((p) => p.layerKind === 'bearer' && p.x === 900)!;
    const board = layout.pieces.find((p) => p.layerKind === 'top_deck' && p.y === 700)!;
    expect(bearer.x + bearer.y + bearer.z).toBeGreaterThan(board.x + board.y + board.z);
    expect(at(bearer)).toBeLessThan(at(board));
  });

  it('holds that ordering for every overlapping pair in the drawing', () => {
    const behind = (a: PlacedPiece, b: PlacedPiece): boolean =>
      a.z + a.dz <= b.z || a.x + a.dx <= b.x || a.y + a.dy <= b.y;

    let checked = 0;
    for (const a of layout.pieces) {
      for (const b of layout.pieces) {
        if (a === b || !overlaps(a, b)) continue;
        // Pieces that read as behind each other on different axes are diagonal
        // to one another and their real silhouettes never meet, however much
        // their screen boxes overlap. Neither order is wrong.
        if (!behind(a, b) || behind(b, a)) continue;
        expect(at(a)).toBeLessThan(at(b));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });
});

describe('the isometric view', () => {
  const layout = computeLayout(loadFixture('wing-both-decks'));

  it('shows the wing overhanging the base on both sides', () => {
    const deck = isoBounds(layout.pieces.filter((p) => p.layerKind === 'top_deck'));
    const base = isoBounds(layout.pieces.filter((p) => p.layerKind === 'block'));
    expect(deck.minSx).toBeLessThan(base.minSx);
    expect(deck.maxSx).toBeGreaterThan(base.maxSx);
    expect(deck.maxSy).toBeGreaterThan(base.maxSy - layout.overallHeight);
  });

  it('draws three faces for every piece and no nail dots', () => {
    const svg = renderIsometric(layout);
    expect((svg.match(/<polygon/g) ?? []).length).toBe(layout.pieces.length * 3);
    expect(svg).not.toContain('<circle');
    expect(svg).toContain('ISOMETRIC');
  });

  it('steps the three faces in tone so the form survives greyscale', () => {
    const svg = renderIsometric(layout);
    const fills = new Set([...svg.matchAll(/<polygon[^>]*fill="([^"]+)"/g)].map((m) => m[1]!));
    // One tone per face per layer kind, all distinct.
    expect(fills.size).toBe(4 * 3);
  });

  it('keeps its ids clear of the flat views', () => {
    const all = [
      renderIsometric(layout, { greyscale: true }),
      renderView(layout, 'top', { greyscale: true }),
    ].flatMap((svg) => [...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!));
    expect(new Set(all).size).toBe(all.length);
  });

  it('takes a forced scale, in the same px per mm as the flat views', () => {
    const svg = renderIsometric(layout, { scale: 0.25 });
    const width = Number(/width="([\d.]+)"/.exec(svg)![1]);
    const bounds = isoBounds(layout.pieces);
    // Coordinates are written to 2 decimals, which is finer than any printer.
    expect(width).toBeCloseTo((bounds.maxSx - bounds.minSx) * 0.25 + 20, 1);
  });

  it('renders every fixture without throwing', () => {
    for (const name of [
      'block-1000x800',
      'two-top-widths',
      'joined-middle-pair',
      'wide-centre-block-row',
      'wing-both-decks',
      'nudged-top-board',
    ]) {
      const svg = renderIsometric(computeLayout(loadFixture(name)));
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg.endsWith('</svg>')).toBe(true);
    }
  });
});
