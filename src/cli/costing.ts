#!/usr/bin/env node
/**
 * Timber volume and cost for a JSON pallet, at the rates in the config file.
 *
 *   npm run costing -- fixtures/block-1000x800.json
 *   npm run costing -- fixtures/block-1000x800.json --json
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeCosting } from '../costing/costing.js';
import { loadRates } from '../costing/load.js';
import { computeLayout } from '../geometry/layout.js';
import { parsePallet } from '../schema.js';

function main(argv: string[]): number {
  const file = argv.find((arg) => !arg.startsWith('--'));
  if (!file) {
    console.error('usage: costing <pallet.json> [--json]');
    return 2;
  }

  const pallet = parsePallet(
    JSON.parse(readFileSync(resolve(process.cwd(), file), 'utf8')),
  );
  const costing = computeCosting(pallet, computeLayout(pallet), loadRates());

  if (argv.includes('--json')) {
    console.log(JSON.stringify(costing, null, 2));
    return 0;
  }

  const money = (value: number): string =>
    `${costing.currency} ${value.toFixed(2).padStart(9)}`;

  console.log(
    [pallet.palletCode, pallet.palletName, pallet.updatedAt].filter((part) => part !== '').join(' '),
  );
  console.log('');
  console.log(`Timber  ${costing.cft.toFixed(3)} cft`);
  for (const line of costing.materials) {
    console.log(
      `  ${line.material.padEnd(12)} ${line.pieces.toString().padStart(3)} pcs  ` +
        `${line.cft.toFixed(3).padStart(7)} cft @ ${line.ratePerCft}  ${money(line.cost)}`,
    );
  }
  console.log(`  ${'timber'.padEnd(12)} ${' '.repeat(22)}${money(costing.timberCost)}`);
  console.log('');
  console.log(`Nails   ${costing.nailCount}`);
  for (const line of costing.nails) {
    console.log(
      `  ${line.label.padEnd(28)} ${line.count.toString().padStart(4)} @ ` +
        `${line.ratePerThousand}/1000  ${money(line.cost)}`,
    );
  }
  console.log(`  ${'nails'.padEnd(28)} ${' '.repeat(19)}${money(costing.nailCost)}`);
  console.log('');
  console.log(
    `Overhead  ${costing.overhead.perPallet} per pallet + ` +
      `${costing.overhead.percentOfMaterial}%  ${money(costing.overhead.amount)}`,
  );
  console.log(`Total ${' '.repeat(28)}${money(costing.total)}`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
