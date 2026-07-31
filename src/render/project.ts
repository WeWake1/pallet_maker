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

function place(piece: PlacedPiece, layout: Layout, view: ViewKind) {
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
 * In the side and end views a piece is faint when something in front of it
 * covers it completely.
 */
function isNear(
  target: ReturnType<typeof place> & { piece: PlacedPiece },
  all: Array<ReturnType<typeof place> & { piece: PlacedPiece }>,
  view: ViewKind,
  faces: { top: string | undefined; bottom: string | undefined },
): boolean {
  if (view === 'top') return target.piece.layerId === faces.top;
  if (view === 'bottom') return target.piece.layerId === faces.bottom;
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

/** The layers a viewer meets first from above and from below. */
export function facesOf(layout: Layout): { top: string | undefined; bottom: string | undefined } {
  return {
    top: layout.layers[0]?.layerId,
    bottom: layout.layers.at(-1)?.layerId,
  };
}

/** Every piece, projected and sorted back to front so a painter's pass works. */
export function projectPieces(layout: Layout, view: ViewKind): Projected[] {
  const faces = facesOf(layout);
  const placed = layout.pieces.map((piece, index) => ({
    piece,
    index,
    ...place(piece, layout, view),
  }));
  const projected = placed.map((item) => ({ ...item, near: isNear(item, placed, view, faces) }));
  return projected.sort((a, b) => a.depth - b.depth);
}
