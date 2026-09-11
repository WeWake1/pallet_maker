import { PAGE } from './layout.js';

/**
 * How big the name across the diagonal has to be to fill it.
 *
 * It used to be two numbers: 80 point on the printed sheet and 64 in the SVG,
 * both measured by eye against one company's name in one company's face. Any
 * other name is a different length, and any other face is a different width
 * per letter, so a fixed size either stops short of the corners or runs off
 * them. The size is worked out instead, from the length of the name and how
 * wide a letter is in the face it will be set in.
 *
 * The two sizes differ for a reason that has not changed: the printed sheet
 * carries the company's face inside it, and the SVG carries no face at all —
 * a `<style>` block is one of the things that makes a page-layout program give
 * up and flatten the page — so its watermark is always set in whatever sans
 * the reader has.
 */

/** Points across the page, corner to corner. */
const DIAGONAL_PT = (Math.hypot(PAGE.width, PAGE.height) * 72) / 25.4;

/**
 * How much of the diagonal the name fills.
 *
 * Not all of it: a watermark that reached the corners would touch the trimmed
 * edge, and the two ends of it would sit under the header and the footer
 * rather than behind the drawings.
 */
export const WATERMARK_FILL = 0.88;

/**
 * How wide a letter is, as a fraction of the size, tracking included.
 *
 * Two faces were measured on the sheet before any of this was worked out:
 * Helvetica at 64 point, and a condensed face at 80 point, each running the
 * same 88% of the diagonal for the same 29-character name. These are those two
 * measurements turned back into a width per letter, which is why they are
 * stated so precisely — at any less, the sheets that have already gone out
 * would come back a fraction of a point different.
 */
export const FALLBACK_ADVANCE_EM = 0.488848;
/** The same measurement for a condensed face, for a brand file to start from. */
export const CONDENSED_ADVANCE_EM = 0.391078;

/** Small enough to read as a watermark, large enough to be seen at all. */
export const MIN_SIZE_PT = 24;
export const MAX_SIZE_PT = 96;

/**
 * The size at which `text` runs `WATERMARK_FILL` of the diagonal, in a face
 * whose letters average `advanceEm` wide.
 *
 * Clamped at both ends, so a one-word name does not become a headline and a
 * long one stays legible rather than shrinking away.
 */
export function watermarkSizePt(text: string, advanceEm = FALLBACK_ADVANCE_EM): number {
  const characters = text.trim().length;
  if (characters === 0) return MIN_SIZE_PT;
  const wanted = (WATERMARK_FILL * DIAGONAL_PT) / (characters * advanceEm);
  const clamped = Math.min(MAX_SIZE_PT, Math.max(MIN_SIZE_PT, wanted));
  // Two decimals: enough that a long name and a slightly longer one differ,
  // and not so many that the stylesheet is full of noise.
  return Math.round(clamped * 100) / 100;
}

/** What the name is set at on paper, where the company's own face may be used. */
export function printedWatermarkSizePt(
  text: string,
  font: { advanceEm?: number } | null,
  override: number | null,
): number {
  return override ?? watermarkSizePt(text, font?.advanceEm ?? FALLBACK_ADVANCE_EM);
}
