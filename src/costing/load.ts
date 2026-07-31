import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseRates } from './rates.js';
import type { Rates } from './rates.js';

/**
 * Reading the rates file. Node only: the editor is served the rates over the
 * API instead, so that one file stays the only place a rate is written down.
 */

export const DEFAULT_RATES_PATH = resolve(process.cwd(), 'config', 'rates.json');

export function loadRates(path: string = process.env.PALLET_RATES ?? DEFAULT_RATES_PATH): Rates {
  return parseRates(JSON.parse(readFileSync(path, 'utf8')));
}
