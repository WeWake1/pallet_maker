#!/usr/bin/env node
/**
 * Write the DXF of a JSON pallet.
 *
 *   npm run dxf -- fixtures/wing-both-decks.json --out out
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { palletToDxf } from '../dxf/drawing.js';
import { computeLayout } from '../geometry/layout.js';
import { parsePallet } from '../schema.js';

function main(argv: string[]): number {
  const file = argv.find((arg) => !arg.startsWith('--'));
  const outIndex = argv.indexOf('--out');
  const outDir = resolve(process.cwd(), outIndex >= 0 ? (argv[outIndex + 1] ?? 'out') : 'out');

  if (!file) {
    console.error('usage: dxf <pallet.json> [--out <dir>]');
    return 2;
  }

  const path = resolve(process.cwd(), file);
  const name = basename(path).replace(/\.json$/i, '');
  const pallet = parsePallet(JSON.parse(readFileSync(path, 'utf8')));
  const dxf = palletToDxf(computeLayout(pallet));

  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, `${name}.dxf`);
  writeFileSync(outPath, dxf, 'utf8');
  console.log(outPath);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
