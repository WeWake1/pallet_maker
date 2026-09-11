import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { InvitationOffer, Session } from './api.js';
import { api } from './api.js';
import { Button, inputClass } from './ui.jsx';

/**
 * The door, from this side.
 *
 * Two screens, and they are the same screen twice: one for somebody who has a
 * password, one for somebody who has a link and is about to choose one. Both
 * are the whole window rather than a panel on the library, because until one
 * of them is answered there is no library — not an empty one, not a greyed-out
 * one. What is behind this is another company's work.
 */

/** Where an invitation link lands: `#/invitation/<token>`. */
export function invitationTokenInHash(hash: string): string | null {
  const match = /^#\/invitation\/(.+)$/.exec(hash);
  return match ? decodeURIComponent(match[1]!) : null;
}

/** Take the token out of the address bar once it has been used or given up on. */
function clearHash(): void {
  if (typeof window === 'undefined') return;
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
}

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center bg-ground-soft px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-title font-semibold tracking-tight text-ink">{title}</h1>
        {children}
      </div>
    </div>
  );
}

function Problem({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 rounded-card border border-red-200 bg-red-50 px-3 py-2 text-ui text-red-700">
      {children}
    </div>
  );
}

export function SignIn({ onSignedIn }: { onSignedIn: (session: Session) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setProblem(null);
    api
      .signIn(email.trim(), password)
      .then(onSignedIn)
      .catch((error: unknown) => {
        setProblem(error instanceof Error ? error.message : String(error));
        setPassword('');
      })
      .finally(() => setBusy(false));
  };

  return (
    <Frame title="Sign in">
      <p className="mt-2 text-ui text-ink-soft">Pallet specification sheets.</p>
      {/* A real form, so a password manager fills it and the enter key works. */}
      <form className="mt-6 flex flex-col gap-3" onSubmit={submit}>
        <label className="flex flex-col gap-1">
          <span className="text-label text-ink-soft">Email</span>
          <input
            ref={first}
            className={inputClass}
            type="email"
            name="email"
            autoComplete="username"
            value={email}
            disabled={busy}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-label text-ink-soft">Password</span>
          <input
            className={inputClass}
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            disabled={busy}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <div className="mt-1">
          <Button tone="primary" disabled={busy || email.trim() === '' || password === ''} submit>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </div>
      </form>
      {problem && <Problem>{problem}</Problem>}
      <p className="mt-6 text-label leading-relaxed text-ink-faint">
        Accounts are made by invitation. If you have lost your password, ask whoever looks after
        this for a new link — there is no password for anyone else to read out.
      </p>
    </Frame>
  );
}

/**
 * The other half: somebody following a link, choosing the password they will
 * use from then on.
 *
 * Nobody else ever knows it, which is the point of doing it this way rather
 * than having an administrator type one in and pass it along.
 */
export function AcceptInvitation({
  token,
  onSignedIn,
  onGiveUp,
}: {
  token: string;
  onSignedIn: (session: Session) => void;
  onGiveUp: () => void;
}) {
  const [offer, setOffer] = useState<InvitationOffer | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .invitation(token)
      .then(setOffer)
      .catch((error: unknown) => setProblem(error instanceof Error ? error.message : String(error)));
  }, [token]);

  const giveUp = () => {
    clearHash();
    onGiveUp();
  };

  if (problem && !offer) {
    return (
      <Frame title="That link does not work">
        <Problem>{problem}</Problem>
        <div className="mt-4">
          <Button onClick={giveUp}>Go to the sign-in screen</Button>
        </div>
      </Frame>
    );
  }

  if (!offer) return <Frame title="One moment…">{null}</Frame>;

  const mismatch = again !== '' && password !== again;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy || mismatch) return;
    setBusy(true);
    setProblem(null);
    api
      .acceptInvitation(token, name.trim(), password)
      .then((session) => {
        clearHash();
        onSignedIn(session);
      })
      .catch((error: unknown) => {
        setProblem(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setBusy(false));
  };

  return (
    <Frame title={offer.kind === 'reset' ? 'Choose a new password' : 'Set up your account'}>
      <p className="mt-2 text-ui text-ink-soft">
        {offer.companyName ? `${offer.companyName} · ` : ''}
        {offer.email}
      </p>
      <form className="mt-6 flex flex-col gap-3" onSubmit={submit}>
        {!offer.returning && (
          <label className="flex flex-col gap-1">
            <span className="text-label text-ink-soft">Your name</span>
            <input
              className={inputClass}
              type="text"
              autoComplete="name"
              value={name}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span className="text-label text-ink-soft">Password</span>
          <input
            className={inputClass}
            type="password"
            autoComplete="new-password"
            value={password}
            disabled={busy}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-label text-ink-soft">And again</span>
          <input
            className={inputClass}
            type="password"
            autoComplete="new-password"
            value={again}
            disabled={busy}
            onChange={(event) => setAgain(event.target.value)}
          />
        </label>
        {mismatch && <p className="text-label text-red-600">Those two do not match.</p>}
        <div className="mt-1">
          <Button tone="primary" disabled={busy || password.length < 10 || mismatch || again === ''} submit>
            {busy ? 'Setting up…' : offer.kind === 'reset' ? 'Set the password' : 'Set up and sign in'}
          </Button>
        </div>
      </form>
      {problem && <Problem>{problem}</Problem>}
      <p className="mt-6 text-label leading-relaxed text-ink-faint">
        At least 10 characters. Nobody else ever sees it, so make it one you will not have to
        write down.
      </p>
    </Frame>
  );
}
