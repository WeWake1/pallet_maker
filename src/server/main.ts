#!/usr/bin/env node
/**
 * Run the tool.
 *
 *   npm run serve                 # API, plus the built editor if there is one
 *   PALLET_DB=path npm run serve  # somewhere other than ./data/pallets.sqlite
 *   PALLET_BACKUPS=n              # how many snapshots to keep, default 20
 */
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { backupDatabase, backupDirectoryFor } from './backup.js';
import { DEFAULT_DB_PATH, openDb } from './db.js';

const port = Number(process.env.PORT ?? 5179);
const dbPath = process.env.PALLET_DB ?? DEFAULT_DB_PATH;
const keep = Number(process.env.PALLET_BACKUPS ?? 20);
const staticDir = resolve(process.cwd(), 'dist', 'editor');

const db = openDb(dbPath);
const app = createApp(db, { staticDir });

// Take the snapshot before serving anything, so the copy is of the designs as
// they were when the tool was last shut down.
if (dbPath !== ':memory:') {
  try {
    const saved = await backupDatabase(db, dbPath, { keep });
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
  console.log(`Designs in ${dbPath}`);
  console.log(`Backups in ${backupDirectoryFor(dbPath)}, keeping ${keep}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
