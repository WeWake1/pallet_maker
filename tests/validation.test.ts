import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { analysePallet, computeLayout, validatePallet } from '../src/geometry/layout.js';
import { PalletLayoutError } from '../src/geometry/types.js';
import { parsePallet } from '../src/schema.js';
import type { Layer, Pallet } from '../src/types.js';
import { loadFixture, round } from './helpers.js';

const here = dirname(fileURLToPath(import.meta.url));

function sequenceLayer(pallet: Pallet, id: string): Layer {
  const layer = pallet.layers.find((l) => l.id === id);
  if (!layer || layer.content.type !== 'sequence') throw new Error(`no sequence layer ${id}`);
  return layer;
}

describe('over-full layers', () => {
  it('fails loudly and names the layer instead of overlapping boards', () => {
    const pallet = loadFixture('block-1000x800');
    const top = sequenceLayer(pallet, 'top');
    if (top.content.type === 'sequence') {
      for (const slot of top.content.slots) slot.width = 200;
    }

    expect(() => computeLayout(pallet)).toThrow(PalletLayoutError);
    const issues = validatePallet(pallet).filter((i) => i.severity === 'error');
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('over_full');
    expect(issues[0]!.layerId).toBe('top');
    // Named by what and where it is. An id means nothing to whoever reads this.
    expect(issues[0]!.message).toContain('top deck layer at position 1');
  });

  it('names the axis when a block grid is over-full', () => {
    const pallet = loadFixture('block-1000x800');
    const blocks = pallet.layers.find((l) => l.id === 'blocks')!;
    if (blocks.content.type === 'grid') {
      for (const cell of blocks.content.grid.cells.flat()) cell.widthMm = 400;
    }
    const issues = validatePallet(pallet).filter((i) => i.severity === 'error');
    expect(issues.map((i) => i.code)).toEqual(['over_full']);
    expect(issues[0]!.message).toContain('columns');
  });

  it('still returns a layout from analysePallet so the editor can show it', () => {
    const pallet = loadFixture('block-1000x800');
    const top = sequenceLayer(pallet, 'top');
    if (top.content.type === 'sequence') {
      for (const slot of top.content.slots) slot.width = 200;
    }
    const layout = analysePallet(pallet);
    expect(layout.pieces.length).toBeGreaterThan(0);
    expect(layout.issues.some((i) => i.severity === 'error')).toBe(true);
  });
});

describe('other validation', () => {
  it('rejects a board running past its own run span', () => {
    const pallet = loadFixture('wing-both-decks');
    const centre = sequenceLayer(pallet, 'centre');
    if (centre.content.type === 'sequence') {
      centre.content.slots[0]!.length = 1000;
    }
    const codes = validatePallet(pallet)
      .filter((i) => i.severity === 'error')
      .map((i) => i.code);
    expect(codes).toContain('run_overflow');
  });

  it('cannot have a part number used for two different sizes', () => {
    // Part numbers are derived from the sizes rather than typed in, so a board
    // given its own size gets its own number and there is nothing to clash.
    const pallet = loadFixture('block-1000x800');
    const centre = sequenceLayer(pallet, 'centre');
    if (centre.content.type === 'sequence') {
      centre.content.slots[1]!.width = 150;
    }
    const layout = computeLayout(pallet);
    const centres = layout.pieces.filter((p) => p.layerId === 'centre');
    expect(new Set(centres.map((p) => p.partNo)).size).toBe(2);
    expect(validatePallet(pallet).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('rejects a grid whose cells do not match its declared size', () => {
    const pallet = loadFixture('block-1000x800');
    const blocks = pallet.layers.find((l) => l.id === 'blocks')!;
    if (blocks.content.type === 'grid') blocks.content.grid.cells.pop();
    const codes = validatePallet(pallet).map((i) => i.code);
    expect(codes).toContain('grid_shape');
  });

  it('rejects two layers claiming the same order', () => {
    const pallet = loadFixture('block-1000x800');
    pallet.layers[1]!.order = pallet.layers[0]!.order;
    const codes = validatePallet(pallet)
      .filter((i) => i.severity === 'error')
      .map((i) => i.code);
    expect(codes).toContain('duplicate_order');
  });

  it('warns rather than fails when the stated height differs from the stack', () => {
    const pallet = loadFixture('block-1000x800');
    pallet.overallHeight = 160;
    const layout = computeLayout(pallet);
    expect(layout.overallHeight).toBe(160);
    expect(layout.derivedHeight).toBe(156);
    expect(layout.issues.map((i) => i.code)).toEqual(['height_override']);
  });
});

describe('nothing is hardcoded', () => {
  it('lays out a 2 x 4 grid and a 5 board deck as readily as 3 x 3 and 7', () => {
    const pallet = loadFixture('block-1000x800');
    const blocks = pallet.layers.find((l) => l.id === 'blocks')!;
    if (blocks.content.type === 'grid') {
      const grid = blocks.content.grid;
      grid.rows = 2;
      grid.cols = 4;
      const cell = grid.cells[0]![0]!;
      grid.cells = [
        [{ ...cell }, { ...cell }, { ...cell }, { ...cell }],
        [{ ...cell }, { ...cell }, { ...cell }, { ...cell }],
      ];
    }
    const layout = computeLayout(pallet);
    const placed = layout.pieces.filter((p) => p.layerId === 'blocks');
    expect(placed).toHaveLength(8);
    expect([...new Set(placed.map((p) => p.x))]).toEqual([0, 900]);
    expect(round([...new Set(placed.map((p) => p.y))])).toEqual([0, 233.333, 466.667, 700]);
  });
});

describe('the schema', () => {
  it('parses every fixture', () => {
    const dir = resolve(here, '..', 'fixtures');
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const file of files) {
      const pallet = parsePallet(JSON.parse(readFileSync(resolve(dir, file), 'utf8')));
      expect(pallet.layers.length).toBeGreaterThan(0);
    }
  });

  it('fills in the optional layout fields', () => {
    const pallet = loadFixture('block-1000x800');
    const top = pallet.layers.find((l) => l.id === 'top')!;
    expect(top.spanMm).toBeNull();
    expect(top.offsetMm).toBe(0);
    expect(top.runSpanMm).toBeNull();
    expect(top.runOffsetMm).toBe(0);
    if (top.content.type === 'sequence') {
      expect(top.content.slots[0]!.joinedToPrev).toBe(false);
      expect(top.content.slots[0]!.nudgeMm).toBe(0);
    }
  });

  it('refuses a fractional millimetre', () => {
    const pallet = JSON.parse(
      readFileSync(resolve(here, '..', 'fixtures', 'block-1000x800.json'), 'utf8'),
    );
    pallet.overallLength = 1000.5;
    expect(() => parsePallet(pallet)).toThrow(/overallLength/);
  });
});

describe('the layout engine stays framework free', () => {
  it('imports nothing but its own modules and the domain types', () => {
    const dir = resolve(here, '..', 'src', 'geometry');
    for (const file of readdirSync(dir)) {
      const source = readFileSync(resolve(dir, file), 'utf8');
      const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]!);
      for (const spec of imports) {
        expect(spec.startsWith('.')).toBe(true);
      }
    }
  });
});
