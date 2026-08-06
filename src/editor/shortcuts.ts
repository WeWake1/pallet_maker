import { useEffect, useRef } from 'react';

/**
 * Keyboard shortcuts for the editor.
 *
 * One listener on the window, given the whole list, rather than a handler on
 * every control that would like one. What is pressed is matched against a
 * written-out combination — "mod+shift+z" — so the list reads as the help text
 * it also serves as.
 */

export interface Shortcut {
  /**
   * The combination, lower case, joined with `+`: `mod`, `shift`, `alt`, then
   * the key itself. `mod` is Command or Control, whichever the keyboard has.
   */
  keys: string;
  run: () => void;
  /**
   * Fire while a field has the focus. Off by default: a bare `Delete` belongs
   * to whatever is being typed, not to the selected board. The combinations
   * with `mod` are the exception — Save and Undo mean the same thing wherever
   * the cursor happens to be.
   */
  whileTyping?: boolean;
  /** Skip the shortcut without taking it out of the list. */
  disabled?: boolean;
}

/** Whether the keystroke belongs to something being typed into. */
function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * Whether the event is this combination, and only this combination.
 *
 * The modifiers are matched exactly, so a shortcut on `mod+z` does not also
 * fire for `mod+shift+z`, which is Redo and would otherwise do both.
 */
export function matches(event: KeyboardEvent, keys: string): boolean {
  const parts = keys.toLowerCase().split('+');
  const key = parts.at(-1) ?? '';
  const wanted = new Set(parts.slice(0, -1));

  // Command on a Mac, Control everywhere else — and either one accepted on
  // both, because a keyboard carried between the two types what it always did.
  const mod = event.metaKey || event.ctrlKey;
  if (wanted.has('mod') !== mod) return false;
  if (wanted.has('shift') !== event.shiftKey) return false;
  if (wanted.has('alt') !== event.altKey) return false;

  return event.key.toLowerCase() === key;
}

export function useShortcuts(shortcuts: Shortcut[]): void {
  // The list is rebuilt every render and closes over the current state; the
  // listener is registered once and reads whatever the latest list is.
  const latest = useRef(shortcuts);
  latest.current = shortcuts;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const inField = typing(event.target);
      for (const shortcut of latest.current) {
        if (shortcut.disabled) continue;
        if (inField && !shortcut.whileTyping) continue;
        if (!matches(event, shortcut.keys)) continue;
        // Held down, these repeat, which is what an arrow key should do and
        // what Undo should do. The browser's own meaning for the combination —
        // saving the page, stepping a number field — is not wanted either way.
        event.preventDefault();
        shortcut.run();
        return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

/** Written the way the platform writes it, for a button's tooltip. */
export function shortcutLabel(keys: string): string {
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);
  return keys
    .split('+')
    .map((part) => {
      if (part === 'mod') return mac ? '⌘' : 'Ctrl';
      if (part === 'shift') return mac ? '⇧' : 'Shift';
      if (part === 'alt') return mac ? '⌥' : 'Alt';
      return part.length === 1 ? part.toUpperCase() : part[0]!.toUpperCase() + part.slice(1);
    })
    .join(mac ? '' : '+');
}
