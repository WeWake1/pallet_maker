import { describe, expect, it } from 'vitest';
import { palletToDxf } from '../src/dxf/drawing.js';
import { computeLayout } from '../src/geometry/layout.js';
import { loadFixture } from './helpers.js';

/**
 * The DXF is read back with an independent parser and checked against the
 * pieces it came from. A CAD viewer is the real test, but nothing here should
 * reach one wrong.
 */

type Pair = [number, string];

function readPairs(dxf: string): Pair[] {
  const lines = dxf.split('\n');
  const pairs: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    pairs.push([Number(lines[i]!.trim()), lines[i + 1]!]);
  }
  return pairs;
}

interface Entity {
  type: string;
  layer?: string;
  pairs: Pair[];
  children: Entity[];
}

function readEntities(dxf: string): Entity[] {
  const pairs = readPairs(dxf);
  const start = pairs.findIndex(
    ([code, value], index) =>
      code === 2 && value === 'ENTITIES' && pairs[index - 1]?.[1] === 'SECTION',
  );
  const entities: Entity[] = [];
  let current: Entity | null = null;

  for (let i = start + 1; i < pairs.length; i++) {
    const [code, value] = pairs[i]!;
    if (code === 0) {
      if (value === 'ENDSEC') break;
      const entity: Entity = { type: value, pairs: [], children: [] };
      if ((value === 'VERTEX' || value === 'SEQEND') && current) current.children.push(entity);
      else {
        entities.push(entity);
        current = entity;
      }
      continue;
    }
    const target = current?.children.at(-1) ?? current;
    if (!target) continue;
    target.pairs.push([code, value]);
    if (code === 8) target.layer = value;
  }
  return entities;
}

function value(entity: Entity, code: number): string | undefined {
  return entity.pairs.find(([c]) => c === code)?.[1];
}

function declaredLayers(dxf: string): string[] {
  const pairs = readPairs(dxf);
  const names: string[] = [];
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i]![0] === 0 && pairs[i]![1] === 'LAYER') {
      const name = pairs[i + 1];
      if (name?.[0] === 2) names.push(name[1]);
    }
  }
  return names;
}

describe('the DXF', () => {
  const layout = computeLayout(loadFixture('wing-both-decks'));
  const dxf = palletToDxf(layout);
  const entities = readEntities(dxf);

  it('writes integer group codes as integers', () => {
    // A flag or a colour is an integer; a reader expecting one will not take
    // "1.0000". Coordinates and sizes stay real.
    for (const [code, value] of readPairs(dxf)) {
      if (code >= 60 && code <= 79) expect(value).toMatch(/^-?\d+$/);
      if (code === 10 || code === 20 || code === 40) expect(value).toMatch(/^-?\d+\.\d+$/);
    }
  });

  it('is R12 ASCII and ends where it should', () => {
    expect(dxf).toContain('9\n$ACADVER\n1\nAC1009');
    expect(dxf.trimEnd().endsWith('0\nEOF')).toBe(true);
    const sections = [...dxf.matchAll(/^SECTION$/gm)].length;
    const ends = [...dxf.matchAll(/^ENDSEC$/gm)].length;
    expect(sections).toBe(ends);
    expect(sections).toBe(3);
  });

  it('uses no entity R12 does not have', () => {
    // LWPOLYLINE arrived with R14. A closed outline in R12 is POLYLINE.
    expect(dxf).not.toContain('LWPOLYLINE');
    expect(new Set(entities.map((entity) => entity.type))).toEqual(
      new Set(['POLYLINE', 'LINE', 'TEXT']),
    );
  });

  it('draws one closed outline per piece, on the layer for its kind', () => {
    const outlines = entities.filter((entity) => entity.type === 'POLYLINE');
    expect(outlines).toHaveLength(layout.pieces.length);

    for (const outline of outlines) {
      expect(value(outline, 70)).toBe('1'); // closed
      const vertices = outline.children.filter((child) => child.type === 'VERTEX');
      expect(vertices).toHaveLength(4);
      expect(outline.children.at(-1)!.type).toBe('SEQEND');
    }

    expect(outlines.filter((o) => o.layer === 'TOP_BOARDS')).toHaveLength(7);
    expect(outlines.filter((o) => o.layer === 'BLOCKS')).toHaveLength(9);
    expect(outlines.filter((o) => o.layer === 'CENTRE_BOARDS')).toHaveLength(3);
    expect(outlines.filter((o) => o.layer === 'BOTTOM_BOARDS')).toHaveLength(3);
  });

  it('puts every piece exactly where the layout put it', () => {
    const outlines = entities.filter((entity) => entity.type === 'POLYLINE');
    const corners = outlines.map((outline) => {
      const points = outline.children
        .filter((child) => child.type === 'VERTEX')
        .map((vertex) => ({ x: Number(value(vertex, 10)), y: Number(value(vertex, 20)) }));
      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);
      return `${Math.min(...xs)},${Math.min(...ys)},${Math.max(...xs)},${Math.max(...ys)}`;
    });

    // Coordinates are the pallet's own, at 1:1 in millimetres.
    for (const piece of layout.pieces) {
      const expected = `${piece.x},${piece.y},${piece.x + piece.dx},${piece.y + piece.dy}`;
      expect(corners).toContain(expected);
    }
  });

  it('declares every layer it draws on', () => {
    const declared = new Set(declaredLayers(dxf));
    expect(declared).toContain('DIMENSIONS');
    for (const entity of entities) {
      expect(declared.has(entity.layer!)).toBe(true);
    }
  });

  it('writes the dimensions as text, and the same ones the sheet carries', () => {
    const labels = entities
      .filter((entity) => entity.type === 'TEXT')
      .map((entity) => value(entity, 1));
    expect(labels).toContain('1200');
    expect(labels).toContain('1000');
    expect(labels).toContain('100');
    // All four wing overhangs.
    expect(labels.filter((label) => label === '50').length).toBeGreaterThanOrEqual(4);
    expect(entities.filter((entity) => entity.type === 'TEXT').every((entity) => entity.layer === 'DIMENSIONS')).toBe(true);
  });

  it('prints the real position of a nudged board here too', () => {
    const nudged = palletToDxf(computeLayout(loadFixture('nudged-top-board')));
    const labels = readEntities(nudged)
      .filter((entity) => entity.type === 'TEXT')
      .map((entity) => value(entity, 1));
    expect(labels).toContain('141.7');
  });

  it('declares extents that contain the drawing and its dimensions', () => {
    const min = /\$EXTMIN\n10\n(-?[\d.]+)\n20\n(-?[\d.]+)/.exec(dxf)!;
    const max = /\$EXTMAX\n10\n(-?[\d.]+)\n20\n(-?[\d.]+)/.exec(dxf)!;
    expect(Number(min[1])).toBeLessThan(0);
    expect(Number(min[2])).toBeLessThan(0);
    expect(Number(max[1])).toBeGreaterThan(layout.overallLength);
    expect(Number(max[2])).toBeGreaterThan(layout.overallWidth);
  });

  it('draws every fixture without a stray entity', () => {
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
      const drawing = palletToDxf(computeLayout(loadFixture(name)));
      const parsed = readEntities(drawing);
      expect(parsed.length).toBeGreaterThan(0);
      expect(parsed.every((entity) => entity.layer !== undefined)).toBe(true);
    }
  });
});
