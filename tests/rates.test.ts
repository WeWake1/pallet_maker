import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_RATES_PATH } from '../src/costing/load.js';
import { ratesResolver } from '../src/costing/resolve.js';
import { cleanupStores, tempStore } from './helpers.js';

/**
 * Which prices a design is costed at.
 *
 * The folder is shared, so a price written there is the price everybody quotes
 * at. The failure worth guarding against is not a missing file — it is somebody
 * quoting at prices they were never told they were quoting at.
 */

afterEach(() => {
  cleanupStores();
  vi.restoreAllMocks();
});

const builtIn = DEFAULT_RATES_PATH;

describe('the prices in use', () => {
  it('are the ones that ship with the program when the folder has none', () => {
    const folder = tempStore();
    const inUse = ratesResolver(() => folder.root, builtIn)();
    expect(inUse.from).toBe('built-in');
    expect(inUse.problem).toBeNull();
    expect(inUse.rates.currency).toBe('INR');
  });

  it('are the ones in the folder when it has some', () => {
    const folder = tempStore();
    const shared = JSON.parse(JSON.stringify(ratesResolver(() => folder.root, builtIn)().rates));
    shared.timberPerCft.default = 999;
    writeFileSync(join(folder.root, 'rates.json'), JSON.stringify(shared));

    const inUse = ratesResolver(() => folder.root, builtIn)();
    expect(inUse.from).toBe('folder');
    expect(inUse.rates.timberPerCft.default).toBe(999);
  });

  /**
   * The one that matters. Falling back quietly would have somebody quoting at
   * the prices this version was built with while believing they were quoting at
   * the folder's.
   */
  it('say so loudly when the ones in the folder cannot be read', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const folder = tempStore();
    writeFileSync(join(folder.root, 'rates.json'), '{ not json');

    const inUse = ratesResolver(() => folder.root, builtIn)();
    expect(inUse.from).toBe('built-in');
    expect(inUse.problem).toMatch(/could not be read/);
    // Costing still works, so a broken price list does not stop the day.
    expect(inUse.rates.currency).toBe('INR');
  });

  it('follow the folder being changed', () => {
    const first = tempStore();
    const second = tempStore();
    const shared = JSON.parse(JSON.stringify(ratesResolver(() => first.root, builtIn)().rates));
    shared.timberPerCft.default = 777;
    writeFileSync(join(second.root, 'rates.json'), JSON.stringify(shared));

    let root = first.root;
    const inUse = ratesResolver(() => root, builtIn);
    expect(inUse().from).toBe('built-in');
    root = second.root;
    expect(inUse().rates.timberPerCft.default).toBe(777);
  });

  it('pick up an edit to the shared prices without a restart', () => {
    const folder = tempStore();
    const path = join(folder.root, 'rates.json');
    const shared = JSON.parse(JSON.stringify(ratesResolver(() => folder.root, builtIn)().rates));

    shared.timberPerCft.default = 100;
    writeFileSync(path, JSON.stringify(shared));
    const inUse = ratesResolver(() => folder.root, builtIn);
    expect(inUse().rates.timberPerCft.default).toBe(100);

    shared.timberPerCft.default = 200;
    writeFileSync(path, JSON.stringify(shared, null, 2));
    expect(inUse().rates.timberPerCft.default).toBe(200);
  });

  it('manage without a folder at all', () => {
    const inUse = ratesResolver(() => null, builtIn)();
    expect(inUse.from).toBe('built-in');
    expect(inUse.problem).toBeNull();
  });
});
