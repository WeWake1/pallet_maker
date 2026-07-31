import type { PieceSource } from '../geometry/types.js';
import type {
  BlockCell,
  BlockGrid,
  Layer,
  LayerContent,
  LayerKind,
  NailSpec,
  Pallet,
  SheetSpec,
  Slot,
} from '../types.js';
import { newGrid, newLayer, newSlot, nextPartNo, runLength } from './templates.js';

/**
 * Editor state.
 *
 * Every change is a change to the pallet document. The drawing is regenerated
 * from it, never edited, so there is nothing else to keep in step.
 */

export interface Selection {
  layerId: string;
  source: PieceSource;
}

export interface EditorState {
  pallet: Pallet;
  selection: Selection | null;
}

export type Action =
  | { type: 'replace'; pallet: Pallet }
  | { type: 'patchPallet'; patch: Partial<Pallet> }
  | { type: 'addLayer'; kind: LayerKind }
  | { type: 'removeLayer'; layerId: string }
  | { type: 'patchLayer'; layerId: string; patch: Partial<Layer> }
  | { type: 'moveLayer'; layerId: string; by: number }
  | { type: 'setContent'; layerId: string; contentType: LayerContent['type'] }
  | { type: 'addSlot'; layerId: string }
  | { type: 'removeSlot'; layerId: string; index: number }
  | { type: 'patchSlot'; layerId: string; index: number; patch: Partial<Slot> }
  | { type: 'patchGrid'; layerId: string; patch: Partial<Omit<BlockGrid, 'cells'>> }
  | { type: 'patchCell'; layerId: string; row: number; col: number; patch: Partial<BlockCell> }
  | { type: 'fillGrid'; layerId: string; row: number; col: number }
  | { type: 'patchSheet'; layerId: string; patch: Partial<SheetSpec> }
  | { type: 'addNail' }
  | { type: 'removeNail'; index: number }
  | { type: 'patchNail'; index: number; patch: Partial<NailSpec> }
  | { type: 'select'; selection: Selection | null }
  | { type: 'nudge'; delta: number }
  | { type: 'setNudge'; value: number };

export function sameSource(a: PieceSource, b: PieceSource): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'slot' && b.kind === 'slot') return a.index === b.index;
  if (a.kind === 'cell' && b.kind === 'cell') return a.row === b.row && a.col === b.col;
  return true;
}

/** Layers are ordered top to bottom, and `order` just follows the list. */
function renumber(pallet: Pallet): void {
  pallet.layers.forEach((layer, index) => {
    layer.order = index + 1;
  });
}

function findLayer(pallet: Pallet, layerId: string): Layer | undefined {
  return pallet.layers.find((layer) => layer.id === layerId);
}

/** The slot the selection points at, if it points at one. */
export function selectedSlot(
  pallet: Pallet,
  selection: Selection | null,
): { layer: Layer; slot: Slot; index: number } | null {
  if (!selection || selection.source.kind !== 'slot') return null;
  const layer = findLayer(pallet, selection.layerId);
  if (!layer || layer.content.type !== 'sequence') return null;
  const slot = layer.content.slots[selection.source.index];
  if (!slot) return null;
  return { layer, slot, index: selection.source.index };
}

export function reducer(state: EditorState, action: Action): EditorState {
  if (action.type === 'replace') {
    return { pallet: action.pallet, selection: null };
  }
  if (action.type === 'select') {
    return { ...state, selection: action.selection };
  }

  const pallet = structuredClone(state.pallet);
  let selection = state.selection;

  switch (action.type) {
    case 'patchPallet':
      Object.assign(pallet, action.patch);
      break;

    case 'addLayer': {
      const material = pallet.species || 'pine';
      pallet.layers.push(
        newLayer(action.kind, pallet.layers.length + 1, nextPartNo(pallet), material, pallet),
      );
      renumber(pallet);
      break;
    }

    case 'removeLayer':
      pallet.layers = pallet.layers.filter((layer) => layer.id !== action.layerId);
      renumber(pallet);
      if (selection?.layerId === action.layerId) selection = null;
      break;

    case 'moveLayer': {
      const from = pallet.layers.findIndex((layer) => layer.id === action.layerId);
      const to = from + action.by;
      if (from >= 0 && to >= 0 && to < pallet.layers.length) {
        const [moved] = pallet.layers.splice(from, 1);
        pallet.layers.splice(to, 0, moved!);
        renumber(pallet);
      }
      break;
    }

    case 'patchLayer': {
      const layer = findLayer(pallet, action.layerId);
      if (layer) Object.assign(layer, action.patch);
      break;
    }

    case 'setContent': {
      const layer = findLayer(pallet, action.layerId);
      if (layer && layer.content.type !== action.contentType) {
        const material = pallet.species || 'pine';
        const partNo = nextPartNo(pallet);
        layer.content =
          action.contentType === 'grid'
            ? { type: 'grid', grid: newGrid(3, 3, partNo, material) }
            : action.contentType === 'sheet'
              ? {
                  type: 'sheet',
                  sheet: {
                    partNo,
                    thickness: 12,
                    width: pallet.overallWidth,
                    length: pallet.overallLength,
                    material: 'plywood',
                  },
                }
              : {
                  type: 'sequence',
                  slots: [newSlot(partNo, material, runLength(pallet, layer.direction))],
                };
        if (selection?.layerId === layer.id) selection = null;
      }
      break;
    }

    case 'addSlot': {
      const layer = findLayer(pallet, action.layerId);
      if (layer?.content.type === 'sequence') {
        const previous = layer.content.slots.at(-1);
        // A new board matches the last one, since a deck is usually one size.
        layer.content.slots.push(
          previous
            ? { ...previous, nudgeMm: 0, joinedToPrev: false }
            : newSlot(
                nextPartNo(pallet),
                pallet.species || 'pine',
                runLength(pallet, layer.direction),
              ),
        );
      }
      break;
    }

    case 'removeSlot': {
      const layer = findLayer(pallet, action.layerId);
      if (layer?.content.type === 'sequence') {
        layer.content.slots.splice(action.index, 1);
        if (selection?.layerId === layer.id) selection = null;
      }
      break;
    }

    case 'patchSlot': {
      const layer = findLayer(pallet, action.layerId);
      if (layer?.content.type === 'sequence') {
        const slot = layer.content.slots[action.index];
        if (slot) Object.assign(slot, action.patch);
      }
      break;
    }

    case 'patchGrid': {
      const layer = findLayer(pallet, action.layerId);
      if (layer?.content.type === 'grid') {
        const grid = layer.content.grid;
        Object.assign(grid, action.patch);
        // Keep the cell matrix the shape the counts claim.
        const template = grid.cells[0]?.[0];
        grid.cells = Array.from({ length: grid.rows }, (_, r) =>
          Array.from(
            { length: grid.cols },
            (_, c) =>
              grid.cells[r]?.[c] ??
              (template
                ? { ...template }
                : { partNo: nextPartNo(pallet), lengthMm: 100, widthMm: 100, heightMm: 100, material: pallet.species || 'pine' }),
          ),
        );
      }
      break;
    }

    case 'patchCell': {
      const layer = findLayer(pallet, action.layerId);
      if (layer?.content.type === 'grid') {
        const cell = layer.content.grid.cells[action.row]?.[action.col];
        if (cell) Object.assign(cell, action.patch);
      }
      break;
    }

    case 'fillGrid': {
      const layer = findLayer(pallet, action.layerId);
      if (layer?.content.type === 'grid') {
        const source = layer.content.grid.cells[action.row]?.[action.col];
        if (source) {
          layer.content.grid.cells = layer.content.grid.cells.map((row) =>
            row.map(() => ({ ...source })),
          );
        }
      }
      break;
    }

    case 'patchSheet': {
      const layer = findLayer(pallet, action.layerId);
      if (layer?.content.type === 'sheet') Object.assign(layer.content.sheet, action.patch);
      break;
    }

    case 'addNail':
      pallet.nails.push({ label: '', type: 'wire nail', sizeMm: 50, count: 0 });
      break;

    case 'removeNail':
      pallet.nails.splice(action.index, 1);
      break;

    case 'patchNail': {
      const nail = pallet.nails[action.index];
      if (nail) Object.assign(nail, action.patch);
      break;
    }

    // A nudge is a number on a component, never a change to the drawing.
    case 'nudge':
    case 'setNudge': {
      const found = selectedSlot(pallet, selection);
      if (found) {
        found.slot.nudgeMm =
          action.type === 'nudge'
            ? Math.round(found.slot.nudgeMm + action.delta)
            : Math.round(action.value);
      }
      break;
    }
  }

  return { pallet, selection };
}
