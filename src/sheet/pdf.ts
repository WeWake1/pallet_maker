import { writeFile } from 'node:fs/promises';

/**
 * Print the sheet HTML to PDF.
 *
 * The page carries its own A4 landscape @page rule and the browser is told to
 * honour it, so there are no margins beyond the template's own. Nothing is
 * rasterised anywhere: the drawings are SVG and the text stays selectable.
 *
 * Which Chromium does the printing depends on how the tool is being run. The
 * app has one inside it and uses that; the command line tools and the tests go
 * looking for one on the machine. Neither is written here, so that the app can
 * be built without a line of `puppeteer-core` in it, and the tests can print
 * without an Electron to do it in.
 */

/** Render sheet HTML to a PDF. Writes to `outPath` as well when given one. */
export type Printer = (html: string, outPath?: string) => Promise<Buffer>;

let printer: Printer | undefined;

/**
 * Print with this from now on.
 *
 * Called once, by whichever entry point knows what it is running inside. The
 * app does it before it opens a window; nothing else has to, because the
 * browser-hunting printer is what the absence of a choice means.
 */
export function usePrinter(chosen: Printer): void {
  printer = chosen;
}

async function print(html: string, outPath?: string): Promise<Buffer> {
  if (!printer) {
    // Loaded only when it is wanted, so that a build with no `puppeteer-core`
    // in it — which is what the app is — never tries to resolve it.
    const { printWithBrowser } = await import('./browserPrinter.js');
    printer = printWithBrowser;
  }
  return printer(html, outPath);
}

export async function exportPdf(html: string, outPath: string): Promise<void> {
  const pdf = await print(html, outPath);
  // A printer that took the path wrote the file itself; one that only returns
  // bytes did not, and this is where it lands.
  await writeFile(outPath, pdf);
}

/** The same PDF, kept in memory, for the server to send straight to the browser. */
export async function exportPdfBuffer(html: string): Promise<Buffer> {
  return print(html);
}
