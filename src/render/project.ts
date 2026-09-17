import { notchOutline } from '../geometry/notch.js';
import type { Layout, PlacedPiece } from '../geometry/types.js';

/**
 * Flat views, all generated from PlacedPiece[]. First-angle projection.
 *
 *   top    looking down    u = length, v = width
 *   bottom looking up      u = length, v = width mirrored, so it is a real view
 *                          from underneath rather than a flipped top view
 *   side   the long face,  looking from the y- side:  u = length, v = height
 *   end    the short face, looking from the x- end:   u = width,  v = height
 *
 * v always runs down the page, so height is flipped: the top of the pallet is
 * at the top of the side and end views.
 */
export type ViewKind = 'top' | 'bottom' | 'side' | 'end';

export const VIEW_TITLE: Record<ViewKind, string> = {
  top: 'TOP VIEW',
  bottom: 'BOTTOM VIEW',
  side: 'SIDE VIEW',
  end: 'END VIEW',
};

/** A rectangle in view coordinates, in mm. */
export interface Cut {
  u: number;
  v: number;
  du: number;
  dv: number;
  /** The radius of the top corners, where the rectangle is a notch. */
  r?: number;
}

/** A box in pallet coordinates: a piece, or a notch cut from one. */
type Box3 = Pick<PlacedPiece, 'x' | 'y' | 'z' | 'dx' | 'dy' | 'dz'>;

export interface Projected {
  piece: PlacedPiece;
  /** Where this piece sits in `layout.pieces`, which is how the editor names it. */
  index: number;
  u: number;
  v: number;
  du: number;
  dv: number;
  /** Larger is nearer the viewer. Used for painter ordering. */
  depth: number;
  /** Drawn solid; everything else in the view is drawn faint. */
  near: boolean;
  /**
   * The piece's notches as this view shows them, in its coordinates. In an
   * elevation looking across the board they are bites out of its outline,
   * standing on its bottom edge; in the bottom view they are recesses in its
   * underside, to be outlined. Empty from above, where they are underneath,
   * and in the elevation looking along the board, where the timber either side
   * of a notch fills the outline and hides it. See `cutsOf`.
   */
  cuts: Cut[];
}

/** The overall outline of the pallet in this view, in mm. */
export function viewFrame(layout: Layout, view: ViewKind): { uSpan: number; vSpan: number } {
  switch (view) {
    case 'top':
    case 'bottom':
      return { uSpan: layout.overallLength, vSpan: layout.overallWidth };
    case 'side':
      return { uSpan: layout.overallLength, vSpan: layout.overallHeight };
    case 'end':
      return { uSpan: layout.overallWidth, vSpan: layout.overallHeight };
  }
}

/** What u and v measure in this view. Dimension labels read off this. */
export function viewAxes(view: ViewKind): { u: 'length' | 'width'; v: 'width' | 'height' } {
  switch (view) {
    case 'top':
    case 'bottom':
      return { u: 'length', v: 'width' };
    case 'side':
      return { u: 'length', v: 'height' };
    case 'end':
      return { u: 'width', v: 'height' };
  }
}

/** A box — a piece, or a notch cut from one — as this view sees it. */
function place(piece: Box3, layout: Layout, view: ViewKind) {
  const height = layout.overallHeight;
  switch (view) {
    case 'top':
      return { u: piece.x, v: piece.y, du: piece.dx, dv: piece.dy, depth: piece.z + piece.dz };
    case 'bottom':
      return {
        u: piece.x,
        v: layout.overallWidth - (piece.y + piece.dy),
        du: piece.dx,
        dv: piece.dy,
        depth: -piece.z,
      };
    case 'side':
      return {
        u: piece.x,
        v: height - (piece.z + piece.dz),
        du: piece.dx,
        dv: piece.dz,
        depth: -piece.y,
      };
    case 'end':
      return {
        u: piece.y,
        v: height - (piece.z + piece.dz),
        du: piece.dy,
        dv: piece.dz,
        depth: -piece.x,
      };
  }
}

/**
 * The notches a view shows of a piece. From below, every one, as a recess. In
 * an elevation, only those that do not run the whole way across the piece as
 * seen — a notch looked at end on is hidden by the timber either side of it,
 * and drawing it would put a hole in a face that has none.
 */
function cutsOf(piece: PlacedPiece, box: Cut, layout: Layout, view: ViewKind): Cut[] {
  const notches = piece.notches ?? [];
  if (notches.length === 0 || view === 'top') return [];
  const placed = notches.map((notch) => {
    const { u, v, du, dv } = place(notch, layout, view);
    return { u, v, du, dv, r: notch.radius };
  });
  if (view === 'bottom') return placed;
  return placed.filter(
    (cut) => cut.u > box.u + TOLERANCE || cut.u + cut.du < box.u + box.du - TOLERANCE,
  );
}

/**
 * The outline of a piece with bites out of its bottom edge, as corners in view
 * coordinates: along the top, down the far side, then back along the bottom
 * going up and round each notch and down again, right to left. The sheet and
 * the DXF both draw this, so the two cannot come to disagree about the shape.
 */
export function profileOf(item: Projected): Array<{ u: number; v: number }> {
  const left = item.u;
  const right = item.u + item.du;
  const top = item.v;
  const bottom = item.v + item.dv;
  const points = [
    { u: left, v: top },
    { u: right, v: top },
    { u: right, v: bottom },
  ];
  for (const cut of [...item.cuts].sort((a, b) => b.u - a.u)) {
    // The outline runs mouth corner to mouth corner along the board; v runs
    // down the page, so up from the underside is down in v.
    const outline = notchOutline(cut.du, cut.dv, cut.r ?? 0);
    for (const point of outline.reverse()) {
      points.push({ u: cut.u + point.x, v: bottom - point.y });
    }
  }
  points.push({ u: left, v: bottom });
  return points;
}

/** A plan position, such as a nail dot, in view coordinates. */
export function projectPlanPoint(
  point: { x: number; y: number },
  layout: Layout,
  view: ViewKind,
): { u: number; v: number } {
  return view === 'bottom'
    ? { u: point.x, v: layout.overallWidth - point.y }
    : { u: point.x, v: point.y };
}

const TOLERANCE = 1e-6;

/**
 * In the top view the layer you would be looking at is solid and everything
 * below it is faint; in the bottom view it is the other way up. That is the
 * topmost layer rather than the one called `top_deck`, because a plywood sheet
 * laid over a boarded deck is what you see from above.
 *
 * A face is a whole course of timber, not one layer. A deck whose boards run
 * two ways is several layers at one height, and every board of it is timber you
 * are looking straight at — holding back the cross-running half of a deck would
 * say it was underneath the rest, which it is not.
 *
 * In the side and end views a piece is faint when something in front of it
 * covers it completely.
 */
function isNear(
  target: ReturnType<typeof place> & { piece: PlacedPiece },
  all: Array<ReturnType<typeof place> & { piece: PlacedPiece }>,
  view: ViewKind,
  faces: { top: Set<string>; bottom: Set<string> },
): boolean {
  if (view === 'top') return faces.top.has(target.piece.layerId);
  if (view === 'bottom') return faces.bottom.has(target.piece.layerId);
  return !all.some(
    (other) =>
      other !== target &&
      other.depth > target.depth + TOLERANCE &&
      other.u <= target.u + TOLERANCE &&
      other.v <= target.v + TOLERANCE &&
      other.u + other.du >= target.u + target.du - TOLERANCE &&
      other.v + other.dv >= target.v + target.dv - TOLERANCE,
  );
}

/**
 * The layers a viewer meets first from above and from below — every layer of
 * the topmost course and of the bottom-most one, since a course may be more
 * than one layer. See `sameLevelAsPrev` on Layer.
 */
export function facesOf(layout: Layout): { top: Set<string>; bottom: Set<string> } {
  const idsAtLevel = (level: number | undefined): Set<string> =>
    new Set(
      level === undefined
        ? []
        : layout.layers.filter((layer) => layer.level === level).map((layer) => layer.layerId),
    );
  return {
    top: idsAtLevel(layout.layers[0]?.level),
    bottom: idsAtLevel(layout.layers.at(-1)?.level),
  };
}

/** Every piece, projected and sorted back to front so a painter's pass works. */
export function projectPieces(layout: Layout, view: ViewKind): Projected[] {
  const faces = facesOf(layout);
  const placed = layout.pieces.map((piece, index) => {
    const box = place(piece, layout, view);
    return { piece, index, ...box, cuts: cutsOf(piece, box, layout, view) };
  });
  const projected = placed.map((item) => ({ ...item, near: isNear(item, placed, view, faces) }));
  return projected.sort((a, b) => a.depth - b.depth);
}
