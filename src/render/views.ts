import { hasOverhang } from '../geometry/footprint.js';
import type { LayerLayout, Layout, Overhang } from '../geometry/types.js';
import { renderDimension } from './dimension.js';
import { facesOf, projectPieces, projectPlanPoint, viewFrame, VIEW_TITLE } from './project.js';
import type { Projected, ViewKind } from './project.js';
import { mmLabel, packLanes, renderTitle, Scene, TIER } from './scene.js';
import type { DimSpec, Side } from './scene.js';
import { circle, el, group, rect, svgDocument } from './svg.js';
import {
  LAYER_STYLE,
  NAIL_HALO,
  NAIL_INK,
  NAIL_RADIUS,
  NAIL_TARGET_INK,
  NAIL_TARGET_MANUAL_INK,
  NAIL_TARGET_STROKE,
  PRINT_EMPHASIS,
  SCREEN_EMPHASIS,
  SELECTION_INK,
} from './theme.js';
import type { Emphasis, Weight } from './theme.js';

export interface ViewOptions {
  targetWidth?: number;
  targetHeight?: number;
  /** Space the whole view may take, dimension lanes included, in px. */
  fitWidth?: number;
  fitHeight?: number;
  /** Force a scale in px per mm, so several views can share one. */
  scale?: number;
  /** Wrap the drawing in a desaturating filter, for the greyscale check. */
  greyscale?: boolean;
  /** Draw the view name under the drawing. Default true. */
  title?: boolean;
  /**
   * Prefix for the ids this view defines. Several views are inlined in one HTML
   * document on the sheet, and ids have to stay unique across all of them.
   */
  idPrefix?: string;
  /**
   * Tag each piece with its index in `layout.pieces`, so the editor can take a
   * click back to the row that produced it. Selection only: the drawing is
   * never edited.
   */
  interactive?: boolean;
  /** Outline this piece as the selected one. An index into `layout.pieces`. */
  selectedPiece?: number;
  /**
   * Draw a click target over every crossing, tagged with its index in
   * `layout.nailCrossings`. The editor turns these on while nails are being
   * placed; nothing printed ever asks for them.
   */
  nailTargets?: boolean;
  /**
   * How hard the layers behind the near one are held back. Default `print`,
   * which is what the sheet and the PDF want; the editor asks for `screen`,
   * where those layers are being worked on rather than merely referred to.
   */
  emphasis?: 'print' | 'screen';
}

const TOLERANCE = 1e-6;

export function renderView(layout: Layout, view: ViewKind, options: ViewOptions = {}): string {
  const frame = viewFrame(layout, view);
  const projected = projectPieces(layout, view);
  const { dims, scene } = layOut(frame, buildDimensions(layout, view, projected), options);
  const idPrefix = `${options.idPrefix ?? 'view'}-${view}`;

  const emphasis = options.emphasis === 'screen' ? SCREEN_EMPHASIS : PRINT_EMPHASIS;

  const body = [
    drawPieces(scene, projected, view, `${idPrefix}-near`, emphasis, options.interactive === true),
    drawNails(scene, layout, view),
    options.nailTargets === true ? drawNailTargets(scene, layout, view) : '',
    group({ 'pointer-events': 'none' }, dims.map((dim) => renderDimension(scene, dim))),
    drawSelection(scene, projected, layout, options.selectedPiece),
    options.title === false ? '' : drawTitle(scene, view),
  ].join('');

  return svgDocument({
    width: scene.width,
    height: scene.height,
    body,
    greyscale: options.greyscale === true,
    idPrefix,
    title: VIEW_TITLE[view],
  });
}

/**
 * Lanes decide the margins, the margins decide the scale, and the scale decides
 * whether two labels collide. So settle it by iterating: pack, remeasure, pack
 * again, until the lanes stop moving.
 */
function layOut(
  frame: { uSpan: number; vSpan: number },
  initial: DimSpec[],
  options: ViewOptions,
): { dims: DimSpec[]; scene: Scene } {
  let dims = initial;
  let scene = new Scene(frame, dims, options);

  for (let pass = 0; pass < 4; pass++) {
    const packed = packLanes(dims, scene);
    const settled =
      packed.length === dims.length &&
      packed.every((dim, i) => dim.lane === dims[i]?.lane && dim.side === dims[i]?.side);
    dims = packed;
    scene = new Scene(frame, dims, options);
    if (settled) break;
  }

  return { dims, scene };
}

function pieceRect(
  scene: Scene,
  item: Projected,
  weight: Weight,
  pieceIndex?: number,
): string {
  const style = LAYER_STYLE[item.piece.layerKind];
  const filled = weight.fillOpacity > 0;
  return rect(scene.px(item.u), scene.py(item.v), scene.len(item.du), scene.len(item.dv), {
    fill: filled ? style.fill : 'none',
    'fill-opacity': filled ? weight.fillOpacity : undefined,
    stroke: style.stroke,
    'stroke-width': weight.strokeWidth,
    opacity: weight.opacity,
    'data-piece': pieceIndex,
  });
}

/** The selected board, outlined. Nothing about the drawing is editable. */
function drawSelection(
  scene: Scene,
  projected: Projected[],
  layout: Layout,
  selected: number | undefined,
): string {
  if (selected === undefined) return '';
  const piece = layout.pieces[selected];
  const item = projected.find((candidate) => candidate.piece === piece);
  if (!item) return '';
  const pad = 1.5;
  return rect(
    scene.px(item.u) - pad,
    scene.py(item.v) - pad,
    scene.len(item.du) + 2 * pad,
    scene.len(item.dv) + 2 * pad,
    {
      fill: 'none',
      stroke: SELECTION_INK,
      'stroke-width': 1.6,
      'stroke-dasharray': '4 2.5',
      'pointer-events': 'none',
    },
  );
}

/**
 * Painter's pass, back to front.
 *
 * In the top and bottom views the layers behind the near one would otherwise be
 * hidden under it, and where the bearers and blocks run is exactly what the
 * production team needs to see. So they are drawn a second time as faint
 * outlines, clipped to the near layer, showing through the boards.
 */
function drawPieces(
  scene: Scene,
  projected: Projected[],
  view: ViewKind,
  clipId: string,
  emphasis: Emphasis,
  interactive = false,
): string {
  const body = group(
    { 'shape-rendering': 'geometricPrecision' },
    projected.map((item) =>
      pieceRect(
        scene,
        item,
        item.near ? emphasis.near : emphasis.far,
        interactive ? item.index : undefined,
      ),
    ),
  );

  if (view !== 'top' && view !== 'bottom') return body;
  // Nothing shows through: the near layer is solid, and what is under it is
  // seen through the gaps between its boards.
  if (emphasis.ghost === null) return body;
  const ghost = emphasis.ghost;

  const near = projected.filter((item) => item.near);
  const behind = projected.filter((item) => !item.near);
  if (near.length === 0 || behind.length === 0) return body;

  const clip = el(
    'clipPath',
    { id: clipId },
    near
      .map((item) =>
        rect(scene.px(item.u), scene.py(item.v), scene.len(item.du), scene.len(item.dv)),
      )
      .join(''),
  );

  return (
    `<defs>${clip}</defs>` +
    body +
    group(
      // The ghosts sit over the boards, so they must not take the clicks meant
      // for the boards underneath them.
      { 'clip-path': `url(#${clipId})`, 'pointer-events': 'none' },
      behind.map((item) => pieceRect(scene, item, ghost)),
    )
  );
}

/** Nail dots appear in the top and bottom views only. */
function drawNails(scene: Scene, layout: Layout, view: ViewKind): string {
  if (view !== 'top' && view !== 'bottom') return '';
  const dots = layout.nailDots.filter((dot) => dot.face === view);
  return group(
    { 'pointer-events': 'none' },
    dots.map((dot) => {
      const { u, v } = projectPlanPoint(dot, layout, view);
      return circle(scene.px(u), scene.py(v), NAIL_RADIUS, {
        fill: NAIL_INK,
        stroke: '#ffffff',
        'stroke-width': NAIL_HALO,
      });
    }),
  );
}

/**
 * A click target over every crossing, drawn only while the editor is placing
 * nails. Tagged with its index in `layout.nailCrossings`, the same way a piece
 * carries its index, so a click can be taken back to the crossing it landed on.
 *
 * `pointer-events: all` because the fill is invisible: an unpainted rectangle
 * would let the click fall through to the board underneath and merely select it.
 */
function drawNailTargets(scene: Scene, layout: Layout, view: ViewKind): string {
  if (view !== 'top' && view !== 'bottom') return '';
  return group(
    {},
    layout.nailCrossings.map((crossing, index) => {
      if (crossing.face !== view) return '';
      const a = projectPlanPoint({ x: crossing.x0, y: crossing.y0 }, layout, view);
      const b = projectPlanPoint({ x: crossing.x1, y: crossing.y1 }, layout, view);
      const u = Math.min(a.u, b.u);
      const v = Math.min(a.v, b.v);
      return rect(
        scene.px(u),
        scene.py(v),
        scene.len(Math.abs(b.u - a.u)),
        scene.len(Math.abs(b.v - a.v)),
        {
          fill: 'none',
          stroke: crossing.manual ? NAIL_TARGET_MANUAL_INK : NAIL_TARGET_INK,
          'stroke-width': NAIL_TARGET_STROKE,
          'stroke-dasharray': crossing.manual ? undefined : '1.5 1.5',
          'pointer-events': 'all',
          'data-crossing': index,
        },
      );
    }),
  );
}

function drawTitle(scene: Scene, view: ViewKind): string {
  return renderTitle(scene.width, scene.height, VIEW_TITLE[view]);
}

/**
 * What a view dimensions, in millimetres, before anything decides where to draw
 * it. The DXF reads the same list, so the two outputs cannot disagree about
 * which numbers a drawing carries.
 */
export function viewDimensions(layout: Layout, view: ViewKind): DimSpec[] {
  return buildDimensions(layout, view, projectPieces(layout, view));
}

function buildDimensions(layout: Layout, view: ViewKind, projected: Projected[]): DimSpec[] {
  const frame = viewFrame(layout, view);
  const dims: DimSpec[] = [];

  if (view === 'top' || view === 'bottom') {
    const overhang = view === 'top' ? layout.topOverhang : layout.bottomOverhang;
    dims.push(...overhangDims(layout, view, overhang));
    dims.push(...nearLayerDims(layout, view, projected));
    dims.push(...nudgeDims(layout, view, projected));
  }

  dims.push({
    side: 'bottom',
    tier: TIER.overall,
    lane: 0,
    a: 0,
    b: frame.uSpan,
    anchor: frame.vSpan,
    label: mmLabel(frame.uSpan),
  });
  dims.push({
    side: 'right',
    tier: TIER.overall,
    lane: 0,
    a: 0,
    b: frame.vSpan,
    anchor: frame.uSpan,
    label: mmLabel(frame.vSpan),
  });

  return dims;
}

/** Every non-zero overhang on a wing pallet has to be dimensioned. */
function overhangDims(layout: Layout, view: ViewKind, overhang: Overhang | null): DimSpec[] {
  if (!hasOverhang(overhang) || !overhang || !layout.base) return [];
  const dims: DimSpec[] = [];
  const { base } = layout;
  const width = layout.overallWidth;

  // Along the length, measured on the bottom lane.
  if (Math.abs(overhang.lengthStart) > TOLERANCE) {
    dims.push({
      side: 'bottom',
      tier: TIER.detail,
      lane: 0,
      a: 0,
      b: base.x0,
      anchor: layout.overallWidth,
      label: mmLabel(overhang.lengthStart),
    });
  }
  if (Math.abs(overhang.lengthEnd) > TOLERANCE) {
    dims.push({
      side: 'bottom',
      tier: TIER.detail,
      lane: 0,
      a: base.x1,
      b: layout.overallLength,
      anchor: layout.overallWidth,
      label: mmLabel(overhang.lengthEnd),
    });
  }

  // Across the width, measured on the right lane. The bottom view is mirrored,
  // so the two width sides swap over.
  const toV = (y: number): number => (view === 'bottom' ? width - y : y);
  if (Math.abs(overhang.widthStart) > TOLERANCE) {
    dims.push({
      side: 'right',
      tier: TIER.detail,
      lane: 0,
      a: toV(0),
      b: toV(base.y0),
      anchor: layout.overallLength,
      label: mmLabel(overhang.widthStart),
    });
  }
  if (Math.abs(overhang.widthEnd) > TOLERANCE) {
    dims.push({
      side: 'right',
      tier: TIER.detail,
      lane: 0,
      a: toV(base.y1),
      b: toV(width),
      anchor: layout.overallLength,
      label: mmLabel(overhang.widthEnd),
    });
  }

  return dims;
}

/** The layer this view emphasises: whichever one the viewer meets first. */
function nearLayer(layout: Layout, view: ViewKind): LayerLayout | undefined {
  const faces = facesOf(layout);
  const id = view === 'bottom' ? faces.bottom : faces.top;
  return layout.layers.find((layer) => layer.layerId === id);
}

/**
 * The side of the drawing a layer's spacing is measured on, which is whichever
 * side is square to the axis its boards are spread across. Boards spread along
 * the length are measured underneath, sharing that band with the overall length
 * rather than claiming a margin of their own.
 */
function spreadSide(layer: LayerLayout): Side {
  return layer.direction === 'along_length' ? 'left' : 'bottom';
}

function alongSpread(item: Projected, side: Side): { start: number; extent: number } {
  return side === 'left'
    ? { start: item.v, extent: item.dv }
    : { start: item.u, extent: item.du };
}

/** Extension lines start at the edge of the piece facing the dimension lane. */
function anchorFor(item: Projected, side: Side): number {
  return side === 'left' ? item.u : item.v + item.dv;
}

/** The width of each distinct board variant, and the computed gap, once per layer. */
function nearLayerDims(layout: Layout, view: ViewKind, projected: Projected[]): DimSpec[] {
  const layer = nearLayer(layout, view);
  if (!layer || layer.contentType === 'grid') return [];

  const side = spreadSide(layer);
  const items = projected
    .filter((item) => item.piece.layerId === layer.layerId)
    .sort((a, b) => alongSpread(a, side).start - alongSpread(b, side).start);
  if (items.length === 0) return [];

  const dims: DimSpec[] = [];

  const seen = new Set<number>();
  for (const item of items) {
    if (seen.has(item.piece.partNo)) continue;
    seen.add(item.piece.partNo);
    const { start, extent } = alongSpread(item, side);
    dims.push({
      side,
      tier: TIER.detail,
      lane: 0,
      a: start,
      b: start + extent,
      anchor: anchorFor(item, side),
      label: mmLabel(extent),
    });
  }

  // The gap is shown once per layer, measured between the first clean pair.
  const gap = layer.spread?.gap ?? 0;
  if (layer.spread && layer.spread.gapCount > 0 && gap > TOLERANCE) {
    for (let i = 0; i < items.length - 1; i++) {
      const current = items[i]!;
      const next = items[i + 1]!;
      if (current.piece.nudged || next.piece.nudged) continue;
      const end = alongSpread(current, side).start + alongSpread(current, side).extent;
      const start = alongSpread(next, side).start;
      if (start - end <= TOLERANCE) continue;
      dims.push({
        side,
        tier: TIER.detail,
        lane: 0,
        a: end,
        b: start,
        anchor: anchorFor(current, side),
        label: mmLabel(gap),
      });
      break;
    }
  }

  return dims;
}

/**
 * A board that is not where equal spacing would put it gets its real position
 * printed, measured from the nearest edge. Without it the production team will
 * build it evenly spaced out of habit.
 */
function nudgeDims(layout: Layout, view: ViewKind, projected: Projected[]): DimSpec[] {
  const dims: DimSpec[] = [];
  const frame = viewFrame(layout, view);

  for (const item of projected) {
    if (!item.piece.nudged) continue;
    // Bottom deck boards are dimensioned in the bottom view, everything else on top.
    const belongsHere =
      view === 'bottom'
        ? item.piece.layerKind === 'bottom_deck'
        : item.piece.layerKind !== 'bottom_deck';
    if (!belongsHere) continue;

    const layer = layout.layers.find((l) => l.layerId === item.piece.layerId);
    if (!layer) continue;
    const side = spreadSide(layer);
    const { start, extent } = alongSpread(item, side);
    const span = side === 'left' ? frame.vSpan : frame.uSpan;
    const fromStart = start;
    const fromEnd = span - (start + extent);

    dims.push(
      fromStart <= fromEnd
        ? {
            side,
            tier: TIER.nudge,
            lane: 0,
            a: 0,
            b: start,
            anchor: anchorFor(item, side),
            label: mmLabel(fromStart),
          }
        : {
            side,
            tier: TIER.nudge,
            lane: 0,
            a: start + extent,
            b: span,
            anchor: anchorFor(item, side),
            label: mmLabel(fromEnd),
          },
    );
  }

  return dims;
}
