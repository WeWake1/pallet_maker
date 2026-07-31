import type { DimSpec, Scene, Side } from './scene.js';
import { group, line, path, text } from './svg.js';
import {
  ARROW_HALF_WIDTH,
  ARROW_LENGTH,
  DIM_FONT_SIZE,
  DIM_INK,
  DIM_STROKE,
  EXTENSION_GAP,
  EXTENSION_OVERSHOOT,
  EXTENSION_STROKE,
  FONT_FAMILY,
  NARROW_DIM,
  NARROW_LABEL_OFFSET,
} from './theme.js';

/**
 * One dimension: two extension lines, a dimension line with arrowheads, and the
 * measurement. Everything is a real SVG element and the text stays text.
 */

const HORIZONTAL: Side[] = ['top', 'bottom'];

/** +1 when the lane sits below or right of the drawing. */
function outward(side: Side): number {
  return side === 'bottom' || side === 'right' ? 1 : -1;
}

function arrow(tipAlong: number, across: number, direction: number, horizontal: boolean): string {
  const tail = tipAlong + direction * ARROW_LENGTH;
  const pt = (along: number, off: number): string =>
    horizontal ? `${along},${across + off}` : `${across + off},${along}`;
  return path(
    `M ${pt(tipAlong, 0)} L ${pt(tail, -ARROW_HALF_WIDTH)} L ${pt(tail, ARROW_HALF_WIDTH)} Z`,
    { fill: DIM_INK },
  );
}

export function renderDimension(scene: Scene, spec: DimSpec): string {
  const horizontal = HORIZONTAL.includes(spec.side);
  const dir = outward(spec.side);
  const lane = scene.lane(spec.side, spec.lane);

  const along = (mm: number): number => (horizontal ? scene.px(mm) : scene.py(mm));
  const anchorAcross = horizontal ? scene.py(spec.anchor) : scene.px(spec.anchor);

  const a = along(spec.a);
  const b = along(spec.b);
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const narrow = hi - lo < NARROW_DIM;

  // Map (along, across) into page coordinates.
  const at = (alongPx: number, acrossPx: number): [number, number] =>
    horizontal ? [alongPx, acrossPx] : [acrossPx, alongPx];

  const parts: string[] = [];

  for (const end of [lo, hi]) {
    const [x1, y1] = at(end, anchorAcross + dir * EXTENSION_GAP);
    const [x2, y2] = at(end, lane + dir * EXTENSION_OVERSHOOT);
    parts.push(line(x1, y1, x2, y2, { stroke: DIM_INK, 'stroke-width': EXTENSION_STROKE }));
  }

  const overrun = narrow ? ARROW_LENGTH * 1.8 : 0;
  const [lx1, ly1] = at(lo - overrun, lane);
  const [lx2, ly2] = at(hi + overrun, lane);
  parts.push(line(lx1, ly1, lx2, ly2, { stroke: DIM_INK, 'stroke-width': DIM_STROKE }));

  // Arrows point inwards on a normal dimension and outwards on a narrow one.
  parts.push(arrow(lo, lane, narrow ? -1 : 1, horizontal));
  parts.push(arrow(hi, lane, narrow ? 1 : -1, horizontal));

  const mid = (lo + hi) / 2;
  const labelOut = narrow ? NARROW_LABEL_OFFSET : 3.5;
  if (horizontal) {
    const y = spec.side === 'bottom' ? lane + labelOut + DIM_FONT_SIZE - 3.5 : lane - labelOut;
    parts.push(
      text(mid, y, spec.label, {
        'text-anchor': 'middle',
        'font-family': FONT_FAMILY,
        'font-size': DIM_FONT_SIZE,
        fill: DIM_INK,
      }),
    );
  } else {
    // Vertical dimensions read from the right, as usual on a technical drawing.
    const x = spec.side === 'left' ? lane - labelOut : lane + labelOut + DIM_FONT_SIZE - 3.5;
    parts.push(
      text(x, mid, spec.label, {
        'text-anchor': 'middle',
        'font-family': FONT_FAMILY,
        'font-size': DIM_FONT_SIZE,
        fill: DIM_INK,
        transform: `rotate(-90, ${x}, ${mid})`,
      }),
    );
  }

  return group({}, parts);
}
