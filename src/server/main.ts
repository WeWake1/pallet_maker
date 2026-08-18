#!/usr/bin/env node
/**
 * Run the tool.
 *
 *   npm run serve                    # API, plus the built editor if there is one
 *   PALLET_STORE=path npm run serve  # designs somewhere other than ./data/library
 *   PALLET_BACKUPS=n                 # how many snapshots to keep, default 20
 *
 * The store is a folder. Point it at the one Google Drive syncs and the designs
 * are shared with everybody else pointed at the same folder.
 */
import { resolve } from 'node:path';
import { FileStore } from '../store/files.js';
import { createApp } from './app.js';
import { backupDirectoryFor, backupLibrary } from './backup.js';
import { reconcileClients } from './repository.js';

const port = Number(process.env.PORT ?? 5179);
const root = process.env.PALLET_STORE ?? resolve(process.cwd(), 'data', 'library');
const keep = Number(process.env.PALLET_BACKUPS ?? 20);
const staticDir = resolve(process.cwd(), 'dist', 'editor');

const store = new FileStore(root);
const app = createApp(store, { staticDir });

// A design can sync in before the clients file that names its client does. This
// folds any such client back in, so the dashboard is settled before anyone is
// looking at it.
const adopted = reconcileClients(store);
if (adopted > 0) console.log(`Took in ${adopted} client(s) named only by their designs`);

// Take the snapshot before serving anything, so the copy is of the designs as
// they were when the tool was last shut down.
try {
  const saved = backupLibrary(store, { keep });
  console.log(`Backed up to ${saved}`);
} catch (error) {
  // A backup that fails is worth saying loudly, but it is not a reason to
  // refuse to open the designs.
  console.error(
    `Could not back up the designs: ${error instanceof Error ? error.message : String(error)}`,
  );
}

const server = app.listen(port, () => {
  console.log(`Pallet spec generator on http://localhost:${port}`);
  console.log(`Designs in ${store.root}`);
  console.log(`Backups in ${backupDirectoryFor(store.root)}, keeping ${keep}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      process.exit(0);
    });
  });
}
