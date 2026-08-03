import { useMemo, useState } from 'react';
import type { ClientDesigns, PalletSummary } from './api.js';
import { draftAge } from './drafts.js';
import type { Draft } from './drafts.js';
import { Button } from './ui.jsx';

/**
 * The design library: every client in turn, each with their designs as cards.
 *
 * This is the home screen and the only place designs are found. There is no
 * history to search — a design is one row that gets overwritten — so a client,
 * a name and a date is the whole of what there is to look through.
 *
 * Work the store has never seen appears here too. A design that was being drawn
 * when the browser closed has no row to be a card of, so its draft is shown as
 * one; without that the only copy of an afternoon's work would be somewhere
 * nothing on this screen could reach.
 */
export function Dashboard({
  sections,
  drafts,
  busy,
  onOpen,
  onOpenDraft,
  onDiscardDraft,
  onCreate,
  onAddClient,
  onRenameClient,
  onRemoveClient,
}: {
  sections: ClientDesigns[];
  drafts: Draft[];
  busy: boolean;
  onOpen: (id: string) => void;
  onOpenDraft: (draft: Draft) => void;
  onDiscardDraft: (id: string) => void;
  onCreate: (clientId: string) => void;
  onAddClient: (name: string) => void;
  onRenameClient: (id: string, name: string) => void;
  onRemoveClient: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);

  // Which designs the store actually holds. A draft for one of them is a card
  // that says "unsaved changes"; a draft for anything else is a card of its own.
  const held = useMemo(
    () => new Set(sections.flatMap((section) => section.designs.map((design) => design.id))),
    [sections],
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-slate-100">
      <div className="mx-auto max-w-6xl p-5">
        <div className="mb-4 flex items-center gap-3">
          <h2 className="text-lg font-semibold text-slate-800">Designs</h2>
          <span className="text-xs text-slate-500">
            {sections.reduce((total, section) => total + section.designs.length, 0)} across{' '}
            {sections.length} {sections.length === 1 ? 'client' : 'clients'}
          </span>
          {drafts.length > 0 && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
              {drafts.length} with unsaved work
            </span>
          )}
          <div className="ml-auto">
            {adding ? (
              <NameEntry
                placeholder="Client name"
                onCancel={() => setAdding(false)}
                onSubmit={(name) => {
                  onAddClient(name);
                  setAdding(false);
                }}
              />
            ) : (
              <Button tone="primary" disabled={busy} onClick={() => setAdding(true)}>
                + Client
              </Button>
            )}
          </div>
        </div>

        {sections.length === 0 ? (
          <p className="rounded border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
            No clients yet. Add one to start a design.
          </p>
        ) : (
          <div className="space-y-6">
            {sections.map((section) => (
              <ClientSection
                key={section.client.id}
                section={section}
                drafts={drafts.filter((draft) => draft.pallet.clientId === section.client.id)}
                held={held}
                busy={busy}
                onOpen={onOpen}
                onOpenDraft={onOpenDraft}
                onDiscardDraft={onDiscardDraft}
                onCreate={onCreate}
                onRename={onRenameClient}
                onRemove={onRemoveClient}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** One horizontal band: the client's name, then their designs, then a blank card. */
function ClientSection({
  section,
  drafts,
  held,
  busy,
  onOpen,
  onOpenDraft,
  onDiscardDraft,
  onCreate,
  onRename,
  onRemove,
}: {
  section: ClientDesigns;
  drafts: Draft[];
  held: ReadonlySet<string>;
  busy: boolean;
  onOpen: (id: string) => void;
  onOpenDraft: (draft: Draft) => void;
  onDiscardDraft: (id: string) => void;
  onCreate: (clientId: string) => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
}) {
  const { client, designs } = section;
  const [renaming, setRenaming] = useState(false);

  const unsaved = new Set(drafts.map((draft) => draft.pallet.id));
  // A design the store never had. Its draft is the only copy of it anywhere.
  const neverSaved = drafts.filter((draft) => !held.has(draft.pallet.id));

  return (
    <section>
      <header className="mb-2 flex items-center gap-2 border-b border-slate-300 pb-1.5">
        {renaming ? (
          <NameEntry
            initial={client.name}
            placeholder="Client name"
            onCancel={() => setRenaming(false)}
            onSubmit={(name) => {
              onRename(client.id, name);
              setRenaming(false);
            }}
          />
        ) : (
          <>
            <h3 className="text-sm font-semibold text-slate-800">{client.name}</h3>
            <span className="text-xs text-slate-400">
              {designs.length} {designs.length === 1 ? 'design' : 'designs'}
            </span>
            <div className="ml-auto flex gap-1">
              <Button disabled={busy} onClick={() => setRenaming(true)} title="Rename this client">
                Rename
              </Button>
              <Button
                tone="danger"
                disabled={busy}
                title={
                  designs.length > 0
                    ? `Delete ${client.name} and all ${designs.length} of their designs`
                    : `Delete ${client.name}`
                }
                onClick={() => {
                  // Their designs go with them, so say so plainly first.
                  const warning =
                    designs.length > 0
                      ? `Delete ${client.name} and all ${designs.length} of their designs? This cannot be undone.`
                      : `Delete ${client.name}?`;
                  if (window.confirm(warning)) onRemove(client.id);
                }}
              >
                Delete
              </Button>
            </div>
          </>
        )}
      </header>

      <div className="flex flex-wrap gap-2.5">
        {designs.map((design) => (
          <DesignCard
            key={design.id}
            design={design}
            unsaved={unsaved.has(design.id)}
            onOpen={() => onOpen(design.id)}
          />
        ))}
        {neverSaved.map((draft) => (
          <DraftCard
            key={draft.pallet.id}
            draft={draft}
            onOpen={() => onOpenDraft(draft)}
            onDiscard={() => {
              // Nothing else holds this design, so say so before it goes.
              const name = draft.pallet.palletName || 'this design';
              if (window.confirm(`Discard ${name}? It was never saved, so nothing else has it.`)) {
                onDiscardDraft(draft.pallet.id);
              }
            }}
          />
        ))}
        <button
          type="button"
          disabled={busy}
          onClick={() => onCreate(client.id)}
          title={`New design for ${client.name}`}
          className="flex h-28 w-44 flex-col items-center justify-center rounded border-2 border-dashed
                     border-slate-300 bg-white text-slate-400 hover:border-blue-400 hover:text-blue-500
                     disabled:opacity-40"
        >
          <span className="text-2xl leading-none">+</span>
          <span className="mt-1 text-xs">New design</span>
        </button>
      </div>
    </section>
  );
}

function DesignCard({
  design,
  unsaved,
  onOpen,
}: {
  design: PalletSummary;
  /** The browser is holding changes to this design that the store has not got. */
  unsaved: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={unsaved ? 'Has changes that were never saved. Opening it picks them up.' : undefined}
      className={`flex h-28 w-44 flex-col rounded border bg-white p-2.5 text-left hover:shadow-sm ${
        unsaved ? 'border-amber-400 hover:border-amber-500' : 'border-slate-300 hover:border-blue-400'
      }`}
    >
      <span className="truncate text-sm font-medium text-slate-800">
        {design.palletName || 'Untitled'}
      </span>
      <span className="truncate text-xs text-slate-500">{design.palletCode || 'no code'}</span>
      <span className="mt-auto text-[11px] tabular-nums text-slate-400">{design.updatedAt}</span>
      {unsaved && (
        <span className="text-[11px] font-medium text-amber-700">unsaved changes</span>
      )}
    </button>
  );
}

/**
 * A design that was never saved, recovered from this browser. It is a card so
 * that it can be picked up again; it is not a design in the library until it is
 * saved, and it says so.
 */
function DraftCard({
  draft,
  onOpen,
  onDiscard,
}: {
  draft: Draft;
  onOpen: () => void;
  onDiscard: () => void;
}) {
  const { pallet } = draft;
  return (
    <div className="relative flex h-28 w-44 flex-col rounded border border-dashed border-amber-400 bg-amber-50 hover:shadow-sm">
      <button type="button" onClick={onOpen} className="flex flex-1 flex-col p-2.5 text-left">
        <span className="truncate pr-5 text-sm font-medium text-slate-800">
          {pallet.palletName || 'Untitled'}
        </span>
        <span className="truncate text-xs text-slate-500">{pallet.palletCode || 'no code'}</span>
        <span className="mt-auto text-[11px] text-amber-700">never saved</span>
        <span className="text-[11px] text-slate-500">edited {draftAge(draft.at)}</span>
      </button>
      <button
        type="button"
        onClick={onDiscard}
        title="Discard this recovered design"
        className="absolute right-1 top-1 rounded px-1 text-sm leading-none text-slate-400 hover:bg-amber-100 hover:text-red-600"
      >
        ×
      </button>
    </div>
  );
}

/** A one-field inline form, for naming a client without a dialog. */
function NameEntry({
  initial = '',
  placeholder,
  onSubmit,
  onCancel,
}: {
  initial?: string;
  placeholder: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
  const submit = () => {
    if (name.trim() !== '') onSubmit(name.trim());
    else onCancel();
  };

  return (
    <div className="flex items-center gap-1">
      <input
        autoFocus
        type="text"
        value={name}
        placeholder={placeholder}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') submit();
          if (event.key === 'Escape') onCancel();
        }}
        className="rounded border border-slate-300 bg-white px-1.5 py-1 text-sm
                   focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
      <Button tone="primary" onClick={submit}>
        Save
      </Button>
      <Button onClick={onCancel}>Cancel</Button>
    </div>
  );
}
