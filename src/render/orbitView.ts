import type { Layout } from '../geometry/types.js';
import { modelExtent, orderForOrbit, project, viewFor, visibleFaces } from './orbit.js';
import type { Face, Orientation, View } from './orbit.js';
import { el, fmt, group, svgDocument } from './svg.js';
import { ISO_FACE_SHADE, ISO_STROKE, LAYER_STYLE, SELECTION_INK, shade } from './theme.js';

/**
 * The editor's 3D view: the pallet as a solid, drawn from wherever the eye has
 * been dragged to, regenerated from the document like every other view.
 *
 * It is not on the sheet and never will be. The sheet carries the fixed
 * isometric, which is a drawing a workshop can be handed; this is a way of
 * looking at what is being edited.
 */

export interface OrbitOptions {
  orientation: Orientation;
  /**
   * The drawing area, in px. Fixed rather than fitted to what the pallet
   * happens to project to, so it does not swell and shrink while it is turned.
   */
  width: number;
  height: number;
  /** Multiplies the fitted scale. */
  zoom?: number;
  /**
   * Tag each piece with its index in `layout.pieces`, so a click can be taken
   * back to the row that produced it. Selection only, as in the flat views.
   */
  interactive?: boolean;
  /** Outline this piece as the selected one. An index into `layout.pieces`. */
  selectedPiece?: number;
  idPrefix?: string;
}

export const ORBIT_TITLE = '3D VIEW';

const MARGIN = 12;

export function renderOrbit(layout: Layout, options: OrbitOptions): string {
  const idPrefix = `${options.idPrefix ?? 'view'}-orbit`;
  const width = Math.max(options.width, 2 * MARGIN + 1);
  const height = Math.max(options.height, 2 * MARGIN + 1);
  const blank = { width, height, idPrefix, title: ORBIT_TITLE };

  if (layout.pieces.length === 0) return svgDocument({ ...blank, body: '' });

  const view = viewFor(options.orientation);
  const extent = modelExtent(layout.pieces);

  // Framed by the pallet's longest diagonal rather than by its outline at this
  // particular angle. No orientation can project wider than the diagonal, so
  // nothing is ever clipped and the drawing holds its size as it turns — which
  // it would not if the scale were fitted to the silhouette.
  const diagonal =
    Math.hypot(extent.x1 - extent.x0, extent.y1 - extent.y0, extent.z1 - extent.z0) || 1;
  const room = Math.min(width - 2 * MARGIN, height - 2 * MARGIN);
  const scale = (room / diagonal) * (options.zoom ?? 1);

  // The centre of that box is the pivot, so turning the view rotates the pallet
  // in place instead of swinging it about the origin.
  const pivot = project(
    view,
    (extent.x0 + extent.x1) / 2,
    (extent.y0 + extent.y1) / 2,
    (extent.z0 + extent.z1) / 2,
  );
  const px = (sx: number): number => width / 2 + (sx - pivot.sx) * scale;
  const py = (sy: number): number => height / 2 + (sy - pivot.sy) * scale;
  const points = (face: Face): string =>
    face.points.map((p) => `${fmt(px(p.sx))},${fmt(py(p.sy))}`).join(' ');

  const indexOf = new Map(layout.pieces.map((piece, index) => [piece, index]));

  const solid = orderForOrbit(layout.pieces, view).map((piece) => {
    const style = LAYER_STYLE[piece.layerKind];
    return group(
      { 'data-piece': options.interactive === true ? indexOf.get(piece) : undefined },
      visibleFaces(piece, view).map((face) =>
        el('polygon', {
          points: points(face),
          fill: shade(style.fill, ISO_FACE_SHADE[face.name]),
          stroke: style.stroke,
          'stroke-width': ISO_STROKE,
          'stroke-linejoin': 'round',
        }),
      ),
    );
  });

  const body =
    group({ 'shape-rendering': 'geometricPrecision' }, solid) +
    drawSelection(layout, options.selectedPiece, view, points);

  return svgDocument({ ...blank, body });
}

/**
 * The selected piece, outlined on top of everything. Dashed and drawn last so
 * it is found even when the piece is buried under the deck.
 */
function drawSelection(
  layout: Layout,
  selected: number | undefined,
  view: View,
  points: (face: Face) => string,
): string {
  if (selected === undefined) return '';
  const piece = layout.pieces[selected];
  if (!piece) return '';
  return group(
    { 'pointer-events': 'none' },
    visibleFaces(piece, view).map((face) =>
      el('polygon', {
        points: points(face),
        fill: 'none',
        stroke: SELECTION_INK,
        'stroke-width': 1.6,
        'stroke-dasharray': '4 2.5',
        'stroke-linejoin': 'round',
      }),
    ),
  );
}
