import { describe, expect, it } from 'vitest';
import { analysePallet, computeLayout } from '../src/geometry/layout.js';
import { renderView } from '../src/render/views.js';
import { PalletSchema } from '../src/schema.js';
import { reducer, sameSource, selectedSlot } from '../src/editor/state.js';
import type { Action, EditorState } from '../src/editor/state.js';
import { duplicatePallet } from '../src/revisions.js';
import { newPallet, nextPartNo } from '../src/editor/templates.js';
import type { Pallet } from '../src/types.js';

function start(pallet: Pallet = newPallet()): EditorState {
  return { pallet, selection: null };
}

function run(state: EditorState, ...actions: Action[]): EditorState {
  return actions.reduce(reducer, state);
}

/** The first top board, which is what a click on the preview usually lands on. */
function firstTopSlot(state: EditorState): Action {
  const layer = state.pallet.layers.find((l) => l.kind === 'top_deck')!;
  return { type: 'select', selection: { layerId: layer.id, source: { kind: 'slot', index: 0 } } };
}

describe('a new pallet', () => {
  const pallet = newPallet();

  it('is a whole plain block pallet, not an empty stack', () => {
    const layout = computeLayout(pallet);
    expect(layout.pieces).toHaveLength(7 + 3 + 9 + 3);
    expect(layout.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('is short only of the things the person has to supply', () => {
    // A design being worked on is allowed to be incomplete. Naming it completes it.
    const parsed = PalletSchema.safeParse(pallet);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.map((issue) => issue.path.join('.'))).toEqual([
        'palletCode',
        'clientName',
      ]);
    }
    expect(
      PalletSchema.safeParse({ ...pallet, palletCode: 'AP-010', clientName: 'A client' }).success,
    ).toBe(true);
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
    const original = newPallet();
    original.clientName = 'First client';
    const copy = duplicatePallet(original);

    expect(copy.id).not.toBe(original.id);
    expect(copy.layers.map((l) => l.id)).not.toEqual(original.layers.map((l) => l.id));

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

  it('starts again at revision A and supersedes nothing', () => {
    const original = newPallet();
    original.revision = 'C';
    original.frozen = true;
    original.supersedes = 'something-else';
    const copy = duplicatePallet(original);
    expect(copy.revision).toBe('A');
    expect(copy.frozen).toBe(false);
    expect(copy.supersedes).toBeUndefined();
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
    expect(slots.slots[7]).toMatchObject({ width: 100, length: 1000, nudgeMm: 0 });
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

  it('never hands out a part number that is already in use', () => {
    const state = run(start(), { type: 'addLayer', kind: 'runner' });
    const numbers = state.pallet.layers.flatMap((layer) =>
      layer.content.type === 'sequence'
        ? layer.content.slots.map((s) => s.partNo)
        : layer.content.type === 'grid'
          ? layer.content.grid.cells.flat().map((c) => c.partNo)
          : [layer.content.sheet.partNo],
    );
    expect(nextPartNo(state.pallet)).toBeGreaterThan(Math.max(...numbers));
  });
});

describe('selection and nudging', () => {
  it('takes a click on the drawing back to the slot that produced it', () => {
    const pallet = newPallet();
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
    const pallet = newPallet();
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
