#!/usr/bin/env node
/**
 * Turn a `pallets.sqlite` into a folder of JSON files.
 *
 *   npm run convert -- data/pallets.sqlite data/library
 *   npm run convert -- data/pallets.sqlite "/Users/me/Google Drive/Pallets"
 *
 * The database is never written to. It is copied to a temporary file first and
 * the copy is what gets opened — which matters because opening a database from
 * the version that had revisions migrates it, and doing that to the original
 * would change the one thing this is supposed to be leaving alone.
 *
 * Running it twice over the same folder is safe: every design lands in the file
 * its id names, so the second run overwrites each design with itself.
 */
import Database from 'better-sqlite3';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { parseClient, parsePallet } from '../schema.js';
import { FileStore } from '../store/files.js';
import type { Client, Pallet } from '../types.js';
import { openDb } from '../server/db.js';

export interface ConvertReport {
  clients: number;
  designs: number;
  /** Rows that would not parse, with the reason. Nothing is written for these. */
  skipped: { id: string; reason: string }[];
}

/** Read every client and design out of a database file, leaving it untouched. */
export function readDatabase(dbPath: string): { clients: Client[]; designs: Pallet[]; skipped: ConvertReport['skipped'] } {
  const scratch = mkdtempSync(join(tmpdir(), 'pallet-convert-'));
  const copy = join(scratch, basename(dbPath));
  try {
    copyFileSync(dbPath, copy);
    // A database left open by a running server keeps its recent writes in the
    // write-ahead log, and the copy is missing them without these.
    for (const suffix of ['-wal', '-shm']) {
      if (existsSync(`${dbPath}${suffix}`)) copyFileSync(`${dbPath}${suffix}`, `${copy}${suffix}`);
    }

    // Through `openDb`, so that a database from the version that had revisions
    // is brought up to date first — on the copy, where that is harmless.
    const db = openDb(copy);
    try {
      const clients = db
        .prepare<[], { id: string; name: string; created_at: string }>(
          'SELECT * FROM clients ORDER BY name',
        )
        .all()
        .map((row) => parseClient({ id: row.id, name: row.name, createdAt: row.created_at }));

      const designs: Pallet[] = [];
      const skipped: ConvertReport['skipped'] = [];
      for (const row of db
        .prepare<[], { id: string; doc: string }>('SELECT id, doc FROM pallets ORDER BY pallet_code, pallet_name')
        .all()) {
        try {
          designs.push(parsePallet(JSON.parse(row.doc)));
        } catch (error) {
          skipped.push({ id: row.id, reason: error instanceof Error ? error.message : String(error) });
        }
      }

      return { clients, designs, skipped };
    } finally {
      db.close();
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * Write a database's contents into a store folder.
 *
 * Ids are carried over exactly. A conversion is the same library in a different
 * shape, not a merge of two of them, so a design must come out pointing at the
 * client it went in pointing at — otherwise the folder is only equivalent to
 * the database rather than equal to it, and there is no way left to check the
 * move lost nothing.
 *
 * Clients are matched by name when the folder already holds some, which is what
 * makes a second run safe. It has to be by name: a database from the version
 * that had revisions has no clients table at all, and their ids are invented
 * while it is read, so a second run invents a second set. Matching those would
 * put every customer on the dashboard twice.
 */
export function convert(dbPath: string, root: string): ConvertReport {
  const { clients, designs, skipped } = readDatabase(dbPath);
  const store = new FileStore(root);

  store.transaction(() => {
    const held = store.readClients();
    const byName = new Map(held.map((client) => [client.name.trim().toLowerCase(), client]));
    const written = [...held];

    /** Where a client from the database ends up in the folder. */
    const settled = new Map<string, string>();
    const place = (client: Client): string => {
      const key = client.name.trim().toLowerCase();
      const already = byName.get(key);
      if (already) return already.id;
      byName.set(key, client);
      written.push(client);
      return client.id;
    };

    for (const client of clients) settled.set(client.id, place(client));

    for (const design of designs) {
      // A design naming a client the clients table does not hold would have
      // been dropped by the join the dashboard used to do. Here it keeps its
      // own copy of the name and gets a client built from it, so converting
      // cannot be the thing that loses a design.
      const clientId =
        settled.get(design.clientId) ??
        place({ id: design.clientId, name: design.clientName, createdAt: design.updatedAt });
      store.writeDesign(clientId === design.clientId ? design : { ...design, clientId });
    }

    store.writeClients(written);
  });

  return { clients: clients.length, designs: designs.length, skipped };
}

function main(argv: string[]): number {
  const [dbPath, root] = argv;
  if (!dbPath || !root) {
    console.error('usage: convert <pallets.sqlite> <store folder>');
    return 2;
  }
  if (!existsSync(dbPath)) {
    console.error(`No database at ${dbPath}`);
    return 1;
  }

  const report = convert(resolve(process.cwd(), dbPath), resolve(process.cwd(), root));
  console.log(`${report.clients} clients, ${report.designs} designs -> ${resolve(process.cwd(), root)}`);
  for (const bad of report.skipped) console.error(`  skipped ${bad.id}: ${bad.reason}`);
  return report.skipped.length > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) {
  process.exitCode = main(process.argv.slice(2));
}
