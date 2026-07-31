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
  dataWidth: 92,
  footerHeight: 5,
  rowGap: 2,
} as const;

const drawingWidth = contentWidth - SHEET.dataWidth - SHEET.columnGap;
const drawingHeight =
  contentHeight - SHEET.headerHeight - SHEET.headerGap - SHEET.footerHeight;

/**
 * Isometric and top on the first row, bottom and end on the second, side across
 * the full width on the third.
 */
export const DRAWING = {
  width: drawingWidth,
  height: drawingHeight,
  pairCellWidth: (drawingWidth - SHEET.columnGap) / 2,
  pairRowHeight: (drawingHeight - 2 * SHEET.rowGap) * 0.36,
  wideRowHeight: (drawingHeight - 2 * SHEET.rowGap) * 0.28,
} as const;
