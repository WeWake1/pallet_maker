import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { FileStore } from '../store/files.js';
import { exportLibrary } from './library.js';
import { ClientRepository, PalletRepository } from './repository.js';

/**
 * Snapshots of the library.
 *
 * Once a couple of hundred designs are in it, this folder is the business
 * record: the thing a client complaint gets judged against. Writing by rename
 * stops the program from spoiling it, and Drive keeps its own version history
 * of each file. Neither helps against the folder itself being deleted, or a
 * sync that goes wrong and takes the designs with it, so a copy of the whole
 * library is taken every time the tool starts.
 *
 * A snapshot is one library document rather than a copy of the folder: it is a
 * single file, so it cannot be caught half-written, and it goes back in through
 * the same import any other library file does.
 */

export interface BackupOptions {
  /** Where the snapshots go. Defaults to `backups/` inside the store. */
  directory?: string;
  /** How many to keep. The oldest are removed beyond this. */
  keep?: number;
  /** For a stable name in tests. */
  now?: Date;
}

const PREFIX = 'pallets-';
const SUFFIX = '.json';

function stamp(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

export function backupDirectoryFor(root: string): string {
  return resolve(root, 'backups');
}

/** Snapshot the library, then drop the oldest beyond `keep`. */
export function backupLibrary(store: FileStore, options: BackupOptions = {}): string {
  const directory = options.directory ?? backupDirectoryFor(store.root);
  const keep = options.keep ?? 20;

  const library = exportLibrary(new PalletRepository(store), new ClientRepository(store));

  mkdirSync(directory, { recursive: true });
  const target = join(directory, `${PREFIX}${stamp(options.now ?? new Date())}${SUFFIX}`);
  writeFileSync(target, `${JSON.stringify(library, null, 2)}\n`, 'utf8');

  prune(directory, keep);
  return target;
}

/** Snapshots newest first. */
export function listBackups(directory: string): string[] {
  let names: string[];
  try {
    names = readdirSync(directory);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.startsWith(PREFIX) && name.endsWith(SUFFIX))
    .map((name) => join(directory, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
}

function prune(directory: string, keep: number): void {
  for (const old of listBackups(directory).slice(Math.max(keep, 1))) {
    rmSync(old, { force: true });
  }
}
