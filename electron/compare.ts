import { app } from 'electron';
import { inflateSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { analysePallet } from '../src/geometry/layout.js';
import { PalletRepository } from '../src/server/repository.js';
import { renderSheet } from '../src/sheet/sheet.js';
import { FileStore } from '../src/store/files.js';
import { printWithElectron } from './printer.js';

/**
 * Does the Chromium inside the app print the same sheet as the one on the
 * machine?
 *
 * The gate on moving printing into the app. Both are Chromium, so the answer
 * ought to be yes — but "ought to" is not something to hand a customer a
 * drawing on, and a sheet is a manufacturing document. So the marks on the page
 * are compared rather than the bytes of the file: a PDF carries a creation date
 * and an id that differ every time anything prints, and comparing those would
 * only ever say "different".
 *
 *   npm run compare:pdf -- <store folder> <folder of reference PDFs>
 */

/** Every content stream in the file, inflated: the marks that make the page. */
function contentStreams(pdf: Buffer): string {
  const out: string[] = [];
  const text = pdf.toString('latin1');
  const pattern = /stream\r?\n/g;

  let match;
  while ((match = pattern.exec(text)) !== null) {
    const from = match.index + match[0].length;
    const to = text.indexOf('endstream', from);
    if (to < 0) continue;
    const raw = pdf.subarray(from, to);
    try {
      out.push(inflateSync(raw).toString('latin1'));
    } catch {
      // Not compressed, or not a content stream — a font file, an ICC profile.
      // Those are compared by what they make on the page, not in themselves.
    }
  }
  return out.join('\n');
}

/** The strings actually drawn, in the order they are drawn. */
function drawnText(streams: string): string[] {
  return [...streams.matchAll(/\((?:\\.|[^\\()])*\)\s*Tj/g)].map((m) => m[0].slice(0, -2).trim());
}

/** How many of each drawing operator: the shape of the vector art. */
function operators(streams: string): Record<string, number> {
  const counted: Record<string, number> = {};
  for (const op of ['m', 'l', 'c', 're', 'f', 'S', 'W', 'cm', 'Tf', 'Td', 'TJ', 'Tj']) {
    counted[op] = [...streams.matchAll(new RegExp(`(?<=^|[\\s])${op}(?=[\\s]|$)`, 'gm'))].length;
  }
  return counted;
}

function pageBoxes(pdf: Buffer): number[][] {
  return [...pdf.toString('latin1').matchAll(/MediaBox\s*\[\s*([\d.\s-]+?)\]/g)].map((m) =>
    m[1]!.trim().split(/\s+/).map(Number),
  );
}

interface Marks {
  streams: string;
  text: string[];
  operators: Record<string, number>;
  boxes: number[][];
  fonts: number;
}

function marksOf(pdf: Buffer): Marks {
  const streams = contentStreams(pdf);
  return {
    streams,
    text: drawnText(streams),
    operators: operators(streams),
    boxes: pageBoxes(pdf),
    fonts: [...pdf.toString('latin1').matchAll(/\/Type\s*\/Font/g)].length,
  };
}

const REFERENCE = ['11689696', '18b345fa', '5fe22ea2', '35033f65', 'e1d62dcd'];

async function main(): Promise<number> {
  const [storeRoot, referenceDir] = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const outDir = resolve(referenceDir!, '..', 'electron-pdf');
  mkdirSync(outDir, { recursive: true });

  const pallets = new PalletRepository(new FileStore(storeRoot!));
  const all = pallets.all();
  let failures = 0;

  for (const prefix of REFERENCE) {
    const design = all.find((p) => p.id.startsWith(prefix));
    if (!design) {
      console.log(`FAIL  ${prefix} — not in the store`);
      failures += 1;
      continue;
    }

    const html = renderSheet(design, analysePallet(design), { greyscale: false });
    const printed = await printWithElectron(html);
    writeFileSync(join(outDir, `${prefix}.pdf`), printed);

    const mine = marksOf(printed);
    const theirs = marksOf(readFileSync(join(referenceDir!, `${prefix}.pdf`)));

    const checks: Array<[string, boolean, string]> = [
      ['pages', mine.boxes.length === theirs.boxes.length, `${theirs.boxes.length} -> ${mine.boxes.length}`],
      [
        'paper',
        JSON.stringify(mine.boxes) === JSON.stringify(theirs.boxes),
        `${JSON.stringify(theirs.boxes[0])} -> ${JSON.stringify(mine.boxes[0])}`,
      ],
      ['fonts embedded', mine.fonts > 0 && theirs.fonts > 0, `${theirs.fonts} -> ${mine.fonts}`],
      [
        'every string drawn',
        JSON.stringify(mine.text) === JSON.stringify(theirs.text),
        `${theirs.text.length} -> ${mine.text.length} strings`,
      ],
      [
        'every drawing operator',
        JSON.stringify(mine.operators) === JSON.stringify(theirs.operators),
        Object.keys(theirs.operators)
          .filter((op) => mine.operators[op] !== theirs.operators[op])
          .map((op) => `${op}: ${theirs.operators[op]} -> ${mine.operators[op]}`)
          .join(', '),
      ],
      ['marks identical', mine.streams === theirs.streams, `${theirs.streams.length} -> ${mine.streams.length} bytes`],
      ['no raster', !printed.toString('latin1').match(/\/Subtype\s*\/Image/), ''],
    ];

    const bad = checks.filter(([, ok]) => !ok);
    console.log(`${bad.length === 0 ? 'ok  ' : 'FAIL'}  ${prefix}  ${design.palletName}`);
    for (const [name, ok, detail] of checks) {
      if (!ok) console.log(`        ${name}: ${detail}`);
    }
    if (bad.length > 0) failures += 1;
  }

  console.log(
    failures === 0
      ? '\nThe app prints the same sheet as the browser did.'
      : `\n${failures} sheet(s) differ.`,
  );
  console.log(`PDFs written to ${outDir}`);
  return failures === 0 ? 0 : 1;
}

void app.whenReady().then(async () => {
  const code = await main().catch((error: unknown) => {
    console.error(error);
    return 1;
  });
  app.exit(code);
});
