import type { Browser } from 'puppeteer-core';
import { describe, expect, it } from 'vitest';
import { analysePallet } from '../src/geometry/layout.js';
import { findBrowser } from '../src/sheet/findBrowser.js';
import { createPooledPrinter, PrinterBusyError, PrinterClosedError } from '../src/sheet/pooledPrinter.js';
import { renderSheet } from '../src/sheet/sheet.js';
import { loadFixture } from './helpers.js';

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/**
 * A browser that prints nothing, at a speed the test chooses, and can be told
 * to hang or to fail — once, or every time.
 */
function pretend(settings: { delay?: number; hangOnce?: boolean; throwOnce?: boolean; alwaysThrow?: boolean } = {}) {
  const state = {
    launches: 0,
    closes: 0,
    open: 0,
    peak: 0,
    hangOnce: settings.hangOnce ?? false,
    throwOnce: settings.throwOnce ?? false,
  };
  const launch = async (): Promise<Browser> => {
    state.launches += 1;
    let connected = true;
    const browser = {
      get connected() {
        return connected;
      },
      async close() {
        state.closes += 1;
        connected = false;
      },
      async newPage() {
        state.open += 1;
        state.peak = Math.max(state.peak, state.open);
        return {
          async setContent() {
            if (state.hangOnce) {
              state.hangOnce = false;
              await new Promise<never>(() => {});
            }
            if (state.throwOnce || settings.alwaysThrow) {
              state.throwOnce = false;
              throw new Error('the page is broken');
            }
            await sleep(settings.delay ?? 0);
          },
          async evaluate() {
            return true;
          },
          async pdf() {
            return new TextEncoder().encode('%PDF-1.4 pretend');
          },
          async close() {
            state.open -= 1;
          },
        };
      },
    };
    return browser as unknown as Browser;
  };
  return { state, launch };
}

describe('the pooled printer', () => {
  it('starts one browser and keeps it', async () => {
    const { state, launch } = pretend();
    const printer = createPooledPrinter({ executablePath: '/pretend', launch });
    expect(printer.status().running).toBe(false);
    for (let i = 0; i < 3; i += 1) {
      expect((await printer.print('<p>sheet</p>')).toString()).toBe('%PDF-1.4 pretend');
    }
    expect(state.launches).toBe(1);
    expect(printer.status()).toMatchObject({
      running: true,
      printed: 3,
      failed: 0,
      launches: 1,
      printing: 0,
      waiting: 0,
    });
    await printer.close();
    expect(state.closes).toBe(1);
  });

  it('prints a couple at a time and queues the rest', async () => {
    const { state, launch } = pretend({ delay: 20 });
    const printer = createPooledPrinter({ executablePath: '/pretend', launch, concurrency: 2 });
    const all = Promise.all(Array.from({ length: 5 }, () => printer.print('<p>sheet</p>')));
    expect(printer.status().printing).toBe(2);
    expect(printer.status().waiting).toBe(3);
    await all;
    expect(state.peak).toBe(2);
    expect(printer.status()).toMatchObject({ printed: 5, printing: 0, waiting: 0 });
    await printer.close();
  });

  it('refuses when too many are waiting already', async () => {
    const { launch } = pretend({ delay: 30 });
    const printer = createPooledPrinter({ executablePath: '/pretend', launch, concurrency: 1, maxQueue: 1 });
    const first = printer.print('<p>1</p>');
    const second = printer.print('<p>2</p>');
    await expect(printer.print('<p>3</p>')).rejects.toBeInstanceOf(PrinterBusyError);
    await Promise.all([first, second]);
    await printer.close();
  });

  it('cuts off a step that never finishes, replaces the browser, and prints on the second try', async () => {
    const { state, launch } = pretend({ hangOnce: true });
    const printer = createPooledPrinter({ executablePath: '/pretend', launch, stepTimeoutMs: 30 });
    expect((await printer.print('<p>sheet</p>')).toString()).toBe('%PDF-1.4 pretend');
    expect(state.launches).toBe(2);
    expect(state.closes).toBe(1);
    expect(printer.status()).toMatchObject({ printed: 1, failed: 0, launches: 2 });
    await printer.close();
  });

  it('gives up on a sheet that fails twice, and says why', async () => {
    const { state, launch } = pretend({ alwaysThrow: true });
    const printer = createPooledPrinter({ executablePath: '/pretend', launch });
    await expect(printer.print('<p>sheet</p>')).rejects.toThrow(/the page is broken/);
    expect(state.launches).toBe(2);
    expect(printer.status().failed).toBe(1);
    await printer.close();
  });

  it('looks for the browser only when the first sheet is asked for', async () => {
    let asked = 0;
    const { launch } = pretend();
    const printer = createPooledPrinter({
      executablePath: () => {
        asked += 1;
        return '/pretend';
      },
      launch,
    });
    expect(asked).toBe(0);
    await printer.print('<p>sheet</p>');
    expect(asked).toBe(1);
    await printer.close();
  });

  it('closes by finishing what is printing and turning away what is waiting', async () => {
    const { launch } = pretend({ delay: 30 });
    const printer = createPooledPrinter({ executablePath: '/pretend', launch, concurrency: 1 });
    const printing = printer.print('<p>1</p>');
    const waiting = printer.print('<p>2</p>');
    const closing = printer.close();
    await expect(waiting).rejects.toBeInstanceOf(PrinterClosedError);
    expect((await printing).toString()).toBe('%PDF-1.4 pretend');
    await closing;
    await expect(printer.print('<p>3</p>')).rejects.toBeInstanceOf(PrinterClosedError);
    expect(printer.status().running).toBe(false);
  });
});

let browser: string | null;
try {
  browser = findBrowser();
} catch {
  browser = null;
}

describe.skipIf(browser === null)('the pooled printer, with a real browser', () => {
  it('prints three sheets at once through one browser', async () => {
    const printer = createPooledPrinter({ executablePath: browser!, concurrency: 2 });
    const pallet = loadFixture('wing-both-decks');
    const html = renderSheet(pallet, analysePallet(pallet));
    const pdfs = await Promise.all([1, 2, 3].map(() => printer.print(html)));
    for (const pdf of pdfs) expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(printer.status()).toMatchObject({ launches: 1, printed: 3, failed: 0 });
    await printer.close();
    expect(printer.status().running).toBe(false);
  }, 60_000);
});
