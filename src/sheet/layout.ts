/**
 * The sheet is A4 landscape, two columns, and every box on it is fixed in
 * millimetres. Views are rendered to the exact pixel size of their cell and
 * embedded at natural size, so the stroke weights land on paper as drawn
 * instead of being dragged around by a CSS scale.
 */

export const PX_PER_MM = 96 / 25.4;

export const mmToPx = (mm: number): number => Math.floor(mm * PX_PER_MM);

export const PAGE = {
  width: 297,
  height: 210,
  padding: 8,
} as const;

const contentWidth = PAGE.width - 2 * PAGE.padding;
const contentHeight = PAGE.height - 2 * PAGE.padding;

export const SHEET = {
  contentWidth,
  contentHeight,
  headerHeight: 15,
  headerGap: 3,
  columnGap: 5,
  // The written side carries the components table, which is the part of the
  // sheet the shop reads most, so it is sized for that table at a size that can
  // be read across a bench. What is left over goes to the drawings.
  dataWidth: 115,
  // Deep enough for the logo in the bottom right corner to stand beside the
  // projection note rather than over the drawing above it.
  footerHeight: 12,
  rowGap: 2,
} as const;

/**
 * The logo in the corner. Nearly square, so the height is what to set; it fills
 * the footer band exactly, which is what that band was deepened for.
 */
export const LOGO = {
  height: SHEET.footerHeight,
  maxWidth: 24,
} as const;

/**
 * The company's name across the page, corner to corner.
 *
 * Set on the true diagonal of the sheet rather than at a round angle, so it
 * runs to the corners of this page rather than to the corners of a page it is
 * not on. It is drawn over the sheet, not under it: every view carries a white
 * background of its own, so a watermark beneath them would show only in the
 * gaps between the drawings.
 */
export const WATERMARK = {
  /** Degrees anticlockwise, bottom-left corner to top-right. */
  angle: (Math.atan2(PAGE.height, PAGE.width) * 180) / Math.PI,
  /** Corner to corner, the length there is to fill. */
  diagonal: Math.hypot(PAGE.width, PAGE.height),
  /**
   * Faint enough that it never competes with a dimension line. The sheet is
   * built from on a bench, and the linework has to win.
   */
  opacity: 0.06,
  /**
   * Point size on the printed sheet, which carries the company face embedded.
   * ITC Anna is condensed, so the name at this size runs most of the way to the
   * corners without reaching them.
   */
  fontSize: 80,
  /**
   * Point size in the SVG, which carries no font.
   *
   * The two differ because the faces do. The SVG embeds no `@font-face` — that
   * is a `<style>` block, and a `<style>` block is one of the things that makes
   * a page-layout program flatten the page — so its watermark is always set in
   * whatever sans the reader has. Helvetica at 80pt runs 110% of the diagonal
   * and off both corners; at 64pt it runs 88%, which is what ITC Anna does at
   * 80pt on paper. Measured, not guessed.
   */
  svgFontSize: 64,
  /** Tracking, as a fraction of the size, so both renderers set it the same. */
  tracking: 0.03,
} as const;

const drawingWidth = contentWidth - SHEET.dataWidth - SHEET.columnGap;
const drawingHeight =
  contentHeight - SHEET.headerHeight - SHEET.headerGap - SHEET.footerHeight;

/**
 * The two plans on the first row, the two elevations on the second, the
 * isometric across the full width on the third.
 *
 * The rows are not the same height, and their heights are not fixed here. The
 * four flat views are drawn to one shared scale — see `drawingRows` — and how
 * deep a row has to be is then whatever that scale makes it: a plan is about as
 * deep as it is wide and wants the height, an elevation is a long thin band that
 * would only sit in a tall row with air above and below it. Setting the rows
 * first and fitting each view to its row separately is what made the same
 * pallet height print at two sizes across the side and end elevations.
 *
 * What the flat views do not need goes to the isometric, which is the picture of
 * the finished pallet and reads better large.
 */
const rowsHeight = drawingHeight - 2 * SHEET.rowGap;

export const DRAWING = {
  width: drawingWidth,
  height: drawingHeight,
  pairCellWidth: (drawingWidth - SHEET.columnGap) / 2,
  /** The three rows together, the gaps between them taken out. */
  rowsHeight,
  /**
   * The isometric's floor. A deep footprint drawn at a generous shared scale
   * would otherwise take the plan row down the page and leave the picture of
   * the finished pallet a strip; past this the flat views give way instead.
   */
  minIsoRowHeight: rowsHeight * 0.34,
} as const;
