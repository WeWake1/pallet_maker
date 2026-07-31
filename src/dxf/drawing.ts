import type { Layout } from '../geometry/types.js';
import { projectPieces, viewFrame } from '../render/project.js';
import type { ViewKind } from '../render/project.js';
import { TIER } from '../render/scene.js';
import type { DimSpec } from '../render/scene.js';
import { viewDimensions } from '../render/views.js';
import type { LayerKind } from '../types.js';
import { document, line, rectangle, text } from './writer.js';
import type { LayerDefinition, Pair, Point } from './writer.js';

/**
 * The pallet as a DXF drawing: the plan, at 1:1 in millimetres, one CAD layer
 * per pallet layer kind so the shop can switch the decks off and look at the
 * blocks.
 *
 * Coordinates are the pallet's own, straight off `PlacedPiece[]`. Measuring a
 * board in CAD gives the number that is in the document. The dimension lanes
 * therefore sit on the far side from where the printed sheet puts them, since
 * on paper the width runs down the page and in CAD it runs up it.
 */

const LAYER_NAME: Record<LayerKind, string> = {
  top_deck: 'TOP_BOARDS',
  bearer: 'CENTRE_BOARDS',
  block: 'BLOCKS',
  runner: 'RUNNERS',
  bottom_deck: 'BOTTOM_BOARDS',
};

/** AutoCAD colour indices, close to the colours the sheet uses. */
const LAYER_COLOUR: Record<LayerKind, number> = {
  top_deck: 30,
  bearer: 5,
  block: 6,
  runner: 6,
  bottom_deck: 3,
};

const DIMENSION_LAYER = 'DIMENSIONS';

export interface DxfOptions {
  /** Which view to draw. The plan is the useful one and the default. */
  view?: ViewKind;
  /** Height of the dimension text, in mm. */
  textHeight?: number;
  /** Distance from the drawing to the first dimension lane, in mm. */
  firstLane?: number;
  /** Distance between dimension lanes, in mm. */
  lanePitch?: number;
}

export function palletToDxf(layout: Layout, options: DxfOptions = {}): string {
  const view = options.view ?? 'top';
  const textHeight = options.textHeight ?? 20;
  const firstLane = options.firstLane ?? 60;
  const lanePitch = options.lanePitch ?? 45;
  const tick = textHeight / 3;

  const frame = viewFrame(layout, view);
  const projected = projectPieces(layout, view);

  const entities: Pair[] = [];
  const kinds = new Set<LayerKind>();

  for (const item of projected) {
    kinds.add(item.piece.layerKind);
    entities.push(
      ...rectangle(LAYER_NAME[item.piece.layerKind], item.u, item.v, item.du, item.dv),
    );
  }

  // One lane per tier: detail dimensions inside, overall ones outside.
  const laneOf = (dim: DimSpec): number =>
    firstLane + (dim.tier === TIER.detail ? 0 : dim.tier === TIER.nudge ? 1 : 2) * lanePitch;

  let reach = firstLane + 2 * lanePitch + textHeight * 2;
  for (const dim of viewDimensions(layout, view)) {
    entities.push(...dimension(dim, laneOf(dim), frame, textHeight, tick));
    reach = Math.max(reach, laneOf(dim) + textHeight * 2);
  }

  const layers: LayerDefinition[] = [...kinds].map((kind) => ({
    name: LAYER_NAME[kind],
    colour: LAYER_COLOUR[kind],
  }));
  layers.push({ name: DIMENSION_LAYER, colour: 7 });

  return document({
    layers,
    entities,
    extents: {
      min: { x: -reach, y: -reach },
      max: { x: frame.uSpan + reach, y: frame.vSpan + reach },
    },
  });
}

/**
 * Extension lines, a dimension line with ticks, and the measurement as TEXT.
 * R12 has no usable dimension entity without a block for the arrowheads, and
 * text with plain lines is what opens everywhere.
 */
function dimension(
  dim: DimSpec,
  lane: number,
  frame: { uSpan: number; vSpan: number },
  textHeight: number,
  tick: number,
): Pair[] {
  const horizontal = dim.side === 'top' || dim.side === 'bottom';
  const outward = dim.side === 'bottom' || dim.side === 'right' ? 1 : -1;

  const across =
    dim.side === 'bottom'
      ? frame.vSpan + lane
      : dim.side === 'top'
        ? -lane
        : dim.side === 'right'
          ? frame.uSpan + lane
          : -lane;

  const at = (along: number, offset: number): Point =>
    horizontal ? { x: along, y: across + offset } : { x: across + offset, y: along };

  const lo = Math.min(dim.a, dim.b);
  const hi = Math.max(dim.a, dim.b);
  const entities: Pair[] = [];

  // Extension lines run from the feature out past the dimension line.
  for (const end of [lo, hi]) {
    const from = horizontal
      ? { x: end, y: dim.anchor + outward * tick }
      : { x: dim.anchor + outward * tick, y: end };
    entities.push(...line(DIMENSION_LAYER, from, at(end, outward * tick)));
  }

  entities.push(...line(DIMENSION_LAYER, at(lo, 0), at(hi, 0)));
  for (const end of [lo, hi]) {
    entities.push(
      ...line(
        DIMENSION_LAYER,
        horizontal
          ? { x: end - tick, y: across - tick }
          : { x: across - tick, y: end - tick },
        horizontal
          ? { x: end + tick, y: across + tick }
          : { x: across + tick, y: end + tick },
      ),
    );
  }

  const middle = (lo + hi) / 2;
  entities.push(
    ...text(DIMENSION_LAYER, at(middle, outward * textHeight * 0.75), dim.label, {
      height: textHeight,
      centred: true,
      ...(horizontal ? {} : { rotation: 90 }),
    }),
  );

  return entities;
}
