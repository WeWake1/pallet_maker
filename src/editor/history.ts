import { reducer } from './state.js';
import type { Action, EditorState } from './state.js';

/**
 * Undo and redo, wrapped around the editor's reducer.
 *
 * The document is the whole of the state, so a step backwards is just an older
 * document put back. Nothing is derived and kept in step by hand — the drawing,
 * the costing and the problem list all come from the document — so there is no
 * second thing to unwind.
 */

export type HistoryAction = Action | { type: 'undo' } | { type: 'redo' };

export interface History {
  past: EditorState[];
  present: EditorState;
  future: EditorState[];
  /**
   * The last edit recorded, so that one continuous change — digits typed into
   * a field, an arrow key held down — folds into a single step. Cleared by
   * anything that is not itself an edit.
   */
  recent: { key: string; at: number } | null;
}

/**
 * How many steps back the editor will go. A pallet document is small, but a
 * long session should not grow a list without end.
 */
export const HISTORY_LIMIT = 100;

/**
 * How long one continuous change stays open.
 *
 * Typing 1200 into a length field dispatches four times, and four presses of
 * Undo to take back one number is not what anybody means by undo. Edits to the
 * same field within this gap of each other are one step; a pause, or a move to
 * anything else, starts a new one.
 */
export const COALESCE_MS = 600;

/**
 * What is being changed, for the purpose of folding a run of changes together.
 *
 * Two actions merge only when this is the same for both, so it has to name the
 * exact field of the exact component. Anything structural — a layer added, a
 * board removed — returns null and always stands as its own step.
 */
function editKey(action: Action): string | null {
  const fields = (patch: object) => Object.keys(patch).sort().join(',');
  switch (action.type) {
    case 'patchPallet':
      return `pallet:${fields(action.patch)}`;
    case 'patchLayer':
      return `layer:${action.layerId}:${fields(action.patch)}`;
    case 'patchSlot':
      return `slot:${action.layerId}:${action.index}:${fields(action.patch)}`;
    case 'patchAllSlots':
      return `slots:${action.layerId}:${fields(action.patch)}`;
    case 'setSlotCount':
      return `count:${action.layerId}`;
    case 'patchGrid':
      return `grid:${action.layerId}:${fields(action.patch)}`;
    case 'patchCell':
      return `cell:${action.layerId}:${action.row}:${action.col}:${fields(action.patch)}`;
    case 'patchAllCells':
      return `cells:${action.layerId}:${fields(action.patch)}`;
    case 'patchSheet':
      return `sheet:${action.layerId}:${fields(action.patch)}`;
    case 'patchNail':
      return `nail:${action.index}:${fields(action.patch)}`;
    case 'nudge':
    case 'setNudge':
      return 'nudge';
    default:
      return null;
  }
}

/** A document, as text, for asking whether an action actually changed it. */
function same(a: EditorState, b: EditorState): boolean {
  // The reducer clones before it edits, so the documents are never the same
  // object; a selection change is the one case that keeps it, and is the case
  // worth catching without stringifying anything.
  return a.pallet === b.pallet || JSON.stringify(a.pallet) === JSON.stringify(b.pallet);
}

export function initialHistory(present: EditorState): History {
  return { past: [], present, future: [], recent: null };
}

export function canUndo(history: History): boolean {
  return history.past.length > 0;
}

export function canRedo(history: History): boolean {
  return history.future.length > 0;
}

export function historyReducer(history: History, action: HistoryAction): History {
  if (action.type === 'undo') {
    const previous = history.past.at(-1);
    if (!previous) return history;
    return {
      past: history.past.slice(0, -1),
      present: previous,
      future: [history.present, ...history.future],
      recent: null,
    };
  }

  if (action.type === 'redo') {
    const [next, ...rest] = history.future;
    if (!next) return history;
    return {
      past: [...history.past, history.present],
      present: next,
      future: rest,
      recent: null,
    };
  }

  const present = reducer(history.present, action);

  // The design as the store now holds it. There is nothing before it worth
  // going back to — the steps that led here have all been saved.
  if (action.type === 'replace' && action.reset) return initialHistory(present);

  // Selecting a board, or an edit that landed on nothing, leaves the document
  // as it was. Neither is a step, and recording either would mean pressing Undo
  // and watching nothing happen.
  if (same(history.present, present)) {
    return present === history.present ? history : { ...history, present };
  }

  const key = editKey(action);
  const now = Date.now();
  const continuing =
    key !== null && history.recent?.key === key && now - history.recent.at < COALESCE_MS;

  // A change of any kind is a new branch: whatever was undone is no longer
  // ahead of us, and cannot be got back to from here.
  return {
    // Continuing an edit keeps the document from before it began, which is
    // already the top of the list, rather than adding the half-typed one.
    past: continuing ? history.past : [...history.past, history.present].slice(-HISTORY_LIMIT),
    present,
    future: [],
    recent: key === null ? null : { key, at: now },
  };
}
