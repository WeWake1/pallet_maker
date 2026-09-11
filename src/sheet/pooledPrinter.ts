import type { Browser, Page } from 'puppeteer-core';
import { PAGE } from './layout.js';
import type { Printer } from './pdf.js';

/**
 * Printing through one Chromium that stays open.
 *
 * `browserPrinter.ts` starts a browser for every sheet and closes it after,
 * which is right for a command line tool that prints one sheet and exits. A
 * server is asked for sheets all day, sometimes several at once, and a browser
 * per request is 150 MB and a second of start-up each time — ten people
 * pressing PDF together would take a small machine down. So one browser is
 * started at the first sheet and kept, a few sheets print in it at a time, the
 * rest wait their turn, and one that never finishes is cut off rather than
 * holding everybody else's place.
 *
 * Nothing here is written to disk. The sheet goes in as a string and the PDF
 * comes back as bytes; `pdf.ts` writes the file where a file is wanted.
 */

/** What is asked of Chromium when it is started. */
export interface LaunchRequest {
  executablePath: string;
  headless: boolean;
  args: string[];
}

export interface PoolOptions {
  /**
   * The Chromium to run, or how to find one. Looked up at the first sheet, so
   * a machine with no browser fails at the first print with a message saying
   * so, rather than refusing to start at all.
   */
  executablePath: string | (() => string);
  /** How many sheets print at once. Default 2. */
  concurrency?: number;
  /** How long any one step of a print gets. Default 30 seconds. */
  stepTimeoutMs?: number;
  /** How many sheets may wait, beyond those printing, before more are refused. Default 20. */
  maxQueue?: number;
  /** Chromium's flags. Default `SERVER_ARGS`. */
  args?: string[];
  /** How a browser is started. The tests start a pretend one. */
  launch?: (request: LaunchRequest) => Promise<Browser>;
}

export interface PrinterStatus {
  /** Whether a browser is up right now. False until the first sheet. */
  running: boolean;
  printing: number;
  waiting: number;
  printed: number;
  failed: number;
  /** How many times a browser has been started. More than one means one was lost. */
  launches: number;
}

export interface PooledPrinter {
  print: Printer;
  status(): PrinterStatus;
  /** Take no more sheets, finish the ones in hand, and close the browser. */
  close(): Promise<void>;
}

/** Too many sheets waiting already. The server answers 503 and says so. */
export class PrinterBusyError extends Error {
  constructor(waiting: number) {
    super(`${waiting} sheets are waiting to print already; try again in a moment`);
    this.name = 'PrinterBusyError';
  }
}

export class PrinterClosedError extends Error {
  constructor() {
    super('The printer has been closed');
    this.name = 'PrinterClosedError';
  }
}

/**
 * Chromium's flags on a server.
 *
 * `--no-sandbox`: Chromium's own sandbox needs user namespaces, which the
 * service user on a hardened box may not have; the sheet it renders is one
 * this program wrote a moment ago, so there is nothing for a sandbox to guard
 * against. `--disable-dev-shm-usage`: a container's /dev/shm is 64 MB and a
 * page that outgrows it crashes. `--disable-gpu`: there is none. Font hinting
 * off is what `browserPrinter.ts` does, so the two print the same sheet.
 */
export const SERVER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--font-render-hinting=none',
];

async function launchWithPuppeteer(request: LaunchRequest): Promise<Browser> {
  // Loaded only when it is wanted, the same as `pdf.ts` does, so that nothing
  // built without `puppeteer-core` ever tries to resolve it.
  const { default: puppeteer } = await import('puppeteer-core');
  return puppeteer.launch(request);
}

/** A promise that is failed rather than waited on for ever. */
export async function within<T>(what: string, work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const expiry = new Promise<never>((_, fail) => {
    timer = setTimeout(() => fail(new Error(`${what} took longer than ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([work, expiry]);
  } finally {
    clearTimeout(timer);
  }
}

interface Waiter {
  start: () => void;
  abort: (error: Error) => void;
}

export function createPooledPrinter(options: PoolOptions): PooledPrinter {
  const concurrency = options.concurrency ?? 2;
  const stepTimeoutMs = options.stepTimeoutMs ?? 30_000;
  const maxQueue = options.maxQueue ?? 20;
  const launch = options.launch ?? launchWithPuppeteer;
  const args = options.args ?? SERVER_ARGS;

  let browser: Browser | undefined;
  let starting: Promise<Browser> | undefined;
  let closed = false;
  let printing = 0;
  const waiting: Waiter[] = [];
  const inflight = new Set<Promise<unknown>>();
  const counts = { printed: 0, failed: 0, launches: 0 };

  const step = <T>(what: string, work: Promise<T>): Promise<T> => within(what, work, stepTimeoutMs);

  /** The browser, started if there is not one. One start at a time, shared. */
  function browserNow(): Promise<Browser> {
    if (browser && browser.connected) return Promise.resolve(browser);
    if (!starting) {
      const executablePath =
        typeof options.executablePath === 'function' ? options.executablePath() : options.executablePath;
      counts.launches += 1;
      starting = launch({ executablePath, headless: true, args })
        .then((started) => {
          browser = started;
          return started;
        })
        .finally(() => {
          starting = undefined;
        });
    }
    return starting;
  }

  /**
   * Let the browser go. The next sheet starts a fresh one.
   *
   * A browser still starting is waited for and then closed, rather than left
   * to arrive after everything else has gone and sit there running.
   */
  async function discard(): Promise<void> {
    if (starting) await starting.catch(() => undefined);
    const gone = browser;
    browser = undefined;
    if (gone) await within('closing the browser', gone.close(), stepTimeoutMs).catch(() => undefined);
  }

  async function render(html: string): Promise<Buffer> {
    const held = await step('starting the browser', browserNow());
    let page: Page | undefined;
    try {
      page = await step('opening a page', held.newPage());
      await step('loading the sheet', page.setContent(html, { waitUntil: 'load' }));
      // The font travels inside the document, so it is decoded rather than
      // fetched — but it is still decoded, and printing before it is ready
      // would set the sheet in a fallback face.
      await step('waiting for the font', page.evaluate(() => document.fonts.ready.then(() => true)));
      const pdf = await step(
        'printing',
        page.pdf({
          printBackground: true,
          preferCSSPageSize: true,
          width: `${PAGE.width}mm`,
          height: `${PAGE.height}mm`,
          margin: { top: '0', right: '0', bottom: '0', left: '0' },
        }),
      );
      return Buffer.from(pdf);
    } finally {
      if (page) await step('closing the page', page.close()).catch(() => undefined);
    }
  }

  /**
   * One sheet, tried twice at most.
   *
   * A step that failed or timed out has left the browser in a state nobody
   * should inherit, so it is thrown away either way. Printing is a pure
   * function of the HTML, which is what makes trying once more safe.
   */
  async function job(html: string): Promise<Buffer> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await render(html);
      } catch (error) {
        await discard();
        if (attempt >= 1) throw error;
      }
    }
  }

  function acquire(): Promise<void> {
    if (printing < concurrency) {
      printing += 1;
      return Promise.resolve();
    }
    if (waiting.length >= maxQueue) return Promise.reject(new PrinterBusyError(waiting.length));
    return new Promise((resolve, reject) => {
      waiting.push({
        start: () => {
          printing += 1;
          resolve();
        },
        abort: reject,
      });
    });
  }

  function release(): void {
    printing -= 1;
    const next = waiting.shift();
    if (next) next.start();
  }

  /**
   * A sheet is on the books from the moment it is accepted, not from its first
   * turn of the event loop — `close` waits for what is on the books, and a
   * sheet accepted a moment before would otherwise slip past it.
   */
  const print: Printer = (html) => {
    if (closed) return Promise.reject(new PrinterClosedError());
    const work: Promise<Buffer> = acquire()
      .then(() => job(html).finally(release))
      .then(
        (pdf) => {
          counts.printed += 1;
          return pdf;
        },
        (error: unknown) => {
          // Being turned away is not a sheet that failed to print.
          if (!(error instanceof PrinterBusyError) && !(error instanceof PrinterClosedError)) {
            counts.failed += 1;
          }
          throw error;
        },
      )
      .finally(() => {
        inflight.delete(work);
      });
    inflight.add(work);
    return work;
  };

  async function close(): Promise<void> {
    closed = true;
    for (const waiter of waiting.splice(0)) waiter.abort(new PrinterClosedError());
    await Promise.allSettled([...inflight]);
    await discard();
  }

  function status(): PrinterStatus {
    return {
      running: browser !== undefined && browser.connected,
      printing,
      waiting: waiting.length,
      ...counts,
    };
  }

  return { print, status, close };
}
