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
 * says them — millimetres become microns, and margins are given in inches.
 * `preferCSSPageSize` means the sheet's own `@page` rule decides the paper
 * either way, and the size below is what it falls back to.
 */

/** Millimetres in the microns Electron measures paper in. */
const MICRONS_PER_MM = 1000;

/**
 * How long any one step of printing gets before it is called a failure.
 *
 * There is a shared window and a queue behind it, so a step that never finishes
 * does not merely lose one sheet — it stops every sheet after it, for as long
 * as the program is running, and the only sign of it is that printing quietly
 * stops working. Generous enough that a slow machine is never cut off, and
 * finite so that a wedged one recovers by itself.
 */
const STEP_TIMEOUT_MS = 30_000;

/** A step that has not finished in time, so the queue is not held by it. */
async function within<T>(what: string, work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout;
  const expiry = new Promise<never>((_, fail) => {
    timer = setTimeout(() => fail(new Error(`${what} took longer than ${STEP_TIMEOUT_MS}ms`)), STEP_TIMEOUT_MS);
  });
  try {
    return await Promise.race([work, expiry]);
  } finally {
    clearTimeout(timer!);
  }
}

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

  let window: BrowserWindow | undefined;
  try {
    window = printWindow();
    await within('loading the sheet', window.loadFile(page));

    // The font travels inside the document, so it is decoded rather than
    // fetched — but it is still decoded, and printing before it is ready would
    // set the sheet in a fallback face.
    await within(
      'waiting for the font',
      window.webContents.executeJavaScript('document.fonts.ready.then(() => true)'),
    );

    return await within('printing', window.webContents.printToPDF({
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
      // In inches, and every one of them nil. Electron's default is about
      // 0.4in, and `preferCSSPageSize` happens to make the sheet's own @page
      // rule win before that can matter — but relying on that would put a
      // margin on every drawing the moment it stopped being true.
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    }));
  } catch (error) {
    // The window is shared and is now holding a page that did not print. Throw
    // it away rather than hand it to the next sheet, which would inherit
    // whatever state stopped this one; the next call makes a fresh one.
    if (window && !window.isDestroyed()) window.destroy();
    printer = undefined;
    throw error;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
