import puppeteer from 'puppeteer-core';
import { findBrowser } from './findBrowser.js';
import { PAGE } from './layout.js';

/**
 * Printing through a browser already on the machine.
 *
 * This is what the command line tools and the tests use, and what `npm run
 * serve` uses when the tool is run as a web page rather than as the app. The
 * app itself does not come this way: Electron carries its own Chromium, so it
 * prints through that and never has to go looking (see `electron/printer.ts`).
 *
 * Both are the same engine. Chromium renders the PDF either way — the only
 * difference is which copy of it, and whose job it is to find one.
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
