import { BrowserWindow } from 'electron';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PAGE } from '../src/sheet/layout.js';

/**
 * Printing through the Chromium inside the app.
 *
 * The same engine the command line tools reach for, but a copy that is already
 * here and is the same version on every machine. That is the point of it: what
 * a sheet looks like stops depending on which browser a particular laptop
 * happens to have installed.
 *
 * The options are the ones `browserPrinter.ts` passes, said the way Electron
 * says them — millimetres become microns, and "no margins" becomes a named
 * margin type. `preferCSSPageSize` means the sheet's own `@page` rule decides
 * the paper either way, and the size below is what it falls back to.
 */

/** Millimetres in the microns Electron measures paper in. */
const MICRONS_PER_MM = 1000;

/**
 * One hidden window, kept and reused.
 *
 * Making and destroying one per sheet is what a first version did, and printing
 * several in a row failed partway through: the next window would start loading
 * while the last was still being torn down. One window that stays, taking one
 * sheet at a time, has neither problem and is faster besides.
 */
let printer: BrowserWindow | undefined;

/** Sheets print one after another, because there is one window to print in. */
let queue: Promise<unknown> = Promise.resolve();

function printWindow(): BrowserWindow {
  if (printer && !printer.isDestroyed()) return printer;
  printer = new BrowserWindow({
    show: false,
    webPreferences: {
      // The sheet is a document this program generated a moment ago and nothing
      // else can reach, so there is nothing here to be guarded from. Scripting
      // stays on only because waiting for the font is done by asking the page.
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  return printer;
}

/** Let go of the window, for a program that is shutting down. */
export function closePrinter(): void {
  if (printer && !printer.isDestroyed()) printer.destroy();
  printer = undefined;
}

export async function printWithElectron(html: string): Promise<Buffer> {
  const mine = queue.then(() => render(html));
  // The queue carries on whatever happens to this sheet, so one that fails to
  // print does not stop every sheet after it.
  queue = mine.catch(() => undefined);
  return mine;
}

async function render(html: string): Promise<Buffer> {
  // Through a file rather than a data: URL. The sheet carries the company font
  // inside it, which makes the document far too big to survive being a URL.
  const scratch = mkdtempSync(join(tmpdir(), 'pallet-print-'));
  const page = join(scratch, 'sheet.html');
  writeFileSync(page, html, 'utf8');

  try {
    const window = printWindow();
    await window.loadFile(page);

    // The font travels inside the document, so it is decoded rather than
    // fetched — but it is still decoded, and printing before it is ready would
    // set the sheet in a fallback face.
    await window.webContents.executeJavaScript('document.fonts.ready.then(() => true)');

    return await window.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      // Chrome's own print pipeline tags its PDFs, and every sheet printed by
      // this tool so far has been tagged. Asking for it here keeps a reprint of
      // an old design the same document it always was, down to the structure
      // markers — and a tagged PDF is the more accessible one regardless.
      generateTaggedPDF: true,
      pageSize: {
        width: PAGE.width * MICRONS_PER_MM,
        height: PAGE.height * MICRONS_PER_MM,
      },
      margins: { marginType: 'none' },
    });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
