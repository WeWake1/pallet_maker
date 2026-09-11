#!/usr/bin/env node
/**
 * Run the tool.
 *
 *   node dist/server/main.mjs           # hosted: companies, people and a door
 *   npm run serve                        # --local: one folder, nobody asked
 *
 * Hosted, every company is a folder under `PALLET_DATA_ROOT/tenants/<short
 * name>`, who may open which is decided by the registry beside them, and the
 * server listens on the loopback for a reverse proxy on the same machine. A
 * data folder that is not there stops it from starting at all: on a server
 * that folder was made on purpose, and inventing an empty one would show an
 * empty library.
 *
 * `--local` is the mode this program has always run in on a laptop: the folder
 * chosen in the editor, or `PALLET_STORE`, or `data/library`, and no sign-in.
 * Still loopback only.
 *
 *   PORT                 5179
 *   HOST                 127.0.0.1
 *   PALLET_DATA_ROOT     hosted only; has to exist
 *   SESSION_SECRET       hosted only; at least 32 characters, and not in the repository
 *   PALLET_PUBLIC_URL    hosted only; where this answers, for invitation links
 *   PALLET_TIMEZONE      --local only; the date designs are stamped with
 *   PALLET_BROWSER       the Chromium to print with, if not one of the usual ones
 *   PALLET_BACKUPS       snapshots to keep per company, default 30
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
import { Registry } from '../tenancy/registry.js';
import { startHousekeeping } from '../tenancy/housekeeping.js';
import { Tenants } from '../tenancy/tenants.js';
import { createApp } from './app.js';
import type { AuthConfig } from './app.js';
import { backupDirectoryFor, backupLibrary } from './backup.js';
import { jsonLogger } from './log.js';
import { reconcileClients } from './repository.js';

/**
 * Where this program is. Two levels up from this file whether it is running
 * from `src/server/` under tsx or from `dist/server/` as the bundle, so the
 * built editor and the config files are found from here rather than from
 * wherever the process happened to be started.
 */
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const local = process.argv.includes('--local');
const port = Number(process.env.PORT ?? 5179);
const host = process.env.HOST ?? '127.0.0.1';
const keep = Number(process.env.PALLET_BACKUPS ?? (local ? 20 : 30));
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

const version = readVersion();

/** The Chromium that prints, started at the first sheet and then kept. */
const printer = createPooledPrinter({ executablePath: () => findBrowser() });
usePrinter(printer.print);

let stopHousekeeping = (): void => {};
let registry: Registry | undefined;

/* ------------------------------------------------------------------ local */

function localApp() {
  const timezone = process.env.PALLET_TIMEZONE ?? localTimeZone();
  if (!isTimeZone(timezone)) {
    fail(`PALLET_TIMEZONE is "${timezone}", which is not a time zone name. Use one like Asia/Kolkata.`);
  }
  const chosen = process.env.PALLET_STORE ?? configuredStoreRoot();
  const handle = new StoreHandle(chosen ?? resolve(appRoot, 'data', 'library'), {
    create: chosen === undefined,
    source: process.env.PALLET_STORE ? 'environment' : chosen ? 'settings' : 'default',
  });

  const app = createApp(handle, {
    staticDir,
    ratesPath,
    brandPath,
    version,
    timezone,
    allowFolderChange: true,
    log: jsonLogger(),
    health: () => ({ printer: printer.status() }),
  });
  return { app, describe: () => describeLocal(handle, timezone), tidy: () => tidyLocal(handle) };
}

function describeLocal(handle: StoreHandle, timezone: string): void {
  const status = handle.status();
  console.log(`Dates in ${timezone}`);
  if (status.ready) {
    console.log(`Designs in ${status.root}`);
    console.log(`Backups in ${backupDirectoryFor(status.root!)}, keeping ${keep}`);
  } else {
    console.error(`Cannot reach the designs folder ${status.root}: ${status.problem}`);
    console.error('Open the editor and choose a folder, or set PALLET_STORE.');
  }
}

function tidyLocal(handle: StoreHandle): void {
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
    console.error(`Could not back up the designs: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/* ----------------------------------------------------------------- hosted */

function hostedApp() {
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

  const secret = process.env.SESSION_SECRET ?? '';
  if (secret.length < 32) {
    fail(
      'SESSION_SECRET is not set, or is shorter than 32 characters. It signs the cookie that ' +
        'keeps people signed in. Make one with: openssl rand -hex 32',
    );
  }
  const publicUrl = process.env.PALLET_PUBLIC_URL ?? `http://${host}:${port}`;

  registry = new Registry(resolve(dataRoot, 'registry.sqlite'));
  const tenants = new Tenants(dataRoot, registry, { ratesPath, brandPath });
  const auth: AuthConfig = {
    registry,
    secret,
    // Cookies are only marked Secure where the address they came from is, or
    // a browser on plain http would throw them away and nobody could sign in.
    secure: publicUrl.startsWith('https://'),
    publicUrl,
  };

  const app = createApp(tenants, {
    staticDir,
    ratesPath,
    brandPath,
    version,
    auth,
    log: jsonLogger(),
    health: () => ({ printer: printer.status() }),
  });

  stopHousekeeping = startHousekeeping(tenants, registry, {
    keep,
    registryBackups: resolve(dataRoot, 'registry-backups'),
  });

  return {
    app,
    describe: () => {
      const companies = registry!.listTenants();
      console.log(`Everything in ${dataRoot}`);
      console.log(
        companies.length === 0
          ? 'No companies yet. Make one with: pallet-tenant create --slug <short> --name "<name>"'
          : `${companies.length} compan(ies): ${companies.map((t) => t.slug).join(', ')}`,
      );
      console.log(`Links in invitations point at ${publicUrl}`);
      if (!auth.secure) {
        console.log('Cookies are not marked Secure, because that address is not https.');
      }
    },
    tidy: () => {},
  };
}

/* ------------------------------------------------------------------- both */

const { app, describe, tidy } = local ? localApp() : hostedApp();

if (!existsSync(staticDir)) {
  console.error(`No built editor at ${staticDir}: the API is up but the editor is not. Run npm run build.`);
}

const server = app.listen(port, host, () => {
  console.log(`Pallet spec ${version ?? ''} ${local ? '(local)' : '(hosted)'} on http://${host}:${port}`);
  describe();
  setImmediate(tidy);
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
    stopHousekeeping();

    const giveUp = setTimeout(() => {
      console.error(`Still printing after ${STOP_WITHIN_MS}ms; going anyway`);
      registry?.close();
      process.exit(0);
    }, STOP_WITHIN_MS);
    giveUp.unref();

    server.close(() => {
      void printer.close().finally(() => {
        clearTimeout(giveUp);
        registry?.close();
        process.exit(0);
      });
    });
    // Node waits on every open connection, idle ones included.
    server.closeIdleConnections();
  });
}
