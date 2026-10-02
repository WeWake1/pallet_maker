import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { InvitationOffer, Session } from './api.js';
import { api } from './api.js';
import { GlassButton, GlassPane } from './Glass.jsx';
import { Wordmark } from './Wordmark.jsx';

// Its own chunk, and gsap with it: somebody already signed in — nearly
// everybody, nearly always — never downloads either.
const DotGrid = lazy(() => import('./DotGrid.jsx'));

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

/**
 * The door is the one screen everybody sees before they see anybody's name
 * on anything, so it is where the service says whose it is. It is seen once a
 * month or so — a session lasts that long — so it never stands between
 * somebody and a day's work.
 */
function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="relative flex h-full items-center justify-center overflow-hidden bg-ground-soft px-4">
      <Suspense fallback={null}>
        <DotGrid />
      </Suspense>
      <div className="relative w-full max-w-sm">
        <div className="mb-8">
          <Wordmark size="lg" />
        </div>
        <GlassPane className="p-7">
          <h1 className="text-title font-semibold tracking-tight text-ink">{title}</h1>
          {children}
        </GlassPane>
      </div>
    </div>
  );
}

function Problem({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 rounded-xl border border-red-200 bg-red-50/85 px-3 py-2 text-ui text-red-700">
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
      <p className="mt-1 text-ui text-ink-soft">Pallet specification sheets, drawn and printed.</p>
      {/* A real form, so a password manager fills it and the enter key works. */}
      <form className="mt-6 flex flex-col gap-3" onSubmit={submit}>
        <label className="flex flex-col gap-1">
          <span className="text-label text-ink-soft">Email</span>
          <input
            ref={first}
            className="glass-field"
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
            className="glass-field"
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            disabled={busy}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <div className="mt-2">
          <GlassButton tone="primary" disabled={busy || email.trim() === '' || password === ''} submit>
            {busy ? 'Signing in…' : 'Sign in'}
          </GlassButton>
        </div>
      </form>
      {problem && <Problem>{problem}</Problem>}
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
          <GlassButton onClick={giveUp}>Go to the sign-in screen</GlassButton>
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
              className="glass-field"
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
            className="glass-field"
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
            className="glass-field"
            type="password"
            autoComplete="new-password"
            value={again}
            disabled={busy}
            onChange={(event) => setAgain(event.target.value)}
          />
        </label>
        {mismatch && <p className="text-label text-red-600">Those two do not match.</p>}
        <div className="mt-2">
          <GlassButton tone="primary" disabled={busy || password.length < 10 || mismatch || again === ''} submit>
            {busy ? 'Setting up…' : offer.kind === 'reset' ? 'Set the password' : 'Set up and sign in'}
          </GlassButton>
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
