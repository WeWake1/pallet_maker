import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { exportPdf, exportPdfBuffer, usePrinter } from '../src/sheet/pdf.js';

/**
 * Which Chromium prints the sheet.
 *
 * The app has one inside it and uses that; the command line tools and the tests
 * go looking for one on the machine. Neither is named in `pdf.ts`, so that the
 * app can be built without a line of `puppeteer-core` in it — and that only
 * holds while the choice really is made from outside.
 */

const out = join(tmpdir(), `pallet-printer-${process.pid}.pdf`);

afterEach(() => {
  rmSync(out, { force: true });
});

describe('the printer', () => {
  it('is whichever one was chosen', async () => {
    const seen: string[] = [];
    usePrinter(async (html) => {
      seen.push(html);
      return Buffer.from('%PDF-1.4 pretend');
    });

    expect((await exportPdfBuffer('<p>a sheet</p>')).toString()).toBe('%PDF-1.4 pretend');
    expect(seen).toEqual(['<p>a sheet</p>']);
  });

  /**
   * Electron's printer hands back bytes and never touches the disk, so writing
   * the file is this side's job. A printer that took the path and wrote it
   * itself must end up with the same file rather than two of them.
   */
  it('writes the file for a printer that only returns bytes', async () => {
    usePrinter(async () => Buffer.from('%PDF-1.4 bytes only'));
    await exportPdf('<p>a sheet</p>', out);
    expect(readFileSync(out).toString()).toBe('%PDF-1.4 bytes only');
  });

  it('passes the path on, for a printer that would rather write it', async () => {
    const paths: (string | undefined)[] = [];
    usePrinter(async (_html, path) => {
      paths.push(path);
      return Buffer.from('%PDF-1.4 wrote it');
    });

    await exportPdf('<p>a sheet</p>', out);
    expect(paths).toEqual([out]);

    await exportPdfBuffer('<p>a sheet</p>');
    expect(paths[1]).toBeUndefined();
  });
});
