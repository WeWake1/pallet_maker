import { useRef, useState } from 'react';
import { BUILT_IN_CHOICES, isOwnWords, MAX_CHOICE_LENGTH, settleWords } from '../choices.js';
import type { ChoiceField } from '../choices.js';
import { NOT_APPLICABLE, notApplicable } from '../types.js';
import { Icon, inputBase } from './ui.jsx';

/**
 * The two answers every list carries besides its own, and what each does to
 * the printed sheet: blank prints a dash, n/a takes the row off. Both are on
 * every list so that a list answers the same way a typed field does.
 */
const BLANK = '— not stated';
const NOT_ON_SHEET = 'n/a — remove from the sheet';

/**
 * What the entries that are not answers stand for. A private-use character
 * starts each, so none can ever be taken for words somebody typed.
 */
const TYPE_OWN = 'own';
const KEEP = 'keep';
const FORGET = 'forget';

/**
 * A list to pick from, or words of the design's own where nothing on it fits.
 *
 * Custom… turns the list into a box to type in. The words are the answer for
 * this design only, unless they are put on the list — from the box while they
 * are being typed, or from the foot of the list afterwards — and then they are
 * offered to everybody in the company from then on. Neither is on the face of
 * the form: the list is what is seen, and the rest is there when it is wanted.
 */
export function ChoiceSelect({
  field,
  value,
  saved,
  onChange,
  onKeep,
  onForget,
  className = 'w-full max-w-72',
}: {
  field: ChoiceField;
  value: string;
  /** What the company has added to this list. */
  saved: readonly string[];
  onChange: (value: string) => void;
  /** Put these words on the company's list. */
  onKeep: (words: string) => void;
  /** Take them off it. Designs that use them keep them. */
  onForget: (words: string) => void;
  className?: string;
}) {
  /** What is in the box while words are being typed; null while picking. */
  const [typed, setTyped] = useState<string | null>(null);
  /**
   * Whether the box is still open. Kept apart from the state above because
   * the box can lose the focus as it goes, and that late blur must not finish
   * it a second time — or, after Escape, finish it at all.
   */
  const open = useRef(false);

  const own = isOwnWords(field, value);
  const listed = own && saved.includes(value);

  const close = (): void => {
    open.current = false;
    setTyped(null);
  };

  /** The typed words become the answer, and go on the list too if asked. */
  const finish = (keep: boolean): void => {
    if (!open.current || typed === null) return;
    close();
    // Nothing typed is not an answer: it leaves the one there was.
    if (typed.trim() === '') return;
    const settled = settleWords(field, typed, saved);
    if (settled !== value) onChange(settled);
    if (keep && isOwnWords(field, settled) && !saved.includes(settled)) onKeep(settled);
  };

  if (typed !== null) {
    return (
      <span className={`relative flex ${className}`}>
        <input
          autoFocus
          className={`${inputBase} w-full ${typed.trim() === '' ? '' : 'pr-9'}`}
          value={typed}
          maxLength={MAX_CHOICE_LENGTH}
          placeholder="Type your own"
          onChange={(event) => setTyped(event.target.value)}
          onBlur={() => finish(false)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              finish(false);
            } else if (event.key === 'Escape') {
              // Stops the editor's own Escape, which would blur the box and
              // so keep what was typed.
              event.preventDefault();
              close();
            }
          }}
        />
        {typed.trim() !== '' && (
          <button
            type="button"
            title="Add to the list"
            aria-label="Add to the list"
            // Before the box loses the focus, which would finish it without
            // keeping anything.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => finish(true)}
            className="absolute inset-y-0 right-1.5 my-auto flex h-6 w-6 items-center justify-center rounded
                       text-ink-faint opacity-70 transition hover:bg-ground hover:text-ink hover:opacity-100"
          >
            <Icon name="listPlus" size={15} />
          </button>
        )}
      </span>
    );
  }

  return (
    <select
      className={`${inputBase} ${className}`}
      value={notApplicable(value) ? NOT_APPLICABLE : value}
      onChange={(event) => {
        const picked = event.target.value;
        if (picked === TYPE_OWN) {
          open.current = true;
          setTyped(own ? value : '');
        } else if (picked === KEEP) onKeep(value);
        else if (picked === FORGET) onForget(value);
        else onChange(picked);
      }}
    >
      <option value="">{BLANK}</option>
      {BUILT_IN_CHOICES[field].map(([code, label]) => (
        <option key={code} value={code}>
          {label}
        </option>
      ))}
      {saved.map((words) => (
        <option key={`saved-${words}`} value={words}>
          {words}
        </option>
      ))}
      {own && !listed && <option value={value}>{value}</option>}
      <option value={TYPE_OWN}>Custom…</option>
      <option value={NOT_APPLICABLE}>{NOT_ON_SHEET}</option>
      {own && !listed && <option value={KEEP}>{`Add “${value}” to the list`}</option>}
      {listed && <option value={FORGET}>{`Remove “${value}” from the list`}</option>}
    </select>
  );
}
