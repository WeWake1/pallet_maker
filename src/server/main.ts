#!/usr/bin/env node
/**
 * Run the tool.
 *
 *   npm run serve                 # API, plus the built editor if there is one
 *   PALLET_DB=path npm run serve  # somewhere other than ./data/pallets.sqlite
 */
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { DEFAULT_DB_PATH, openDb } from './db.js';

const port = Number(process.env.PORT ?? 5179);
const dbPath = process.env.PALLET_DB ?? DEFAULT_DB_PATH;
const staticDir = resolve(process.cwd(), 'dist', 'editor');

const db = openDb(dbPath);
const app = createApp(db, { staticDir });

const server = app.listen(port, () => {
  console.log(`Pallet spec generator on http://localhost:${port}`);
  console.log(`Designs in ${dbPath}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
