/**
 * The company mark, as vector.
 *
 * Traced from `Ambica Patterns (india) Pvt.Ltd..png` rather than embedded from
 * it. The mark is three shapes — a triangle, the stem of a P and its bowl — and
 * as geometry it costs a few hundred bytes instead of fifty kilobytes, prints
 * sharp at any size, and leaves nothing raster anywhere in the outputs.
 *
 * That last part is what makes the SVG sheet worth having. An `<image>` holding
 * a base64 PNG is one of the things a page-layout program cannot take apart, and
 * a program that cannot take one element apart tends to give up and flatten the
 * whole page to a picture. Every mark on the sheet is now a shape or a letter.
 *
 * The numbers below are pixel measurements off the artwork, which is 1460 × 1278:
 *
 *   triangle  apex (730, 0), base corners (0, 1278) and (1460, 1278)
 *   stem      x 543 to 748, y 557 to 1173
 *   bowl      half-ellipse, flat side at x 797, centre y 732.5, rx 194, ry 175.5
 *
 * **If the artwork ever changes, this has to be traced again** — nothing here
 * reads the PNG. `src/brand/probe` is not kept; re-measure and update these
 * numbers, or go back to embedding the file.
 */

export const LOGO_COLOUR = '#5ca3ff';

/**
 * The P is painted white rather than knocked out of the triangle. That is what
 * the artwork does — the letter is opaque white, not a hole — and the two only
 * look the same while the mark sits on white paper. It also gives a drawing
 * program two shapes it can recolour separately instead of one with holes in.
 */
export const LOGO_LETTER_COLOUR = '#ffffff';

export const LOGO_BOX = { width: 1460, height: 1278 } as const;

/** Width over height. The mark is very slightly wider than it is tall. */
export const LOGO_ASPECT = LOGO_BOX.width / LOGO_BOX.height;

/** The triangle the mark is built on. */
export const LOGO_TRIANGLE_PATH = 'M730 0L1460 1278H0Z';

/**
 * The P: the stem, then the bowl.
 *
 * The bowl is a half-ellipse and not a half-circle — 194 across against 175.5
 * down — which is the whole reason this is traced from measurements rather than
 * drawn from memory.
 */
export const LOGO_LETTER_PATH = 'M543 557H749V1174H543ZM797 557A194 175.5 0 0 1 797 908Z';

/** The two shapes, as `<path>` elements, ready to sit in any `<svg>` or `<g>`. */
export function logoPaths(): string {
  return (
    `<path d="${LOGO_TRIANGLE_PATH}" fill="${LOGO_COLOUR}"/>` +
    `<path d="${LOGO_LETTER_PATH}" fill="${LOGO_LETTER_COLOUR}"/>`
  );
}

/** The mark as a standalone `<svg>`, for inlining in the printed sheet. */
export function logoSvg(attrs: { width: string; height: string; title?: string }): string {
  const title = attrs.title
    ? `<title>${attrs.title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</title>`
    : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="logo" role="img"` +
    ` width="${attrs.width}" height="${attrs.height}"` +
    ` viewBox="0 0 ${LOGO_BOX.width} ${LOGO_BOX.height}">` +
    title +
    logoPaths() +
    `</svg>`
  );
}
