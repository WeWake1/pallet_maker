import type { ReactNode } from 'react';
import type { Session, StoreStatus } from './api.js';
import { Button, Icon, Menu, MenuItem } from './ui.jsx';
import { Wordmark } from './Wordmark.jsx';

/**
 * The two things every library screen carries: who you are, and whether the
 * designs can be reached at all.
 *
 * Where the designs are kept is the server's business. It is settled when the
 * server starts and nobody moves it from a browser, so neither of these
 * offers a path to type — what is left is saying plainly when the folder
 * cannot be reached, and who to tell.
 */

/**
 * The screen shown instead of the library when the designs cannot be reached.
 *
 * Nothing here makes a folder. An empty library shown in place of a real one
 * is how somebody comes to redraw designs that were never lost, so this says
 * what is wrong and offers to look again, and does nothing else.
 */
export function StoreUnreachable({
  status,
  busy,
  onRetry,
}: {
  status: StoreStatus;
  busy: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-title font-semibold tracking-tight text-ink">
        The designs cannot be reached right now
      </h1>
      <p className="mt-3 text-ui text-ink-soft">
        Nothing has been lost. The server cannot see the folder it keeps the designs in — usually
        a disk or a mount — and whoever looks after the server needs to know.
      </p>
      {status.problem && (
        <div className="mt-4 rounded-card border border-line-soft bg-card px-3 py-2.5 text-ui text-red-600">
          {status.problem}
        </div>
      )}
      {/* Run locally the path is the reader's own machine, and worth showing. */}
      {status.root && (
        <div className="mt-3 rounded-card border border-line-soft bg-card px-3 py-2.5">
          <div className="text-label text-ink-soft">Looking in</div>
          <div className="mt-0.5 break-all font-mono text-ui text-ink">{status.root}</div>
        </div>
      )}
      <div className="mt-4">
        <Button disabled={busy} onClick={onRetry}>
          Look again
        </Button>
      </div>
    </div>
  );
}

/**
 * How long a trial has left, beside the company's name, so the end of it is
 * never a surprise at the sign-in screen. A company with no end date shows
 * nothing.
 */
function TrialNote({ accessUntil }: { accessUntil: string | null }) {
  if (accessUntil === null) return null;
  const left = Math.ceil((Date.parse(accessUntil) - Date.now()) / (24 * 60 * 60 * 1000));
  if (left < 1) return null;
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-px text-micro font-medium ${left <= 2 ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'}`}
      title={`Trial access ends ${new Date(accessUntil).toLocaleString()}`}
    >
      Trial · {left} day{left === 1 ? '' : 's'} left
    </span>
  );
}

/** "AP" for Ambica Patterns, "AD" for admin@… — two letters, never empty. */
function initials(name: string): string {
  const words = name.replace(/@.*$/, '').split(/[\s._-]+/).filter(Boolean);
  const letters =
    words.length >= 2 ? `${words[0]![0]}${words[1]![0]}` : (words[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}

/**
 * Who is signed in, as the one thing at the right-hand end of the bar.
 *
 * The name, the way out and the build number used to sit in a row of their
 * own above the header, at one weight, as three loose words. They are things
 * looked at now and then — who am I signed in as, which version is this —
 * and never while working, so they fold into the one button every web app
 * puts there, and the row they took goes back to the screen.
 */
export function AccountMenu({
  name,
  email,
  version,
  busy,
  onSignOut,
}: {
  name: string;
  email: string;
  /** Said at the foot of the list, for a bug report to quote. */
  version?: string | null;
  busy?: boolean;
  onSignOut: () => void;
}) {
  return (
    <Menu
      tone="subtle"
      width="sm"
      title={`Signed in as ${email}`}
      label={
        <span className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-800 text-[10px] font-semibold tracking-wide text-white"
          >
            {initials(name || email)}
          </span>
          <span className="max-w-40 truncate text-ui font-medium text-ink">{name || email}</span>
        </span>
      }
      caret
    >
      {(close) => (
        <>
          <div className="px-3 pb-2 pt-1.5">
            <div className="truncate text-ui font-medium text-ink">{name || email}</div>
            {name && <div className="truncate text-label text-ink-faint">{email}</div>}
          </div>
          <div className="border-t border-line-soft pt-1">
            <MenuItem
              disabled={busy}
              onClick={() => {
                close();
                onSignOut();
              }}
            >
              <span className="flex items-center gap-2">
                <Icon name="signOut" size={14} className="text-ink-faint" />
                Sign out
              </span>
            </MenuItem>
          </div>
          {version && (
            <div className="mt-1 border-t border-line-soft px-3 pb-1 pt-2 text-micro text-ink-faint">
              Version {version}
            </div>
          )}
        </>
      )}
    </Menu>
  );
}

/**
 * The bar across the top of the library: whose it is on the left, the way
 * out on the right, and between them whatever the screen itself offers.
 *
 * The company is named on every screen rather than only at sign-in: somebody
 * who looks after two of them should never have to wonder which one they are
 * in before they press save. It sits beside the service's own name, the way a
 * workspace does in any tool that has more than one.
 */
export function TopBar({
  status,
  session,
  busy,
  onSignOut,
  children,
}: {
  status: StoreStatus;
  /** Who is signed in, where anybody has to be. */
  session: Session | null;
  busy: boolean;
  onSignOut: () => void;
  /** What this screen offers, ahead of the account at the far end. */
  children?: ReactNode;
}) {
  const user = session?.user ?? null;
  return (
    <>
      {/* A sheet going to a customer under the wrong name, or under none, is
          a failure worth saying out loud and leaving said. */}
      {status.brandProblem && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-label text-amber-900">
          <strong className="font-semibold">Branding:</strong> {status.brandProblem}
        </div>
      )}
      <header className="flex h-13 items-center gap-3 border-b border-line bg-card px-4">
        <h1 className="shrink-0">
          <Wordmark />
        </h1>
        {session?.company ? (
          <>
            <span aria-hidden="true" className="h-5 w-px shrink-0 bg-line" />
            <span className="truncate text-ui font-medium text-ink-soft">{session.company.name}</span>
            <TrialNote accessUntil={session.company.accessUntil} />
          </>
        ) : (
          // Run locally there is no company and no door; the folder in use is
          // what there is to say.
          status.root && (
            <>
              <span aria-hidden="true" className="h-5 w-px shrink-0 bg-line" />
              <span className="truncate font-mono text-label text-ink-faint" title={status.root}>
                {status.root}
              </span>
            </>
          )
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {children}
          {user && session?.signInRequired ? (
            <>
              <span aria-hidden="true" className="mx-1 h-5 w-px bg-line" />
              <AccountMenu
                name={user.name}
                email={user.email}
                version={status.version}
                busy={busy}
                onSignOut={onSignOut}
              />
            </>
          ) : (
            // People update at their own pace, so a bug report is much easier
            // to place when the screen it was seen on says which build it was.
            status.version && (
              <span className="ml-1 text-label text-ink-faint" title="Which version of the app this is">
                v{status.version}
              </span>
            )
          )}
        </div>
      </header>
    </>
  );
}
