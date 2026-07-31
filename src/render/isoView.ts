import type { Layout } from '../geometry/types.js';
import { isoBounds, isoFaces, orderForPainter } from './isometric.js';
import { renderTitle, TITLE_SPACE } from './scene.js';
import { el, fmt, group, svgDocument } from './svg.js';
import { ISO_FACE_SHADE, ISO_STROKE, LAYER_STYLE, shade } from './theme.js';

export const ISO_TITLE = 'ISOMETRIC';

export interface IsoOptions {
  targetWidth?: number;
  targetHeight?: number;
  /** Space the whole view may take, its margins included, in px. */
  fitWidth?: number;
  fitHeight?: number;
  /** Force a scale in px per mm, so several views can share one. */
  scale?: number;
  greyscale?: boolean;
  /** Draw the view name under the drawing. Default true. */
  title?: boolean;
  idPrefix?: string;
}

const MARGIN = 10;

/**
 * The isometric, generated geometrically from PlacedPiece[] like every other
 * view. Three visible faces per piece, painted back to front, no nail dots and
 * no dimensions: it is the pictorial view, and the flat views carry the numbers.
 */
export function renderIsometric(layout: Layout, options: IsoOptions = {}): string {
  const idPrefix = `${options.idPrefix ?? 'view'}-iso`;
  const showTitle = options.title !== false;

  if (layout.pieces.length === 0) {
    return svgDocument({
      width: 2 * MARGIN,
      height: 2 * MARGIN,
      body: '',
      idPrefix,
      title: ISO_TITLE,
    });
  }

  const bounds = isoBounds(layout.pieces);
  const spanX = bounds.maxSx - bounds.minSx;
  const spanY = bounds.maxSy - bounds.minSy;
  const chromeX = 2 * MARGIN;
  const chromeY = 2 * MARGIN + (showTitle ? TITLE_SPACE : 0);
  const room = (available: number, used: number): number => Math.max(available - used, 1);
  const targetWidth =
    options.fitWidth !== undefined
      ? room(options.fitWidth, chromeX)
      : (options.targetWidth ?? 420);
  const targetHeight =
    options.fitHeight !== undefined
      ? room(options.fitHeight, chromeY)
      : (options.targetHeight ?? 320);
  const scale = options.scale ?? Math.min(targetWidth / spanX, targetHeight / spanY);

  const px = (sx: number): number => MARGIN + (sx - bounds.minSx) * scale;
  const py = (sy: number): number => MARGIN + (sy - bounds.minSy) * scale;
  const width = 2 * MARGIN + spanX * scale;
  const height = 2 * MARGIN + spanY * scale + (showTitle ? TITLE_SPACE : 0);

  const pieces = orderForPainter(layout.pieces).map((piece) => {
    const style = LAYER_STYLE[piece.layerKind];
    return group(
      {},
      isoFaces(piece).map((face) =>
        el('polygon', {
          points: face.points.map((p) => `${fmt(px(p.sx))},${fmt(py(p.sy))}`).join(' '),
          fill: shade(style.fill, ISO_FACE_SHADE[face.name]),
          stroke: style.stroke,
          'stroke-width': ISO_STROKE,
          'stroke-linejoin': 'round',
        }),
      ),
    );
  });

  const body =
    group({ 'shape-rendering': 'geometricPrecision' }, pieces) +
    (showTitle ? renderTitle(width, height, ISO_TITLE) : '');

  return svgDocument({
    width,
    height,
    body,
    greyscale: options.greyscale === true,
    idPrefix,
    title: ISO_TITLE,
  });
}
