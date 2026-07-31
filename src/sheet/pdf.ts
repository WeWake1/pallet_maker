import puppeteer from 'puppeteer-core';
import { PAGE } from './layout.js';
import { findBrowser } from './browser.js';

/**
 * Print the sheet HTML to PDF.
 *
 * The page carries its own A4 landscape @page rule and the browser is told to
 * honour it, so there are no margins beyond the template's own. Nothing is
 * rasterised anywhere: the drawings are SVG and the text stays selectable.
 */
export async function exportPdf(html: string, outPath: string): Promise<void> {
  await print(html, outPath);
}

/** The same PDF, kept in memory, for the server to send straight to the browser. */
export async function exportPdfBuffer(html: string): Promise<Buffer> {
  return print(html);
}

async function print(html: string, outPath?: string): Promise<Buffer> {
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
