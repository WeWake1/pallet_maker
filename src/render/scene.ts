import { text } from './svg.js';
import {
  DIM_GLYPH_WIDTH,
  FIRST_LANE,
  FONT_FAMILY,
  INK,
  LANE_PITCH,
  LANE_TAIL,
  TITLE_FONT_SIZE,
} from './theme.js';

/** Which side of the drawing a dimension line sits on. */
export type Side = 'left' | 'right' | 'top' | 'bottom';

/**
 * Dimensions sit in lanes: lane 0 nearest the drawing, then outwards. Detail
 * dimensions take the inner lanes and overall dimensions the outer ones, which
 * is the usual convention and keeps extension lines from crossing.
 */
export const TIER = { detail: 0, nudge: 1, overall: 2 } as const;
export type DimTier = (typeof TIER)[keyof typeof TIER];

export interface DimSpec {
  side: Side;
  /** Detail dimensions sit inside, overall ones outside. */
  tier: DimTier;
  /** Which lane within the tier. Worked out by `packLanes`. */
  lane: number;
  /** Start and end along the measured axis, in mm. */
  a: number;
  b: number;
  /** Where on the other axis the extension lines start, in mm. */
  anchor: number;
  label: string;
}

export interface SceneOptions {
  /** Space the drawing itself may take, in px. */
  targetWidth?: number;
  targetHeight?: number;
  /**
   * Space the whole view may take including its dimension lanes, in px. The
   * sheet uses this so a view lands at exactly the size of its cell and can be
   * embedded without scaling, which would drag the stroke weights with it.
   */
  fitWidth?: number;
  fitHeight?: number;
  /** Force a scale in px per mm. Wins over both of the above. */
  scale?: number;
  /**
   * Ceiling on the scale in px per mm. The view still shrinks to fit its box if
   * it has to, but never grows past this. What lets several views share one
   * scale — see `sharedScale` — without any of them bursting its cell.
   */
  maxScale?: number;
  title?: boolean;
}

const EDGE_MARGIN = 9;
export const TITLE_SPACE = TITLE_FONT_SIZE + 5;

/** The view name, centred under the drawing. */
export function renderTitle(width: number, height: number, label: string): string {
  return text(width / 2, height - 6, label, {
    'text-anchor': 'middle',
    'font-family': FONT_FAMILY,
    'font-size': TITLE_FONT_SIZE,
    'letter-spacing': 0.6,
    fill: INK,
  });
}

export class Scene {
  readonly scale: number;
  readonly width: number;
  readonly height: number;
  readonly left: number;
  readonly top: number;
  readonly uSpan: number;
  readonly vSpan: number;
  private readonly margins: Record<Side, number>;

  constructor(
    frame: { uSpan: number; vSpan: number },
    dims: DimSpec[],
    options: SceneOptions = {},
  ) {
    this.uSpan = frame.uSpan;
    this.vSpan = frame.vSpan;

    const lanes = (side: Side): number =>
      dims.filter((d) => d.side === side).reduce((max, d) => Math.max(max, d.lane + 1), 0);
    const margin = (side: Side): number => {
      const count = lanes(side);
      return count === 0 ? EDGE_MARGIN : FIRST_LANE + (count - 1) * LANE_PITCH + LANE_TAIL;
    };

    this.margins = {
      left: margin('left'),
      right: margin('right'),
      top: margin('top'),
      bottom: margin('bottom') + (options.title === false ? 0 : TITLE_SPACE),
    };

    // Margins are fixed by the dimension lanes and do not depend on the scale,
    // so fitting the whole view into a box is one subtraction.
    const room = (available: number, used: number): number => Math.max(available - used, 1);
    const targetWidth =
      options.fitWidth !== undefined
        ? room(options.fitWidth, this.margins.left + this.margins.right)
        : (options.targetWidth ?? 520);
    const targetHeight =
      options.fitHeight !== undefined
        ? room(options.fitHeight, this.margins.top + this.margins.bottom)
        : (options.targetHeight ?? 340);

    const fitted = Math.min(targetWidth / frame.uSpan, targetHeight / frame.vSpan);
    this.scale = options.scale ?? Math.min(fitted, options.maxScale ?? Infinity);

    this.left = this.margins.left;
    this.top = this.margins.top;
    this.width = this.margins.left + frame.uSpan * this.scale + this.margins.right;
    this.height = this.margins.top + frame.vSpan * this.scale + this.margins.bottom;
  }

  px(u: number): number {
    return this.left + u * this.scale;
  }

  py(v: number): number {
    return this.top + v * this.scale;
  }

  len(mm: number): number {
    return mm * this.scale;
  }

  /** The px coordinate of a lane's dimension line: an x for left/right, a y for top/bottom. */
  lane(side: Side, index: number): number {
    const offset = FIRST_LANE + index * LANE_PITCH;
    switch (side) {
      case 'left':
        return this.px(0) - offset;
      case 'right':
        return this.px(this.uSpan) + offset;
      case 'top':
        return this.py(0) - offset;
      case 'bottom':
        return this.py(this.vSpan) + offset;
    }
  }
}

const LABEL_PAD = 3;

/**
 * Put every dimension in a lane where its label has room.
 *
 * A view on the sheet is small — the drawing itself can be under 40 mm across —
 * and two callouts on neighbouring boards will otherwise print on top of each
 * other. Lanes are assigned per side and per tier, so detail dimensions still
 * sit inside the overall ones however many lanes they end up needing.
 */
export function packLanes(dims: DimSpec[], scene: Scene): DimSpec[] {
  const packed: DimSpec[] = [];

  for (const side of ['left', 'right', 'top', 'bottom'] as Side[]) {
    const onSide = dims.filter((dim) => dim.side === side);
    if (onSide.length === 0) continue;
    const horizontal = side === 'top' || side === 'bottom';
    const at = (mm: number): number => (horizontal ? scene.px(mm) : scene.py(mm));

    let base = 0;
    for (const tier of [TIER.detail, TIER.nudge, TIER.overall]) {
      const lanes: Array<Array<[number, number]>> = [];

      for (const dim of onSide.filter((d) => d.tier === tier)) {
        // Only the label needs room. Two dimensions that meet end to end share
        // that end, and their arrows with it.
        const mid = (at(dim.a) + at(dim.b)) / 2;
        const half = (dim.label.length * DIM_GLYPH_WIDTH) / 2;
        const span: [number, number] = [mid - half - LABEL_PAD, mid + half + LABEL_PAD];

        let index = lanes.findIndex(
          (lane) => !lane.some(([lo, hi]) => span[0] < hi && lo < span[1]),
        );
        if (index < 0) {
          index = lanes.length;
          lanes.push([]);
        }
        lanes[index]!.push(span);
        packed.push({ ...dim, lane: base + index });
      }

      base += lanes.length;
    }
  }

  return packed;
}

/** Millimetres as they appear on a drawing: no units, no trailing zeros. */
export function mmLabel(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
