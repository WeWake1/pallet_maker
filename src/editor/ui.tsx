import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { NOT_APPLICABLE } from '../types.js';
import type { LoadKg } from '../types.js';

/** Small form controls. Tailwind styles the editor chrome only. */

/**
 * A field, less its width. A field is as wide as what goes in it: four digits
 * of millimetres want a box four digits wide, and a box the width of the
 * column says "type a sentence here" to someone about to type 1200.
 */
export const inputBase =
  'rounded-md border border-line bg-card px-2 py-1.5 text-ui text-ink ' +
  'transition-colors placeholder:text-slate-400 hover:border-slate-400 ' +
  'focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-ring/30 ' +
  'disabled:bg-ground disabled:text-ink-faint disabled:hover:border-line';

export const inputClass = `w-full ${inputBase}`;

/**
 * Something that closes when the attention moves off it.
 *
 * A bubble opened by a click has two ways of being finished with: clicking
 * somewhere else, and pressing Escape. Both have to work, or the thing stays on
 * screen and has to be hunted down and clicked again.
 *
 * `also` is for a bubble that is not inside the thing that opened it — one
 * rendered through a portal, as Menu's is. Without it a click on the bubble
 * itself counts as a click somewhere else: the mousedown closes it, and the
 * button the click was aimed at is gone before the click lands on it.
 */
export function useDismiss(
  open: boolean,
  close: () => void,
  ...also: Array<RefObject<HTMLElement | null>>
) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const inside = (node: Node): boolean =>
      box.current?.contains(node) === true || also.some((ref) => ref.current?.contains(node));
    const onDown = (event: MouseEvent) => {
      if (!inside(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };

    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  return box;
}

/**
 * One sentence saying what a word means, next to the word.
 *
 * The editor is full of terms from the trade — span, slack, nudge — that mean
 * something exact to whoever has built pallets and nothing at all to whoever
 * has not. Explaining them in a manual means being stuck at the moment of
 * needing to know; explaining them here does not. The wording lives in
 * hints.ts, so the same sentence appears here and in the help panel.
 */
export function Hint({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const box = useDismiss(open, () => setOpen(false));

  return (
    <span className="relative inline-flex" ref={box}>
      <button
        type="button"
        // Hover says it too, for whoever is already reaching with the mouse.
        title={text}
        aria-label={`What this means: ${text}`}
        aria-expanded={open}
        onClick={(event) => {
          // The caption is a <label>, so a click here would otherwise land in
          // the field and lose the bubble to the same click that opened it.
          event.preventDefault();
          setOpen((current) => !current);
        }}
        className={
          'flex h-3.5 w-3.5 items-center justify-center rounded-full border text-[9px] ' +
          'font-semibold leading-none transition-colors ' +
          (open
            ? 'border-accent bg-accent text-white'
            : 'border-slate-300 text-ink-faint hover:border-slate-400 hover:text-ink-soft')
        }
      >
        i
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute left-0 top-5 z-30 w-56 rounded-md border border-line bg-card p-2
                     text-micro font-normal normal-case tracking-normal text-ink-soft shadow-raised"
        >
          {text}
        </span>
      )}
    </span>
  );
}

export function Field({
  label,
  hint,
  id,
  children,
}: {
  label: string;
  /** One plain sentence on what the word means. See hints.ts. */
  hint?: string;
  /** What the problem list scrolls to when it names this field. */
  id?: string;
  children: ReactNode;
}) {
  return (
    <label className="block" id={id}>
      <span className="mb-1 flex items-center gap-1 text-label font-medium text-ink-soft">
        {label}
        {hint && <Hint text={hint} />}
      </span>
      {children}
    </label>
  );
}

/**
 * A field with its name beside it rather than over it.
 *
 * The name sits in a column of its own, so a stack of these reads down the
 * left like the attribute list printed on the sheet, and the field next to it
 * is only as wide as its answer.
 */
export function Prop({
  label,
  hint,
  id,
  group = false,
  children,
}: {
  label: string;
  hint?: string;
  id?: string;
  /**
   * More than one field beside the one name. Each is then labelled on its
   * own, and the row is not a label — a click on the name would otherwise
   * always land in the first of them.
   */
  group?: boolean;
  children: ReactNode;
}) {
  const Row = group ? 'div' : 'label';
  return (
    <Row className="flex min-h-8 items-center gap-3" id={id}>
      <span className="flex w-28 shrink-0 items-center gap-1 text-label text-ink-soft">
        {label}
        {hint && <Hint text={hint} />}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-2">{children}</span>
    </Row>
  );
}

/**
 * A field with what is typed into it said after it — mm, kg — inside the
 * same box, so the unit is read with the number rather than looked for in a
 * heading somewhere above.
 */
export function Unit({ unit, children }: { unit: string; children: ReactNode }) {
  return (
    <span className="relative inline-flex">
      {children}
      <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-label text-ink-faint">
        {unit}
      </span>
    </span>
  );
}

/**
 * One part of the form: a heading, and what is under it.
 *
 * The form is one sheet with a rule between its parts, not a stack of cards —
 * a card each is a box around every thought, and a screen of boxes is read as
 * boxes before it is read as a pallet.
 */
export function Section({
  title,
  note,
  actions,
  id,
  children,
}: {
  title: string;
  note?: ReactNode;
  actions?: ReactNode;
  id?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="border-t border-line-soft px-6 py-4">
      <header className="mb-3 flex min-h-7 items-center gap-2">
        <h2 className="text-ui font-semibold text-ink">{title}</h2>
        {note && <span className="text-label text-ink-faint">{note}</span>}
        {actions && <div className="ml-auto flex items-center gap-1.5">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  disabled,
  className = 'w-full',
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** The width, and anything else the field needs that the others do not. */
  className?: string;
  /** Said aloud where the field has no caption of its own, as in a table. */
  label?: string;
}) {
  return (
    <input
      className={`${inputBase} ${className}`}
      type="text"
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={label}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/**
 * What a number field shows: what is being typed, while it is still being
 * typed, and otherwise the value it has been given.
 *
 * Text on its way to being a number, and text that already reads as the value,
 * both belong to whoever is typing. Anything else means the value moved on its
 * own — a layer row set every board at once, say — and what it says now is what
 * is true, so the typing is dropped in favour of it.
 *
 * A value that is not a number shows nothing, leaving the placeholder. That is
 * how a field standing for several components at once says they do not agree.
 */
export function numberText(typed: string | null, value: number): string {
  const partial = typed === '' || typed === '-';
  if (typed !== null && (partial || Number.parseInt(typed, 10) === value)) return typed;
  return Number.isFinite(value) ? String(value) : '';
}

/**
 * Every dimension in the system is an integer number of millimetres. The field
 * keeps what is typed while it is being typed, and only reports whole numbers.
 */
export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled,
  placeholder,
  onKeyDown,
  inputRef,
  className = 'w-full',
  label,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  placeholder?: string;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  inputRef?: React.Ref<HTMLInputElement>;
  className?: string;
  label?: string;
}) {
  /**
   * What has been typed so far, while it is still being typed.
   *
   * Clearing a field is how a number gets replaced, and half-cleared is not a
   * number. Without somewhere to keep that, the field reported nothing, the
   * value it was given never changed, and React put the old digits back — so
   * emptying 100 to type 120 left 1, and typing gave 1120. The half-typed text
   * lives here until it is a number or the field is left.
   */
  const [typed, setTyped] = useState<string | null>(null);

  return (
    <input
      ref={inputRef}
      className={`${inputBase} ${className} tabular-nums`}
      type="number"
      value={numberText(typed, value)}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      placeholder={placeholder}
      aria-label={label}
      onKeyDown={onKeyDown}
      onBlur={() => setTyped(null)}
      onChange={(event) => {
        const text = event.target.value;
        setTyped(text);
        const next = Number.parseInt(text, 10);
        if (Number.isFinite(next)) onChange(next);
      }}
    />
  );
}

/**
 * A number with a fraction to it — an opacity, a width per letter.
 *
 * Not NumberInput with a smaller step: that one keeps whole numbers only, so
 * 0.39 typed into it reported 0, and nothing after the point ever reached the
 * brand. This reads the whole of what is typed, reports it only once it is a
 * number inside the range, and keeps the text as typed until then — "0." is
 * on its way to 0.4, not a request for nothing. Leaving the field with
 * something out of range puts back the last good value.
 *
 * A text box rather than a number box, so what is shown is exactly what was
 * typed in every browser; the arrow keys still step it.
 */
export function DecimalInput({
  value,
  onChange,
  min,
  max,
  step = 0.01,
  disabled,
  placeholder,
  className = 'w-full',
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const [typed, setTyped] = useState<string | null>(null);
  const inRange = (next: number): boolean =>
    Number.isFinite(next) && (min === undefined || next >= min) && (max === undefined || next <= max);
  // As many places as the step has, so stepping 0.49 up gives 0.5 and not
  // 0.49999999999999994.
  const places = (String(step).split('.')[1] ?? '').length;

  return (
    <input
      className={`${inputBase} ${className} tabular-nums`}
      type="text"
      inputMode="decimal"
      value={typed ?? (Number.isFinite(value) ? String(value) : '')}
      disabled={disabled}
      placeholder={placeholder}
      onBlur={() => setTyped(null)}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        const next = Number(((Number.isFinite(value) ? value : 0) + (event.key === 'ArrowUp' ? step : -step)).toFixed(places));
        if (inRange(next)) {
          setTyped(null);
          onChange(next);
        }
      }}
      onChange={(event) => {
        const text = event.target.value;
        setTyped(text);
        if (!/^\s*\d*\.?\d+\s*$/.test(text)) return;
        const next = Number.parseFloat(text);
        if (inRange(next)) onChange(next);
      }}
    />
  );
}

/**
 * A number that is allowed to be absent, where absent means something rather
 * than nothing: an override that has not been made, so the derived value stands.
 * Emptying the field reports undefined instead of holding the old digits.
 */
export function OptionalNumberInput({
  value,
  onChange,
  min,
  placeholder,
  className = 'w-full',
  label,
}: {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  min?: number;
  placeholder?: string;
  className?: string;
  label?: string;
}) {
  const [typed, setTyped] = useState<string | null>(null);

  return (
    <input
      className={`${inputBase} ${className} tabular-nums`}
      type="number"
      value={typed ?? (value === undefined ? '' : String(value))}
      min={min}
      step={1}
      placeholder={placeholder}
      aria-label={label}
      onBlur={() => setTyped(null)}
      onChange={(event) => {
        const text = event.target.value;
        setTyped(text);
        if (text.trim() === '') {
          onChange(undefined);
          return;
        }
        const next = Number.parseInt(text, 10);
        if (Number.isFinite(next)) onChange(next);
      }}
    />
  );
}

/**
 * A figure that is also allowed to be left blank or marked `na`.
 *
 * The three states mean different things on the sheet — a figure prints, blank
 * prints as a dash, `na` takes the whole row off — and all three have to be
 * typeable into the same field, so this reads numbers out of a text box rather
 * than being a number box that would refuse the two letters.
 */
export function NumberOrNaInput({
  value,
  onChange,
  placeholder,
  className = 'w-full',
}: {
  value: LoadKg | undefined;
  onChange: (value: LoadKg | undefined) => void;
  placeholder?: string;
  className?: string;
}) {
  const [typed, setTyped] = useState<string | null>(null);

  return (
    <input
      className={`${inputBase} ${className} tabular-nums`}
      type="text"
      inputMode="numeric"
      value={typed ?? (value === undefined ? '' : String(value))}
      placeholder={placeholder}
      onBlur={() => setTyped(null)}
      onChange={(event) => {
        const text = event.target.value;
        setTyped(text);
        const wanted = text.trim().toLowerCase();
        if (wanted === '') onChange(undefined);
        else if (wanted === NOT_APPLICABLE) onChange(NOT_APPLICABLE);
        else {
          const next = Number.parseInt(wanted, 10);
          if (Number.isFinite(next) && next >= 0) onChange(next);
        }
      }}
    />
  );
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  disabled,
  className = 'w-full',
  label,
}: {
  value: T;
  options: Array<[T, string]>;
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
  label?: string;
}) {
  return (
    <select
      className={`${inputBase} ${className}`}
      value={value}
      disabled={disabled}
      aria-label={label}
      onChange={(event) => onChange(event.target.value as T)}
    >
      {options.map(([key, label]) => (
        <option key={key} value={key}>
          {label}
        </option>
      ))}
    </select>
  );
}

export function Check({
  checked,
  onChange,
  label,
  /** Where the label is a column heading elsewhere, and the box needs its own. */
  hiddenLabel,
  disabled,
  /** Drawn between the box and the label — for a choice that has a picture. */
  icon,
  /**
   * Show an unticked box as struck off rather than merely not ticked. For the
   * choice where not ticking it is itself an answer, and prints as one.
   */
  strikeWhenOff,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hiddenLabel?: string;
  disabled?: boolean;
  icon?: ReactNode;
  strikeWhenOff?: boolean;
}) {
  const struck = strikeWhenOff === true && !checked;
  return (
    <label
      className={
        'flex items-center gap-1.5 text-ui ' +
        (struck ? 'text-ink-faint line-through decoration-line' : 'text-slate-700')
      }
    >
      <input
        type="checkbox"
        className="h-3.5 w-3.5 rounded border-line accent-(--color-accent)"
        checked={checked}
        disabled={disabled}
        aria-label={hiddenLabel}
        onChange={(event) => onChange(event.target.checked)}
      />
      {icon}
      {label}
    </label>
  );
}

export function Button({
  onClick,
  children,
  tone = 'plain',
  size = 'md',
  disabled,
  title,
  label,
  submit = false,
}: {
  /** Absent on a button that submits the form it is in. */
  onClick?: () => void;
  children: ReactNode;
  tone?: 'plain' | 'primary' | 'danger' | 'subtle';
  size?: 'sm' | 'md';
  disabled?: boolean;
  title?: string;
  /** Said aloud where the face of the button is an arrow or a cross. */
  label?: string;
  /**
   * Submit the form this sits in, rather than acting on its own.
   *
   * Worth the extra word: a real form is what makes the enter key work and
   * what a password manager looks for before it offers to fill anything in.
   */
  submit?: boolean;
}) {
  const tones = {
    plain: 'border-line bg-card text-slate-700 shadow-xs hover:bg-ground-soft hover:border-slate-400',
    primary: 'border-accent bg-accent text-white shadow-xs hover:bg-blue-700',
    danger: 'border-line bg-card text-red-600 shadow-xs hover:bg-red-50 hover:border-red-300',
    // The many small actions in tables and card corners, which should not each
    // look like a decision to be made.
    subtle: 'border-transparent bg-transparent text-ink-faint hover:bg-ground hover:text-ink-soft',
  };
  const sizes = {
    sm: 'px-1.5 py-0.5 text-micro',
    md: 'px-2.5 py-1 text-ui',
  };
  return (
    <button
      type={submit ? 'submit' : 'button'}
      title={title}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-md border font-medium transition-colors disabled:opacity-40
                  disabled:shadow-none disabled:hover:bg-card ${sizes[size]} ${tones[tone]}`}
    >
      {children}
    </button>
  );
}

/**
 * The mark a dropdown wears. The same chevron styles.css draws in every
 * select, so a menu button and a select side by side point the same way.
 *
 * It replaced a ▾ typed into the label, which sat on the text's baseline
 * rather than its middle and came out a different size in every font.
 */
export function Chevron({ open = false, small = false }: { open?: boolean; small?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`${small ? 'h-3 w-3' : 'h-3.5 w-3.5'} shrink-0 text-ink-faint transition-transform ${open ? 'rotate-180' : ''}`}
    >
      <path d="m4 6 4 4 4-4" />
    </svg>
  );
}

/** Clear space between a list and its button, and between a list and the window's edge. */
const MENU_GAP = 4;
const MENU_EDGE = 8;

/**
 * A button that opens a short list of things it can do.
 *
 * The header had eleven controls competing on one row, four of them acronyms,
 * and the explanation of what each produced was in a tooltip that had to be
 * hovered to be found. A list has room to say what each one is for on the way
 * past, and gives the row back to the two things done constantly: Save, and
 * getting back to the library.
 *
 * The list is rendered through a portal, on the body, rather than under the
 * button that opens it. As a child it was at the mercy of whatever its
 * ancestors did: a design card lifts itself half a step on hover, and a
 * transform — however small — makes the element a stacking context, which traps
 * the list's z-index inside a card that has none of its own. So the list opened
 * on top and then slid behind the next row of cards the moment the pointer
 * reached it. On the body it has no ancestor left to be trapped by.
 *
 * The cost of the portal is that the list no longer moves with the button, so
 * where it goes has to be worked out here — see `place` below.
 */
export function Menu({
  label,
  title,
  align = 'right',
  /**
   * Narrow where the thing it hangs off is small, as on a design card; wide
   * where the list has fields in it as well as choices.
   */
  width = 'md',
  disabled,
  tone = 'plain',
  size = 'md',
  caret = false,
  children,
}: {
  label: ReactNode;
  title?: string;
  align?: 'left' | 'right';
  width?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  tone?: 'plain' | 'subtle';
  /** Small in a table row, beside the small buttons there. */
  size?: 'sm' | 'md';
  /** Say it opens a list, with the chevron a select has. Not for a bare ⋯. */
  caret?: boolean;
  /** Given a way to close, so choosing something puts the list away. */
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);

  const close = () => {
    setOpen(false);
    setAt(null);
  };
  const box = useDismiss(open, close, panel);

  // Measured rather than guessed, so a list that will not fit under its button
  // opens over it instead of running off the foot of the window. A layout
  // effect, so the move happens before the browser paints and is never seen.
  useLayoutEffect(() => {
    if (!open) return;

    const place = () => {
      const button = box.current?.getBoundingClientRect();
      const list = panel.current?.getBoundingClientRect();
      if (!button || !list) return;

      // Under the button if it fits there, over it if it does not, and pinned
      // to the foot of the window if it fits neither way.
      const below = button.bottom + MENU_GAP;
      const above = button.top - MENU_GAP - list.height;
      const top =
        below + list.height <= window.innerHeight - MENU_EDGE
          ? below
          : above >= MENU_EDGE
            ? above
            : Math.max(MENU_EDGE, window.innerHeight - MENU_EDGE - list.height);

      const left = align === 'right' ? button.right - list.width : button.left;
      setAt({
        top,
        left: Math.max(MENU_EDGE, Math.min(left, window.innerWidth - MENU_EDGE - list.width)),
      });
    };

    place();
    // A fixed list does not travel with the button that owns it, so it has to
    // be put back whenever the button moves. The library scrolls in a pane of
    // its own, so the scroll is caught on the way down rather than waited for
    // on the window.
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, align]);

  return (
    <div className="relative inline-flex" ref={box}>
      <Button
        tone={tone}
        size={size}
        title={title}
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span aria-expanded={open} className="flex items-center gap-1">
          {label}
          {caret && <Chevron open={open} small={size === 'sm'} />}
        </span>
      </Button>
      {open &&
        createPortal(
          <div
            ref={panel}
            role="menu"
            style={{
              top: at?.top ?? 0,
              left: at?.left ?? 0,
              // Fixed, so a list longer than the window would otherwise have
              // its last item somewhere unreachable.
              maxHeight: `calc(100vh - ${2 * MENU_EDGE}px)`,
              // Measured on the first pass, moved into place on the same pass.
              visibility: at === null ? 'hidden' : undefined,
            }}
            className={
              'fixed z-50 overflow-x-hidden overflow-y-auto rounded-card border border-line ' +
              'bg-card py-1 shadow-raised ' +
              (width === 'sm' ? 'w-52' : width === 'lg' ? 'w-72' : 'w-64')
            }
          >
            {children(close)}
          </div>,
          document.body,
        )}
    </div>
  );
}

/** One line of a Menu: what it does, and underneath, what that is for. */
export function MenuItem({
  onClick,
  children,
  note,
  disabled,
  tone = 'plain',
}: {
  onClick: () => void;
  children: ReactNode;
  note?: string;
  disabled?: boolean;
  tone?: 'plain' | 'danger';
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={
        'block w-full px-3 py-1.5 text-left transition-colors disabled:opacity-40 ' +
        (disabled ? '' : 'hover:bg-ground ') +
        (tone === 'danger' ? 'text-red-600' : 'text-ink')
      }
    >
      <span className="block text-ui font-medium">{children}</span>
      {note && <span className="mt-0.5 block text-micro text-ink-faint">{note}</span>}
    </button>
  );
}

export function MenuHeading({ children }: { children: ReactNode }) {
  return (
    <div className="mt-1 border-t border-line-soft px-3 pb-1 pt-2 text-micro font-semibold uppercase tracking-wider text-ink-faint first:mt-0 first:border-t-0 first:pt-1">
      {children}
    </div>
  );
}

/**
 * Detail folded away until it is wanted.
 *
 * A layer is nearly always one size repeated, and the row above describes the
 * whole of it, so the component-by-component table underneath is a correction
 * tool rather than something to be read. It opens closed, except where the
 * components already differ and the table is the only place that says how.
 */
export function Disclosure({
  summary,
  defaultOpen = false,
  openWhen = false,
  children,
}: {
  summary: string;
  defaultOpen?: boolean;
  /** Unfold, whatever state it was left in, while this holds. */
  openWhen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen || openWhen);

  // Something outside has pointed at what is folded away — a board clicked on
  // the drawing, say. Hiding what the click just selected would make the click
  // look like it did nothing.
  useEffect(() => {
    if (openWhen) setOpen(true);
  }, [openWhen]);

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="-ml-1 flex items-center gap-1 rounded-md px-1 py-0.5 text-left text-label font-medium
                   text-ink-soft transition-colors hover:bg-ground hover:text-ink"
      >
        <Icon name="chevronRight" size={14} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
        {summary}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

/**
 * A card, for the screens that are a few separate things side by side — the
 * company list, its people, its branding. The design form is not one of them:
 * see Section.
 */
export function Panel({
  title,
  children,
  actions,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-card border border-line bg-card shadow-card">
      <header className="flex min-h-11 items-center justify-between gap-2 border-b border-line-soft px-4 py-2">
        <h2 className="text-ui font-semibold text-ink">{title}</h2>
        {actions}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

/**
 * The small drawings on buttons that have no word on them.
 *
 * Drawn here rather than typed as ↶ ↑ × — a typed arrow is whatever the font
 * makes of it, sits on the text's baseline rather than its middle, and comes
 * out a different size and weight on every machine. These are one stroke
 * weight, one size and centred, the way the chevron in a select already was.
 */
const ICONS = {
  undo: (
    <>
      <path d="M3 7v6h6" />
      <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
    </>
  ),
  redo: (
    <>
      <path d="M21 7v6h-6" />
      <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  check: <path d="M20 6 9 17l-5-5" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  chevronRight: <path d="m9 18 6-6-6-6" />,
  arrowUp: <path d="M12 19V5M5 12l7-7 7 7" />,
  arrowDown: <path d="M12 5v14M19 12l-7 7-7-7" />,
  arrowLeft: <path d="M19 12H5M12 19l-7-7 7-7" />,
  arrowRight: <path d="M5 12h14M12 5l7 7-7 7" />,
  trash: (
    <>
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </>
  ),
  signOut: (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </>
  ),
  listPlus: (
    <>
      <path d="M11 12H3" />
      <path d="M16 6H3" />
      <path d="M16 18H3" />
      <path d="M18 9v6" />
      <path d="M21 12h-6" />
    </>
  ),
  download: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10 5 5 5-5" />
      <path d="M12 15V3" />
    </>
  ),
  upload: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m17 8-5-5-5 5" />
      <path d="M12 3v12" />
    </>
  ),
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  size = 16,
  className = '',
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
    >
      {ICONS[name]}
    </svg>
  );
}

/**
 * A button that is only a drawing — move, remove, more. Quiet until the
 * pointer is on it, so a row of them reads as part of the row rather than as
 * three more things to decide about.
 */
export function IconButton({
  icon,
  label,
  onClick,
  disabled,
  tone = 'plain',
  size = 'md',
}: {
  icon: IconName;
  /** What it does, said aloud and on hover. Required: there is no word on it. */
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'plain' | 'danger';
  size?: 'sm' | 'md';
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={
        'inline-flex shrink-0 items-center justify-center rounded-md text-ink-faint transition-colors ' +
        'disabled:opacity-30 disabled:hover:bg-transparent ' +
        (size === 'sm' ? 'h-6 w-6 ' : 'h-7 w-7 ') +
        (tone === 'danger' ? 'hover:bg-red-50 hover:text-red-600' : 'hover:bg-ground hover:text-ink')
      }
    >
      <Icon name={icon} size={size === 'sm' ? 14 : 16} />
    </button>
  );
}
