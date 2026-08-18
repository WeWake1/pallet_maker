import { useState } from 'react';
import type { StoreStatus } from './api.js';
import { Button, TextInput } from './ui.jsx';

/**
 * Where the designs are kept.
 *
 * The folder is meant to be one a sync client watches, so that several people
 * pointed at the same shared folder are working on the same designs. Which
 * folder that is has to be said per machine: Drive mounts somewhere different
 * on each of them, so this is the one setting that cannot travel with the
 * designs themselves.
 */

/**
 * The screen shown instead of the library when the designs cannot be reached.
 *
 * It says where the tool looked and what it found, because the usual cause is
 * outside this program — Drive not started yet, the folder renamed, a disk
 * unplugged — and knowing the path is most of knowing what to do. Nothing here
 * makes a folder unless it is asked to: an empty library shown in place of a
 * real one is how somebody comes to redraw designs that were never lost.
 */
export function StoreSetup({
  status,
  busy,
  onUse,
  onBrowse,
  onRetry,
}: {
  status: StoreStatus;
  busy: boolean;
  onUse: (root: string) => void;
  /** Present only in the app, where there is a dialog to open. */
  onBrowse: (() => void) | null;
  onRetry: () => void;
}) {
  const [typed, setTyped] = useState(status.root ?? '');
  const first = status.root === null;

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-title font-semibold tracking-tight text-ink">
        {first ? 'Where should the designs be kept?' : 'The designs folder cannot be reached'}
      </h1>

      {first ? (
        <p className="mt-3 text-ui text-ink-soft">
          Choose the folder to keep designs in. To share them with the rest of the team, use a
          folder that Google Drive syncs, and have everyone else point at the same one.
        </p>
      ) : (
        <>
          <p className="mt-3 text-ui text-ink-soft">
            Nothing has been lost. The designs are wherever they were — this copy of the tool
            simply cannot see the folder it was told to use.
          </p>
          <div className="mt-4 rounded-card border border-line-soft bg-card px-3 py-2.5">
            <div className="text-label text-ink-soft">Looking in</div>
            <div className="mt-0.5 break-all font-mono text-ui text-ink">{status.root}</div>
            {status.problem && (
              <div className="mt-1.5 text-ui text-red-600">{status.problem}</div>
            )}
          </div>
          <p className="mt-4 text-ui text-ink-soft">
            The usual causes are Google Drive not having started yet, the folder having been
            renamed or moved, or a drive that is not plugged in. If Drive is still starting, wait
            a moment and look again.
          </p>
          <div className="mt-3">
            <Button disabled={busy} onClick={onRetry}>
              Look again
            </Button>
          </div>
        </>
      )}

      <div className="mt-8 border-t border-line pt-6">
        <div className="text-label text-ink-soft">
          {first ? 'Folder' : 'Or use a different folder'}
        </div>

        {/* In the app this is the whole of it: a dialog knows the difference
            between a folder that exists and a path with a typo in it. The typed
            box below stays for a browser tab, which has no dialog to open. */}
        {onBrowse && (
          <div className="mt-1.5">
            <Button tone="primary" disabled={busy} onClick={onBrowse}>
              Choose folder…
            </Button>
          </div>
        )}

        <div className={`flex gap-2 ${onBrowse ? 'mt-3' : 'mt-1.5'}`}>
          <div className="flex-1">
            <TextInput
              value={typed}
              onChange={setTyped}
              disabled={busy}
              placeholder="/Users/you/Google Drive/Pallet designs"
            />
          </div>
          <Button
            tone={onBrowse ? 'plain' : 'primary'}
            disabled={busy || typed.trim() === ''}
            onClick={() => onUse(typed.trim())}
          >
            Use this folder
          </Button>
        </div>
        <p className="mt-1.5 text-label text-ink-faint">
          The folder is made if it is not there. An empty folder starts a new library; one that
          already holds designs opens them.
        </p>

        {status.source === 'environment' && (
          <p className="mt-3 text-ui text-red-600">
            PALLET_STORE is set, and it decides the folder. Unset it to choose one here.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The folder in use, on the library screen.
 *
 * Worth a line of its own because the designs are shared: which folder this is
 * decides whose work you are looking at, and getting it wrong is quiet — the
 * library simply looks emptier than it should.
 */
export function StoreFolderBar({
  status,
  busy,
  onChange,
}: {
  status: StoreStatus;
  busy: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-line bg-ground-soft px-4 py-1.5">
      <span className="text-label text-ink-soft">Designs folder</span>
      <span className="truncate font-mono text-label text-ink" title={status.root ?? ''}>
        {status.root}
      </span>
      {status.source === 'environment' && (
        <span className="text-label text-ink-soft">(set by PALLET_STORE)</span>
      )}
      <button
        type="button"
        disabled={busy || status.source === 'environment'}
        onClick={onChange}
        className="ml-auto text-label text-ink-soft underline underline-offset-2 hover:text-ink disabled:opacity-40"
      >
        Change
      </button>
    </div>
  );
}
