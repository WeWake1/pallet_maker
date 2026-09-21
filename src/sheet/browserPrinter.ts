import puppeteer from 'puppeteer-core';
import { findBrowser } from './findBrowser.js';
import { PAGE } from './layout.js';

/**
 * Printing through a browser already on the machine.
 *
 * Finding a Chromium on the machine, for the command line tools and the tests.
 * The server does not come this way: it keeps one open across every sheet it
 * prints, rather than starting one per sheet (see `pooledPrinter.ts`).
 *
 * Both are the same engine. Chromium renders the PDF either way — the only
 * difference is whether the copy of it is found once or every time.
 */
export async function printWithBrowser(html: string, outPath?: string): Promise<Buffer> {
  const browser = await puppeteer.launch({
    executablePath: findBrowser(),
    headless: true,
    args: ['--disable-gpu', '--font-render-hinting=none'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    const pdf = await page.pdf({
      ...(outPath ? { path: outPath } : {}),
      printBackground: true,
      preferCSSPageSize: true,
      width: `${PAGE.width}mm`,
      height: `${PAGE.height}mm`,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
