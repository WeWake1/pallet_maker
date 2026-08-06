#!/usr/bin/env node
/**
 * Write the specification sheet for a JSON pallet, as HTML and as PDF.
 *
 *   npm run sheet -- fixtures/wing-both-decks.json
 *   npm run sheet -- fixtures/block-1000x800.json --out out --greyscale
 *   npm run sheet -- fixtures/block-1000x800.json --html-only
 *   npm run sheet -- fixtures/block-1000x800.json --svg
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { analysePallet } from '../geometry/layout.js';
import { parsePallet } from '../schema.js';
import { exportPdf } from '../sheet/pdf.js';
import { renderSheet } from '../sheet/sheet.js';
import { renderSheetSvg } from '../sheet/svgSheet.js';

async function main(argv: string[]): Promise<number> {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const file = argv.find((a) => !a.startsWith('--'));
  const outIndex = argv.indexOf('--out');
  const outDir = resolve(process.cwd(), outIndex >= 0 ? (argv[outIndex + 1] ?? 'out') : 'out');

  if (!file) {
    console.error(
      'usage: sheet <pallet.json> [--out <dir>] [--greyscale] [--html-only] [--svg]',
    );
    return 2;
  }

  const path = resolve(process.cwd(), file);
  const name = basename(path).replace(/\.json$/i, '');
  const pallet = parsePallet(JSON.parse(readFileSync(path, 'utf8')));
  const layout = analysePallet(pallet);

  for (const issue of layout.issues) {
    console.error(`${issue.severity === 'error' ? 'ERROR' : 'warning'}: ${issue.message}`);
  }
  if (layout.issues.some((issue) => issue.severity === 'error')) {
    console.error('Refusing to print a sheet for a pallet that does not lay out.');
    return 1;
  }

  const suffix = flags.has('--greyscale') ? '-grey' : '';
  const html = renderSheet(pallet, layout, { greyscale: flags.has('--greyscale') });

  mkdirSync(outDir, { recursive: true });
  const htmlPath = resolve(outDir, `${name}${suffix}-sheet.html`);
  writeFileSync(htmlPath, html, 'utf8');
  console.log(htmlPath);

  if (flags.has('--svg')) {
    const svgPath = resolve(outDir, `${name}${suffix}-sheet.svg`);
    writeFileSync(svgPath, renderSheetSvg(pallet, layout, { greyscale: flags.has('--greyscale') }), 'utf8');
    console.log(svgPath);
  }

  if (!flags.has('--html-only')) {
    const pdfPath = resolve(outDir, `${name}${suffix}-sheet.pdf`);
    await exportPdf(html, pdfPath);
    console.log(pdfPath);
  }

  return 0;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  },
);
