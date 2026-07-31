import type { ReactNode } from 'react';

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
 * Every dimension in the system is an integer number of millimetres. The field
 * keeps what is typed while it is being typed, and only reports whole numbers.
 */
export function NumberInput({
  value,
  onChange,
  min,
  step = 1,
  disabled,
  onKeyDown,
  inputRef,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  step?: number;
  disabled?: boolean;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  return (
    <input
      ref={inputRef}
      className={`${inputClass} tabular-nums`}
      type="number"
      value={Number.isFinite(value) ? value : ''}
      min={min}
      step={step}
      disabled={disabled}
      onKeyDown={onKeyDown}
      onChange={(event) => {
        const next = Number.parseInt(event.target.value, 10);
        if (Number.isFinite(next)) onChange(next);
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

export function Panel({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded border border-slate-200 bg-white">
      <header className="flex items-center justify-between gap-2 border-b border-slate-200 px-2.5 py-1.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{title}</h2>
        {actions}
      </header>
      <div className="p-2.5">{children}</div>
    </section>
  );
}
