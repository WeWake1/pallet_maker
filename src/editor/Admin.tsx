import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import type { Rates } from '../costing/rates.js';
import { HANDLING_METHODS } from '../types.js';
import type { HandlingMethod } from '../types.js';
import { api } from './api.js';
import type { BrandFileInput, BrandSettings, Invitation, People, Person, RatesSettings } from './api.js';
import { HANDLING_LABEL } from '../sheet/handling.js';
import { Button, Check, Field, inputClass, NumberInput, Panel, Select, TextInput } from './ui.jsx';

/**
 * Looking after a company: who is in it, whose name is on its sheets, and what
 * it quotes at.
 *
 * Reached two ways and drawn once. A company's own administrator comes here
 * from the library; the vendor comes here from the list of companies, working
 * on one of them. `base` is the only difference, and it is the address the
 * requests go to.
 */

type Tab = 'people' | 'brand' | 'rates';

export function Admin({
  base,
  companyName,
  selfId,
  onBack,
  backLabel,
}: {
  base: string;
  companyName: string;
  /** Whoever is at the keyboard, who is not offered the buttons that would act on themselves. */
  selfId: string | null;
  onBack: () => void;
  backLabel: string;
}) {
  const [tab, setTab] = useState<Tab>('people');
  const calls = api.admin(base);

  return (
    <div className="flex h-full flex-col bg-slate-100 text-slate-900">
      <header className="flex items-center gap-3 border-b border-line bg-card px-4 py-2.5">
        <Button onClick={onBack}>{backLabel}</Button>
        <h1 className="text-title font-semibold tracking-tight text-ink">{companyName}</h1>
        <nav className="ml-6 flex gap-1">
          {(
            [
              ['people', 'People'],
              ['brand', 'Branding'],
              ['rates', 'Prices'],
            ] as Array<[Tab, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`rounded-md px-2.5 py-1 text-ui font-medium ${
                tab === key ? 'bg-ground text-ink' : 'text-ink-soft hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl px-4 py-6">
          {tab === 'people' && <PeopleTab calls={calls} selfId={selfId} />}
          {tab === 'brand' && <BrandTab calls={calls} />}
          {tab === 'rates' && <RatesTab calls={calls} />}
        </div>
      </div>
    </div>
  );
}

type Calls = ReturnType<typeof api.admin>;

/* ------------------------------------------------------------------ shared */

function Problem({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div className="mb-4 rounded-card border border-red-200 bg-red-50 px-3 py-2 text-ui text-red-700">{text}</div>
  );
}

function Notice({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div className="mb-4 rounded-card border border-emerald-200 bg-emerald-50 px-3 py-2 text-ui text-emerald-800">
      {text}
    </div>
  );
}

/**
 * A link to send to somebody.
 *
 * Shown once, with a button to copy it, and a plain reminder that this is the
 * only time it will be shown: the server keeps a hash of it and cannot say it
 * again. There is no email sent from here, so this is how the link travels —
 * pasted into whatever the company already uses to talk to each other.
 */
function LinkToSend({ email, link, onDone }: { email: string; link: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(link).then(() => setCopied(true));
  };
  return (
    <div className="mb-4 rounded-card border border-accent/40 bg-blue-50 px-3 py-3">
      <p className="text-ui text-ink">
        Send this to <strong>{email}</strong>. It works once, and for seven days. It will not be shown again.
      </p>
      <div className="mt-2 flex gap-2">
        <input className={`${inputClass} font-mono text-label`} readOnly value={link} onFocus={(e) => e.target.select()} />
        <Button tone="primary" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button onClick={onDone}>Done</Button>
      </div>
    </div>
  );
}

/** Reads a chosen file as base64, the way the upload routes take it. */
function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(file);
  });
}

const when = (iso: string | null): string => (iso ? iso.slice(0, 10) : 'never');

/* ------------------------------------------------------------------ people */

function PeopleTab({ calls, selfId }: { calls: Calls; selfId: string | null }) {
  const [people, setPeople] = useState<People | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [link, setLink] = useState<{ email: string; link: string } | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => calls.people().then(setPeople), [calls]);
  useEffect(() => {
    void refresh().catch((e: unknown) => setProblem(e instanceof Error ? e.message : String(e)));
  }, [refresh]);

  const run = (work: () => Promise<unknown>) => {
    setBusy(true);
    setProblem(null);
    void work()
      .then(refresh)
      .catch((e: unknown) => setProblem(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  const invite = () =>
    run(async () => {
      const made = await calls.invite(email.trim(), role);
      setLink({ email: email.trim(), link: made.link });
      setEmail('');
    });

  if (!people) return <Problem text={problem} />;

  return (
    <>
      <Problem text={problem} />
      {link && <LinkToSend email={link.email} link={link.link} onDone={() => setLink(null)} />}

      <Panel title="Invite somebody">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Field label="Email">
              <TextInput value={email} onChange={setEmail} placeholder="colleague@example.com" disabled={busy} />
            </Field>
          </div>
          <div className="w-40">
            <Field label="Role">
              <Select<'admin' | 'member'>
                value={role}
                onChange={setRole}
                options={[
                  ['member', 'Member'],
                  ['admin', 'Administrator'],
                ]}
                disabled={busy}
              />
            </Field>
          </div>
          <Button tone="primary" disabled={busy || email.trim() === ''} onClick={invite}>
            Invite
          </Button>
        </div>
        <p className="mt-2 text-label leading-relaxed text-ink-faint">
          You will be given a link to send them. They follow it, choose a password, and are in. A
          member draws and prints; an administrator can also do everything on this screen.
        </p>
      </Panel>

      <div className="mt-6">
        <Panel title="People">
          <table className="w-full text-ui">
            <thead>
              <tr className="text-left text-label text-ink-soft">
                <th className="py-1 pr-2 font-medium">Who</th>
                <th className="py-1 pr-2 font-medium">Role</th>
                <th className="py-1 pr-2 font-medium">Last signed in</th>
                <th className="py-1 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {people.users.map((person) => (
                <PersonRow key={person.id} person={person} self={person.id === selfId} busy={busy} calls={calls} run={run} onLink={setLink} />
              ))}
              {people.invitations.map((invitation) => (
                <InvitationRow key={invitation.id} invitation={invitation} busy={busy} calls={calls} run={run} />
              ))}
            </tbody>
          </table>
          {people.users.length === 0 && people.invitations.length === 0 && (
            <p className="text-ui text-ink-faint">Nobody yet.</p>
          )}
        </Panel>
      </div>
    </>
  );
}

function PersonRow({
  person,
  self,
  busy,
  calls,
  run,
  onLink,
}: {
  person: Person;
  /** This row is whoever is looking at it. */
  self: boolean;
  busy: boolean;
  calls: Calls;
  run: (work: () => Promise<unknown>) => void;
  onLink: (link: { email: string; link: string }) => void;
}) {
  const off = person.status === 'disabled';
  return (
    <tr className={`border-t border-line-soft ${off ? 'text-ink-faint' : ''}`}>
      <td className="py-1.5 pr-2">
        <div className="font-medium">{person.name || person.email}</div>
        {person.name && <div className="text-label text-ink-soft">{person.email}</div>}
        {!person.hasPassword && <div className="text-label text-amber-700">has not set a password yet</div>}
        {off && <div className="text-label">turned off</div>}
      </td>
      <td className="py-1.5 pr-2">
        <Select<'admin' | 'member'>
          value={person.role === 'admin' ? 'admin' : 'member'}
          onChange={(role) => run(() => calls.setRole(person.id, role))}
          options={[
            ['member', 'Member'],
            ['admin', 'Administrator'],
          ]}
          disabled={busy || off || self}
        />
      </td>
      <td className="py-1.5 pr-2 tabular-nums">{when(person.lastLoginAt)}</td>
      <td className="py-1.5">
        <div className="flex justify-end gap-1">
          <Button
            size="sm"
            disabled={busy}
            title="A link for them to choose a new password"
            onClick={() => run(async () => onLink({ email: person.email, link: (await calls.resetLink(person.id)).link }))}
          >
            New password link
          </Button>
          {self ? (
            <span className="self-center px-1 text-label text-ink-faint">you</span>
          ) : off ? (
            <Button size="sm" disabled={busy} onClick={() => run(() => calls.enable(person.id))}>
              Turn on
            </Button>
          ) : (
            <Button size="sm" tone="danger" disabled={busy} onClick={() => run(() => calls.disable(person.id))}>
              Turn off
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}

function InvitationRow({
  invitation,
  busy,
  calls,
  run,
}: {
  invitation: Invitation;
  busy: boolean;
  calls: Calls;
  run: (work: () => Promise<unknown>) => void;
}) {
  return (
    <tr className="border-t border-line-soft text-ink-soft">
      <td className="py-1.5 pr-2">
        <div>{invitation.email}</div>
        <div className="text-label">invited, link not yet used · runs out {when(invitation.expiresAt)}</div>
      </td>
      <td className="py-1.5 pr-2 capitalize">{invitation.role === 'admin' ? 'Administrator' : 'Member'}</td>
      <td className="py-1.5 pr-2">—</td>
      <td className="py-1.5">
        <div className="flex justify-end">
          <Button size="sm" disabled={busy} onClick={() => run(() => calls.withdraw(invitation.id))}>
            Withdraw
          </Button>
        </div>
      </td>
    </tr>
  );
}

/* ------------------------------------------------------------------- brand */

/** The form's own shape of the brand file: every field present and plain. */
interface BrandForm {
  companyName: string;
  watermarkEnabled: boolean;
  watermarkText: string;
  watermarkOpacity: number;
  watermarkSizePt: number | null;
  fontFamily: string;
  fontAdvanceEm: number | null;
  projectionNote: string;
  toleranceComponent: string;
  tolerancePallet: string;
  volume: 'cft' | 'm3';
  codePlaceholder: string;
  species: string;
  nailType: string;
  newLength: number;
  newWidth: number;
  handling: HandlingMethod[];
}

const EMPTY_FORM: BrandForm = {
  companyName: '',
  watermarkEnabled: true,
  watermarkText: '',
  watermarkOpacity: 0.06,
  watermarkSizePt: null,
  fontFamily: '',
  fontAdvanceEm: null,
  projectionNote: 'First-angle projection, all dimensions in mm',
  toleranceComponent: '± 2 mm',
  tolerancePallet: '± 5 mm',
  volume: 'cft',
  codePlaceholder: '',
  species: 'pine',
  nailType: 'wire nail',
  newLength: 1200,
  newWidth: 800,
  handling: ['pallet_truck', 'forklift'],
};

function formFrom(file: BrandFileInput | null): BrandForm {
  if (!file) return EMPTY_FORM;
  return {
    companyName: file.companyName ?? '',
    watermarkEnabled: file.watermark?.enabled ?? true,
    watermarkText: file.watermark?.text ?? '',
    watermarkOpacity: file.watermark?.opacity ?? 0.06,
    watermarkSizePt: file.watermark?.sizePt ?? null,
    fontFamily: file.font?.family ?? '',
    fontAdvanceEm: file.font?.advanceEm ?? null,
    projectionNote: file.projectionNote ?? EMPTY_FORM.projectionNote,
    toleranceComponent: file.tolerances?.component ?? EMPTY_FORM.toleranceComponent,
    tolerancePallet: file.tolerances?.pallet ?? EMPTY_FORM.tolerancePallet,
    volume: file.units?.volume ?? 'cft',
    codePlaceholder: file.defaults?.palletCodePlaceholder ?? '',
    species: file.defaults?.species ?? EMPTY_FORM.species,
    nailType: file.defaults?.nailType ?? EMPTY_FORM.nailType,
    newLength: file.defaults?.newPallet?.length ?? 1200,
    newWidth: file.defaults?.newPallet?.width ?? 800,
    handling: (file.defaults?.handling as HandlingMethod[] | undefined) ?? EMPTY_FORM.handling,
  };
}

function fileFrom(form: BrandForm, held: BrandSettings): BrandFileInput {
  return {
    companyName: form.companyName,
    watermark: {
      enabled: form.watermarkEnabled,
      text: form.watermarkText.trim() === '' ? null : form.watermarkText,
      opacity: form.watermarkOpacity,
      sizePt: form.watermarkSizePt,
    },
    // The font's file is whatever is on disk; the server settles that. Only
    // its name and width per letter are the form's to change.
    font: held.font
      ? { family: form.fontFamily || 'Company face', file: held.font, ...(form.fontAdvanceEm ? { advanceEm: form.fontAdvanceEm } : {}) }
      : null,
    projectionNote: form.projectionNote,
    tolerances: { component: form.toleranceComponent, pallet: form.tolerancePallet },
    units: { volume: form.volume },
    defaults: {
      palletCodePlaceholder: form.codePlaceholder,
      species: form.species,
      nailType: form.nailType,
      newPallet: { length: form.newLength, width: form.newWidth },
      handling: form.handling,
    },
  };
}

function BrandTab({ calls }: { calls: Calls }) {
  const [held, setHeld] = useState<BrandSettings | null>(null);
  const [form, setForm] = useState<BrandForm>(EMPTY_FORM);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Bumped after every change, so the preview asks for the sheet again. */
  const [previewKey, setPreviewKey] = useState(0);
  const logoInput = useRef<HTMLInputElement>(null);
  const fontInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(
    () =>
      calls.brand().then((settings) => {
        setHeld(settings);
        setForm(formFrom(settings.file));
        setPreviewKey((k) => k + 1);
      }),
    [calls],
  );
  useEffect(() => {
    void refresh().catch((e: unknown) => setProblem(e instanceof Error ? e.message : String(e)));
  }, [refresh]);

  const run = (work: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setProblem(null);
    setNotice(null);
    void work()
      .then(refresh)
      .then(() => {
        if (done) setNotice(done);
      })
      .catch((e: unknown) => setProblem(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  const patch = (changes: Partial<BrandForm>) => setForm((f) => ({ ...f, ...changes }));

  const save = () => {
    if (!held) return;
    run(() => calls.saveBrand(fileFrom(form, held)), 'Saved. The preview below is the sheet as it prints now.');
  };

  const upload = (kind: 'logo' | 'font') => async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const data = await readFileAsBase64(file);
    if (kind === 'logo') run(() => calls.uploadLogo(file.name, data), 'Logo in place.');
    else run(() => calls.uploadFont(file.name, data, form.fontFamily || file.name.replace(/\.[^.]+$/, ''), form.fontAdvanceEm ?? undefined), 'Face in place.');
  };

  if (!held) return <Problem text={problem} />;

  return (
    <>
      <Problem text={problem} />
      <Notice text={notice} />
      {held.problem && <Problem text={held.problem} />}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <Panel title="Whose sheets these are">
            <div className="flex flex-col gap-3">
              <Field label="Company name, as it prints">
                <TextInput value={form.companyName} onChange={(companyName) => patch({ companyName })} disabled={busy} />
              </Field>
              <Check
                checked={form.watermarkEnabled}
                onChange={(watermarkEnabled) => patch({ watermarkEnabled })}
                label="Write the name across every sheet as a watermark"
                disabled={busy}
              />
              {form.watermarkEnabled && (
                <div className="grid grid-cols-2 gap-3 pl-6">
                  <Field label="Watermark says" hint="Left blank, the company name.">
                    <TextInput value={form.watermarkText} onChange={(watermarkText) => patch({ watermarkText })} disabled={busy} />
                  </Field>
                  <Field label="Opacity" hint="0.06 is faint enough to build from.">
                    <NumberInput value={form.watermarkOpacity} min={0.01} max={0.3} step={0.01} onChange={(watermarkOpacity) => patch({ watermarkOpacity })} disabled={busy} />
                  </Field>
                </div>
              )}
            </div>
          </Panel>

          <Panel title="The mark in the corner">
            <ArtworkRow
              held={held.logo}
              nothing="No logo. The corner is left empty."
              accept=".svg,.png,.jpg,.jpeg,image/svg+xml,image/png,image/jpeg"
              input={logoInput}
              busy={busy}
              onChoose={upload('logo')}
              onRemove={() => run(() => calls.removeLogo(), 'Logo removed.')}
            />
            <p className="mt-2 text-label leading-relaxed text-ink-faint">
              SVG prints sharpest and keeps the vector sheet something a drawing program can take
              apart. A PNG or JPEG is fine; it costs only that. An SVG with a stylesheet, a clip
              path or a filter in it will be refused — flatten it to plain shapes when you export.
            </p>
          </Panel>

          <Panel title="The face the watermark is set in">
            <ArtworkRow
              held={held.font}
              nothing="The sheet's own sans."
              accept=".otf,.ttf,.woff,.woff2"
              input={fontInput}
              busy={busy}
              onChoose={upload('font')}
              onRemove={() => run(() => calls.removeFont(), 'Face removed.')}
            />
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label="Called" hint="Any name; it is only what the sheet asks for it by.">
                <TextInput value={form.fontFamily} onChange={(fontFamily) => patch({ fontFamily })} disabled={busy || !held.font} />
              </Field>
              <Field label="Width per letter" hint="About 0.39 for a condensed face, 0.49 for an ordinary one. Decides the size that fills the diagonal.">
                <NumberInput value={form.fontAdvanceEm ?? 0.49} min={0.2} max={1} step={0.01} onChange={(fontAdvanceEm) => patch({ fontAdvanceEm })} disabled={busy || !held.font} />
              </Field>
            </div>
            <p className="mt-2 text-label leading-relaxed text-ink-faint">
              Every sheet carries a copy of the face, so it has to be one the company is licensed
              to embed in documents. Under 1 MB.
            </p>
          </Panel>

          <Panel title="House conventions">
            <div className="flex flex-col gap-3">
              <Field label="Printed under the drawings">
                <Select<string>
                  value={form.projectionNote}
                  onChange={(projectionNote) => patch({ projectionNote })}
                  options={[
                    ['First-angle projection, all dimensions in mm', 'First-angle projection (Europe, India)'],
                    ['Third-angle projection, all dimensions in mm', 'Third-angle projection (North America)'],
                  ]}
                  disabled={busy}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Component tolerance">
                  <TextInput value={form.toleranceComponent} onChange={(toleranceComponent) => patch({ toleranceComponent })} disabled={busy} />
                </Field>
                <Field label="Overall tolerance">
                  <TextInput value={form.tolerancePallet} onChange={(tolerancePallet) => patch({ tolerancePallet })} disabled={busy} />
                </Field>
              </div>
              <Field label="Timber is bought by the">
                <Select<'cft' | 'm3'>
                  value={form.volume}
                  onChange={(volume) => patch({ volume })}
                  options={[
                    ['cft', 'cubic foot'],
                    ['m3', 'cubic metre'],
                  ]}
                  disabled={busy}
                />
              </Field>
            </div>
          </Panel>

          <Panel title="What a new design starts as">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Length (mm)">
                <NumberInput value={form.newLength} min={100} onChange={(newLength) => patch({ newLength })} disabled={busy} />
              </Field>
              <Field label="Width (mm)">
                <NumberInput value={form.newWidth} min={100} onChange={(newWidth) => patch({ newWidth })} disabled={busy} />
              </Field>
              <Field label="Timber">
                <TextInput value={form.species} onChange={(species) => patch({ species })} disabled={busy} />
              </Field>
              <Field label="Nail type">
                <TextInput value={form.nailType} onChange={(nailType) => patch({ nailType })} disabled={busy} />
              </Field>
              <Field label="Pallet code, as an example" hint="Shown greyed in the empty field.">
                <TextInput value={form.codePlaceholder} onChange={(codePlaceholder) => patch({ codePlaceholder })} placeholder="e.g. AP-001" disabled={busy} />
              </Field>
            </div>
            <div className="mt-3">
              <div className="mb-1 text-label text-ink-soft">Cleared to be moved with</div>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {HANDLING_METHODS.map((method) => (
                  <Check
                    key={method}
                    checked={form.handling.includes(method)}
                    onChange={(on) =>
                      patch({
                        handling: on ? [...form.handling, method] : form.handling.filter((m) => m !== method),
                      })
                    }
                    label={HANDLING_LABEL[method]}
                    disabled={busy}
                  />
                ))}
              </div>
            </div>
          </Panel>

          <div className="flex items-center gap-3">
            <Button tone="primary" disabled={busy} onClick={save}>
              Save
            </Button>
            <span className="text-label text-ink-faint">
              {held.from === 'folder' ? 'This company has a brand of its own.' : 'Using the branding this version ships with until saved.'}
            </span>
          </div>
        </div>

        <div className="lg:sticky lg:top-6 lg:self-start">
          <Panel title="The sheet, as it prints now">
            <SheetPreview src={calls.previewUrl()} refreshKey={previewKey} />
            <p className="mt-2 text-label leading-relaxed text-ink-faint">
              The same design for every company, so two brands can be compared. Save to see a change.
            </p>
          </Panel>
        </div>
      </div>
    </>
  );
}

function ArtworkRow({
  held,
  nothing,
  accept,
  input,
  busy,
  onChoose,
  onRemove,
}: {
  held: string | null;
  nothing: string;
  accept: string;
  input: React.RefObject<HTMLInputElement | null>;
  busy: boolean;
  onChoose: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex-1 font-mono text-label text-ink-soft">{held ?? nothing}</span>
      <input ref={input} type="file" accept={accept} className="hidden" onChange={onChoose} />
      <Button disabled={busy} onClick={() => input.current?.click()}>
        {held ? 'Replace…' : 'Choose a file…'}
      </Button>
      {held && (
        <Button tone="danger" disabled={busy} onClick={onRemove}>
          Remove
        </Button>
      )}
    </div>
  );
}

/**
 * The printed sheet, scaled to fit.
 *
 * An iframe rather than the sheet's markup dropped into the page: the sheet
 * carries a stylesheet of its own that would fight the editor's, and its A4
 * page is wider than this column, so it is drawn at full size in a frame and
 * the frame is scaled down.
 */
function SheetPreview({ src, refreshKey }: { src: string; refreshKey: number }) {
  // The sheet's own size in CSS pixels: A4 landscape at 96 per inch.
  const sheetWidth = (297 / 25.4) * 96;
  const sheetHeight = (210 / 25.4) * 96;
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);

  // Scaled to the column it sits in, and again whenever that column changes
  // width, so the whole page is always in view rather than its left two-thirds.
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const fit = () => setScale(element.clientWidth / sheetWidth);
    fit();
    const watcher = new ResizeObserver(fit);
    watcher.observe(element);
    return () => watcher.disconnect();
  }, [sheetWidth]);

  return (
    <div ref={box} className="overflow-hidden rounded-md border border-line bg-white" style={{ height: `${sheetHeight * scale}px` }}>
      <iframe
        key={refreshKey}
        title="The sheet as it prints"
        src={`${src}?at=${refreshKey}`}
        style={{
          width: `${sheetWidth}px`,
          height: `${sheetHeight}px`,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          border: 0,
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------- rates */

function RatesTab({ calls }: { calls: Calls }) {
  const [held, setHeld] = useState<RatesSettings | null>(null);
  const [currency, setCurrency] = useState('');
  const [timber, setTimber] = useState<Array<[string, number]>>([]);
  const [nails, setNails] = useState<Array<[string, number]>>([]);
  const [perPallet, setPerPallet] = useState(0);
  const [percent, setPercent] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const take = (settings: RatesSettings) => {
    setHeld(settings);
    setCurrency(settings.rates.currency);
    setTimber(Object.entries(settings.rates.timberPerCft));
    setNails(Object.entries(settings.rates.nailsPerThousand));
    setPerPallet(settings.rates.overhead.perPallet);
    setPercent(settings.rates.overhead.percentOfMaterial);
  };
  const refresh = useCallback(() => calls.rates().then(take), [calls]);
  useEffect(() => {
    void refresh().catch((e: unknown) => setProblem(e instanceof Error ? e.message : String(e)));
  }, [refresh]);

  const run = (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setProblem(null);
    setNotice(null);
    void work()
      .then(refresh)
      .then(() => setNotice(done))
      .catch((e: unknown) => setProblem(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  const save = () => {
    const rates: Rates = {
      currency: currency.trim(),
      timberPerCft: Object.fromEntries(timber.filter(([k]) => k.trim() !== '').map(([k, v]) => [k.trim(), v])),
      nailsPerThousand: Object.fromEntries(nails.filter(([k]) => k.trim() !== '').map(([k, v]) => [k.trim(), v])),
      overhead: { perPallet, percentOfMaterial: percent },
    };
    run(() => calls.saveRates(rates), 'Saved. Every design is costed at these prices from now on.');
  };

  if (!held) return <Problem text={problem} />;

  return (
    <>
      <Problem text={problem} />
      <Notice text={notice} />
      {held.problem && <Problem text={held.problem} />}

      <Panel title="Currency">
        <div className="w-40">
          <TextInput value={currency} onChange={setCurrency} placeholder="INR" disabled={busy} />
        </div>
        <p className="mt-2 text-label text-ink-faint">Printed beside every cost in the editor. Never on the sheet.</p>
      </Panel>

      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
        <RateTable title="Timber, per cubic foot" rows={timber} onChange={setTimber} busy={busy} placeholder="pine" />
        <RateTable title="Nails, per thousand" rows={nails} onChange={setNails} busy={busy} placeholder="wire nail" />
      </div>

      <div className="mt-6">
        <Panel title="Overhead">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Per pallet">
              <NumberInput value={perPallet} min={0} onChange={setPerPallet} disabled={busy} />
            </Field>
            <Field label="Plus, of the material cost (%)">
              <NumberInput value={percent} min={0} max={100} step={0.5} onChange={setPercent} disabled={busy} />
            </Field>
          </div>
        </Panel>
      </div>

      <div className="mt-6 flex items-center gap-3">
        <Button tone="primary" disabled={busy || currency.trim() === ''} onClick={save}>
          Save
        </Button>
        {held.from === 'folder' ? (
          <Button disabled={busy} onClick={() => run(() => calls.useShippedRates(), 'Back to the prices this version ships with.')}>
            Use the shipped prices instead
          </Button>
        ) : (
          <span className="text-label text-ink-faint">Using the prices this version ships with until saved.</span>
        )}
      </div>
    </>
  );
}

function RateTable({
  title,
  rows,
  onChange,
  busy,
  placeholder,
}: {
  title: string;
  rows: Array<[string, number]>;
  onChange: (rows: Array<[string, number]>) => void;
  busy: boolean;
  placeholder: string;
}) {
  const set = (index: number, row: [string, number]) => onChange(rows.map((r, i) => (i === index ? row : r)));
  return (
    <Panel title={title}>
      <table className="w-full text-ui">
        <tbody>
          {rows.map(([name, rate], index) => (
            <tr key={index}>
              <td className="py-1 pr-2">
                <TextInput value={name} onChange={(next) => set(index, [next, rate])} placeholder={placeholder} disabled={busy || name === 'default'} />
              </td>
              <td className="w-32 py-1 pr-2">
                <NumberInput value={rate} min={0} onChange={(next) => set(index, [name, next])} disabled={busy} />
              </td>
              <td className="w-8 py-1">
                {name !== 'default' && (
                  <Button size="sm" tone="subtle" disabled={busy} label={`Remove ${name}`} onClick={() => onChange(rows.filter((_, i) => i !== index))}>
                    ×
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2">
        <Button size="sm" disabled={busy} onClick={() => onChange([...rows, ['', 0]])}>
          Add a material
        </Button>
      </div>
      <p className="mt-2 text-label text-ink-faint">Anything not listed is charged at <code>default</code>.</p>
    </Panel>
  );
}

export type { ReactNode };
