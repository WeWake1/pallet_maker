import { describe, expect, it } from 'vitest';
import { computeLayout } from '../src/geometry/layout.js';
import type { Layout } from '../src/geometry/types.js';
import { renderIsometric } from '../src/render/isoView.js';
import { ISO_ORIENTATION } from '../src/render/orbit.js';
import { renderThumbnail, thumbnailScale } from '../src/render/thumbnail.js';
import { loadFixture } from './helpers.js';

/**
 * The picture on a design card: the sheet's isometric at card size, and the
 * turn the pointer gives it.
 */

const box = { width: 176, height: 100 };

/** Every corner of every polygon in the drawing, in px. */
function corners(svg: string): Array<[number, number]> {
  const found: Array<[number, number]> = [];
  for (const match of svg.matchAll(/points="([^"]+)"/g)) {
    for (const pair of match[1]!.split(' ')) {
      found.push(pair.split(',').map(Number) as [number, number]);
    }
  }
  return found;
}

function extent(points: Array<[number, number]>): { width: number; height: number } {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return {
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

// A square-ish block pallet, a pallet twice as long as it is wide, and a
// stringer pallet with notches: the shapes a shelf of them is made of.
const fixtures = ['block-1000x800', 'gma-48x40', 'stringer-notched', 'wing-both-decks'];

describe('the card picture', () => {
  it('keeps every corner inside the box from every angle of the turn', () => {
    for (const name of fixtures) {
      const layout = computeLayout(loadFixture(name));
      for (let turn = 0; turn < 2 * Math.PI; turn += Math.PI / 12) {
        for (const [x, y] of corners(renderThumbnail(layout, { ...box, turn }))) {
          expect(x, `${name} at ${turn.toFixed(2)}`).toBeGreaterThanOrEqual(0);
          expect(x, `${name} at ${turn.toFixed(2)}`).toBeLessThanOrEqual(box.width);
          expect(y, `${name} at ${turn.toFixed(2)}`).toBeGreaterThanOrEqual(0);
          expect(y, `${name} at ${turn.toFixed(2)}`).toBeLessThanOrEqual(box.height);
        }
      }
    }
  });

  it('is the isometric on the sheet, at card size', () => {
    // The same drawing, so the same outline: its width against its height is
    // a fact about the viewpoint, and the two viewpoints are one.
    const layout = computeLayout(loadFixture('block-1000x800'));
    const card = extent(corners(renderThumbnail(layout, box)));
    const sheet = extent(corners(renderIsometric(layout, { title: false })));
    expect(card.width / card.height).toBeCloseTo(sheet.width / sheet.height, 2);
  });

  it('fills the box, whichever way the pallet is long', () => {
    // A pallet is wider than it is tall from this height, so the box's height
    // is what it runs out of; the drawing should come close to it without
    // leaning on the edge.
    for (const name of fixtures) {
      const layout = computeLayout(loadFixture(name));
      const drawn = extent(corners(renderThumbnail(layout, box)));
      expect(drawn.height, name).toBeGreaterThan(box.height * 0.7);
      expect(drawn.width, name).toBeLessThanOrEqual(box.width * 0.95);
    }
  });

  it('holds the same scale while it turns, so the pallet does not swell', () => {
    const layout = computeLayout(loadFixture('gma-48x40'));
    const scale = thumbnailScale(layout, box.width, box.height);
    // The eye keeps its height, so an upright edge is upright on screen from
    // every angle and always the same length: the piece's height, foreshortened
    // by the pitch, at the scale. The tallest of them is the tallest piece.
    const tallest = Math.max(...layout.pieces.map((p) => p.dz));
    const expected = tallest * Math.cos(ISO_ORIENTATION.pitch) * scale;
    for (const turn of [0, 0.9, 2.2, 4.1, 5.5]) {
      const svg = renderThumbnail(layout, { ...box, turn });
      let longestUpright = 0;
      for (const match of svg.matchAll(/points="([^"]+)"/g)) {
        const pts = match[1]!.split(' ').map((p) => p.split(',').map(Number) as [number, number]);
        for (let i = 0; i < pts.length; i++) {
          const [ax, ay] = pts[i]!;
          const [bx, by] = pts[(i + 1) % pts.length]!;
          if (ax === bx) longestUpright = Math.max(longestUpright, Math.abs(by - ay));
        }
      }
      expect(longestUpright).toBeCloseTo(expected, 1);
    }
  });

  it('draws no nails and no title', () => {
    const layout = computeLayout(loadFixture('block-1000x800'));
    const svg = renderThumbnail(layout, box);
    expect(svg).not.toContain('<circle');
    expect(svg).not.toContain('<title');
    expect(svg).toContain(`width="${box.width}"`);
    expect(svg).toContain(`height="${box.height}"`);
  });

  it('is a blank of the right size for a design with nothing in it', () => {
    const empty: Layout = { ...computeLayout(loadFixture('block-1000x800')), pieces: [] };
    const svg = renderThumbnail(empty, box);
    expect(svg).not.toContain('<polygon');
    expect(svg).toContain(`width="${box.width}"`);
  });
});
