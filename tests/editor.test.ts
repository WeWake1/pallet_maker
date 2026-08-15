import { describe, expect, it } from 'vitest';
import { analysePallet, computeLayout } from '../src/geometry/layout.js';
import { renderView } from '../src/render/views.js';
import { PalletSchema } from '../src/schema.js';
import { MAX_GRID_SIDE, MAX_SLOTS, reducer, sameSource, selectedSlot } from '../src/editor/state.js';
import type { Action, EditorState } from '../src/editor/state.js';
import { numberText } from '../src/editor/ui.js';
import type { BlockCell, Slot } from '../src/types.js';
import { duplicatePallet } from '../src/duplicate.js';
import { newPallet } from '../src/editor/templates.js';
import { partNumbers } from '../src/geometry/parts.js';
import type { Pallet } from '../src/types.js';

/** Every design belongs to a client, so the tests need one to hand. */
const CLIENT = { id: 'client-test', name: 'Demo Client' };

function start(pallet: Pallet = newPallet(CLIENT)): EditorState {
  return { pallet, selection: null };
}

function run(state: EditorState, ...actions: Action[]): EditorState {
  return actions.reduce(reducer, state);
}

/** The first top board, which is what a click on the preview usually lands on. */
function firstTopSlot(state: EditorState): Action {
  const layer = state.pallet.layers.find((layer) => layer.kind === 'top_deck')!;
  return { type: 'select', selection: { layerId: layer.id, source: { kind: 'slot', index: 0 } } };
}

function slotsOf(state: EditorState, layerId: string): Slot[] {
  const content = state.pallet.layers.find((layer) => layer.id === layerId)!.content;
  if (content.type !== 'sequence') throw new Error('expected boards');
  return content.slots;
}

function cellsOf(state: EditorState, layerId: string): BlockCell[] {
  const content = state.pallet.layers.find((layer) => layer.id === layerId)!.content;
  if (content.type !== 'grid') throw new Error('expected a grid');
  return content.grid.cells.flat();
}

describe('a new pallet', () => {
  const pallet = newPallet(CLIENT);

  it('is a whole plain block pallet, not an empty stack', () => {
    const layout = computeLayout(pallet);
    expect(layout.pieces).toHaveLength(7 + 3 + 9 + 3);
    expect(layout.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('can be saved as it stands, with no pallet code typed in', () => {
    // The client comes from the dashboard and everything else has a sensible
    // default, so a new design is complete the moment it is created. A code is
    // assigned by the shop later, if at all, and waiting for one only ever
    // meant a placeholder was typed in and never corrected.
    expect(pallet.palletCode).toBe('');
    expect(PalletSchema.safeParse(pallet).success).toBe(true);
    expect(PalletSchema.safeParse({ ...pallet, palletCode: 'AP-010' }).success).toBe(true);
  });

  it('gives each layer boards as long as the run they sit in', () => {
    for (const layer of pallet.layers) {
      if (layer.content.type !== 'sequence') continue;
      const expected = layer.direction === 'along_length' ? pallet.overallLength : pallet.overallWidth;
      for (const slot of layer.content.slots) expect(slot.length).toBe(expected);
    }
  });
});

describe('copying a design', () => {
  it('is a full deep copy that shares nothing with the original', () => {
    const original = newPallet(CLIENT);
    original.clientName = 'First client';
    const copy = duplicatePallet(original);

    expect(copy.id).not.toBe(original.id);
    expect(copy.layers.map((layer) => layer.id)).not.toEqual(original.layers.map((layer) => layer.id));

    // Editing one client's pallet must never affect another's.
    const copyLayer = copy.layers[0]!;
    if (copyLayer.content.type === 'sequence') copyLayer.content.slots[0]!.width = 999;
    copy.nails[0]!.count = 999;
    copy.clientName = 'Second client';

    const originalLayer = original.layers[0]!;
    if (originalLayer.content.type === 'sequence') {
      expect(originalLayer.content.slots[0]!.width).toBe(100);
    }
    expect(original.nails[0]!.count).not.toBe(999);
    expect(original.clientName).toBe('First client');
  });

  it('stays with the same client, which is where it will appear', () => {
    const original = newPallet(CLIENT);
    const copy = duplicatePallet(original);
    expect(copy.clientId).toBe(CLIENT.id);
    expect(copy.clientName).toBe(CLIENT.name);
    // A copy is only worth making before a rework, so it is dated today.
    expect(copy.updatedAt).toBe(new Date().toISOString().slice(0, 10));
  });
});

describe('the form', () => {
  it('adds a board matching the last one, so a deck is a few clicks', () => {
    const state = start();
    const layer = state.pallet.layers[0]!;
    const next = run(state, { type: 'addSlot', layerId: layer.id });
    const slots = next.pallet.layers[0]!.content;
    if (slots.type !== 'sequence') throw new Error('expected boards');
    expect(slots.slots).toHaveLength(8);
    // The top deck runs along the length, so a board of it is that long. Read
    // from the pallet rather than written out, because what is being checked is
    // that the new board matches the others, not what the starting size is.
    expect(slots.slots[7]).toMatchObject({
      width: 100,
      length: state.pallet.overallLength,
      nudgeMm: 0,
    });
  });

  /**
   * The species does two jobs: it is a line of the sheet, and it is what a new
   * board is made of. Saying the sheet should not carry that line is not saying
   * the boards are made of the word "na".
   */
  it('gives a new layer real timber when the species is left off the sheet', () => {
    for (const species of ['na', '']) {
      const state = run(start(), { type: 'patchPallet', patch: { species } });
      const added = run(state, { type: 'addLayer', kind: 'top_deck' });
      const layer = added.pallet.layers.at(-1)!;
      expect(slotsOf(added, layer.id).map((slot) => slot.material)).toContain('pine');
    }
  });

  it('lays out again on every edit, so the preview follows the numbers', () => {
    const state = start();
    const layer = state.pallet.layers[0]!;
    // Narrower boards, so the same seven share out a wider gap.
    const next = run(
      state,
      ...[0, 1, 2, 3, 4, 5, 6].map(
        (index): Action => ({ type: 'patchSlot', layerId: layer.id, index, patch: { width: 90 } }),
      ),
    );
    const before = computeLayout(state.pallet).layers[0]!.spread!.gap;
    const after = computeLayout(next.pallet).layers[0]!.spread!.gap;
    expect(after).toBeGreaterThan(before);
  });

  it('renumbers layers so order always follows the list', () => {
    const state = run(start(), { type: 'addLayer', kind: 'runner' });
    expect(state.pallet.layers.map((l) => l.order)).toEqual([1, 2, 3, 4, 5]);
    const moved = run(state, { type: 'moveLayer', layerId: state.pallet.layers[4]!.id, by: -1 });
    expect(moved.pallet.layers.map((l) => l.order)).toEqual([1, 2, 3, 4, 5]);
    expect(moved.pallet.layers[3]!.kind).toBe('runner');
  });

  it('keeps a grid the shape its row and column counts claim', () => {
    const state = start();
    const blocks = state.pallet.layers.find((l) => l.kind === 'block')!;
    const next = run(state, { type: 'patchGrid', layerId: blocks.id, patch: { rows: 2, cols: 4 } });
    const content = next.pallet.layers.find((l) => l.id === blocks.id)!.content;
    if (content.type !== 'grid') throw new Error('expected a grid');
    expect(content.grid.cells).toHaveLength(2);
    expect(content.grid.cells.every((row) => row.length === 4)).toBe(true);
    expect(computeLayout(next.pallet).pieces.filter((p) => p.layerKind === 'block')).toHaveLength(8);
  });

  it('numbers the parts itself, so a new layer never clashes with an old one', () => {
    // Part numbers are not typed in and cannot be got wrong: they follow the
    // sizes. A layer added to a whole pallet is simply the next number along.
    const before = partNumbers(start().pallet);
    const state = run(start(), { type: 'addLayer', kind: 'runner' });
    const after = partNumbers(state.pallet);

    expect([...before.values()]).toEqual([1, 2, 3, 4]);
    expect([...after.values()]).toEqual([1, 2, 3, 4, 5]);
  });

  it('gives two boards of one size one number, and a resized board its own', () => {
    const state = start();
    const layer = state.pallet.layers[0]!;
    expect(computeLayout(state.pallet).pieces.filter((p) => p.layerId === layer.id).map((p) => p.partNo))
      .toEqual([1, 1, 1, 1, 1, 1, 1]);

    // One board made wider is a part of its own, without anything being typed.
    const widened = run(state, {
      type: 'patchSlot',
      layerId: layer.id,
      index: 3,
      patch: { width: 150 },
    });
    const numbers = computeLayout(widened.pallet)
      .pieces.filter((p) => p.layerId === layer.id)
      .map((p) => p.partNo);
    expect(numbers).toEqual([1, 1, 1, 2, 1, 1, 1]);
    // And it is a real part, not a clash to be reported.
    expect(analysePallet(widened.pallet).issues.filter((i) => i.severity === 'error')).toEqual([]);
  });
});

/**
 * Eight designs in ten have every board in a layer the same size, so the layer
 * is described once — a count and one set of numbers — rather than a row at a
 * time. What is not the same for every board is where each one sits, so a size
 * set across the layer must not disturb that.
 */
describe('setting a whole layer at once', () => {
  it('makes as many boards as the count asks for, all matching', () => {
    const state = start();
    const layer = state.pallet.layers.find((l) => l.kind === 'bearer')!;
    expect(slotsOf(state, layer.id)).toHaveLength(3);

    const next = run(state, { type: 'setSlotCount', layerId: layer.id, count: 7 });
    const slots = slotsOf(next, layer.id);
    expect(slots).toHaveLength(7);
    for (const slot of slots) {
      expect(slot).toMatchObject({ thickness: 18, width: 100, length: 800, nudgeMm: 0 });
    }
  });

  it('sets one size across every board, in a single edit', () => {
    const state = start();
    const layer = state.pallet.layers[0]!;
    const next = run(state, {
      type: 'patchAllSlots',
      layerId: layer.id,
      patch: { thickness: 22, width: 120, length: 1200 },
    });

    for (const slot of slotsOf(next, layer.id)) {
      expect(slot).toMatchObject({ thickness: 22, width: 120, length: 1200 });
    }
    // Seven boards, described once. That is the whole of the point.
    expect(slotsOf(next, layer.id)).toHaveLength(7);
  });

  it('leaves each board sitting where it was put', () => {
    const state = start();
    const layer = state.pallet.layers[0]!;
    // One board nudged off the shared spacing, and one pair butted together:
    // both are about position, and neither is a consequence of size.
    const arranged = run(
      state,
      { type: 'patchSlot', layerId: layer.id, index: 0, patch: { nudgeMm: 12 } },
      { type: 'patchSlot', layerId: layer.id, index: 3, patch: { joinedToPrev: true } },
    );
    const resized = run(arranged, {
      type: 'patchAllSlots',
      layerId: layer.id,
      patch: { width: 90 },
    });

    const slots = slotsOf(resized, layer.id);
    expect(slots.every((slot) => slot.width === 90)).toBe(true);
    expect(slots[0]!.nudgeMm).toBe(12);
    expect(slots[3]!.joinedToPrev).toBe(true);
    expect(slots[1]!.nudgeMm).toBe(0);
  });

  it('takes boards off the end when the count drops, and forgets nothing else', () => {
    const state = start();
    const layer = state.pallet.layers[0]!;
    const marked = run(state, {
      type: 'patchSlot',
      layerId: layer.id,
      index: 1,
      patch: { width: 77 },
    });
    const fewer = run(marked, { type: 'setSlotCount', layerId: layer.id, count: 3 });

    const slots = slotsOf(fewer, layer.id);
    expect(slots).toHaveLength(3);
    expect(slots[1]!.width).toBe(77);
  });

  it('drops a selection pointing at a board that no longer exists', () => {
    const state = start();
    const layer = state.pallet.layers[0]!;
    const selected = run(state, {
      type: 'select',
      selection: { layerId: layer.id, source: { kind: 'slot', index: 6 } },
    });
    expect(run(selected, { type: 'setSlotCount', layerId: layer.id, count: 2 }).selection).toBeNull();
    // A selection still within the layer is left where it is.
    expect(run(selected, { type: 'setSlotCount', layerId: layer.id, count: 7 }).selection).not.toBeNull();
  });

  it('never leaves the first board claiming to be joined to one before it', () => {
    const state = start();
    const layer = state.pallet.layers[0]!;
    const joined = run(state, {
      type: 'patchSlot',
      layerId: layer.id,
      index: 5,
      patch: { joinedToPrev: true },
    });
    const trimmed = run(joined, { type: 'setSlotCount', layerId: layer.id, count: 5 });
    // Board 6 was joined to board 5; cutting to five is not what was meant, but
    // a first board joined to nothing before it would not lay out at all.
    const shortened = run(joined, { type: 'setSlotCount', layerId: layer.id, count: 1 });
    expect(slotsOf(trimmed, layer.id)).toHaveLength(5);
    expect(slotsOf(shortened, layer.id)[0]!.joinedToPrev).toBe(false);
  });

  it('sets every block in the grid at once, the same way', () => {
    const state = start();
    const blocks = state.pallet.layers.find((l) => l.kind === 'block')!;
    const next = run(state, {
      type: 'patchAllCells',
      layerId: blocks.id,
      patch: { lengthMm: 145, widthMm: 100, heightMm: 95 },
    });

    const cells = cellsOf(next, blocks.id);
    expect(cells).toHaveLength(9);
    for (const cell of cells) {
      expect(cell).toMatchObject({ lengthMm: 145, widthMm: 100, heightMm: 95 });
    }
    expect(computeLayout(next.pallet).pieces.filter((p) => p.layerKind === 'block')).toHaveLength(9);
  });

  it('refuses a count that could only be a slip of the keyboard', () => {
    const state = start();
    const layer = state.pallet.layers[0]!;
    const blocks = state.pallet.layers.find((l) => l.kind === 'block')!;

    // A deck is a handful of boards. Building the ten thousand rows a stray
    // keypress asks for would hang the tab and help nobody.
    expect(slotsOf(run(state, { type: 'setSlotCount', layerId: layer.id, count: 10_000 }), layer.id))
      .toHaveLength(MAX_SLOTS);
    expect(slotsOf(run(state, { type: 'setSlotCount', layerId: layer.id, count: 0 }), layer.id))
      .toHaveLength(1);

    const huge = run(state, { type: 'patchGrid', layerId: blocks.id, patch: { rows: 999, cols: 999 } });
    expect(cellsOf(huge, blocks.id)).toHaveLength(MAX_GRID_SIDE * MAX_GRID_SIDE);
  });
});

/**
 * Typing a number over one that is already there. Nearly every field in the
 * editor is one of these, and the layer rows are the ones now typed into most.
 */
describe('a number field being typed into', () => {
  it('lets a number be cleared on the way to replacing it', () => {
    // Clearing 100 to type 120 used to leave a 1 behind and give 1120: the
    // field reported nothing for the empty box, so the old value came back.
    expect(numberText('', 1)).toBe('');
    expect(numberText('1', 1)).toBe('1');
    expect(numberText('12', 12)).toBe('12');
    expect(numberText('120', 120)).toBe('120');
  });

  it('keeps a minus sign that has nothing after it yet, for a nudge', () => {
    expect(numberText('-', 5)).toBe('-');
    expect(numberText('-1', -1)).toBe('-1');
  });

  it('shows the value it is given when nothing is being typed', () => {
    expect(numberText(null, 250)).toBe('250');
    expect(numberText(null, 0)).toBe('0');
  });

  it('gives way when the value is changed by something other than typing', () => {
    // A layer row setting every board at once: the board's own field was left
    // mid-edit, and what the layer just said is what is true.
    expect(numberText('7', 120)).toBe('120');
  });

  it('shows nothing at all where components disagree, leaving "mixed"', () => {
    expect(numberText(null, Number.NaN)).toBe('');
    expect(numberText('', Number.NaN)).toBe('');
  });
});

describe('selection and nudging', () => {
  it('takes a click on the drawing back to the slot that produced it', () => {
    const pallet = newPallet(CLIENT);
    const layout = computeLayout(pallet);
    const svg = renderView(layout, 'top', { interactive: true });

    // What the preview's click handler does with the attribute it finds.
    const tagged = [...svg.matchAll(/data-piece="(\d+)"/g)].map((m) => Number(m[1]));
    expect(tagged.length).toBe(layout.pieces.length);

    // Pieces are drawn back to front, so document order is not piece order.
    // The attribute carries the index, which is the point of it.
    const board = tagged.find((index) => layout.pieces[index]!.source.kind === 'slot')!;
    const piece = layout.pieces[board]!;
    const state = run(start(pallet), {
      type: 'select',
      selection: { layerId: piece.layerId, source: piece.source },
    });
    const found = selectedSlot(state.pallet, state.selection);
    expect(found).not.toBeNull();
    expect(sameSource(piece.source, { kind: 'slot', index: found!.index })).toBe(true);
  });

  it('saves a nudge as a number on the component, and nothing else', () => {
    const state = start();
    const selected = run(state, firstTopSlot(state));
    const nudged = run(selected, { type: 'nudge', delta: 5 }, { type: 'nudge', delta: 20 });

    const layer = nudged.pallet.layers[0]!;
    if (layer.content.type !== 'sequence') throw new Error('expected boards');
    expect(layer.content.slots[0]!.nudgeMm).toBe(25);
    // The board moves because the document moved it, not the other way round.
    expect(computeLayout(nudged.pallet).pieces[0]!.y).toBe(25);
    expect(computeLayout(nudged.pallet).pieces[0]!.nudged).toBe(true);
  });

  it('types a nudge straight in, and clears it again', () => {
    const state = start();
    const selected = run(state, firstTopSlot(state));
    const typed = run(selected, { type: 'setNudge', value: -12 });
    const content = typed.pallet.layers[0]!.content;
    if (content.type !== 'sequence') throw new Error('expected boards');
    expect(content.slots[0]!.nudgeMm).toBe(-12);
    expect(content.slots[1]!.nudgeMm).toBe(0);

    const cleared = run(selected, { type: 'setNudge', value: -12 }, { type: 'setNudge', value: 0 });
    expect(computeLayout(cleared.pallet).pieces[0]!.nudged).toBe(false);
  });

  it('marks the selected board in the drawing without changing it', () => {
    const pallet = newPallet(CLIENT);
    const layout = computeLayout(pallet);
    const plain = renderView(layout, 'top', { interactive: true });
    const withSelection = renderView(layout, 'top', { interactive: true, selectedPiece: 2 });
    expect(plain).not.toContain('stroke-dasharray');
    expect(withSelection).toContain('stroke-dasharray');
    // The selection is drawn over the top; the pieces themselves are untouched.
    expect([...plain.matchAll(/<rect/g)].length + 1).toBe(
      [...withSelection.matchAll(/<rect/g)].length,
    );
  });

  it('drops the selection when the thing selected goes away', () => {
    const state = start();
    const selected = run(state, firstTopSlot(state));
    expect(selected.selection).not.toBeNull();
    const removed = run(selected, {
      type: 'removeSlot',
      layerId: selected.pallet.layers[0]!.id,
      index: 0,
    });
    expect(removed.selection).toBeNull();
  });
});

/**
 * Nails are placed by clicking a crossing in the top or bottom view. A click is
 * an edit to the document like any other: it writes a count against the two
 * boards that cross, and the drawing is regenerated from that.
 */
describe('placing nails by clicking a crossing', () => {
  /** A click on the crossing at `index`, given the drawing as it stands now. */
  function click(state: EditorState, index = 0): EditorState {
    const crossing = computeLayout(state.pallet).nailCrossings[index]!;
    return reducer(state, { type: 'cycleNailCrossing', crossing });
  }

  function countAt(state: EditorState, index = 0): number {
    return computeLayout(state.pallet).nailCrossings[index]!.count;
  }

  it('starts with every crossing on the default and nothing stored', () => {
    const state = start();
    expect(state.pallet.nailPlacements).toEqual([]);
    const crossings = computeLayout(state.pallet).nailCrossings;
    expect(crossings.every((crossing) => !crossing.manual)).toBe(true);
    expect(new Set(crossings.map((crossing) => crossing.count))).toEqual(new Set([2, 3]));
  });

  it('steps a crossing on by one, and round to zero past four', () => {
    // This crossing is a corner of the top face, so it starts at three.
    let state = start();
    expect(countAt(state)).toBe(3);
    state = click(state);
    expect(countAt(state)).toBe(4);
    state = click(state);
    expect(countAt(state)).toBe(0);
    state = click(state);
    expect(countAt(state)).toBe(1);
  });

  /**
   * Only what was changed is written down. A crossing clicked right round to
   * where it started leaves no trace, so it goes on following the default if
   * the pallet is rearranged later.
   */
  it('stores only the crossings that differ from the default', () => {
    let state = start();
    state = click(state);
    expect(state.pallet.nailPlacements).toHaveLength(1);
    expect(state.pallet.nailPlacements[0]).toMatchObject({ count: 4 });

    // Round through 0, 1, 2 and back to the 3 it started on.
    for (let i = 0; i < 4; i++) state = click(state);
    expect(countAt(state)).toBe(3);
    expect(state.pallet.nailPlacements).toEqual([]);
  });

  it('touches one crossing and leaves every other one alone', () => {
    const before = computeLayout(start().pallet).nailCrossings.map((c) => c.count);
    const after = computeLayout(click(start()).pallet).nailCrossings.map((c) => c.count);
    expect(after.slice(1)).toEqual(before.slice(1));
    expect(after[0]).not.toBe(before[0]);
  });

  it('puts the whole pallet back to the default when the placements are cleared', () => {
    let state = start();
    state = click(state, 0);
    state = click(state, 5);
    expect(state.pallet.nailPlacements).toHaveLength(2);

    const reset = reducer(state, { type: 'clearNailPlacements' });
    expect(reset.pallet.nailPlacements).toEqual([]);
    expect(computeLayout(reset.pallet).nailCrossings.every((c) => !c.manual)).toBe(true);
  });

  it('writes a document the schema will take back', () => {
    const state = click(click(start()));
    expect(() => PalletSchema.parse(state.pallet)).not.toThrow();
  });
});

describe('a design being worked on', () => {
  it('still lays out and still reports what is wrong with it', () => {
    const state = start();
    const layer = state.pallet.layers[0]!;
    // Boards far too wide for the deck: the layer is over-full.
    const broken = run(
      state,
      ...[0, 1, 2, 3, 4, 5, 6].map(
        (index): Action => ({ type: 'patchSlot', layerId: layer.id, index, patch: { width: 300 } }),
      ),
    );
    const layout = analysePallet(broken.pallet);
    expect(layout.pieces.length).toBeGreaterThan(0);
    const errors = layout.issues.filter((issue) => issue.severity === 'error');
    expect(errors.map((issue) => issue.code)).toContain('over_full');
    expect(errors[0]!.message).toContain('top deck layer at position 1');
  });
});
