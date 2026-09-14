import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { extname, join } from 'node:path';
import { writeAtomic } from '../store/files.js';
import { readLogo, sniffImage } from './logoFile.js';
import { BRAND_FILE } from './resolve.js';
import { parseBrandFile } from './schema.js';
import type { BrandFile } from './schema.js';

/**
 * Changing a company's brand from the editor.
 *
 * The brand is files beside the designs — `brand.json`, and the artwork it
 * names under `brand/` — and this is how those files are written by somebody
 * pressing Save rather than by somebody with a shell on the server. What it
 * writes is exactly what an administrator could have put there by hand, so
 * nothing is stored that the resolver does not already read.
 *
 * Every write lands by rename, the same as a design, so a sheet being printed
 * at that moment sees the old brand or the new one and never half of each.
 */

/** Where the artwork goes, beside the file that names it. */
const ASSETS_DIR = 'brand';

/** Bigger than any face needs to be, and small enough to travel in every sheet. */
export const MAX_FONT_BYTES = 1_000_000;

const FONT_EXTENSIONS = new Set(['.otf', '.ttf', '.woff', '.woff2']);

export class BrandWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrandWriteError';
  }
}

/** The brand file as written, or nothing if the company has not made one. */
export function readBrandFile(root: string): BrandFile | null {
  const path = join(root, BRAND_FILE);
  if (!existsSync(path)) return null;
  return parseBrandFile(JSON.parse(readFileSync(path, 'utf8')));
}

/**
 * Write the brand file. The artwork it names is left alone: that is put in
 * place by `storeLogo` and `storeFont`, and taken away by their opposites.
 */
export function writeBrandFile(root: string, file: BrandFile): void {
  // Through the schema, so that what is written is what will be read back.
  const checked = parseBrandFile(file);
  writeAtomic(join(root, BRAND_FILE), `${JSON.stringify(checked, null, 2)}\n`);
}

/** The path the brand file should name for a logo, if there is one on disk. */
export function logoOnDisk(root: string): string | null {
  const dir = join(root, ASSETS_DIR);
  if (!existsSync(dir)) return null;
  const found = readdirSync(dir).find((name) => /^logo\.(svg|png|jpe?g)$/i.test(name));
  return found ? `${ASSETS_DIR}/${found}` : null;
}

export function fontOnDisk(root: string): string | null {
  const dir = join(root, ASSETS_DIR);
  if (!existsSync(dir)) return null;
  const found = readdirSync(dir).find((name) => /^font\.(otf|ttf|woff2?)$/i.test(name));
  return found ? `${ASSETS_DIR}/${found}` : null;
}

/**
 * Put a logo in place, and say what the brand file should call it.
 *
 * The file is read the way the sheet will read it before anything is written,
 * so a logo that would be refused at print time is refused here, with the
 * same words.
 */
export function storeLogo(root: string, bytes: Buffer): string {
  const kind = sniffImage(bytes);
  if (!kind) throw new BrandWriteError('That is not an SVG, a PNG or a JPEG. Save the logo as one of those.');
  // Validates, and throws a LogoError worth showing if it will not do.
  readLogo(bytes);

  removeLogo(root);
  const name = `logo.${kind === 'jpeg' ? 'jpg' : kind}`;
  mkdirSync(join(root, ASSETS_DIR), { recursive: true });
  writeAtomic(join(root, ASSETS_DIR, name), bytes);
  return `${ASSETS_DIR}/${name}`;
}

export function removeLogo(root: string): void {
  const held = logoOnDisk(root);
  if (held) rmSync(join(root, held), { force: true });
}

/**
 * Put a face in place. Only its kind is checked: whether it is licensed for
 * embedding is a question for whoever uploads it, and the editor asks.
 */
export function storeFont(root: string, bytes: Buffer, originalName: string): string {
  const extension = extname(originalName).toLowerCase();
  if (!FONT_EXTENSIONS.has(extension)) {
    throw new BrandWriteError('A font has to be an .otf, .ttf, .woff or .woff2 file.');
  }
  if (bytes.length > MAX_FONT_BYTES) {
    throw new BrandWriteError(
      `That font is ${Math.round(bytes.length / 1000)} kB, and every sheet would carry a copy. Under ${MAX_FONT_BYTES / 1000} kB, please.`,
    );
  }
  if (bytes.length < 1000) throw new BrandWriteError('That file is too small to be a font.');

  removeFont(root);
  const name = `font${extension}`;
  mkdirSync(join(root, ASSETS_DIR), { recursive: true });
  writeAtomic(join(root, ASSETS_DIR, name), bytes);
  return `${ASSETS_DIR}/${name}`;
}

export function removeFont(root: string): void {
  const held = fontOnDisk(root);
  if (held) rmSync(join(root, held), { force: true });
}
