/**
 * A very small SVG writer. Elements are plain strings so that a view can be
 * written to a file, inlined in the sheet HTML or handed to Puppeteer without
 * any intermediate representation.
 *
 * Text is always a real <text> element. Nothing is ever converted to a path,
 * because the PDF has to keep selectable text.
 */

export type Attrs = Record<string, string | number | undefined>;

/** Trim floating point noise. Coordinates never need more than 2 decimals. */
export function fmt(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

export function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function attrs(input: Attrs): string {
  return Object.entries(input)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => {
      const text = typeof value === 'number' ? fmt(value) : String(value);
      return ` ${key}="${esc(text)}"`;
    })
    .join('');
}

export function el(name: string, input: Attrs, children?: string): string {
  return children === undefined
    ? `<${name}${attrs(input)}/>`
    : `<${name}${attrs(input)}>${children}</${name}>`;
}

export function group(input: Attrs, children: string[]): string {
  return el('g', input, children.join(''));
}

export function rect(x: number, y: number, w: number, h: number, input: Attrs = {}): string {
  return el('rect', { x, y, width: w, height: h, ...input });
}

export function line(x1: number, y1: number, x2: number, y2: number, input: Attrs = {}): string {
  return el('line', { x1, y1, x2, y2, ...input });
}

export function circle(cx: number, cy: number, r: number, input: Attrs = {}): string {
  return el('circle', { cx, cy, r, ...input });
}

export function path(d: string, input: Attrs = {}): string {
  return el('path', { d, ...input });
}

export function text(x: number, y: number, content: string, input: Attrs = {}): string {
  return el('text', { x, y, ...input }, esc(content));
}

export interface SvgDocument {
  width: number;
  height: number;
  body: string;
  /** Wrap the whole drawing in a desaturating filter, for the greyscale check. */
  greyscale?: boolean;
  /** Keeps ids unique when several views are inlined in one HTML document. */
  idPrefix?: string;
  title?: string;
  /**
   * Emit a `<g>` rather than an `<svg>`, for a view that is being placed inside
   * a larger drawing.
   *
   * A nested `<svg>` is correct and every browser draws it, but it is the first
   * thing a page-layout program gives up on — and a program that gives up on
   * one element tends to flatten the whole page to a picture rather than fail.
   * A `<g>` is the same drawing with nothing to give up on.
   *
   * The size travels on `data-width` and `data-height` so that whoever places
   * the fragment can still centre it: a `<g>` has no width of its own, and the
   * scale it was laid out at is not knowable from the outside.
   */
  fragment?: boolean;
}

/**
 * The natural size a fragment was drawn at, read back off its `<g>`.
 * Returns null for anything that is not one of our fragments.
 */
export function fragmentSize(fragment: string): { width: number; height: number } | null {
  const found = /^<g[^>]*\sdata-width="([\d.]+)"[^>]*\sdata-height="([\d.]+)"/.exec(fragment);
  return found ? { width: Number(found[1]), height: Number(found[2]) } : null;
}

export function svgDocument(doc: SvgDocument): string {
  const greyId = `${doc.idPrefix ?? 'view'}-greyscale`;
  const defs = doc.greyscale
    ? `<defs><filter id="${greyId}" color-interpolation-filters="sRGB">` +
      `<feColorMatrix type="saturate" values="0"/></filter></defs>`
    : '';
  const titleEl = doc.title ? el('title', {}, esc(doc.title)) : '';
  const content = doc.greyscale
    ? group({ filter: `url(#${greyId})` }, [doc.body])
    : doc.body;

  // A fragment carries no background: it is being placed on a page that has one
  // already, and five white rectangles would be five things to delete.
  if (doc.fragment === true) {
    return (
      `<g data-width="${fmt(doc.width)}" data-height="${fmt(doc.height)}">` +
      titleEl +
      defs +
      content +
      `</g>`
    );
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(doc.width)}" height="${fmt(doc.height)}"` +
    ` viewBox="0 0 ${fmt(doc.width)} ${fmt(doc.height)}">` +
    titleEl +
    defs +
    `<rect x="0" y="0" width="${fmt(doc.width)}" height="${fmt(doc.height)}" fill="#ffffff"/>` +
    content +
    `</svg>`
  );
}
