import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeCosting, MM3_PER_CFT, timberVolumeMm3, toCft } from '../src/costing/costing.js';
import { DEFAULT_RATES_PATH, loadRates } from '../src/costing/load.js';
import { parseRates, rateFor } from '../src/costing/rates.js';
import type { Rates } from '../src/costing/rates.js';
import { computeLayout } from '../src/geometry/layout.js';
import { loadFixture } from './helpers.js';

const rates: Rates = parseRates({
  currency: 'INR',
  timberPerCft: { default: 800, pine: 1000, hardwood: 2000 },
  nailsPerThousand: { default: 500, 'wire nail': 1000 },
  overhead: { perPallet: 50, percentOfMaterial: 10 },
});

describe('the rates file', () => {
  it('is a file, not a number in the code', () => {
    const shipped = parseRates(JSON.parse(readFileSync(DEFAULT_RATES_PATH, 'utf8')));
    expect(shipped.timberPerCft['default']).toBeGreaterThan(0);
    expect(loadRates(DEFAULT_RATES_PATH)).toEqual(shipped);
  });

  it('falls back to the default rate for a material it has never heard of', () => {
    expect(rateFor(rates.timberPerCft, 'pine')).toBe(1000);
    expect(rateFor(rates.timberPerCft, 'PINE')).toBe(1000);
    expect(rateFor(rates.timberPerCft, 'mango')).toBe(800);
  });

  it('refuses a rates file that is not rates', () => {
    expect(() => parseRates({ timberPerCft: { default: 'free' } })).toThrow(/Invalid rates file/);
  });
});

describe('timber volume', () => {
  it('is the sum of every piece, in the units the trade uses', () => {
    const layout = computeLayout(loadFixture('block-1000x800'));
    // 7 top and 3 bottom boards 18 x 100 x 1000 or 800, 3 bearers 20 x 100 x 800,
    // 9 blocks 100 x 100 x 100.
    const expected =
      7 * 18 * 100 * 1000 + 3 * 20 * 100 * 800 + 9 * 100 * 100 * 100 + 3 * 18 * 100 * 800;
    expect(timberVolumeMm3(layout)).toBe(expected);
    expect(toCft(MM3_PER_CFT)).toBe(1);
    expect(toCft(expected)).toBeCloseTo(expected / 28_316_846.6, 9);
  });

  it('counts what the drawing shows, so a nudge changes nothing', () => {
    const plain = computeLayout(loadFixture('block-1000x800'));
    const pallet = loadFixture('block-1000x800');
    const layer = pallet.layers[0]!;
    if (layer.content.type === 'sequence') layer.content.slots[1]!.nudgeMm = 40;
    expect(timberVolumeMm3(computeLayout(pallet))).toBe(timberVolumeMm3(plain));
  });
});

describe('costing', () => {
  const pallet = loadFixture('block-1000x800');
  const layout = computeLayout(pallet);
  const costing = computeCosting(layout, rates);

  it('prices each material at its own rate', () => {
    expect(costing.materials).toHaveLength(1);
    expect(costing.materials[0]).toMatchObject({ material: 'pine', pieces: 22, ratePerCft: 1000 });
    expect(costing.timberCost).toBeCloseTo(costing.cft * 1000, 9);
  });

  it('splits a mixed pallet by material', () => {
    const mixed = loadFixture('block-1000x800');
    const blocks = mixed.layers.find((layer) => layer.kind === 'block')!;
    if (blocks.content.type === 'grid') {
      for (const cell of blocks.content.grid.cells.flat()) cell.material = 'hardwood';
    }
    const split = computeCosting(computeLayout(mixed), rates);
    expect(split.materials.map((line) => line.material).sort()).toEqual(['hardwood', 'pine']);
    expect(split.materials.find((line) => line.material === 'hardwood')!.ratePerCft).toBe(2000);
    // Same timber, dearer blocks.
    expect(split.volumeMm3).toBe(costing.volumeMm3);
    expect(split.timberCost).toBeGreaterThan(costing.timberCost);
  });

  it('prices nails by the thousand, per type', () => {
    // Counted off the drawing: 16 long and 30 short on top, 18 underneath.
    expect(costing.nailCount).toBe(16 + 30 + 18);
    expect(costing.nailCost).toBeCloseTo((64 / 1000) * 1000, 9);
  });

  it('prices the nails the drawing shows, not a number typed beside it', () => {
    const pallet = loadFixture('block-1000x800');
    const layout = computeLayout(pallet);
    const fromLines = layout.nailLines.reduce((sum, line) => sum + line.count, 0);
    expect(computeCosting(layout, rates).nailCount).toBe(fromLines);
  });

  it('adds the overhead the rates file asks for', () => {
    const expected = 50 + (costing.materialCost * 10) / 100;
    expect(costing.overhead.amount).toBeCloseTo(expected, 9);
    expect(costing.total).toBeCloseTo(costing.materialCost + expected, 9);
  });

  it('adds up', () => {
    expect(costing.materialCost).toBeCloseTo(costing.timberCost + costing.nailCost, 9);
    expect(costing.volumeMm3).toBe(timberVolumeMm3(layout));
    const fromLines = costing.materials.reduce((sum, line) => sum + line.volumeMm3, 0);
    expect(fromLines).toBe(costing.volumeMm3);
  });

  it('costs a pallet with no nails without falling over', () => {
    const bare = computeCosting({ ...layout, nailLines: [] }, rates);
    expect(bare.nailCost).toBe(0);
    expect(bare.total).toBeCloseTo(bare.timberCost * 1.1 + 50, 9);
  });
});
