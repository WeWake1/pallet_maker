#!/usr/bin/env node
/**
 * Does the sheet still come out the way it did?
 *
 *   npx tsx scripts/compare-sheets.ts <before dir> <after dir>
 *
 * The sheet is a document that has already gone to customers. Changing how it
 * is built — pulling one company's name out of the code and reading it off a
 * disk instead — must not change what it prints, and "must not" is worth more
 * than a glance at one drawing. So every fixture is rendered both ways, as the
 * printed page and as the vector one, and the two are compared character by
 * character.
 *
 * Each directory holds files named `<fixture>.html` and `<fixture>.svg`.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [beforeDir, afterDir] = process.argv.slice(2).map((path) => resolve(process.cwd(), path));

if (!beforeDir || !afterDir || !existsSync(beforeDir) || !existsSync(afterDir)) {
  console.error('usage: compare-sheets <before dir> <after dir>');
  process.exit(2);
}

/** The first place two strings stop agreeing, with a little either side. */
function firstDifference(before: string, after: string): string {
  const limit = Math.min(before.length, after.length);
  let at = 0;
  while (at < limit && before[at] === after[at]) at += 1;
  const from = Math.max(0, at - 60);
  return (
    `  at character ${at} of ${before.length}\n` +
    `  before: …${before.slice(from, at + 60).replace(/\n/g, '⏎')}\n` +
    `  after : …${after.slice(from, at + 60).replace(/\n/g, '⏎')}`
  );
}

const names = readdirSync(beforeDir).filter((name) => /\.(html|svg)$/.test(name)).sort();
let same = 0;
const differences: string[] = [];

for (const name of names) {
  const afterPath = join(afterDir, name);
  if (!existsSync(afterPath)) {
    differences.push(`${name}: missing from the after set`);
    continue;
  }
  const before = readFileSync(join(beforeDir, name), 'utf8');
  const after = readFileSync(afterPath, 'utf8');
  if (before === after) {
    same += 1;
    continue;
  }
  differences.push(
    `${name}: ${before.length} characters became ${after.length}\n${firstDifference(before, after)}`,
  );
}

console.log(`${same} of ${names.length} identical`);
for (const difference of differences) console.log(`\n${difference}`);
process.exitCode = differences.length === 0 ? 0 : 1;
