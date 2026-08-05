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
  footerHeight: 5,
  rowGap: 2,
} as const;

const drawingWidth = contentWidth - SHEET.dataWidth - SHEET.columnGap;
const drawingHeight =
  contentHeight - SHEET.headerHeight - SHEET.headerGap - SHEET.footerHeight;

/**
 * The two plans on the first row, the two elevations on the second, the
 * isometric across the full width on the third.
 *
 * The rows are not the same height because the views are not the same shape. A
 * plan is about as deep as it is wide and wants the height; an elevation is a
 * long thin band that would only sit in the middle of a tall row with air above
 * and below it. What the elevations do not need goes to the isometric, which is
 * the picture of the finished pallet and reads better large.
 */
const rowsHeight = drawingHeight - 2 * SHEET.rowGap;

export const DRAWING = {
  width: drawingWidth,
  height: drawingHeight,
  pairCellWidth: (drawingWidth - SHEET.columnGap) / 2,
  planRowHeight: rowsHeight * 0.36,
  elevationRowHeight: rowsHeight * 0.2,
  isoRowHeight: rowsHeight * 0.44,
} as const;
