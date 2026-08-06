import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { shade } from '../render/theme.js';
import type { LayerStyle } from '../render/theme.js';
import { NOT_APPLICABLE } from '../types.js';
import type { LoadKg } from '../types.js';

/** Small form controls. Tailwind styles the editor chrome only. */

const inputClass =
  'w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-sm text-slate-900 ' +
  'focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 ' +
  'disabled:bg-slate-100 disabled:text-slate-500';

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </span>
      {children}
    </label>
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
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-1.5 text-sm text-slate-700">
      <input
        type="checkbox"
        className="h-3.5 w-3.5 rounded border-slate-300"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}

export function Button({
  onClick,
  children,
  tone = 'plain',
  disabled,
  title,
}: {
  onClick: () => void;
  children: ReactNode;
  tone?: 'plain' | 'primary' | 'danger';
  disabled?: boolean;
  title?: string;
}) {
  const tones = {
    plain: 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
    primary: 'border-blue-600 bg-blue-600 text-white hover:bg-blue-700',
    danger: 'border-slate-300 bg-white text-red-600 hover:bg-red-50',
  };
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`rounded border px-2 py-1 text-sm disabled:opacity-40 ${tones[tone]}`}
    >
      {children}
    </button>
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
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 rounded px-1 py-1 text-left text-xs text-slate-500 hover:bg-slate-50 hover:text-slate-700"
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
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  accent?: LayerStyle;
}) {
  return (
    <section
      className="overflow-hidden rounded-md border border-slate-200 bg-white"
      style={accent ? { borderLeftWidth: '5px', borderLeftColor: accent.stroke } : undefined}
    >
      <header
        className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2"
        style={accent ? { background: accent.fill, borderBottomColor: accent.stroke } : undefined}
      >
        <h2
          className={
            accent
              ? 'text-base font-bold tracking-tight'
              : 'text-[11px] font-semibold uppercase tracking-wider text-slate-500'
          }
          style={accent ? { color: accentInk(accent) } : undefined}
        >
          {title}
        </h2>
        {actions}
      </header>
      <div className="p-2.5">{children}</div>
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
      className="key-fields rounded-md border-2 bg-white p-2.5 shadow-sm"
      style={{ borderColor: accent?.stroke ?? '#94a3b8' }}
    >
      <div className="mb-1.5 flex items-baseline gap-2">
        <span
          className="text-[11px] font-bold uppercase tracking-wider"
          style={{ color: accent ? accentInk(accent) : '#475569' }}
        >
          {caption}
        </span>
        {note && <span className="text-[11px] font-normal text-slate-500">{note}</span>}
      </div>
      {children}
    </div>
  );
}
