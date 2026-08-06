import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { computeLayout } from '../src/geometry/layout.js';
import { findBrowser } from '../src/sheet/browser.js';
import { exportPdf } from '../src/sheet/pdf.js';
import { renderSheet } from '../src/sheet/sheet.js';
import { loadFixture } from './helpers.js';

/**
 * Printing needs a browser, which not every machine running the tests will
 * have. Where there is one, the PDF is checked properly.
 */
let browser: string | null = null;
try {
  browser = findBrowser();
} catch {
  browser = null;
}

const out = join(tmpdir(), `pallet-sheet-${process.pid}.pdf`);

describe.skipIf(browser === null)('PDF export', () => {
  afterAll(() => {
    if (existsSync(out)) rmSync(out);
  });

  it('prints one A4 landscape page of true vector with selectable text', async () => {
    const pallet = loadFixture('wing-both-decks');
    const layout = computeLayout(pallet);
    await exportPdf(renderSheet(pallet, layout), out);

    const pdf = readFileSync(out);
    const text = pdf.toString('latin1');

    expect(text.startsWith('%PDF-')).toBe(true);

    // A4 landscape is 841.89 x 595.28 pt. One page, no more.
    const boxes = [...text.matchAll(/MediaBox\s*\[\s*([\d.\s]+?)\]/g)].map((m) =>
      m[1]!.trim().split(/\s+/).map(Number),
    );
    expect(boxes.length).toBeGreaterThan(0);
    for (const box of boxes) {
      expect(box[2]).toBeCloseTo(841.89, 0);
      expect(box[3]).toBeCloseTo(595.28, 0);
    }
    expect([...text.matchAll(/\/Type\s*\/Page[^s]/g)]).toHaveLength(1);

    // Fonts embedded means the text is text.
    expect(text).toMatch(/\/Type\s*\/Font/);

    // No image XObject at all. Every mark on the sheet is a shape or a letter,
    // the logo included — it is two paths, not a PNG — so anything here would
    // mean something in the pipeline had rasterised part of the drawing.
    expect(text).not.toMatch(/\/Subtype\s*\/Image/);
  }, 60_000);
});
