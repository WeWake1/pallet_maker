import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadRates } from './load.js';
import type { Rates } from './rates.js';

/**
 * Which prices a design is costed at.
 *
 * The rates ship with the program, and a `rates.json` in the designs folder
 * takes their place. That is deliberate: the folder is shared, so a price
 * written there is the price everybody quotes at, from the afternoon it is
 * saved — rather than everybody quoting at whatever their copy of the program
 * happens to have been built with.
 *
 * A rates file in the folder that will not read is **not** quietly ignored. The
 * built-in prices are used so that costing goes on working, and the problem is
 * carried out to the editor to be said out loud, because the failure worth
 * guarding against is somebody quoting last year's timber price and never being
 * told which prices they were quoting at.
 */

export const RATES_FILE = 'rates.json';

export interface RatesInUse {
  rates: Rates;
  /** Which of the two this came from, for saying so on screen. */
  from: 'folder' | 'built-in';
  /** Why the folder's rates were not used, when there are some and they failed. */
  problem: string | null;
}

interface Cached {
  mtimeMs: number;
  size: number;
  value: RatesInUse;
}

/**
 * Reads the rates, remembering them until the file changes.
 *
 * A resolver rather than a value, because both the folder and what is in it can
 * change while the program is running — somebody points at a different folder,
 * or edits the prices and lets Drive carry them over.
 */
export function ratesResolver(
  folder: () => string | null,
  builtInPath: string,
): () => RatesInUse {
  let cache: (Cached & { path: string }) | undefined;
  let builtIn: Rates | undefined;

  const readBuiltIn = (): Rates => {
    builtIn ??= loadRates(builtInPath);
    return builtIn;
  };

  return () => {
    const root = folder();
    const path = root === null ? null : join(root, RATES_FILE);

    if (path === null || !existsSync(path)) {
      return { rates: readBuiltIn(), from: 'built-in', problem: null };
    }

    const stat = statSync(path);
    if (cache && cache.path === path && cache.mtimeMs === stat.mtimeMs && cache.size === stat.size) {
      return cache.value;
    }

    let value: RatesInUse;
    try {
      value = { rates: loadRates(path), from: 'folder', problem: null };
    } catch (error) {
      value = {
        rates: readBuiltIn(),
        from: 'built-in',
        problem:
          `${path} could not be read (${
            error instanceof Error ? error.message : String(error)
          }). The prices built into this version are being used instead.`,
      };
      console.error(value.problem);
    }

    cache = { path, mtimeMs: stat.mtimeMs, size: stat.size, value };
    return value;
  };
}
