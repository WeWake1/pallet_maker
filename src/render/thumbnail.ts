import type { Layout } from '../geometry/types.js';
import { ISO_ORIENTATION, modelExtent } from './orbit.js';
import { renderOrbit } from './orbitView.js';

/**
 * A design at card size: the pallet alone, as the sheet's isometric shows it,
 * fitted to a small box.
 *
 * For the library. A card that says "1200 x 800" says nothing about whether
 * that is a block pallet or a stringer one, two-way or four-way, and a shelf
 * of thirty cards saying much the same thing is told apart by the pictures.
 * The picture is the one already on the sheet, so a design looks the same on
 * the shelf as it does on paper.
 *
 * `turn` swings the eye round the pallet from there, with its height kept: the
 * card can be turned to look at the ends and the far side, but it is never
 * tipped, so the drawing stays recognisably the sheet's own.
 */

export interface ThumbnailOptions {
  width: number;
  height: number;
  /** Radians round from the isometric. 0 is the drawing on the sheet. */
  turn?: number;
  idPrefix?: string;
}

/** Room kept between the pallet and the edge of the box, as a fraction of each side. */
const INSET = 0.05;

/**
 * Px per mm that keeps the pallet inside the box from every angle of the turn.
 *
 * With the eye at one height the turn is a spin about the vertical, so the
 * widest the pallet can come out is its footprint's diagonal, and the tallest
 * is that diagonal tipped by the pitch with the height standing on it. Fitting
 * to those rather than to the outline at any one angle is what holds the
 * drawing still while it turns. Against a fit to the isometric alone it costs
 * about 2% on a 1200 x 800 and 9% on a pallet two and a half times as long as
 * it is wide.
 */
export function thumbnailScale(layout: Layout, width: number, height: number): number {
  const extent = modelExtent(layout.pieces);
  const diagonal = Math.hypot(extent.x1 - extent.x0, extent.y1 - extent.y0);
  const tall = extent.z1 - extent.z0;
  const { pitch } = ISO_ORIENTATION;
  const spanX = diagonal || 1;
  const spanY = diagonal * Math.sin(pitch) + tall * Math.cos(pitch) || 1;
  return Math.min((width * (1 - 2 * INSET)) / spanX, (height * (1 - 2 * INSET)) / spanY);
}

export function renderThumbnail(layout: Layout, options: ThumbnailOptions): string {
  const { width, height } = options;
  return renderOrbit(layout, {
    orientation: { yaw: ISO_ORIENTATION.yaw + (options.turn ?? 0), pitch: ISO_ORIENTATION.pitch },
    width,
    height,
    scale: thumbnailScale(layout, width, height),
    // At this size a nail is a speck the width of a board, and thirty of them
    // are a rash rather than a pattern. The sheet is where they are read.
    nails: false,
    // The card names the design; a title here would be a second tooltip.
    title: false,
    idPrefix: options.idPrefix,
  });
}
