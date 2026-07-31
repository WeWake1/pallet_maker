#!/usr/bin/env node
/**
 * Write the flat views of a JSON pallet to SVG files.
 *
 *   npm run views -- fixtures/wing-both-decks.json
 *   npm run views -- fixtures/block-1000x800.json --out out
 *
 * Each view is written twice, in colour and desaturated, and an HTML contact
 * sheet puts them side by side so the greyscale check is a glance rather than a
 * chore. If the near layer stops reading as the near layer in the grey column,
 * the weights are wrong.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { analysePallet } from '../geometry/layout.js';
import type { Layout } from '../geometry/types.js';
import { renderView } from '../render/views.js';
import { ISO_TITLE, renderIsometric } from '../render/isoView.js';
import type { ViewKind } from '../render/project.js';
import { VIEW_TITLE } from '../render/project.js';
import { esc } from '../render/svg.js';
import { parsePallet } from '../schema.js';
import type { Pallet } from '../types.js';
import { readFileSync } from 'node:fs';

const VIEWS: ViewKind[] = ['top', 'bottom', 'side', 'end'];

function main(argv: string[]): number {
  const args = argv.filter((a) => !a.startsWith('--'));
  const file = args[0];
  const outIndex = argv.indexOf('--out');
  const outDir = resolve(process.cwd(), outIndex >= 0 ? (argv[outIndex + 1] ?? 'out') : 'out');

  if (!file) {
    console.error('usage: views <pallet.json> [--out <dir>]');
    return 2;
  }

  const path = resolve(process.cwd(), file);
  const name = basename(path).replace(/\.json$/i, '');
  const pallet = parsePallet(JSON.parse(readFileSync(path, 'utf8')));
  const layout = analysePallet(pallet);

  for (const issue of layout.issues) {
    console.error(`${issue.severity === 'error' ? 'ERROR' : 'warning'}: ${issue.message}`);
  }

  mkdirSync(outDir, { recursive: true });

  const rendered = [
    {
      view: 'iso',
      title: ISO_TITLE,
      colour: renderIsometric(layout),
      grey: renderIsometric(layout, { greyscale: true }),
    },
    ...VIEWS.map((view) => ({
      view,
      title: VIEW_TITLE[view],
      colour: renderView(layout, view),
      grey: renderView(layout, view, { greyscale: true }),
    })),
  ];

  for (const item of rendered) {
    writeFileSync(resolve(outDir, `${name}-${item.view}.svg`), item.colour, 'utf8');
    writeFileSync(resolve(outDir, `${name}-${item.view}-grey.svg`), item.grey, 'utf8');
  }

  const html = contactSheet(pallet, layout, rendered);
  const htmlPath = resolve(outDir, `${name}.html`);
  writeFileSync(htmlPath, html, 'utf8');

  console.log(`${rendered.length * 2} SVG files and a contact sheet written to ${outDir}`);
  console.log(htmlPath);

  return layout.issues.some((i) => i.severity === 'error') ? 1 : 0;
}

function contactSheet(
  pallet: Pallet,
  layout: Layout,
  rendered: Array<{ view: string; title: string; colour: string; grey: string }>,
): string {
  const rows = rendered
    .map(
      (item) => `
      <section>
        <h2>${esc(item.title)}</h2>
        <div class="pair">
          <figure>${item.colour}<figcaption>colour</figcaption></figure>
          <figure>${item.grey}<figcaption>greyscale</figcaption></figure>
        </div>
      </section>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(pallet.palletCode)} ${esc(pallet.palletName)} — views</title>
<style>
  body { font: 13px/1.5 'Helvetica Neue', Helvetica, Arial, sans-serif; margin: 24px; color: #1b1b1b; }
  h1 { font-size: 17px; margin: 0 0 2px; }
  p.meta { margin: 0 0 20px; color: #555; }
  h2 { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: #666; margin: 22px 0 6px; }
  .pair { display: flex; gap: 20px; flex-wrap: wrap; align-items: flex-start; }
  figure { margin: 0; border: 1px solid #ddd; padding: 6px; background: #fff; }
  figcaption { font-size: 10px; color: #888; text-align: center; padding-top: 4px; }
</style>
</head>
<body>
<h1>${esc(pallet.palletCode)} — ${esc(pallet.palletName)}</h1>
<p class="meta">${esc(pallet.clientName)} · rev ${esc(pallet.revision)} ${esc(pallet.revisionDate)}
 · ${layout.overallLength} × ${layout.overallWidth} × ${layout.overallHeight}
 · ${layout.pieces.length} pieces · ${layout.nailDots.length} nails</p>
${rows}
</body>
</html>
`;
}

process.exitCode = main(process.argv.slice(2));
