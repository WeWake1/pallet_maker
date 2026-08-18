import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/**
 * Where this copy of the program keeps its own preferences.
 *
 * Only one thing is in here: which folder the designs are in. It deliberately
 * does not live in that folder. The designs are shared — several people point
 * at the same Drive folder — but the path to them is not: Drive mounts
 * somewhere different on every machine, and a shared setting would send
 * everyone to whichever of them saved it last.
 *
 * `PALLET_SETTINGS` moves the file, which is what the tests use.
 */

const APP = 'pallet-spec-generator';

export interface Settings {
  /** The folder the designs are in, as the person who chose it typed it. */
  storeRoot?: string;
}

export function settingsDirectory(): string {
  const override = process.env.PALLET_SETTINGS;
  if (override) return resolve(override);

  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), APP);
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', APP);
  }
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), APP);
}

export function settingsPath(): string {
  return join(settingsDirectory(), 'settings.json');
}

/**
 * The settings as they stand.
 *
 * A file that will not parse is treated as no settings at all rather than as a
 * failure to start. The only thing it can cost is having to choose the folder
 * again, which is a great deal better than the tool refusing to open.
 */
export function readSettings(): Settings {
  const path = settingsPath();
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (typeof raw !== 'object' || raw === null) return {};
    const { storeRoot } = raw as Settings;
    return typeof storeRoot === 'string' && storeRoot.trim() !== '' ? { storeRoot } : {};
  } catch (error) {
    console.error(`Ignoring unreadable settings at ${path}: ${
      error instanceof Error ? error.message : String(error)
    }`);
    return {};
  }
}

export function writeSettings(settings: Settings): void {
  const path = settingsPath();
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid.toString(36)}`;
  try {
    writeFileSync(temp, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
    renameSync(temp, path);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

/** Where the settings say the designs are, if they say. */
export function configuredStoreRoot(): string | undefined {
  return readSettings().storeRoot;
}

export function rememberStoreRoot(root: string): void {
  writeSettings({ ...readSettings(), storeRoot: resolve(root) });
}
