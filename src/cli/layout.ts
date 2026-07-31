#!/usr/bin/env node
/**
 * Load a JSON pallet document and print its PlacedPiece[].
 *
 *   npm run layout -- fixtures/block-1000x800.json
 *   npm run layout -- fixtures/wing-both-decks.json --summary
 *   npm run layout -- fixtures/block-1000x800.json --full
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { analysePallet } from '../geometry/layout.js';
import { hasOverhang } from '../geometry/footprint.js';
import type { Layout } from '../geometry/types.js';
import { parsePallet } from '../schema.js';

function main(argv: string[]): number {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const file = argv.find((a) => !a.startsWith('--'));

  if (!file) {
    console.error('usage: layout <pallet.json> [--summary] [--full]');
    return 2;
  }

  const path = resolve(process.cwd(), file);
  const pallet = parsePallet(JSON.parse(readFileSync(path, 'utf8')));
  const layout = analysePallet(pallet);

  for (const issue of layout.issues) {
    const tag = issue.severity === 'error' ? 'ERROR' : 'warning';
    console.error(`${tag}: ${issue.message}`);
  }

  if (flags.has('--summary')) {
    printSummary(layout);
  } else if (flags.has('--full')) {
    console.log(JSON.stringify(layout, null, 2));
  } else {
    console.log(JSON.stringify(layout.pieces, null, 2));
  }

  return layout.issues.some((i) => i.severity === 'error') ? 1 : 0;
}

function printSummary(layout: Layout): void {
  const n = (v: number) => (Math.round(v * 100) / 100).toString();

  console.log(
    `Overall ${n(layout.overallLength)} x ${n(layout.overallWidth)} x ${n(layout.overallHeight)}` +
      (Math.abs(layout.overallHeight - layout.derivedHeight) > 1e-6
        ? ` (stack ${n(layout.derivedHeight)})`
        : ''),
  );
  console.log('');

  for (const layer of layout.layers) {
    const spacing = layer.spread ?? layer.rows;
    const gap =
      layer.contentType === 'grid'
        ? `row gap ${n(layer.rows?.gap ?? 0)}, col gap ${n(layer.cols?.gap ?? 0)}`
        : `gap ${n(spacing?.gap ?? 0)}`;
    console.log(
      `${layer.layerId}  ${layer.kind}  z=${n(layer.zBottom)}  t=${n(layer.thickness)}  ${gap}`,
    );
    for (const p of layout.pieces.filter((piece) => piece.layerId === layer.layerId)) {
      const mark = p.nudged ? ' *nudged' : '';
      console.log(
        `    #${p.partNo}  at (${n(p.x)}, ${n(p.y)}, ${n(p.z)})  ` +
          `${n(p.dx)} x ${n(p.dy)} x ${n(p.dz)}  ${p.material}` +
          (p.variant ? ` [${p.variant}]` : '') +
          mark,
      );
    }
  }

  if (layout.base) {
    console.log('');
    console.log(
      `Base footprint  x ${n(layout.base.x0)}..${n(layout.base.x1)}  y ${n(layout.base.y0)}..${n(layout.base.y1)}`,
    );
    for (const [name, over] of [
      ['Top deck', layout.topOverhang],
      ['Bottom deck', layout.bottomOverhang],
    ] as const) {
      if (hasOverhang(over) && over) {
        console.log(
          `${name} overhang  length ${n(over.lengthStart)}/${n(over.lengthEnd)}  ` +
            `width ${n(over.widthStart)}/${n(over.widthEnd)}`,
        );
      }
    }
  }

  console.log('');
  console.log(`${layout.pieces.length} pieces`);
}

process.exitCode = main(process.argv.slice(2));
