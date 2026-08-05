import type { LayerKind } from '../types.js';

/**
 * Emphasis is carried by three signals at once, never by colour alone: colour,
 * opacity and stroke weight. The shop floor prints in black and white, so every
 * view has to survive being converted to greyscale.
 *
 * Lengths here are CSS pixels. A view is embedded at its natural size, so 1
 * unit is 1/96 inch on paper.
 */

export interface LayerStyle {
  stroke: string;
  fill: string;
}

/** One colour per layer kind. A runner replaces the block layer, so it shares its hue. */
export const LAYER_STYLE: Record<LayerKind, LayerStyle> = {
  panel: { stroke: '#8a6a2f', fill: '#f6ecd4' },
  top_deck: { stroke: '#a8551f', fill: '#f2ddc9' },
  bearer: { stroke: '#1f5f7a', fill: '#d3e6ee' },
  block: { stroke: '#5a3f8c', fill: '#e2daf0' },
  runner: { stroke: '#5a3f8c', fill: '#e2daf0' },
  bottom_deck: { stroke: '#3d6b2f', fill: '#dcead3' },
};

export interface Weight {
  opacity: number;
  strokeWidth: number;
  fillOpacity: number;
}

export interface Emphasis {
  /** The layer being emphasised in this view. */
  near: Weight;
  /** Everything behind it. */
  far: Weight;
  /**
   * A piece behind the near layer, drawn a second time where the near layer
   * covers it so that it shows through. A zero fill opacity makes it an outline
   * only; null leaves the near layer solid and shows what is under it through
   * the gaps between its boards, which is what it really looks like.
   */
  ghost: Weight | null;
}

/**
 * On paper. A spec sheet is read for the layer the view is of, and the layers
 * behind it are context: enough to see where the bearers run, not enough to be
 * confused with the boards on top of them.
 */
export const PRINT_EMPHASIS: Emphasis = {
  near: { opacity: 1, strokeWidth: 1.2, fillOpacity: 1 },
  far: { opacity: 0.3, strokeWidth: 0.4, fillOpacity: 0.55 },
  ghost: { opacity: 0.3, strokeWidth: 0.4, fillOpacity: 0 },
};

/**
 * On screen. The editor preview is a working surface rather than a print, so
 * the layers underneath are kept legible instead of being held back for the
 * sake of the page — but the layer the view is of stays solid, and what is
 * under it is seen through the gaps between its boards, as it would be if you
 * were standing over the pallet.
 */
export const SCREEN_EMPHASIS: Emphasis = {
  near: { opacity: 1, strokeWidth: 1.3, fillOpacity: 1 },
  far: { opacity: 0.95, strokeWidth: 0.8, fillOpacity: 0.75 },
  ghost: null,
};

/** Kept for anything still reading the print weights directly. */
export const NEAR = PRINT_EMPHASIS.near;
export const FAR = PRINT_EMPHASIS.far;

export const INK = '#1b1b1b';
export const DIM_INK = '#333333';
export const NAIL_INK = '#111111';
/** The outline round the board selected in the editor. */
export const SELECTION_INK = '#0f62fe';

export const FONT_FAMILY = "'Helvetica Neue', Helvetica, Arial, sans-serif";
export const DIM_FONT_SIZE = 8.5;
export const TITLE_FONT_SIZE = 9.5;
export const FOOTER_FONT_SIZE = 7.5;
/** Rough width of a digit at DIM_FONT_SIZE, for keeping labels off each other. */
export const DIM_GLYPH_WIDTH = DIM_FONT_SIZE * 0.55;

export const DIM_STROKE = 0.5;
export const EXTENSION_STROKE = 0.4;
export const ARROW_LENGTH = 5;
export const ARROW_HALF_WIDTH = 1.6;

/**
 * Distance from the drawing to the first dimension lane, and between lanes.
 * These are what the sheet pays for its margins, so they are kept tight: on an
 * A4 sheet a view cell is only about 90 by 62 mm.
 */
export const FIRST_LANE = 16;
export const LANE_PITCH = 22;
/** Room for the dimension text sitting outside the last lane. */
export const LANE_TAIL = 18;

/** Gap between the object and the start of an extension line. */
export const EXTENSION_GAP = 2.5;
/** How far an extension line runs past its dimension line. */
export const EXTENSION_OVERSHOOT = 3;

/**
 * Big enough to count at a glance. The nailing pattern is instruction, not
 * decoration: a fitter has to be able to see three dots at a corner and two
 * everywhere else on a printed sheet, across a bench.
 */
export const NAIL_RADIUS = 2.4;

/**
 * The isometric is a pictorial view, so nothing in it is faint: every piece is
 * drawn solid with real occlusion. Its three visible faces are stepped in tone
 * so the form reads at a glance and keeps reading in greyscale, which is a
 * difference in luminance rather than in colour.
 */
export const ISO_STROKE = 0.8;
export const ISO_FACE_SHADE: Record<'top' | 'right' | 'left', number> = {
  top: 1,
  right: 0.9,
  left: 0.78,
};

/** Multiply a #rrggbb colour towards black. */
export function shade(hex: string, factor: number): string {
  const value = hex.replace('#', '');
  const channel = (at: number): string => {
    const raw = Number.parseInt(value.slice(at, at + 2), 16);
    const scaled = Math.max(0, Math.min(255, Math.round(raw * factor)));
    return scaled.toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(2)}${channel(4)}`;
}

/** A dimension narrower than this gets its arrows and label placed outside. */
export const NARROW_DIM = 20;
/** How far past the dimension line a narrow label sits. Must fit inside LANE_TAIL. */
export const NARROW_LABEL_OFFSET = 9;
