import type { Session, StoreStatus } from './api.js';
import { Button } from './ui.jsx';

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
 * Whose designs these are, and the way out.
 *
 * The company is named on every screen rather than only at sign-in: somebody
 * who looks after two of them should never have to wonder which one they are
 * in before they press save.
 */
export function TopBar({
  status,
  session,
  busy,
  onSignOut,
  onSettings,
}: {
  status: StoreStatus;
  /** Who is signed in, where anybody has to be. */
  session: Session | null;
  busy: boolean;
  onSignOut: () => void;
  /** Present for an administrator, who may look after who is in the company. */
  onSettings: (() => void) | null;
}) {
  return (
    <>
      {/* A sheet going to a customer under the wrong name, or under none, is
          a failure worth saying out loud and leaving said. */}
      {status.brandProblem && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-label text-amber-900">
          <strong className="font-semibold">Branding:</strong> {status.brandProblem}
        </div>
      )}
      <div className="flex items-center gap-2 border-b border-line bg-ground-soft px-4 py-1.5">
        {session?.company ? (
          <span className="font-medium text-label text-ink">{session.company.name}</span>
        ) : (
          // Run locally there is no company and no door; the folder in use is
          // what there is to say.
          <span className="truncate font-mono text-label text-ink-soft" title={status.root ?? ''}>
            {status.root}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {onSettings && (
            <button
              type="button"
              disabled={busy}
              onClick={onSettings}
              className="text-label text-ink-soft underline underline-offset-2 hover:text-ink disabled:opacity-40"
            >
              People
            </button>
          )}
          {session?.user && (
            <span className="text-label text-ink-soft" title={session.user.email}>
              {session.user.name || session.user.email}
            </span>
          )}
          {session?.signInRequired && (
            <button
              type="button"
              disabled={busy}
              onClick={onSignOut}
              className="text-label text-ink-soft underline underline-offset-2 hover:text-ink disabled:opacity-40"
            >
              Sign out
            </button>
          )}
          {/* People update at their own pace, so a bug report is much easier to
              place when the screen it was seen on says which build it was. */}
          {status.version && (
            <span className="text-label text-ink-faint" title="Which version of the app this is">
              v{status.version}
            </span>
          )}
        </span>
      </div>
    </>
  );
}
