#!/usr/bin/env node
/**
 * Run the tool.
 *
 *   node dist/server/main.mjs           # hosted: everything under PALLET_DATA_ROOT
 *   npm run serve                        # --local: the open mode, for working on the tool
 *
 * Hosted, the designs live in `<PALLET_DATA_ROOT>/library`, nobody can point
 * the server anywhere else over the API, and it listens on the loopback for a
 * reverse proxy on the same machine to reach. A data folder that is not there
 * stops it from starting at all: on a server that folder was made on purpose,
 * and inventing an empty one would show an empty library.
 *
 * `--local` is the mode this program has always run in on a laptop: the
 * folder chosen in the editor, or `PALLET_STORE`, or `data/library`, and the
 * folder can be changed from the editor. Still loopback only.
 *
 *   PORT                 5179
 *   HOST                 127.0.0.1
 *   PALLET_DATA_ROOT     hosted only; has to exist
 *   PALLET_TIMEZONE      the date stamped on designs, e.g. Asia/Kolkata; this machine's otherwise
 *   PALLET_BROWSER       the Chromium to print with, if not one of the usual ones
 *   PALLET_BACKUPS       snapshots to keep, default 20
 *   PALLET_STORE         --local only: the designs folder, over the one chosen in the editor
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isTimeZone, localTimeZone } from '../ids.js';
import { findBrowser } from '../sheet/findBrowser.js';
import { usePrinter } from '../sheet/pdf.js';
import { createPooledPrinter } from '../sheet/pooledPrinter.js';
import { StoreHandle } from '../store/handle.js';
import { configuredStoreRoot } from '../store/settings.js';
import { createApp } from './app.js';
import { backupDirectoryFor, backupLibrary } from './backup.js';
import { jsonLogger } from './log.js';
import { reconcileClients } from './repository.js';

/**
 * Where this program is. Two levels up from this file whether it is running
 * from `src/server/` under tsx or from `dist/server/` as the bundle, so the
 * built editor and the rates file are found from here rather than from
 * wherever the process happened to be started.
 */
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const local = process.argv.includes('--local');
const port = Number(process.env.PORT ?? 5179);
const host = process.env.HOST ?? '127.0.0.1';
const keep = Number(process.env.PALLET_BACKUPS ?? 20);
const staticDir = resolve(appRoot, 'dist', 'editor');
const ratesPath = resolve(appRoot, 'config', 'rates.json');
const brandPath = resolve(appRoot, 'config', 'brand.json');

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function readVersion(): string | null {
  try {
    const raw = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8')) as { version?: unknown };
    return typeof raw.version === 'string' ? raw.version : null;
  } catch {
    return null;
  }
}

const timezone = process.env.PALLET_TIMEZONE ?? localTimeZone();
if (!isTimeZone(timezone)) {
  fail(`PALLET_TIMEZONE is "${timezone}", which is not a time zone name. Use one like Asia/Kolkata.`);
}

/** The data folder was made on purpose; the library inside it is made here. */
function openHostedStore(): StoreHandle {
  const dataRoot = process.env.PALLET_DATA_ROOT;
  if (!dataRoot) {
    fail(
      'PALLET_DATA_ROOT is not set. It names the folder this server keeps everything in, ' +
        'and that folder has to exist. Run with --local to work on the tool without it.',
    );
  }
  if (!existsSync(dataRoot) || !statSync(dataRoot).isDirectory()) {
    fail(`PALLET_DATA_ROOT is ${dataRoot}, and there is no such folder. Make it first.`);
  }
  const handle = new StoreHandle(resolve(dataRoot, 'library'), { create: true, source: 'environment' });
  if (!handle.ready()) fail(`Cannot use ${handle.status().root}: ${handle.status().problem}`);
  return handle;
}

/**
 * The laptop's folder, and whether this copy may make it.
 *
 * A folder somebody chose and this program wrote down must already be there.
 * If it is not, Drive is not running or it has been moved, and making an empty
 * one would show an empty library — so it is reported instead. The built-in
 * default has nobody to report to on a first run, so that one is made.
 */
function openLocalStore(): StoreHandle {
  const chosen = process.env.PALLET_STORE ?? configuredStoreRoot();
  return new StoreHandle(chosen ?? resolve(appRoot, 'data', 'library'), {
    create: chosen === undefined,
    source: process.env.PALLET_STORE ? 'environment' : chosen ? 'settings' : 'default',
  });
}

const handle = local ? openLocalStore() : openHostedStore();
const version = readVersion();

// One Chromium, kept open, a couple of sheets at a time. It is started at the
// first sheet, so a machine with no browser says so then rather than refusing
// to serve the designs at all.
const printer = createPooledPrinter({ executablePath: () => findBrowser() });
usePrinter(printer.print);

const app = createApp(handle, {
  staticDir,
  ratesPath,
  brandPath,
  version,
  timezone,
  allowFolderChange: local,
  log: jsonLogger(),
  health: () => ({ printer: printer.status() }),
});

if (!existsSync(staticDir)) {
  console.error(`No built editor at ${staticDir}: the API is up but the editor is not. Run npm run build.`);
}

/**
 * The housekeeping a start does: adopt any client named only by their designs,
 * and take a snapshot. Both read the whole folder and neither is urgent, so
 * they run once the server is already answering.
 */
function tidyUp(): void {
  if (!handle.ready()) return;
  try {
    const adopted = reconcileClients(handle.require());
    if (adopted > 0) console.log(`Took in ${adopted} client(s) named only by their designs`);
  } catch (error) {
    console.error(`Could not reconcile the clients: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    console.log(`Backed up to ${backupLibrary(handle.require(), { keep })}`);
  } catch (error) {
    // A backup that fails is worth saying loudly, but it is not a reason to
    // refuse to open the designs.
    console.error(`Could not back up the designs: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const server = app.listen(port, host, () => {
  const status = handle.status();
  console.log(`Pallet spec ${version ?? ''} ${local ? '(local)' : '(hosted)'} on http://${host}:${port}`);
  console.log(`Dates in ${timezone}`);
  if (status.ready) {
    console.log(`Designs in ${status.root}`);
    console.log(`Backups in ${backupDirectoryFor(status.root!)}, keeping ${keep}`);
  } else {
    // Still serving: the editor needs to be reachable to be told where to look.
    console.error(`Cannot reach the designs folder ${status.root}: ${status.problem}`);
    console.error('Open the editor and choose a folder, or set PALLET_STORE.');
  }
  setImmediate(tidyUp);
});

/**
 * Stop taking requests, finish the sheets being printed, and go.
 *
 * Three things have to happen in order. New connections stop. Connections
 * sitting idle between requests are closed at once — a browser keeps one open
 * for a while after it is done with it, and waiting on those would hold a
 * deploy up for no reason. Then the sheets already being printed are given
 * until the ceiling below to finish.
 *
 * That ceiling is short of the one systemd is told (TimeoutStopSec), so a
 * restart is never stuck behind this process: a sheet whose page has hung is
 * given up on rather than waited out, and whoever asked for it sees a failed
 * download and presses the button again.
 */
const STOP_WITHIN_MS = 15_000;
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    console.log(`${signal}: stopping`);

    const giveUp = setTimeout(() => {
      console.error(`Still printing after ${STOP_WITHIN_MS}ms; going anyway`);
      process.exit(0);
    }, STOP_WITHIN_MS);
    giveUp.unref();

    server.close(() => {
      void printer.close().finally(() => {
        clearTimeout(giveUp);
        process.exit(0);
      });
    });
    // Node waits on every open connection, idle ones included.
    server.closeIdleConnections();
  });
}
