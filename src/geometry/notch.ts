import { NOTCH_RADIUS_MM } from '../types.js';
import type { Notch } from '../types.js';

/**
 * The shape of a notch.
 *
 * A notch is stated as a box — how long at the mouth, how deep — and cut with
 * a rounded top: the cutter comes round from the wall onto the ceiling on a
 * radius, while the mouth corners, where the saw goes in, stay square. This is
 * the one place that shape is worked out, so the side view, the DXF and the
 * pictorial views all draw the same cut.
 */

const EPSILON = 1e-6;

/** The radius a notch is cut to: the standard one, unless the notch is too short for it. */
export function notchRadius(notch: Pick<Notch, 'lengthMm'>): number {
  return Math.min(NOTCH_RADIUS_MM, notch.lengthMm / 2);
}

export interface OutlinePoint {
  x: number;
  y: number;
}

/**
 * The outline of a notch from one mouth corner to the other, in the board's
 * own frame: x along the board from where the notch starts, y up from the
 * underside.
 *
 * Up the wall, round the corner, along the ceiling, round and down again. A
 * radius deeper than the notch — the GMA's R1.5 in a 1.38 cut — leaves no
 * straight wall at all: the end is one sweep from the mouth corner to the
 * ceiling, still tangent to the ceiling, still starting exactly where the
 * mouth does, so the length stated is the length at the mouth either way.
 *
 * `segments` is how many straight pieces stand in for each curve. Everything
 * this feeds is drawn as polygons, so the curve is a few of them: at six, a
 * 38 radius is out by under a fifth of a millimetre.
 */
export function notchOutline(
  length: number,
  depth: number,
  radius: number,
  segments = 6,
): OutlinePoint[] {
  const r = Math.min(radius, length / 2);
  if (r <= EPSILON || depth <= EPSILON) {
    return [
      { x: 0, y: 0 },
      { x: 0, y: depth },
      { x: length, y: depth },
      { x: length, y: 0 },
    ];
  }

  // The corner's centre: a radius below the ceiling, and in from the mouth by
  // the radius where there is wall under it, or by less where the arc has to
  // reach the underside before it has turned fully vertical.
  const shallow = r > depth;
  const inset = shallow ? Math.sqrt(depth * (2 * r - depth)) : r;
  const centreY = depth - r;
  const from = shallow ? Math.asin((r - depth) / r) : 0;
  const to = Math.PI / 2;

  const left: OutlinePoint[] = [{ x: 0, y: 0 }];
  for (let i = 0; i <= segments; i++) {
    const t = from + ((to - from) * i) / segments;
    push(left, { x: inset - r * Math.cos(t), y: centreY + r * Math.sin(t) });
  }

  const points = [...left];
  for (const point of [...left].reverse()) push(points, { x: length - point.x, y: point.y });
  return points;
}

/** Add a point unless it is where the last one already is. */
function push(points: OutlinePoint[], point: OutlinePoint): void {
  const last = points.at(-1);
  if (last && Math.abs(last.x - point.x) <= EPSILON && Math.abs(last.y - point.y) <= EPSILON) return;
  points.push(point);
}
