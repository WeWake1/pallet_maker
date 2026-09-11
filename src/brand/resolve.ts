import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve as resolvePath } from 'node:path';
import { readLogo } from './logoFile.js';
import { parseBrandFile } from './schema.js';
import type { BrandFile } from './schema.js';
import { DEFAULT_BRAND } from './defaults.js';
import type { Brand, BrandFont } from './types.js';

/**
 * Whose name is on the sheet, read off a disk.
 *
 * The same arrangement as the prices: a `brand.json` beside the designs takes
 * the place of the one that ships with the program. The folder is the
 * company's, so what is in it is the company's — change the logo there and
 * every sheet printed from that folder carries the new one, with nothing to
 * install.
 *
 * A brand file that will not read is **not** quietly ignored. A sheet is a
 * document that goes to a customer over the company's name, so printing one
 * under the wrong name, or under none, is not something to discover later: the
 * built-in brand is used so that work goes on, and the problem is carried out
 * to be said on screen.
 */

export const BRAND_FILE = 'brand.json';

export interface BrandInUse {
  brand: Brand;
  /** Which of the two this came from, for saying so on screen. */
  from: 'folder' | 'built-in';
  /** Why the folder's brand was not used, when there is one and it failed. */
  problem: string | null;
}

/** What the files looked like when they were last read. */
interface Mark {
  path: string;
  mtimeMs: number;
  size: number;
}

interface Cached {
  marks: Mark[];
  value: BrandInUse;
}

const FONT_FORMATS: Record<string, BrandFont['format']> = {
  '.otf': 'opentype',
  '.ttf': 'truetype',
  '.woff': 'woff',
  '.woff2': 'woff2',
};

function mark(path: string): Mark {
  const stat = statSync(path);
  return { path, mtimeMs: stat.mtimeMs, size: stat.size };
}

/**
 * Run something that touches one of the files the brand names, and say which
 * file if it fails — by the name the brand file gave it, not by where that
 * turned out to be on the disk.
 */
function beside_<T>(named: string, work: () => T): T {
  try {
    return work();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    // A filesystem error repeats the whole path it tried; the name is enough.
    throw new Error(`${named}: ${reason.replace(/,? *(?:open|stat|lstat) '[^']*'/g, '').trim()}`);
  }
}

function unchanged(marks: Mark[]): boolean {
  return marks.every((held) => {
    try {
      const now = mark(held.path);
      return now.mtimeMs === held.mtimeMs && now.size === held.size;
    } catch {
      return false;
    }
  });
}

/**
 * Read a brand file and everything it points at.
 *
 * The paths inside it are relative to the file itself, so a brand folder can
 * be copied somewhere else whole and still work. `marks` comes back alongside
 * so the caller can tell when any of the files has moved on.
 */
export function readBrand(path: string): { brand: Brand; marks: Mark[] } {
  const marks = [mark(path)];
  const file: BrandFile = parseBrandFile(JSON.parse(readFileSync(path, 'utf8')));
  const beside = dirname(path);

  let logo = DEFAULT_BRAND.logo;
  if (file.logo) {
    const logoPath = resolvePath(beside, file.logo);
    // Named as the brand file names it. Whoever reads the complaint typed
    // that, and where the folder happens to sit on a server is not theirs to
    // know or to fix.
    beside_(file.logo, () => marks.push(mark(logoPath)));
    logo = beside_(file.logo, () => readLogo(readFileSync(logoPath), 'brandlogo'));
  }

  let font: BrandFont | null = null;
  if (file.font) {
    const fontFile = file.font.file;
    const fontPath = resolvePath(beside, fontFile);
    beside_(fontFile, () => marks.push(mark(fontPath)));
    const format = FONT_FORMATS[extname(fontPath).toLowerCase()];
    if (!format) {
      throw new Error(`${fontFile} is not a font this can embed. Use .otf, .ttf, .woff or .woff2.`);
    }
    font = {
      family: file.font.family,
      dataUri: beside_(
        fontFile,
        () =>
          `data:font/${format === 'opentype' ? 'otf' : format === 'truetype' ? 'ttf' : format};base64,${readFileSync(fontPath).toString('base64')}`,
      ),
      format,
      ...(file.font.advanceEm === undefined ? {} : { advanceEm: file.font.advanceEm }),
    };
  }

  const text = file.watermark.text ?? file.companyName;
  return {
    brand: {
      companyName: file.companyName,
      logo,
      watermark: {
        // A watermark is on when there is something for it to say, unless the
        // file says otherwise.
        enabled: file.watermark.enabled ?? text !== '',
        text,
        opacity: file.watermark.opacity,
        sizePt: file.watermark.sizePt,
      },
      font,
      projectionNote: file.projectionNote,
      tolerances: file.tolerances,
      units: { length: 'mm', volume: file.units.volume },
      defaults: file.defaults,
    },
    marks,
  };
}

/**
 * Reads the brand, remembering it until one of its files changes.
 *
 * A resolver rather than a value, because both the folder and what is in it
 * can change while the program is running — somebody points at a different
 * folder, or replaces the logo and lets a sync carry it over.
 */
export function brandResolver(folder: () => string | null, builtInPath?: string): () => BrandInUse {
  let cache: Cached | undefined;
  let builtIn: { brand: Brand; marks: Mark[] } | undefined;

  const readBuiltIn = (): BrandInUse => {
    if (!builtInPath || !existsSync(builtInPath)) {
      return { brand: DEFAULT_BRAND, from: 'built-in', problem: null };
    }
    if (!builtIn || !unchanged(builtIn.marks)) {
      try {
        builtIn = readBrand(builtInPath);
      } catch (error) {
        // The one that ships with the program failing is a fault in the
        // program, not in anybody's folder. Say so and carry on unbranded
        // rather than refusing to print.
        console.error(
          `Could not read the brand at ${builtInPath}: ${error instanceof Error ? error.message : String(error)}`,
        );
        builtIn = { brand: DEFAULT_BRAND, marks: [] };
      }
    }
    return { brand: builtIn.brand, from: 'built-in', problem: null };
  };

  return () => {
    const root = folder();
    const path = root === null ? null : join(root, BRAND_FILE);

    if (path === null || !existsSync(path)) return readBuiltIn();
    if (cache && cache.marks[0]?.path === path && unchanged(cache.marks)) return cache.value;

    let value: BrandInUse;
    let marks: Mark[];
    try {
      const read = readBrand(path);
      value = { brand: read.brand, from: 'folder', problem: null };
      marks = read.marks;
    } catch (error) {
      const fallback = readBuiltIn();
      value = {
        brand: fallback.brand,
        from: 'built-in',
        problem:
          `The ${BRAND_FILE} beside the designs could not be read ` +
          `(${error instanceof Error ? error.message : String(error)}). ` +
          'Sheets are being printed with the branding built into this version instead.',
      };
      // The full path goes to the log, where whoever looks after the server
      // can see it, rather than to whoever happens to be drawing a pallet.
      console.error(`${path}: ${value.problem}`);
      // Only the brand file itself, so that fixing it is noticed even though
      // whatever it pointed at could not be read.
      marks = [mark(path)];
    }

    cache = { marks, value };
    return value;
  };
}
