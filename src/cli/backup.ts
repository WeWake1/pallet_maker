#!/usr/bin/env node
/**
 * Snapshot the library, and drop the oldest snapshots beyond the limit.
 *
 *   npm run backup -- <designs folder> [--keep 30]
 *   node dist/server/backup.mjs /var/lib/pallet-spec/library --keep 30
 *
 * The server takes one snapshot when it starts, which on a laptop is every
 * morning and on a server is once a month if that. So a timer runs this every
 * night instead, and a second job copies the whole data folder off the
 * machine — see deploy/. A snapshot is one library file, the same as the
 * editor's Export library, and goes back in through the same import.
 */
import { backupLibrary } from '../server/backup.js';
import { StoreHandle } from '../store/handle.js';

const args = process.argv.slice(2);
const root = args.find((arg) => !arg.startsWith('--'));
const keepAt = args.indexOf('--keep');
const keep = keepAt >= 0 ? Number(args[keepAt + 1]) : Number(process.env.PALLET_BACKUPS ?? 30);

if (!root) {
  console.error('Usage: backup <designs folder> [--keep n]');
  process.exit(2);
}
if (!Number.isInteger(keep) || keep < 1) {
  console.error(`--keep has to be a whole number of snapshots, not "${args[keepAt + 1]}"`);
  process.exit(2);
}

const handle = new StoreHandle(root, { create: false });
if (!handle.ready()) {
  console.error(`Cannot reach ${root}: ${handle.status().problem}`);
  process.exit(1);
}

console.log(`Backed up to ${backupLibrary(handle.require(), { keep })}`);
