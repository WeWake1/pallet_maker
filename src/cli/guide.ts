#!/usr/bin/env node
/**
 * Write the guide, as HTML and as PDF.
 *
 *   npm run guide
 *   npm run guide -- --out out
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderGuide } from '../../docs/guide.js';
import { exportPdf } from '../sheet/pdf.js';

async function main(argv: string[]): Promise<number> {
  const outIndex = argv.indexOf('--out');
  const outDir = resolve(process.cwd(), outIndex >= 0 ? (argv[outIndex + 1] ?? 'out') : 'out');

  mkdirSync(outDir, { recursive: true });
  const html = renderGuide();
  const htmlPath = resolve(outDir, 'pallet-spec-guide.html');
  writeFileSync(htmlPath, html, 'utf8');
  console.log(htmlPath);

  if (!argv.includes('--html-only')) {
    const pdfPath = resolve(outDir, 'pallet-spec-guide.pdf');
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
