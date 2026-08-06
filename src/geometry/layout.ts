import type {
  BlockGrid,
  Direction,
  Layer,
  Pallet,
  SheetSpec,
  Slot,
} from '../types.js';
import { EPSILON, distribute, distributeEvenly } from './distribute.js';
import { boundingBox, overhangOf } from './footprint.js';
import { computeNails } from './nails.js';
import { cellSignature, partNumbers, sheetSignature, slotSignature } from './parts.js';
import type {
  Layout,
  LayerLayout,
  LayoutIssue,
  PlacedPiece,
} from './types.js';
import { PalletLayoutError } from './types.js';

/**
 * Which axis the boards run along, and which axis they are distributed across.
 *
 * `length` always runs the same direction as the top boards, so a layer whose
 * direction is 'along_length' has its boards running along x and spread out
 * across y.
 */
function axesFor(direction: Direction): { run: 'x' | 'y'; spread: 'x' | 'y' } {
  return direction === 'along_length'
    ? { run: 'x', spread: 'y' }
    : { run: 'y', spread: 'x' };
}

/** The pallet dimension a layer's boards are distributed across. */
function fullSpan(pallet: Pallet, direction: Direction): number {
  return direction === 'along_length' ? pallet.overallWidth : pallet.overallLength;
}

/** The pallet dimension a layer's boards run along. */
function fullRun(pallet: Pallet, direction: Direction): number {
  return direction === 'along_length' ? pallet.overallLength : pallet.overallWidth;
}

function layerThickness(layer: Layer): number {
  const content = layer.content;
  switch (content.type) {
    case 'sequence':
      return content.slots.reduce((max, slot) => Math.max(max, slot.thickness), 0);
    case 'grid':
      return content.grid.cells
        .flat()
        .reduce((max, cell) => Math.max(max, cell.heightMm), 0);
    case 'sheet':
      return content.sheet.thickness;
  }
}

/**
 * How a layer is named in a message. Its position and kind, not its id: ids are
 * generated and mean nothing to the person reading the error.
 */
function describe(layer: Layer): string {
  return `the ${layer.kind.replace('_', ' ')} layer at position ${layer.order}`;
}

/**
 * Which level each layer belongs to, for layers already ordered top to bottom.
 *
 * A level is a course of timber at one height. Normally it is one layer, and
 * these come out 0, 1, 2, 3. A layer marked `sameLevelAsPrev` joins the level
 * above instead of starting one of its own. The topmost layer always starts
 * level 0 whatever it is marked, since there is nothing above it to join.
 */
export function levelIndices(ordered: Layer[]): number[] {
  const levels: number[] = [];
  let level = -1;
  ordered.forEach((layer, index) => {
    if (index === 0 || !layer.sameLevelAsPrev) level += 1;
    levels.push(level);
  });
  return levels;
}

/** The extent of each level: as thick as the thickest layer in it. */
function levelExtents(levelOf: number[], thicknesses: number[]): number[] {
  const extents: number[] = [];
  levelOf.forEach((level, index) => {
    extents[level] = Math.max(extents[level] ?? 0, thicknesses[index]!);
  });
  return extents;
}

/**
 * Two layers at one height cannot both have timber in the same place, so an
 * overlap in plan between them is a mistake — usually a cross-running group
 * that was never shortened to fit between the boards it sits between.
 *
 * Only checked across layers of a level. Pieces inside one layer are already
 * spaced by `distribute`, and an over-full layer is reported as that.
 */
function reportLevelClashes(
  ordered: Layer[],
  levelOf: number[],
  layerLayouts: LayerLayout[],
  pieces: PlacedPiece[],
  issues: LayoutIssue[],
): void {
  const byLayer = new Map<string, PlacedPiece[]>();
  for (const piece of pieces) {
    const list = byLayer.get(piece.layerId);
    if (list) list.push(piece);
    else byLayer.set(piece.layerId, [piece]);
  }
  // A layer that failed to place anything has no layout, and nothing to clash.
  const placed = new Set(layerLayouts.map((layout) => layout.layerId));

  for (let i = 0; i < ordered.length; i++) {
    for (let j = i + 1; j < ordered.length; j++) {
      if (levelOf[i] !== levelOf[j]) continue;
      const a = ordered[i]!;
      const b = ordered[j]!;
      if (!placed.has(a.id) || !placed.has(b.id)) continue;

      // Boards of one course are cut from one board. Where they are not, the
      // level is as deep as the deeper of them and the shallower sits on the
      // underside of it, which is a step in the deck and worth saying so.
      const thickA = layerThickness(a);
      const thickB = layerThickness(b);
      if (Math.abs(thickA - thickB) > EPSILON) {
        issues.push({
          severity: 'warning',
          code: 'level_thickness',
          layerId: b.id,
          layerKind: b.kind,
          message: `${describe(b)} is ${thickB} thick and shares its level with ${describe(a)} at ${thickA}, so the two do not finish flush`,
        });
      }

      if (!anyOverlapInPlan(byLayer.get(a.id) ?? [], byLayer.get(b.id) ?? [])) continue;
      issues.push({
        severity: 'error',
        code: 'level_clash',
        layerId: b.id,
        layerKind: b.kind,
        message: `${describe(b)} shares its level with ${describe(a)} but overlaps it in plan, so the two would occupy the same timber`,
      });
    }
  }
}

function anyOverlapInPlan(a: PlacedPiece[], b: PlacedPiece[]): boolean {
  return a.some((one) =>
    b.some(
      (other) =>
        Math.min(one.x + one.dx, other.x + other.dx) - Math.max(one.x, other.x) > EPSILON &&
        Math.min(one.y + one.dy, other.y + other.dy) - Math.max(one.y, other.y) > EPSILON,
    ),
  );
}

/** Where a layer sits in the stack, worked out once before it is placed. */
interface LevelPosition {
  level: number;
  zBottom: number;
  thickness: number;
}

/**
 * Lay a pallet out. Collects issues rather than throwing so that the editor can
 * show a broken design; `computeLayout` is the strict entry point.
 */
export function analysePallet(pallet: Pallet): Layout {
  const issues: LayoutIssue[] = [];
  const pieces: PlacedPiece[] = [];
  const layerLayouts: LayerLayout[] = [];

  if (pallet.overallLength <= 0 || pallet.overallWidth <= 0) {
    issues.push({
      severity: 'error',
      code: 'bad_overall_size',
      message: `Overall size must be positive, got ${pallet.overallLength} x ${pallet.overallWidth}`,
    });
  }

  // Part numbers follow the sizes in the document, so they are worked out once
  // for the whole pallet and looked up as each piece is placed.
  const parts = partNumbers(pallet);

  const ordered = [...pallet.layers].sort((a, b) => a.order - b.order);
  const seenOrders = new Set<number>();
  for (const layer of ordered) {
    if (seenOrders.has(layer.order)) {
      issues.push({
        severity: 'error',
        code: 'duplicate_order',
        layerId: layer.id,
        layerKind: layer.kind,
        message: `${describe(layer)} shares its order (${layer.order}) with another layer`,
      });
    }
    seenOrders.add(layer.order);
  }

  // Layers are listed top to bottom, so stack z from the last one upwards.
  // Layers sharing a level are one course of timber, so they take one z and one
  // thickness between them rather than sitting on each other. See Layer.
  const thicknesses = ordered.map(layerThickness);
  const levelOf = levelIndices(ordered);
  const levelThicknesses = levelExtents(levelOf, thicknesses);
  const derivedHeight = levelThicknesses.reduce((sum, t) => sum + t, 0);

  const levelZ: number[] = new Array(levelThicknesses.length).fill(0);
  let z = 0;
  for (let i = levelThicknesses.length - 1; i >= 0; i--) {
    levelZ[i] = z;
    z += levelThicknesses[i]!;
  }

  ordered.forEach((layer, index) => {
    const level = levelOf[index]!;
    const zBottom = levelZ[level]!;
    const thickness = thicknesses[index]!;
    checkKind(layer, issues);

    const at = { level, zBottom, thickness };
    switch (layer.content.type) {
      case 'sequence':
        layerLayouts.push(
          placeSequence(pallet, layer, layer.content.slots, at, pieces, issues, parts),
        );
        break;
      case 'sheet':
        layerLayouts.push(
          placeSheet(pallet, layer, layer.content.sheet, at, pieces, issues, parts),
        );
        break;
      case 'grid':
        layerLayouts.push(
          placeGrid(pallet, layer, layer.content.grid, at, pieces, issues, parts),
        );
        break;
    }
  });

  reportLevelClashes(ordered, levelOf, layerLayouts, pieces, issues);

  if (
    pallet.overallHeight > 0 &&
    Math.abs(pallet.overallHeight - derivedHeight) > EPSILON
  ) {
    issues.push({
      severity: 'warning',
      code: 'height_override',
      message: `Stated overall height ${pallet.overallHeight} differs from the layer stack total ${derivedHeight}`,
    });
  }

  const nails = computeNails(pallet.nailPlacements, layerLayouts, pieces);
  issues.push(...nails.issues);

  const base = boundingBox(
    pieces.filter((p) => p.layerKind === 'block' || p.layerKind === 'runner'),
  );
  const topDeck = boundingBox(pieces.filter((p) => p.layerKind === 'top_deck'));
  const bottomDeck = boundingBox(pieces.filter((p) => p.layerKind === 'bottom_deck'));

  return {
    pieces,
    layers: layerLayouts,
    derivedHeight,
    overallHeight: pallet.overallHeight > 0 ? pallet.overallHeight : derivedHeight,
    overallLength: pallet.overallLength,
    overallWidth: pallet.overallWidth,
    base,
    topDeck,
    bottomDeck,
    topOverhang: overhangOf(topDeck, base),
    bottomOverhang: overhangOf(bottomDeck, base),
    nailDots: nails.dots,
    nailCrossings: nails.crossings,
    issues,
  };
}

/**
 * Lay a pallet out, refusing to produce a drawing that would be wrong.
 * A wrong drawing on the shop floor is worse than no drawing.
 */
export function computeLayout(pallet: Pallet): Layout {
  const layout = analysePallet(pallet);
  const errors = layout.issues.filter((issue) => issue.severity === 'error');
  if (errors.length > 0) throw new PalletLayoutError(errors);
  return layout;
}

/** Collect every problem with a pallet without throwing. */
export function validatePallet(pallet: Pallet): LayoutIssue[] {
  return analysePallet(pallet).issues;
}

function placeSequence(
  pallet: Pallet,
  layer: Layer,
  slots: Slot[],
  at: LevelPosition,
  pieces: PlacedPiece[],
  issues: LayoutIssue[],
  parts: Map<string, number>,
): LayerLayout {
  const { run } = axesFor(layer.direction);
  const available = layer.spanMm ?? fullSpan(pallet, layer.direction);

  if (slots.length === 0) {
    issues.push({
      severity: 'error',
      code: 'empty_layer',
      layerId: layer.id,
      layerKind: layer.kind,
      message: `${describe(layer)} has no slots`,
    });
  }

  const spread = distribute(
    available,
    layer.offsetMm,
    slots.map((slot) => ({
      extent: slot.width,
      joinedToPrev: slot.joinedToPrev,
      nudgeMm: slot.nudgeMm,
    })),
  );

  reportOverfull(layer, spread.slack, available, issues);

  slots.forEach((slot, i) => {
    const across = spread.positions[i]!;
    checkRun(pallet, layer, slot.length, issues);
    pieces.push({
      partNo: parts.get(slotSignature(layer, slot)) ?? 0,
      layerKind: layer.kind,
      layerId: layer.id,
      source: { kind: 'slot', index: i },
      x: run === 'x' ? layer.runOffsetMm : across,
      y: run === 'x' ? across : layer.runOffsetMm,
      z: at.zBottom,
      dx: run === 'x' ? slot.length : slot.width,
      dy: run === 'x' ? slot.width : slot.length,
      dz: slot.thickness,
      material: slot.material,
      ...(slot.variant !== undefined ? { variant: slot.variant } : {}),
      nudged: slot.nudgeMm !== 0,
    });
  });

  return {
    layerId: layer.id,
    kind: layer.kind,
    order: layer.order,
    direction: layer.direction,
    contentType: 'sequence',
    level: at.level,
    zBottom: at.zBottom,
    thickness: at.thickness,
    spread,
    rows: null,
    cols: null,
  };
}

function placeSheet(
  pallet: Pallet,
  layer: Layer,
  sheet: SheetSpec,
  at: LevelPosition,
  pieces: PlacedPiece[],
  issues: LayoutIssue[],
  parts: Map<string, number>,
): LayerLayout {
  const { run } = axesFor(layer.direction);
  const available = layer.spanMm ?? fullSpan(pallet, layer.direction);
  const spread = distributeEvenly(available, layer.offsetMm, [sheet.width]);

  reportOverfull(layer, spread.slack, available, issues);
  checkRun(pallet, layer, sheet.length, issues);

  const across = spread.positions[0]!;
  pieces.push({
    partNo: parts.get(sheetSignature(layer, sheet)) ?? 0,
    layerKind: layer.kind,
    layerId: layer.id,
    source: { kind: 'sheet' },
    x: run === 'x' ? layer.runOffsetMm : across,
    y: run === 'x' ? across : layer.runOffsetMm,
    z: at.zBottom,
    dx: run === 'x' ? sheet.length : sheet.width,
    dy: run === 'x' ? sheet.width : sheet.length,
    dz: sheet.thickness,
    material: sheet.material,
    nudged: false,
  });

  return {
    layerId: layer.id,
    kind: layer.kind,
    order: layer.order,
    direction: layer.direction,
    contentType: 'sheet',
    level: at.level,
    zBottom: at.zBottom,
    thickness: at.thickness,
    spread,
    rows: null,
    cols: null,
  };
}

function placeGrid(
  pallet: Pallet,
  layer: Layer,
  grid: BlockGrid,
  at: LevelPosition,
  pieces: PlacedPiece[],
  issues: LayoutIssue[],
  parts: Map<string, number>,
): LayerLayout {
  const shapeOk = checkGridShape(layer, grid, issues);

  // Rows run down the pallet length, columns across the pallet width. Each row
  // is as deep as its widest cell, so a 3x3 grid with a fatter middle row works.
  const rowExtents: number[] = [];
  for (let r = 0; r < grid.rows; r++) {
    const row = grid.cells[r] ?? [];
    rowExtents.push(row.reduce((max, cell) => Math.max(max, cell.lengthMm), 0));
  }
  const colExtents: number[] = [];
  for (let c = 0; c < grid.cols; c++) {
    let max = 0;
    for (let r = 0; r < grid.rows; r++) {
      const cell = grid.cells[r]?.[c];
      if (cell) max = Math.max(max, cell.widthMm);
    }
    colExtents.push(max);
  }

  const rowAvailable = grid.rowSpanMm ?? pallet.overallLength;
  const colAvailable = grid.colSpanMm ?? pallet.overallWidth;
  const rows = distributeEvenly(rowAvailable, grid.rowOffsetMm, rowExtents);
  const cols = distributeEvenly(colAvailable, grid.colOffsetMm, colExtents);

  reportOverfull(layer, rows.slack, rowAvailable, issues, 'rows');
  reportOverfull(layer, cols.slack, colAvailable, issues, 'columns');

  if (shapeOk) {
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        const cell = grid.cells[r]![c]!;
        // A cell narrower than its band sits centred in it.
        const x = rows.positions[r]! + (rowExtents[r]! - cell.lengthMm) / 2;
        const y = cols.positions[c]! + (colExtents[c]! - cell.widthMm) / 2;
        pieces.push({
          partNo: parts.get(cellSignature(layer, cell)) ?? 0,
          layerKind: layer.kind,
          layerId: layer.id,
          source: { kind: 'cell', row: r, col: c },
          x,
          y,
          z: at.zBottom,
          dx: cell.lengthMm,
          dy: cell.widthMm,
          dz: cell.heightMm,
          material: cell.material,
          ...(cell.variant !== undefined ? { variant: cell.variant } : {}),
          nudged: false,
        });
      }
    }
  }

  return {
    layerId: layer.id,
    kind: layer.kind,
    order: layer.order,
    direction: layer.direction,
    contentType: 'grid',
    level: at.level,
    zBottom: at.zBottom,
    thickness: at.thickness,
    spread: null,
    rows,
    cols,
  };
}

function reportOverfull(
  layer: Layer,
  slack: number,
  available: number,
  issues: LayoutIssue[],
  axis?: string,
): void {
  if (slack >= -EPSILON) return;
  const where = axis ? `${describe(layer)} ${axis}` : describe(layer);
  issues.push({
    severity: 'error',
    code: 'over_full',
    layerId: layer.id,
    layerKind: layer.kind,
    message: `${where} is over-full: ${(available - slack).toFixed(1)} of material in a ${available} span, ${(-slack).toFixed(1)} too much`,
  });
}

/** A board must fit inside the run span when the base is inset on all sides. */
function checkRun(
  pallet: Pallet,
  layer: Layer,
  runExtent: number,
  issues: LayoutIssue[],
): void {
  const runAvailable = layer.runSpanMm ?? fullRun(pallet, layer.direction);
  const end = layer.runOffsetMm + runExtent;
  const limit = layer.runSpanMm === null ? runAvailable : layer.runOffsetMm + runAvailable;
  if (end - limit > EPSILON) {
    issues.push({
      severity: 'error',
      code: 'run_overflow',
      layerId: layer.id,
      layerKind: layer.kind,
      message: `${describe(layer)} has a piece running to ${end} along its own direction, past the ${limit} available`,
    });
  }
}

function checkGridShape(layer: Layer, grid: BlockGrid, issues: LayoutIssue[]): boolean {
  let ok = grid.rows > 0 && grid.cols > 0;
  if (!ok) {
    issues.push({
      severity: 'error',
      code: 'empty_grid',
      layerId: layer.id,
      layerKind: layer.kind,
      message: `${describe(layer)} has a ${grid.rows}x${grid.cols} grid`,
    });
  }
  if (grid.cells.length !== grid.rows) ok = false;
  for (const row of grid.cells) {
    if (row.length !== grid.cols) ok = false;
  }
  if (!ok && grid.rows > 0 && grid.cols > 0) {
    issues.push({
      severity: 'error',
      code: 'grid_shape',
      layerId: layer.id,
      layerKind: layer.kind,
      message: `${describe(layer)} declares ${grid.rows}x${grid.cols} but its cells are ${grid.cells.length}x${grid.cells.map((r) => r.length).join('/')}`,
    });
  }
  return ok;
}

/** The layer/content pairings that are normal. Anything else is worth a look. */
const EXPECTED_CONTENT: Record<string, string[]> = {
  panel: ['sheet'],
  top_deck: ['sequence', 'sheet'],
  bottom_deck: ['sequence', 'sheet'],
  bearer: ['sequence'],
  runner: ['sequence'],
  block: ['grid'],
};

function checkKind(layer: Layer, issues: LayoutIssue[]): void {
  const expected = EXPECTED_CONTENT[layer.kind];
  if (expected && !expected.includes(layer.content.type)) {
    issues.push({
      severity: 'warning',
      code: 'unusual_content',
      layerId: layer.id,
      layerKind: layer.kind,
      message: `${describe(layer)} holds ${layer.content.type} content, normally ${expected.join(' or ')}`,
    });
  }
}
