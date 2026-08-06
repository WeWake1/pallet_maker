import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canRedo,
  canUndo,
  COALESCE_MS,
  HISTORY_LIMIT,
  historyReducer,
  initialHistory,
} from '../src/editor/history.js';
import type { History, HistoryAction } from '../src/editor/history.js';
import { matches, shortcutLabel } from '../src/editor/shortcuts.js';
import { newPallet } from '../src/editor/templates.js';
import type { Slot } from '../src/types.js';

/**
 * Undo is the safety net under every other editing rule: a board deleted with
 * one keystroke has to be one keystroke away from coming back. What is tested
 * here is what counts as a step — not every dispatch is one, and a number typed
 * digit by digit is emphatically not four.
 */

const CLIENT = { id: 'client-test', name: 'Demo Client' };

function start(): History {
  return initialHistory({ pallet: newPallet(CLIENT), selection: null });
}

function run(history: History, ...actions: HistoryAction[]): History {
  return actions.reduce(historyReducer, history);
}

function topLayer(history: History): string {
  return history.present.pallet.layers.find((layer) => layer.kind === 'top_deck')!.id;
}

function slotsOf(history: History, layerId: string): Slot[] {
  const content = history.present.pallet.layers.find((layer) => layer.id === layerId)!.content;
  if (content.type !== 'sequence') throw new Error('expected boards');
  return content.slots;
}

beforeEach(() => {
  // The window that folds a run of edits into one step is measured in real
  // time, so the clock has to be one the test can move.
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('undo', () => {
  it('puts back the document as it was, and redo puts it forward again', () => {
    const history = start();
    const layer = topLayer(history);
    const edited = run(history, { type: 'patchSlot', layerId: layer, index: 0, patch: { width: 90 } });
    expect(slotsOf(edited, layer)[0]!.width).toBe(90);

    const undone = run(edited, { type: 'undo' });
    expect(slotsOf(undone, layer)[0]!.width).toBe(slotsOf(history, layer)[0]!.width);
    expect(canRedo(undone)).toBe(true);

    const redone = run(undone, { type: 'redo' });
    expect(slotsOf(redone, layer)[0]!.width).toBe(90);
  });

  it('brings back a board that was deleted', () => {
    const history = start();
    const layer = topLayer(history);
    const before = slotsOf(history, layer).length;
    const removed = run(history, { type: 'removeSlot', layerId: layer, index: 0 });
    expect(slotsOf(removed, layer)).toHaveLength(before - 1);
    expect(slotsOf(run(removed, { type: 'undo' }), layer)).toHaveLength(before);
  });

  it('does nothing at the beginning, and redo nothing at the end', () => {
    const history = start();
    expect(canUndo(history)).toBe(false);
    expect(run(history, { type: 'undo' })).toBe(history);
    expect(run(history, { type: 'redo' })).toBe(history);
  });

  it('is not a step for selecting a board, which never changed anything', () => {
    const history = start();
    const layer = topLayer(history);
    const selected = run(history, {
      type: 'select',
      selection: { layerId: layer, source: { kind: 'slot', index: 0 } },
    });
    expect(selected.present.selection).not.toBeNull();
    expect(canUndo(selected)).toBe(false);
  });

  it('is not a step for an edit that landed on nothing', () => {
    const history = start();
    // No such layer, so the document comes back unchanged.
    const missed = run(history, { type: 'patchLayer', layerId: 'nope', patch: { offsetMm: 5 } });
    expect(canUndo(missed)).toBe(false);
  });

  it('gives back the selection that was live at the time', () => {
    const history = start();
    const layer = topLayer(history);
    const selected = run(history, {
      type: 'select',
      selection: { layerId: layer, source: { kind: 'slot', index: 1 } },
    });
    const nudged = run(selected, { type: 'nudge', delta: 5 });
    const undone = run(nudged, { type: 'undo' });
    expect(undone.present.selection).toEqual(selected.present.selection);
  });
});

describe('one continuous change', () => {
  it('is one step, however many keystrokes typed it', () => {
    const history = start();
    // 1, then 12, then 120: a width typed digit by digit.
    const typed = run(
      history,
      { type: 'patchPallet', patch: { overallLength: 1 } },
      { type: 'patchPallet', patch: { overallLength: 12 } },
      { type: 'patchPallet', patch: { overallLength: 120 } },
    );
    expect(typed.present.pallet.overallLength).toBe(120);
    expect(typed.past).toHaveLength(1);

    const undone = run(typed, { type: 'undo' });
    expect(undone.present.pallet.overallLength).toBe(history.present.pallet.overallLength);
  });

  it('closes after a pause, so a second thought is its own step', () => {
    const history = start();
    const first = run(history, { type: 'patchPallet', patch: { overallLength: 1100 } });
    vi.advanceTimersByTime(COALESCE_MS + 1);
    const second = run(first, { type: 'patchPallet', patch: { overallLength: 1200 } });
    expect(second.past).toHaveLength(2);
    expect(run(second, { type: 'undo' }).present.pallet.overallLength).toBe(1100);
  });

  it('closes when the typing moves to another field', () => {
    const history = start();
    const both = run(
      history,
      { type: 'patchPallet', patch: { overallLength: 1100 } },
      { type: 'patchPallet', patch: { overallWidth: 900 } },
    );
    expect(both.past).toHaveLength(2);
    const undone = run(both, { type: 'undo' });
    expect(undone.present.pallet.overallWidth).toBe(history.present.pallet.overallWidth);
    expect(undone.present.pallet.overallLength).toBe(1100);
  });

  it('never folds two structural changes together', () => {
    const history = start();
    const layer = topLayer(history);
    const added = run(history, { type: 'addSlot', layerId: layer }, { type: 'addSlot', layerId: layer });
    expect(added.past).toHaveLength(2);
  });
});

describe('the redo branch', () => {
  it('is thrown away by an edit made after undoing', () => {
    const history = start();
    const layer = topLayer(history);
    const undone = run(
      history,
      { type: 'patchSlot', layerId: layer, index: 0, patch: { width: 90 } },
      { type: 'undo' },
    );
    expect(canRedo(undone)).toBe(true);
    const diverged = run(undone, { type: 'addSlot', layerId: layer });
    expect(canRedo(diverged)).toBe(false);
  });
});

describe('the history itself', () => {
  it('stops growing, keeping the most recent steps', () => {
    const history = start();
    let state = history;
    for (let index = 0; index < HISTORY_LIMIT + 20; index += 1) {
      state = run(state, { type: 'patchPallet', patch: { overallLength: 1000 + index } });
      vi.advanceTimersByTime(COALESCE_MS + 1);
    }
    expect(state.past).toHaveLength(HISTORY_LIMIT);
    // The oldest kept step is the one HISTORY_LIMIT changes back, not the
    // document the session opened with.
    expect(state.past[0]!.pallet.overallLength).toBe(1000 + 19);
  });

  it('starts again from a design that came back from the store', () => {
    const history = start();
    const edited = run(history, { type: 'patchPallet', patch: { overallLength: 1400 } });
    expect(canUndo(edited)).toBe(true);
    const saved = run(edited, {
      type: 'replace',
      pallet: edited.present.pallet,
      reset: true,
    });
    expect(canUndo(saved)).toBe(false);
    expect(canRedo(saved)).toBe(false);
  });

  it('keeps an imported document undoable, since importing is an edit', () => {
    const history = start();
    const imported = run(history, { type: 'replace', pallet: newPallet(CLIENT) });
    expect(canUndo(imported)).toBe(true);
  });
});

/** The four members `matches` reads, which is all a keystroke is to it. */
function press(key: string, held: Partial<Record<'mod' | 'shift' | 'alt', boolean>> = {}) {
  return {
    key,
    metaKey: held.mod ?? false,
    ctrlKey: false,
    shiftKey: held.shift ?? false,
    altKey: held.alt ?? false,
  } as KeyboardEvent;
}

describe('a keyboard shortcut', () => {
  it('matches the combination it names', () => {
    expect(matches(press('z', { mod: true }), 'mod+z')).toBe(true);
    expect(matches(press('Z', { mod: true, shift: true }), 'mod+shift+z')).toBe(true);
    expect(matches(press('Escape'), 'escape')).toBe(true);
    expect(matches(press('ArrowLeft', { shift: true }), 'shift+arrowleft')).toBe(true);
  });

  it('matches Control as well as Command, whichever the keyboard has', () => {
    const control = { ...press('z'), ctrlKey: true } as KeyboardEvent;
    expect(matches(control, 'mod+z')).toBe(true);
  });

  it('does not fire Undo when Redo was asked for', () => {
    expect(matches(press('z', { mod: true, shift: true }), 'mod+z')).toBe(false);
    expect(matches(press('z', { mod: true }), 'mod+shift+z')).toBe(false);
  });

  it('leaves a bare key to whatever is being typed', () => {
    expect(matches(press('z'), 'mod+z')).toBe(false);
    expect(matches(press('s', { alt: true }), 'mod+s')).toBe(false);
  });

  it('writes itself out the way the platform writes it', () => {
    const label = shortcutLabel('mod+shift+z');
    expect(label === '⌘⇧Z' || label === 'Ctrl+Shift+Z').toBe(true);
  });
});
