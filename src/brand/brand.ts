import { BRAND_FONT_DATA_URI, LOGO_DATA_URI } from './assets.js';

/**
 * Who the sheet comes from.
 *
 * A specification sheet is sent to a customer, so it has to say whose drawing
 * it is. The name goes across the top in the company's own face; the mark goes
 * in the bottom right corner, which is where a title block's owner belongs on a
 * drawing.
 *
 * Both travel inside the document as data URIs — see `build.ts` — because the
 * sheet is rendered with no base URL to resolve a file path against.
 */

export const COMPANY_NAME = 'Ambica Patterns India Pvt Ltd';

/**
 * The family name the sheet asks for. Declared here rather than taken from the
 * font file, so nothing depends on what the file happens to call itself.
 */
export const BRAND_FONT_FAMILY = 'Ambica Brand';

/** Fallbacks for anywhere the embedded face does not arrive. */
export const BRAND_FONT_STACK = `'${BRAND_FONT_FAMILY}', 'Helvetica Neue', Helvetica, Arial, sans-serif`;

/** The @font-face rule, for a stylesheet in the sheet or in an SVG. */
export function brandFontFace(): string {
  return `@font-face {
    font-family: '${BRAND_FONT_FAMILY}';
    src: url('${BRAND_FONT_DATA_URI}') format('opentype');
    font-weight: normal;
    font-style: normal;
  }`;
}

export { LOGO_DATA_URI };
