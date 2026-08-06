import { nextNailCount, sameNailCrossing } from '../geometry/nails.js';
import type { NailCrossing } from '../geometry/nails.js';
import type { PieceSource } from '../geometry/types.js';
import { notApplicable } from '../types.js';
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
import { newCell, newGrid, newLayer, newSlot, runLength } from './templates.js';

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
  // `reset` marks a document that came from the store rather than from an edit.
  // It means nothing here; the history around this reducer reads it as a point
  // there is no going back past. See ./history.ts.
  | { type: 'replace'; pallet: Pallet; reset?: boolean }
  | { type: 'patchPallet'; patch: Partial<Pallet> }
  | { type: 'addLayer'; kind: LayerKind }
  | { type: 'removeLayer'; layerId: string }
  | { type: 'patchLayer'; layerId: string; patch: Partial<Layer> }
  | { type: 'fitRun'; layerId: string; runOffsetMm: number; runSpanMm: number }
  | { type: 'moveLayer'; layerId: string; by: number }
  | { type: 'setContent'; layerId: string; contentType: LayerContent['type'] }
  | { type: 'addSlot'; layerId: string }
  | { type: 'removeSlot'; layerId: string; index: number }
  | { type: 'patchSlot'; layerId: string; index: number; patch: Partial<Slot> }
  | { type: 'setSlotCount'; layerId: string; count: number }
  | { type: 'patchAllSlots'; layerId: string; patch: Partial<Slot> }
  | { type: 'patchGrid'; layerId: string; patch: Partial<Omit<BlockGrid, 'cells'>> }
  | { type: 'patchCell'; layerId: string; row: number; col: number; patch: Partial<BlockCell> }
  | { type: 'patchAllCells'; layerId: string; patch: Partial<BlockCell> }
  | { type: 'fillGrid'; layerId: string; row: number; col: number }
  | { type: 'patchSheet'; layerId: string; patch: Partial<SheetSpec> }
  | { type: 'addNail' }
  | { type: 'removeNail'; index: number }
  | { type: 'patchNail'; index: number; patch: Partial<NailSpec> }
  | { type: 'cycleNailCrossing'; crossing: NailCrossing }
  | { type: 'clearNailPlacements' }
  | { type: 'select'; selection: Selection | null }
  | { type: 'nudge'; delta: number }
  | { type: 'setNudge'; value: number };

export function sameSource(a: PieceSource, b: PieceSource): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'slot' && b.kind === 'slot') return a.index === b.index;
  if (a.kind === 'cell' && b.kind === 'cell') return a.row === b.row && a.col === b.col;
  return true;
}

/**
 * As many boards as one layer will ever be given at once. A deck is a handful
 * of boards, so a number past this is a typing slip, and turning it into ten
 * thousand rows would be worse than ignoring it.
 */
export const MAX_SLOTS = 200;

/** The same guard for a grid, which is counted on both sides. */
export const MAX_GRID_SIDE = 20;

/**
 * What a new board is made of.
 *
 * The design's species where it states one. A design that leaves it blank, or
 * says the sheet should not carry a species at all, still has to make boards
 * out of something, so those both fall back to pine rather than to a board
 * labelled with the word that meant "do not print this".
 */
function defaultMaterial(pallet: Pallet): string {
  return notApplicable(pallet.species) ? 'pine' : pallet.species || 'pine';
}

/**
 * Another board for a layer, matching the last one it has.
 *
 * A deck is nearly always one size repeated, so the size carries over. Where
 * the board sits does not: a nudge and a join belong to the one board they were
 * set on, and copying those would move a board nobody asked to move.
 */
function anotherSlot(pallet: Pallet, layer: Layer, slots: Slot[]): Slot {
  const previous = slots.at(-1);
  return previous
    ? { ...previous, nudgeMm: 0, joinedToPrev: false }
    : newSlot(defaultMaterial(pallet), runLength(pallet, layer.direction));
}

/** Layers are ordered top to bottom, and `order` just follows the list. */
function renumber(pallet: Pallet): void {
  pallet.layers.forEach((layer, index) => {
    layer.order = index + 1;
  });
  // The top layer has nothing above it to share a height with, so a layer that
  // becomes the top one has to stop claiming that it does. Same reasoning as
  // the first board of a layer and its join.
  if (pallet.layers[0]) pallet.layers[0].sameLevelAsPrev = false;
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
      const material = defaultMaterial(pallet);
      pallet.layers.push(newLayer(action.kind, pallet.layers.length + 1, material, pallet));
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

    /**
     * Shorten a layer to the run left free by the layers it shares its level
     * with — the cross-running group of a deck that runs two ways, cut to sit
     * between the boards at the ends.
     *
     * Where the boards start and how long they are cut are one answer, so this
     * writes both rather than leaving a run span the boards overrun. The
     * arithmetic is `fitRun` in the layout engine; this only records it, and
     * either number can be typed over afterwards.
     */
    case 'fitRun': {
      const layer = findLayer(pallet, action.layerId);
      if (layer) {
        layer.runOffsetMm = action.runOffsetMm;
        layer.runSpanMm = action.runSpanMm;
        if (layer.content.type === 'sequence') {
          for (const slot of layer.content.slots) slot.length = action.runSpanMm;
        } else if (layer.content.type === 'sheet') {
          layer.content.sheet.length = action.runSpanMm;
        }
      }
      break;
    }

    case 'setContent': {
      const layer = findLayer(pallet, action.layerId);
      if (layer && layer.content.type !== action.contentType) {
        const material = defaultMaterial(pallet);
        layer.content =
          action.contentType === 'grid'
            ? { type: 'grid', grid: newGrid(3, 3, material) }
            : action.contentType === 'sheet'
              ? {
                  type: 'sheet',
                  sheet: {
                    length: pallet.overallLength,
                    width: pallet.overallWidth,
                    thickness: 12,
                    material: 'plywood',
                  },
                }
              : {
                  type: 'sequence',
                  slots: [newSlot(material, runLength(pallet, layer.direction))],
                };
        if (selection?.layerId === layer.id) selection = null;
      }
      break;
    }

    case 'addSlot': {
      const layer = findLayer(pallet, action.layerId);
      if (layer?.content.type === 'sequence') {
        const slots = layer.content.slots;
        if (slots.length < MAX_SLOTS) slots.push(anotherSlot(pallet, layer, slots));
      }
      break;
    }

    /**
     * How many boards the layer has, set as a number rather than reached by
     * clicking Add seven times. Boards already there are left exactly as they
     * are; the count only adds to the end or takes from it.
     */
    case 'setSlotCount': {
      const layer = findLayer(pallet, action.layerId);
      if (layer?.content.type === 'sequence') {
        const slots = layer.content.slots;
        const count = Math.min(Math.max(Math.round(action.count), 1), MAX_SLOTS);
        while (slots.length < count) slots.push(anotherSlot(pallet, layer, slots));
        if (slots.length > count) {
          slots.length = count;
          // The first board is never joined to one before it, so a board that
          // becomes the first has to stop claiming that it is.
          if (slots[0]) slots[0].joinedToPrev = false;
          if (
            selection?.layerId === layer.id &&
            selection.source.kind === 'slot' &&
            selection.source.index >= count
          ) {
            selection = null;
          }
        }
      }
      break;
    }

    /**
     * One size for every board in the layer, which is what eight designs in ten
     * want. Only what is passed is written, so the nudge and the join each
     * board carries survive being resized with the rest.
     */
    case 'patchAllSlots': {
      const layer = findLayer(pallet, action.layerId);
      if (layer?.content.type === 'sequence') {
        for (const slot of layer.content.slots) Object.assign(slot, action.patch);
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
        // A grid of blocks is a few by a few. Anything past that is a slip of
        // the keyboard, and building the matrix it asks for would hang the tab.
        grid.rows = Math.min(Math.max(Math.round(grid.rows), 1), MAX_GRID_SIDE);
        grid.cols = Math.min(Math.max(Math.round(grid.cols), 1), MAX_GRID_SIDE);
        // Keep the cell matrix the shape the counts claim.
        const template = grid.cells[0]?.[0];
        grid.cells = Array.from({ length: grid.rows }, (_, r) =>
          Array.from(
            { length: grid.cols },
            (_, c) =>
              grid.cells[r]?.[c] ??
              (template ? { ...template } : newCell(defaultMaterial(pallet))),
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

    /** One size for every block in the grid, the same idea as for boards. */
    case 'patchAllCells': {
      const layer = findLayer(pallet, action.layerId);
      if (layer?.content.type === 'grid') {
        for (const cell of layer.content.grid.cells.flat()) Object.assign(cell, action.patch);
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
      pallet.nails.push({ label: '', type: 'wire nail' });
      break;

    case 'removeNail':
      pallet.nails.splice(action.index, 1);
      break;

    case 'patchNail': {
      const nail = pallet.nails[action.index];
      if (nail) Object.assign(nail, action.patch);
      break;
    }

    /**
     * A click on a crossing in the top or bottom view. The count steps on by
     * one and round, so clicking keeps working and never has to be undone.
     *
     * A crossing put back to what it would have been anyway drops its placement
     * rather than storing one: the document then says only what was changed,
     * and a crossing on the default follows the default if the pallet is
     * rearranged later.
     */
    case 'cycleNailCrossing': {
      const { crossing } = action;
      const at = pallet.nailPlacements.findIndex((placement) =>
        sameNailCrossing(placement, crossing),
      );
      const next = nextNailCount(crossing.count);

      if (next === crossing.defaultCount) {
        if (at >= 0) pallet.nailPlacements.splice(at, 1);
      } else if (at >= 0) {
        pallet.nailPlacements[at]!.count = next;
      } else {
        pallet.nailPlacements.push({
          upperLayerId: crossing.upperLayerId,
          upperSource: crossing.upperSource,
          lowerLayerId: crossing.lowerLayerId,
          lowerSource: crossing.lowerSource,
          count: next,
        });
      }
      break;
    }

    case 'clearNailPlacements':
      pallet.nailPlacements = [];
      break;

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
