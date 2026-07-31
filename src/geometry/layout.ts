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
import { computeNailDots } from './nails.js';
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
  const thicknesses = ordered.map(layerThickness);
  const derivedHeight = thicknesses.reduce((sum, t) => sum + t, 0);
  const zBottoms: number[] = new Array(ordered.length).fill(0);
  let z = 0;
  for (let i = ordered.length - 1; i >= 0; i--) {
    zBottoms[i] = z;
    z += thicknesses[i]!;
  }

  ordered.forEach((layer, index) => {
    const zBottom = zBottoms[index]!;
    const thickness = thicknesses[index]!;
    checkKind(layer, issues);

    switch (layer.content.type) {
      case 'sequence':
        layerLayouts.push(
          placeSequence(pallet, layer, layer.content.slots, zBottom, thickness, pieces, issues),
        );
        break;
      case 'sheet':
        layerLayouts.push(
          placeSheet(pallet, layer, layer.content.sheet, zBottom, thickness, pieces, issues),
        );
        break;
      case 'grid':
        layerLayouts.push(
          placeGrid(pallet, layer, layer.content.grid, zBottom, thickness, pieces, issues),
        );
        break;
    }
  });

  checkPartNumbers(pallet, issues);

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

  const nails = computeNailDots(pallet.nails, layerLayouts, pieces);
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
  zBottom: number,
  thickness: number,
  pieces: PlacedPiece[],
  issues: LayoutIssue[],
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
    const at = spread.positions[i]!;
    checkRun(pallet, layer, slot.length, issues);
    pieces.push({
      partNo: slot.partNo,
      layerKind: layer.kind,
      layerId: layer.id,
      source: { kind: 'slot', index: i },
      x: run === 'x' ? layer.runOffsetMm : at,
      y: run === 'x' ? at : layer.runOffsetMm,
      z: zBottom,
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
    zBottom,
    thickness,
    spread,
    rows: null,
    cols: null,
  };
}

function placeSheet(
  pallet: Pallet,
  layer: Layer,
  sheet: SheetSpec,
  zBottom: number,
  thickness: number,
  pieces: PlacedPiece[],
  issues: LayoutIssue[],
): LayerLayout {
  const { run } = axesFor(layer.direction);
  const available = layer.spanMm ?? fullSpan(pallet, layer.direction);
  const spread = distributeEvenly(available, layer.offsetMm, [sheet.width]);

  reportOverfull(layer, spread.slack, available, issues);
  checkRun(pallet, layer, sheet.length, issues);

  const at = spread.positions[0]!;
  pieces.push({
    partNo: sheet.partNo,
    layerKind: layer.kind,
    layerId: layer.id,
    source: { kind: 'sheet' },
    x: run === 'x' ? layer.runOffsetMm : at,
    y: run === 'x' ? at : layer.runOffsetMm,
    z: zBottom,
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
    zBottom,
    thickness,
    spread,
    rows: null,
    cols: null,
  };
}

function placeGrid(
  pallet: Pallet,
  layer: Layer,
  grid: BlockGrid,
  zBottom: number,
  thickness: number,
  pieces: PlacedPiece[],
  issues: LayoutIssue[],
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
          partNo: cell.partNo,
          layerKind: layer.kind,
          layerId: layer.id,
          source: { kind: 'cell', row: r, col: c },
          x,
          y,
          z: zBottom,
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
    zBottom,
    thickness,
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

/** Slots with identical dimensions share a partNo, so the reverse must hold. */
function checkPartNumbers(pallet: Pallet, issues: LayoutIssue[]): void {
  const seen = new Map<number, { signature: string; where: string }>();
  for (const layer of pallet.layers) {
    const entries: Array<{ partNo: number; signature: string }> = [];
    const content = layer.content;
    if (content.type === 'sequence') {
      for (const slot of content.slots) {
        entries.push({
          partNo: slot.partNo,
          signature: `${slot.thickness}x${slot.width}x${slot.length}/${slot.material}`,
        });
      }
    } else if (content.type === 'grid') {
      for (const cell of content.grid.cells.flat()) {
        entries.push({
          partNo: cell.partNo,
          signature: `${cell.heightMm}x${cell.widthMm}x${cell.lengthMm}/${cell.material}`,
        });
      }
    } else {
      const s = content.sheet;
      entries.push({
        partNo: s.partNo,
        signature: `${s.thickness}x${s.width}x${s.length}/${s.material}`,
      });
    }

    for (const entry of entries) {
      const prev = seen.get(entry.partNo);
      if (!prev) {
        seen.set(entry.partNo, { signature: entry.signature, where: describe(layer) });
      } else if (prev.signature !== entry.signature) {
        issues.push({
          severity: 'error',
          code: 'part_no_clash',
          layerId: layer.id,
          layerKind: layer.kind,
          message: `Part ${entry.partNo} is ${entry.signature} in ${describe(layer)} but ${prev.signature} in ${prev.where}`,
        });
      }
    }
  }
}
