/**
 * Turning a logo file into something safe to put on a sheet.
 *
 * The file comes from a customer. An SVG is a document with a scripting model,
 * and the sheet it lands on is opened in a browser, so what arrives is not
 * embedded as it came: the markup is read, held to a list of shapes and
 * attributes that a drawing can be made of, and anything else is refused with
 * a reason that says what to do instead.
 *
 * The list is deliberately shorter than SVG. The sheet's whole SVG export
 * exists so that a page-layout program can take it apart, and the things that
 * make such a program give up and flatten the page — a stylesheet, a clip
 * path, a filter, a use — are exactly the things a logo is likeliest to carry.
 * Refusing them keeps that promise for every company that uploads vector.
 */

import type { BrandLogo } from './types.js';

/** Bigger than any mark needs to be, and small enough to sit in every sheet. */
export const MAX_SVG_BYTES = 200_000;
export const MAX_RASTER_BYTES = 512_000;
/** Past this a picture is being used where a logo was meant. */
export const MAX_RASTER_PIXELS = 2000;

/** Shapes, groups, text and the gradients that fill them. Nothing else. */
const ALLOWED_ELEMENTS = new Set([
  'circle', 'defs', 'desc', 'ellipse', 'g', 'line', 'linearGradient', 'path',
  'polygon', 'polyline', 'radialGradient', 'rect', 'stop', 'svg', 'text',
  'title', 'tspan',
]);

/**
 * Presentation and geometry. Nothing that loads, scripts or styles: no `on*`,
 * no `style`, no `href` (which is only ever a reference to elsewhere).
 */
const ALLOWED_ATTRIBUTES = new Set([
  'cx', 'cy', 'd', 'dx', 'dy', 'fill', 'fill-opacity', 'fill-rule',
  'font-family', 'font-size', 'font-style', 'font-weight', 'gradientTransform',
  'gradientUnits', 'height', 'id', 'offset', 'opacity', 'points', 'r', 'rx',
  'ry', 'spreadMethod', 'stop-color', 'stop-opacity', 'stroke',
  'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin',
  'stroke-miterlimit', 'stroke-opacity', 'stroke-width', 'text-anchor',
  'transform', 'width', 'x', 'x1', 'x2', 'y', 'y1', 'y2',
]);

export class LogoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LogoError';
  }
}

/** What a file is, judged by its first bytes rather than by its name. */
export function sniffImage(bytes: Buffer): 'png' | 'jpeg' | 'svg' | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  const head = bytes.subarray(0, 1024).toString('utf8').trimStart();
  if (head.startsWith('<svg') || head.startsWith('<?xml') || head.startsWith('<!--')) return 'svg';
  return null;
}

/** A logo from a file, whatever kind it turns out to be. */
export function readLogo(bytes: Buffer, idPrefix = 'logo'): BrandLogo {
  const kind = sniffImage(bytes);
  if (kind === 'svg') return readSvgLogo(bytes.toString('utf8'), idPrefix);
  if (kind === 'png' || kind === 'jpeg') return readRasterLogo(bytes, kind);
  throw new LogoError('That is not an SVG, a PNG or a JPEG. Save the logo as one of those.');
}

/* --------------------------------------------------------------- vector */

export function readSvgLogo(source: string, idPrefix = 'logo'): BrandLogo {
  if (Buffer.byteLength(source, 'utf8') > MAX_SVG_BYTES) {
    throw new LogoError(`That SVG is bigger than ${Math.round(MAX_SVG_BYTES / 1000)} kB. Simplify it, or upload a PNG.`);
  }
  // A document type or an entity is how an SVG reads a file off the machine
  // that opens it. A logo has no use for either.
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(source)) {
    throw new LogoError('That SVG carries a document type or an entity. Export it as a plain SVG.');
  }

  const root = /<svg\b([^>]*)>/i.exec(source);
  if (!root) throw new LogoError('That file has no <svg> in it.');
  const { width, height } = rootSize(root[1]!);

  const closed = source.lastIndexOf('</svg>');
  if (closed < 0) throw new LogoError('That SVG is cut off: it has no closing </svg>.');
  const inner = source.slice(root.index + root[0].length, closed);

  return { kind: 'svg', svg: sanitiseMarkup(inner, idPrefix), width, height };
}

/** The box the shapes are drawn in: the viewBox, or the width and height. */
function rootSize(attributes: string): { width: number; height: number } {
  const viewBox = /\bviewBox\s*=\s*["']([^"']+)["']/i.exec(attributes);
  if (viewBox) {
    const parts = viewBox[1]!.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n)) && parts[2]! > 0 && parts[3]! > 0) {
      // A viewBox that does not start at the origin is honoured by shifting
      // nothing: the box is what the sheet scales, and its offset comes along
      // inside the shapes.
      return { width: parts[2]!, height: parts[3]! };
    }
  }
  const width = length(/\bwidth\s*=\s*["']([^"']+)["']/i.exec(attributes)?.[1]);
  const height = length(/\bheight\s*=\s*["']([^"']+)["']/i.exec(attributes)?.[1]);
  if (width && height) return { width, height };
  throw new LogoError('That SVG says no viewBox and no size, so nothing can tell how wide the mark is.');
}

function length(value: string | undefined): number | null {
  if (!value) return null;
  const number = Number.parseFloat(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

/**
 * Every tag held to the list, every attribute held to the list, and every id
 * moved out of the way.
 *
 * The ids matter because the mark is dropped into a sheet that has ids of its
 * own — the views are rendered with a prefix for the same reason — and two
 * elements answering to one name is a gradient that goes missing on one of
 * them.
 */
function sanitiseMarkup(markup: string, idPrefix: string): string {
  // Comments are dropped rather than carried through. Nothing needs them, and
  // one containing a stray angle bracket would take the rest of the mark with
  // it when this walks the tags below.
  const source = markup.replace(/<!--[\s\S]*?-->/g, '');

  const out: string[] = [];
  const tag = /<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let at = 0;
  let match: RegExpExecArray | null;

  while ((match = tag.exec(source)) !== null) {
    const [whole, closing, rawName, rawAttributes] = match;
    // Text between the tags: kept, since a wordmark may be set as text.
    out.push(source.slice(at, match.index));
    at = match.index + whole.length;

    const name = rawName!.includes(':') ? rawName!.split(':').pop()! : rawName!;
    if (!ALLOWED_ELEMENTS.has(name)) {
      throw new LogoError(
        `That SVG uses <${name}>, which a specification sheet cannot carry. ` +
          'Flatten the logo to plain shapes when you export it, or upload a PNG instead.',
      );
    }
    if (closing) {
      out.push(`</${name}>`);
      continue;
    }

    // The slash of a self-closing tag sits where an attribute would, so it is
    // taken off here rather than matched separately — a pattern that tried to
    // match it separately would let the attributes swallow it, and the shape
    // would come out unclosed.
    const attributes = (rawAttributes ?? '').replace(/\/\s*$/, '');
    const selfClosing = attributes.length !== (rawAttributes ?? '').length;
    out.push(`<${name}${sanitiseAttributes(attributes, idPrefix)}${selfClosing ? '/' : ''}>`);
  }

  out.push(source.slice(at));
  return out.join('');
}

function sanitiseAttributes(source: string, idPrefix: string): string {
  const kept: string[] = [];
  const attribute = /([a-zA-Z_:][a-zA-Z0-9_:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;

  while ((match = attribute.exec(source)) !== null) {
    const name = match[1]!;
    const value = match[3] ?? match[4] ?? '';
    const bare = name.includes(':') ? name.split(':').pop()! : name;

    if (/^on/i.test(name)) continue;
    if (bare === 'href') {
      // The only reference a logo may make is to itself.
      if (!value.trim().startsWith('#')) {
        throw new LogoError('That SVG points at something outside itself. A logo has to stand alone.');
      }
      kept.push(`href="#${idPrefix}-${escapeAttribute(value.trim().slice(1))}"`);
      continue;
    }
    if (!ALLOWED_ATTRIBUTES.has(bare)) continue;

    if (bare === 'id') {
      kept.push(`id="${idPrefix}-${escapeAttribute(value)}"`);
      continue;
    }
    // `fill="url(#a)"` and the like: the name it points at has moved too.
    const rewritten = value.replace(/url\(\s*#([^)\s]+)\s*\)/g, (_, id: string) => `url(#${idPrefix}-${id})`);
    if (/url\(\s*(?!#)/i.test(rewritten) || /(javascript|data)\s*:/i.test(rewritten)) {
      throw new LogoError('That SVG loads something from outside itself. A logo has to stand alone.');
    }
    kept.push(`${bare}="${escapeAttribute(rewritten)}"`);
  }

  return kept.length > 0 ? ` ${kept.join(' ')}` : '';
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* --------------------------------------------------------------- raster */

export function readRasterLogo(bytes: Buffer, kind: 'png' | 'jpeg'): BrandLogo {
  if (bytes.length > MAX_RASTER_BYTES) {
    throw new LogoError(`That picture is bigger than ${Math.round(MAX_RASTER_BYTES / 1000)} kB. Save it smaller.`);
  }
  const size = kind === 'png' ? pngSize(bytes) : jpegSize(bytes);
  if (!size) throw new LogoError('That picture is damaged: nothing in it says how big it is.');
  if (size.width > MAX_RASTER_PIXELS || size.height > MAX_RASTER_PIXELS) {
    throw new LogoError(`That picture is over ${MAX_RASTER_PIXELS} pixels across. A logo needs far less.`);
  }
  return {
    kind: 'raster',
    dataUri: `data:image/${kind === 'png' ? 'png' : 'jpeg'};base64,${bytes.toString('base64')}`,
    ...size,
  };
}

/** PNG says its size in the header chunk, which is always first. */
function pngSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 24 || bytes.subarray(12, 16).toString('latin1') !== 'IHDR') return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** JPEG says its size in whichever start-of-frame marker it happens to use. */
function jpegSize(bytes: Buffer): { width: number; height: number } | null {
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) {
      at += 1;
      continue;
    }
    const marker = bytes[at + 1]!;
    // Every SOFn but the four that are not frames at all.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc, 0xd8].includes(marker)) {
      return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) };
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    at += 2 + bytes.readUInt16BE(at + 2);
  }
  return null;
}
