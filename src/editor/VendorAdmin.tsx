import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import type { CompanySummary, MailStatus, People, SentLink } from './api.js';
import { Admin, LinkToSend } from './Admin.jsx';
import { Button, Check, Field, Menu, MenuItem, NumberInput, Panel, TextInput } from './ui.jsx';

/**
 * Looking after the service.
 *
 * What the vendor sees on signing in: every company at a glance, a way to make
 * one, and a way into any one of them to set it up. There are no designs here
 * — the vendor belongs to no company — so this is the whole of the window.
 */

function Problem({ text }: { text: string | null }) {
  if (!text) return null;
  return <div className="mb-4 rounded-card border border-red-200 bg-red-50 px-3 py-2 text-ui text-red-700">{text}</div>;
}

const when = (iso: string | null): string => (iso ? iso.slice(0, 10) : '—');

/** What a trial is, unless the vendor says otherwise. */
const TRIAL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** "4 Oct", in whatever way this browser writes a date. */
const shortDate = (at: number): string => new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/**
 * Where a company's trial stands, in a few words, and whether it is still let
 * in. A company with no end date says nothing: that is a customer.
 */
function trialState(company: CompanySummary, now = Date.now()): { text: string; ended: boolean } | null {
  if (company.accessUntil === null) return null;
  const end = Date.parse(company.accessUntil);
  if (end <= now) return { text: `trial ended ${shortDate(end)}`, ended: true };
  const left = Math.ceil((end - now) / DAY_MS);
  return { text: `trial · ends ${shortDate(end)}, ${left} day${left === 1 ? '' : 's'} left`, ended: false };
}

export function VendorAdmin({ userName, onSignOut }: { userName: string; onSignOut: () => void }) {
  const [companies, setCompanies] = useState<CompanySummary[] | null>(null);
  const [people, setPeople] = useState<People | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<{ email: string; sent: SentLink } | null>(null);
  const [mail, setMail] = useState<MailStatus | null>(null);
  /** A company being set up: its settings take the window. */
  const [inside, setInside] = useState<CompanySummary | null>(null);

  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [firstEmail, setFirstEmail] = useState('');
  // A new company is somebody trying it more often than not, so it starts as
  // a trial; unticking makes a customer with no end date.
  const [trial, setTrial] = useState(true);
  const [trialDays, setTrialDays] = useState(TRIAL_DAYS);
  const [vendorEmail, setVendorEmail] = useState('');

  const refresh = useCallback(
    () =>
      Promise.all([
        api.vendor.companies().then(setCompanies),
        api.vendor.people().then(setPeople),
        api.vendor.mail().then(setMail),
      ]),
    [],
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

  const create = () =>
    run(async () => {
      const made = await api.vendor.createCompany({
        slug: slug.trim(),
        name: name.trim(),
        timezone: timezone.trim(),
        firstEmail: firstEmail.trim(),
        trialDays: trial ? trialDays : null,
      });
      if (made.link) setLink({ email: firstEmail.trim(), sent: { link: made.link, emailed: made.emailed, mailProblem: made.mailProblem } });
      setSlug('');
      setName('');
      setFirstEmail('');
    }, 'Made. Its folder is ready for its branding.');

  if (inside) {
    return (
      <Admin
        base={api.vendor.adminBase(inside.slug)}
        companyName={inside.name}
        backLabel="← All companies"
        onBack={() => {
          setInside(null);
          void refresh().catch(() => undefined);
        }}
      />
    );
  }

  return (
    <div className="flex h-full flex-col bg-slate-100 text-slate-900">
      <header className="flex items-center gap-3 border-b border-line bg-card px-4 py-2.5">
        <h1 className="text-title font-semibold tracking-tight text-ink">Companies</h1>
        <span className="ml-auto text-label text-ink-soft">{userName}</span>
        <button type="button" onClick={onSignOut} className="text-label text-ink-soft underline underline-offset-2 hover:text-ink">
          Sign out
        </button>
      </header>
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl px-4 py-6">
          <Problem text={problem} />
          {notice && <div className="mb-4 rounded-card border border-emerald-200 bg-emerald-50 px-3 py-2 text-ui text-emerald-800">{notice}</div>}
          {link && <LinkToSend email={link.email} sent={link.sent} onDone={() => setLink(null)} />}

          <Panel
            title="Every company"
            actions={
              <Button size="sm" disabled={busy} onClick={() => run(() => api.vendor.backup(), 'Every library and the registry are backed up.')}>
                Back everything up now
              </Button>
            }
          >
            {companies === null ? null : companies.length === 0 ? (
              <p className="text-ui text-ink-faint">None yet. Make the first one below.</p>
            ) : (
              <table className="w-full text-ui">
                <thead>
                  <tr className="text-left text-label text-ink-soft">
                    <th className="py-1 pr-2 font-medium">Company</th>
                    <th className="py-1 pr-2 font-medium">People</th>
                    <th className="py-1 pr-2 font-medium">Designs</th>
                    <th className="py-1 pr-2 font-medium">Last saved</th>
                    <th className="py-1 pr-2 font-medium">Last sign-in</th>
                    <th className="py-1 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {companies.map((company) => (
                    <CompanyRow key={company.id} company={company} busy={busy} run={run} onEnter={() => setInside(company)} />
                  ))}
                </tbody>
              </table>
            )}
          </Panel>

          <div className="mt-6">
            <Panel title="A new company">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Short name" hint="Lowercase, no spaces. It names the folder, so it is permanent.">
                  <TextInput value={slug} onChange={(v) => setSlug(v.toLowerCase())} placeholder="northgate" disabled={busy} />
                </Field>
                <Field label="Name, as it prints">
                  <TextInput value={name} onChange={setName} placeholder="Northgate Pallets Ltd" disabled={busy} />
                </Field>
                <Field label="Time zone" hint="The date a design is stamped with when it is saved.">
                  <TextInput value={timezone} onChange={setTimezone} placeholder="Asia/Kolkata" disabled={busy} />
                </Field>
                <Field label="First person's email" hint="Optional now; more can be invited later from inside the company.">
                  <TextInput value={firstEmail} onChange={setFirstEmail} placeholder="boss@northgate.example" disabled={busy} />
                </Field>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Check
                  checked={trial}
                  disabled={busy}
                  label="A trial — nobody in it can sign in after"
                  onChange={setTrial}
                />
                <div className="w-16">
                  <NumberInput value={trialDays} min={1} max={366} disabled={busy || !trial} onChange={setTrialDays} />
                </div>
                <span className="text-ui text-ink-soft">days</span>
                <span className="text-label text-ink-faint">
                  {trial
                    ? `(until ${shortDate(Date.now() + trialDays * DAY_MS)}; extend it or give full access from the list above)`
                    : '(no end date: a customer)'}
                </span>
              </div>
              <div className="mt-3">
                <Button
                  tone="primary"
                  disabled={busy || slug.trim() === '' || name.trim() === '' || (trial && !(trialDays >= 1))}
                  onClick={create}
                >
                  Make it
                </Button>
              </div>
            </Panel>
          </div>

          <div className="mt-6">
            <Panel title="Who looks after the service">
              {people && (
                <ul className="mb-3 flex flex-col gap-1 text-ui">
                  {people.users.map((person) => (
                    <li key={person.id} className="flex gap-2">
                      <span>{person.name || person.email}</span>
                      <span className="text-ink-faint">{person.name ? person.email : ''}</span>
                      <span className="ml-auto text-label text-ink-soft">last signed in {when(person.lastLoginAt)}</span>
                    </li>
                  ))}
                  {people.invitations.map((invitation) => (
                    <li key={invitation.id} className="flex gap-2 text-ink-soft">
                      <span>{invitation.email}</span>
                      <span className="text-label">invited, link not yet used</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Field label="Invite somebody else to look after it">
                    <TextInput value={vendorEmail} onChange={setVendorEmail} placeholder="colleague@example.com" disabled={busy} />
                  </Field>
                </div>
                <Button
                  disabled={busy || vendorEmail.trim() === ''}
                  onClick={() =>
                    run(async () => {
                      const made = await api.vendor.invite(vendorEmail.trim());
                      setLink({ email: vendorEmail.trim(), sent: made });
                      setVendorEmail('');
                    })
                  }
                >
                  Invite
                </Button>
              </div>
            </Panel>
          </div>

          <div className="mt-6">
            <Panel
              title="Email"
              actions={
                mail?.configured ? (
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => run(async () => {
                      const sent = await api.vendor.testMail();
                      setNotice(`A test email is on its way to ${sent.to}.`);
                    })}
                  >
                    Send me a test email
                  </Button>
                ) : undefined
              }
            >
              {mail === null ? null : mail.configured ? (
                <p className="text-ui text-ink-soft">
                  Invitations and new-password links are emailed from <strong className="text-ink">{mail.from}</strong>.
                  The link is shown to you as well, in case one goes astray.
                </p>
              ) : (
                <p className="text-ui text-ink-soft">
                  This server is not set up to send email, so each invitation gives you a link to send yourself. To
                  have them emailed, set <code className="rounded bg-slate-200 px-1">PALLET_SMTP_HOST</code> and the
                  settings beside it in <code className="rounded bg-slate-200 px-1">/etc/pallet-spec/env</code> (see
                  deploy/env.example) and restart the service.
                </p>
              )}
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}

function CompanyRow({
  company,
  busy,
  run,
  onEnter,
}: {
  company: CompanySummary;
  busy: boolean;
  run: (work: () => Promise<unknown>, done?: string) => void;
  onEnter: () => void;
}) {
  const suspended = company.status === 'suspended';
  const trial = trialState(company);
  const shut = suspended || trial?.ended === true;
  // Seven more days from the end of the trial, or from today where it has run
  // out or there is none — which is what the server does with them too.
  const from = company.accessUntil === null ? Date.now() : Math.max(Date.now(), Date.parse(company.accessUntil));
  return (
    <tr className={`border-t border-line-soft ${shut ? 'text-ink-faint' : ''}`}>
      <td className="py-1.5 pr-2">
        <div className="font-medium">{company.name}</div>
        <div className="text-label text-ink-soft">
          {company.slug} · {company.timezone}
          {suspended && ' · suspended'}
        </div>
        {trial && (
          <div className={`text-label ${trial.ended ? 'text-red-700' : 'text-amber-700'}`}>
            {trial.text}
            {trial.ended && !suspended && ' — nobody in it can sign in'}
          </div>
        )}
      </td>
      <td className="py-1.5 pr-2 tabular-nums">
        {company.signedUp} of {company.people}
      </td>
      <td className="py-1.5 pr-2 tabular-nums">{company.designs ?? '?'}</td>
      <td className="py-1.5 pr-2 tabular-nums">{when(company.lastSaved)}</td>
      <td className="py-1.5 pr-2 tabular-nums">{when(company.lastLogin)}</td>
      <td className="py-1.5">
        <div className="flex justify-end gap-1">
          <Button size="sm" tone="primary" disabled={busy} onClick={onEnter}>
            Set up
          </Button>
          <Menu label="Access ▾" title="How long this company may go on signing in" disabled={busy}>
            {(close) => (
              <>
                <MenuItem
                  onClick={() => {
                    close();
                    run(
                      () => api.vendor.access(company.slug, { addDays: TRIAL_DAYS }),
                      `${company.name} can sign in until ${shortDate(from + TRIAL_DAYS * DAY_MS)}.`,
                    );
                  }}
                  note={`Access until ${shortDate(from + TRIAL_DAYS * DAY_MS)}`}
                >
                  {company.accessUntil === null
                    ? `Make it a ${TRIAL_DAYS}-day trial`
                    : trial?.ended
                      ? `Reopen for ${TRIAL_DAYS} days`
                      : `${TRIAL_DAYS} more days`}
                </MenuItem>
                {company.accessUntil !== null && (
                  <MenuItem
                    onClick={() => {
                      close();
                      run(
                        () => api.vendor.access(company.slug, { unlimited: true }),
                        `${company.name} has full access, with no end date.`,
                      );
                    }}
                    note="No end date — a customer now"
                  >
                    Full access
                  </MenuItem>
                )}
              </>
            )}
          </Menu>
          {suspended ? (
            <Button size="sm" disabled={busy} onClick={() => run(() => api.vendor.resume(company.slug), `${company.name} is active again.`)}>
              Resume
            </Button>
          ) : (
            <Button
              size="sm"
              tone="danger"
              disabled={busy}
              title="Revoke access now: everyone in it is signed out"
              onClick={() => {
                if (window.confirm(`Suspend ${company.name}? Everyone in it is signed out and cannot sign in until it is resumed. Nothing is deleted.`)) {
                  run(() => api.vendor.suspend(company.slug), `${company.name} is suspended.`);
                }
              }}
            >
              Suspend
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}
