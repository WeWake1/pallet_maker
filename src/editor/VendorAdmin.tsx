import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import type { CompanySummary, People } from './api.js';
import { Admin } from './Admin.jsx';
import { Button, Field, inputClass, Panel, TextInput } from './ui.jsx';

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

function LinkToSend({ email, link, onDone }: { email: string; link: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mb-4 rounded-card border border-accent/40 bg-blue-50 px-3 py-3">
      <p className="text-ui text-ink">
        Send this to <strong>{email}</strong>. It works once, and for seven days. It will not be shown again.
      </p>
      <div className="mt-2 flex gap-2">
        <input className={`${inputClass} font-mono text-label`} readOnly value={link} onFocus={(e) => e.target.select()} />
        <Button tone="primary" onClick={() => void navigator.clipboard?.writeText(link).then(() => setCopied(true))}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button onClick={onDone}>Done</Button>
      </div>
    </div>
  );
}

const when = (iso: string | null): string => (iso ? iso.slice(0, 10) : '—');

export function VendorAdmin({ userName, onSignOut }: { userName: string; onSignOut: () => void }) {
  const [companies, setCompanies] = useState<CompanySummary[] | null>(null);
  const [people, setPeople] = useState<People | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<{ email: string; link: string } | null>(null);
  /** A company being set up: its settings take the window. */
  const [inside, setInside] = useState<CompanySummary | null>(null);

  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [adminEmail, setAdminEmail] = useState('');
  const [vendorEmail, setVendorEmail] = useState('');

  const refresh = useCallback(
    () => Promise.all([api.vendor.companies().then(setCompanies), api.vendor.people().then(setPeople)]),
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
        adminEmail: adminEmail.trim(),
      });
      if (made.link) setLink({ email: adminEmail.trim(), link: made.link });
      setSlug('');
      setName('');
      setAdminEmail('');
    }, 'Made. Its folder is ready for a brand and prices.');

  if (inside) {
    return (
      <Admin
        base={api.vendor.adminBase(inside.slug)}
        companyName={inside.name}
        selfId={null}
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
          {link && <LinkToSend email={link.email} link={link.link} onDone={() => setLink(null)} />}

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
                <Field label="First administrator's email" hint="Optional now; can be invited later from inside the company.">
                  <TextInput value={adminEmail} onChange={setAdminEmail} placeholder="boss@northgate.example" disabled={busy} />
                </Field>
              </div>
              <div className="mt-3">
                <Button tone="primary" disabled={busy || slug.trim() === '' || name.trim() === ''} onClick={create}>
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
                      setLink({ email: vendorEmail.trim(), link: made.link });
                      setVendorEmail('');
                    })
                  }
                >
                  Invite
                </Button>
              </div>
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
  return (
    <tr className={`border-t border-line-soft ${suspended ? 'text-ink-faint' : ''}`}>
      <td className="py-1.5 pr-2">
        <div className="font-medium">{company.name}</div>
        <div className="text-label text-ink-soft">
          {company.slug} · {company.timezone}
          {suspended && ' · suspended'}
        </div>
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
          {suspended ? (
            <Button size="sm" disabled={busy} onClick={() => run(() => api.vendor.resume(company.slug), `${company.name} is active again.`)}>
              Resume
            </Button>
          ) : (
            <Button
              size="sm"
              tone="danger"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Suspend ${company.name}? Everyone in it is signed out and cannot sign in until it is resumed.`)) {
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
