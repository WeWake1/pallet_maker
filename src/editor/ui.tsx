import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { shade } from '../render/theme.js';
import type { LayerStyle } from '../render/theme.js';
import { NOT_APPLICABLE } from '../types.js';
import type { LoadKg } from '../types.js';

/** Small form controls. Tailwind styles the editor chrome only. */

const inputClass =
  'w-full rounded-md border border-line bg-card px-2 py-1.5 text-ui text-ink ' +
  'transition-colors placeholder:text-slate-400 ' +
  'focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-ring/30 ' +
  'disabled:bg-ground disabled:text-ink-faint';

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
function useDismiss(
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
      <span className="mb-1 flex items-center gap-1 text-label font-medium uppercase tracking-wide text-ink-faint">
        {label}
        {hint && <Hint text={hint} />}
      </span>
      {children}
    </label>
  );
}

/**
 * A named group of fields inside a panel.
 *
 * Seventeen fields in a row of identical grids is a list to be read from the
 * top every time something has to be found in it. Four named groups is four
 * places to look, and the name says which one.
 */
export function SectionHeading({ children, note }: { children: ReactNode; note?: string }) {
  return (
    <div className="mb-2 flex items-baseline gap-2 border-b border-line-soft pb-1">
      <h3 className="text-micro font-semibold uppercase tracking-wider text-ink-soft">{children}</h3>
      {note && <span className="text-micro text-ink-faint">{note}</span>}
    </div>
  );
}

/** A value the design worked out for itself, shown where a field would be. */
export function Readout({
  label,
  value,
  hint,
  tone = 'plain',
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'plain' | 'warn';
}) {
  return (
    <div className="block">
      <span className="mb-1 flex items-center gap-1 text-label font-medium uppercase tracking-wide text-ink-faint">
        {label}
        {hint && <Hint text={hint} />}
      </span>
      <div
        className={
          'rounded-md border border-dashed border-line bg-ground-soft px-2 py-1.5 text-ui tabular-nums ' +
          (tone === 'warn' ? 'text-red-600' : 'text-ink-soft')
        }
      >
        {value}
      </div>
    </div>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <input
      className={inputClass}
      type="text"
      value={value}
      placeholder={placeholder}
      disabled={disabled}
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
      className={`${inputClass} tabular-nums`}
      type="number"
      value={numberText(typed, value)}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      placeholder={placeholder}
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
 * A number that is allowed to be absent, where absent means something rather
 * than nothing: an override that has not been made, so the derived value stands.
 * Emptying the field reports undefined instead of holding the old digits.
 */
export function OptionalNumberInput({
  value,
  onChange,
  min,
  placeholder,
}: {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  min?: number;
  placeholder?: string;
}) {
  const [typed, setTyped] = useState<string | null>(null);

  return (
    <input
      className={`${inputClass} tabular-nums`}
      type="number"
      value={typed ?? (value === undefined ? '' : String(value))}
      min={min}
      step={1}
      placeholder={placeholder}
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
}: {
  value: LoadKg | undefined;
  onChange: (value: LoadKg | undefined) => void;
  placeholder?: string;
}) {
  const [typed, setTyped] = useState<string | null>(null);

  return (
    <input
      className={`${inputClass} tabular-nums`}
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
}: {
  value: T;
  options: Array<[T, string]>;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <select
      className={inputClass}
      value={value}
      disabled={disabled}
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
}: {
  onClick: () => void;
  children: ReactNode;
  tone?: 'plain' | 'primary' | 'danger' | 'subtle';
  size?: 'sm' | 'md';
  disabled?: boolean;
  title?: string;
  /** Said aloud where the face of the button is an arrow or a cross. */
  label?: string;
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
      type="button"
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
  /** Narrow where the thing it hangs off is small, as on a design card. */
  width = 'md',
  disabled,
  tone = 'plain',
  children,
}: {
  label: ReactNode;
  title?: string;
  align?: 'left' | 'right';
  width?: 'sm' | 'md';
  disabled?: boolean;
  tone?: 'plain' | 'subtle';
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
        title={title}
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span aria-expanded={open} className="flex items-center gap-1">
          {label}
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
              (width === 'sm' ? 'w-52' : 'w-64')
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
        className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-label
                   text-ink-faint transition-colors hover:bg-ground-soft hover:text-ink-soft"
      >
        <span className="text-[10px] text-slate-400">{open ? '▼' : '▶'}</span>
        {summary}
      </button>
      {open && <div className="mt-1">{children}</div>}
    </div>
  );
}

/**
 * Text dark enough to read on a layer's own pale fill. The drawing's line
 * colour is mixed for a hairline on white, not for a word on a tint.
 */
function accentInk(accent: LayerStyle): string {
  return shade(accent.stroke, 0.75);
}

/**
 * A card. Given a layer's colours it wears them.
 *
 * A stack of a dozen identical white cards makes you read the small print at
 * the top of each one to find out which layer you are editing. Carrying the
 * colour the layer is already drawn in — the header tinted with its fill, the
 * left edge in its line colour — means the card is recognised on the way past
 * rather than read, and the editor and the drawing agree about what is what.
 */
export function Panel({
  title,
  children,
  actions,
  accent,
  /**
   * Keep the tight padding. A stack of a dozen layer cards is read by
   * scrolling, and room given to each one is room taken from how many are in
   * sight at once. The panels there is only one of can afford to breathe.
   */
  dense,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  accent?: LayerStyle;
  dense?: boolean;
}) {
  return (
    <section
      className="overflow-hidden rounded-card border border-line-soft bg-card shadow-card"
      style={accent ? { borderLeftWidth: '5px', borderLeftColor: accent.stroke } : undefined}
    >
      <header
        className="flex items-center justify-between gap-2 border-b border-line-soft px-3 py-2"
        style={accent ? { background: accent.fill, borderBottomColor: accent.stroke } : undefined}
      >
        <h2
          className={
            accent
              ? 'text-key font-bold tracking-tight'
              : 'text-micro font-semibold uppercase tracking-wider text-ink-faint'
          }
          style={accent ? { color: accentInk(accent) } : undefined}
        >
          {title}
        </h2>
        {actions}
      </header>
      <div className={dense ? 'p-2.5' : 'p-4'}>{children}</div>
    </section>
  );
}

/**
 * The row a design is actually typed into.
 *
 * Most of a layer card is corrections and settings that are right already. One
 * row of it — the size, the count and the material — is filled in on every
 * design there is. Someone entering a dozen designs should not have to find
 * that row again on every card, so it is boxed in the layer's own colour,
 * captioned, and set larger than the settings around it. The type scale comes
 * from `.key-fields` in styles.css rather than from a size prop threaded
 * through every control.
 */
export function KeyFields({
  caption,
  note,
  accent,
  children,
}: {
  caption: string;
  note?: string;
  accent?: LayerStyle;
  children: ReactNode;
}) {
  return (
    <div
      className="key-fields rounded-card border-2 bg-card p-3 shadow-card"
      style={{ borderColor: accent?.stroke ?? '#94a3b8' }}
    >
      <div className="mb-2 flex items-baseline gap-2">
        <span
          className="text-micro font-bold uppercase tracking-wider"
          style={{ color: accent ? accentInk(accent) : '#475569' }}
        >
          {caption}
        </span>
        {note && <span className="text-micro font-normal text-ink-faint">{note}</span>}
      </div>
      {children}
    </div>
  );
}
