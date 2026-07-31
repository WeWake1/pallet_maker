import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Db } from './db.js';

/**
 * Snapshots of the database.
 *
 * Once a couple of hundred designs are in it, this one file is the business
 * record: the thing a client complaint gets judged against. The frozen-row
 * triggers stop the program from spoiling it. They do nothing about a disk
 * fault or a stray delete, so a copy is taken every time the tool starts.
 *
 * `better-sqlite3` does the copying, which is a proper online backup rather
 * than a file copy that could catch a half-written page.
 */

export interface BackupOptions {
  /** Where the snapshots go. Defaults to `backups/` beside the database. */
  directory?: string;
  /** How many to keep. The oldest are removed beyond this. */
  keep?: number;
  /** For a stable name in tests. */
  now?: Date;
}

const PREFIX = 'pallets-';
const SUFFIX = '.sqlite';

function stamp(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

export function backupDirectoryFor(dbPath: string): string {
  return resolve(dirname(dbPath), 'backups');
}

/** Snapshot the database, then drop the oldest beyond `keep`. */
export async function backupDatabase(
  db: Db,
  dbPath: string,
  options: BackupOptions = {},
): Promise<string> {
  const directory = options.directory ?? backupDirectoryFor(dbPath);
  const keep = options.keep ?? 20;

  mkdirSync(directory, { recursive: true });
  const target = join(directory, `${PREFIX}${stamp(options.now ?? new Date())}${SUFFIX}`);
  await db.backup(target);

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
