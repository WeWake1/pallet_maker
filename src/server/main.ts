#!/usr/bin/env node
/**
 * Run the tool.
 *
 *   npm run serve                    # API, plus the built editor if there is one
 *   PALLET_STORE=path npm run serve  # designs somewhere other than the chosen folder
 *   PALLET_BACKUPS=n                 # how many snapshots to keep, default 20
 *
 * The store is a folder. Point it at the one Google Drive syncs and the designs
 * are shared with everybody else pointed at the same folder. Which folder that
 * is gets chosen in the editor and remembered per machine, because Drive mounts
 * somewhere different on each of them.
 */
import { resolve } from 'node:path';
import { StoreHandle } from '../store/handle.js';
import { configuredStoreRoot } from '../store/settings.js';
import { createApp } from './app.js';
import { backupDirectoryFor, backupLibrary } from './backup.js';
import { reconcileClients } from './repository.js';

const port = Number(process.env.PORT ?? 5179);
const keep = Number(process.env.PALLET_BACKUPS ?? 20);
const staticDir = resolve(process.cwd(), 'dist', 'editor');

/**
 * Where the designs are, and whether that folder is allowed to be made.
 *
 * A folder somebody chose and this program wrote down must already be there. If
 * it is not, Drive is not running or it has been moved, and making an empty one
 * would show an empty library — so it is reported instead. The built-in default
 * has nobody to report to on a first run, so that one is made.
 */
const chosen = process.env.PALLET_STORE ?? configuredStoreRoot();
const handle = new StoreHandle(chosen ?? resolve(process.cwd(), 'data', 'library'), {
  create: chosen === undefined,
  source: process.env.PALLET_STORE ? 'environment' : chosen ? 'settings' : 'default',
});

const app = createApp(handle, { staticDir });

const status = handle.status();
if (status.ready) {
  // A design can sync in before the clients file that names its client does.
  // This folds any such client back in, so the dashboard is settled before
  // anyone is looking at it.
  const adopted = reconcileClients(handle.require());
  if (adopted > 0) console.log(`Took in ${adopted} client(s) named only by their designs`);

  // Take the snapshot before serving anything, so the copy is of the designs as
  // they were when the tool was last shut down.
  try {
    const saved = backupLibrary(handle.require(), { keep });
    console.log(`Backed up to ${saved}`);
  } catch (error) {
    // A backup that fails is worth saying loudly, but it is not a reason to
    // refuse to open the designs.
    console.error(
      `Could not back up the designs: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

const server = app.listen(port, () => {
  console.log(`Pallet spec generator on http://localhost:${port}`);
  if (status.ready) {
    console.log(`Designs in ${status.root}`);
    console.log(`Backups in ${backupDirectoryFor(status.root!)}, keeping ${keep}`);
  } else {
    // Still serving: the editor needs to be reachable to be told where to look.
    console.error(`Cannot reach the designs folder ${status.root}: ${status.problem}`);
    console.error('Open the editor and choose a folder, or set PALLET_STORE.');
  }
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      process.exit(0);
    });
  });
}
