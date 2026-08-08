import { useMemo, useRef, useState } from 'react';
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
 *
 * A card carries what is most often wanted of a design that is not being
 * changed — its sheet, a copy of it, the design itself as a file, and its
 * removal — so that none of them needs the editor opened first.
 */

/**
 * How the cards are ordered within a client.
 *
 * The store stamps a date, not a time, so "recently edited" can only sort to
 * the day; designs saved on the same day fall back to their code, which is the
 * order the library had before there was a choice.
 */
export type SortOrder = 'recent' | 'name';

const SORTS: Array<[SortOrder, string]> = [
  ['recent', 'Recently edited'],
  ['name', 'Code and name'],
];

export interface DesignActions {
  onOpen: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (design: PalletSummary) => void;
  onSheet: (id: string) => void;
  /** Download the design itself, as a file that can be opened again. */
  onExport: (id: string) => void;
}

/** True where the design answers to what has been typed in the search box. */
function matches(design: PalletSummary, needle: string): boolean {
  if (needle === '') return true;
  return `${design.palletName} ${design.palletCode} ${design.clientName}`
    .toLowerCase()
    .includes(needle);
}

function sorted(designs: PalletSummary[], order: SortOrder): PalletSummary[] {
  if (order === 'name') return designs;
  return [...designs].sort(
    (a, b) =>
      b.updatedAt.localeCompare(a.updatedAt) ||
      a.palletCode.localeCompare(b.palletCode) ||
      a.palletName.localeCompare(b.palletName),
  );
}

/**
 * The sections as they are to be shown.
 *
 * Searching narrows each client to the designs that answer, and drops the
 * clients left with none — a search that left every empty client on screen
 * would bury the handful that matched. With nothing typed every client stays,
 * including one with no designs at all, which is the point of a client being a
 * record of their own.
 */
export function visibleSections(
  sections: ClientDesigns[],
  search: string,
  order: SortOrder,
): ClientDesigns[] {
  const needle = search.trim().toLowerCase();
  const narrowed = sections.map((section) => ({
    client: section.client,
    designs: sorted(section.designs.filter((design) => matches(design, needle)), order),
  }));
  return needle === '' ? narrowed : narrowed.filter((section) => section.designs.length > 0);
}

export function Dashboard({
  sections,
  drafts,
  busy,
  actions,
  onOpenDraft,
  onDiscardDraft,
  onCreate,
  onAddClient,
  onRenameClient,
  onRemoveClient,
  onImportDesign,
}: {
  sections: ClientDesigns[];
  drafts: Draft[];
  busy: boolean;
  actions: DesignActions;
  onOpenDraft: (draft: Draft) => void;
  onDiscardDraft: (id: string) => void;
  onCreate: (clientId: string) => void;
  onAddClient: (name: string) => void;
  onRenameClient: (id: string, name: string) => void;
  onRemoveClient: (id: string) => void;
  onImportDesign: (clientId: string, file: File) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState('');
  const [order, setOrder] = useState<SortOrder>('recent');

  const needle = search.trim().toLowerCase();
  const searching = needle !== '';

  // Which designs the store actually holds. A draft for one of them is a card
  // that says "unsaved changes"; a draft for anything else is a card of its own.
  const held = useMemo(
    () => new Set(sections.flatMap((section) => section.designs.map((design) => design.id))),
    [sections],
  );

  const shown = useMemo(
    () => visibleSections(sections, search, order),
    [sections, search, order],
  );

  const total = shown.reduce((count, section) => count + section.designs.length, 0);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-slate-100">
      <div className="mx-auto max-w-6xl p-5">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold text-slate-800">Designs</h2>
          <span className="text-xs text-slate-500">
            {searching
              ? `${total} matching`
              : `${total} across ${shown.length} ${shown.length === 1 ? 'client' : 'clients'}`}
          </span>
          {drafts.length > 0 && !searching && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
              {drafts.length} with unsaved work
            </span>
          )}

          <div className="ml-auto flex items-center gap-2">
            <input
              type="search"
              value={search}
              placeholder="Search name, code or client"
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setSearch('');
              }}
              className="w-56 rounded border border-slate-300 bg-white px-2 py-1 text-sm
                         focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <select
              value={order}
              onChange={(event) => setOrder(event.target.value as SortOrder)}
              title="How designs are ordered within each client"
              className="rounded border border-slate-300 bg-white px-1.5 py-1 text-sm"
            >
              {SORTS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
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
        ) : shown.length === 0 ? (
          <p className="rounded border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
            Nothing matches “{search.trim()}”.
          </p>
        ) : (
          <div className="space-y-6">
            {shown.map((section) => (
              <ClientSection
                key={section.client.id}
                section={section}
                drafts={
                  searching
                    ? []
                    : drafts.filter((draft) => draft.pallet.clientId === section.client.id)
                }
                held={held}
                busy={busy}
                searching={searching}
                actions={actions}
                onOpenDraft={onOpenDraft}
                onDiscardDraft={onDiscardDraft}
                onCreate={onCreate}
                onRename={onRenameClient}
                onRemove={onRemoveClient}
                onImportDesign={onImportDesign}
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
  searching,
  actions,
  onOpenDraft,
  onDiscardDraft,
  onCreate,
  onRename,
  onRemove,
  onImportDesign,
}: {
  section: ClientDesigns;
  drafts: Draft[];
  held: ReadonlySet<string>;
  busy: boolean;
  /** A search is on, so this section is a result rather than the whole client. */
  searching: boolean;
  actions: DesignActions;
  onOpenDraft: (draft: Draft) => void;
  onDiscardDraft: (id: string) => void;
  onCreate: (clientId: string) => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
  onImportDesign: (clientId: string, file: File) => void;
}) {
  const { client, designs } = section;
  const [renaming, setRenaming] = useState(false);
  const designFile = useRef<HTMLInputElement>(null);

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
            {/* Deleting a client takes their designs with them, and while a
                search is on this section shows only some of them. Counting off
                what would go is the whole warning, so it is not offered from a
                screen that is not showing all of it. */}
            {!searching && (
              <div className="ml-auto flex gap-1">
                {/* Importing belongs to a client rather than to the library as a
                    whole, because whose design it is has to be settled by the
                    person importing it — the file cannot be trusted to say. */}
                <Button
                  disabled={busy}
                  onClick={() => designFile.current?.click()}
                  title={`Add a design from a .json file to ${client.name}`}
                >
                  Import
                </Button>
                <input
                  ref={designFile}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) onImportDesign(client.id, file);
                    // Cleared so that the same file picked twice running still
                    // counts as a change and still imports.
                    event.target.value = '';
                  }}
                />
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
            )}
          </>
        )}
      </header>

      <div className="flex flex-wrap gap-2.5">
        {designs.map((design) => (
          <DesignCard
            key={design.id}
            design={design}
            unsaved={unsaved.has(design.id)}
            busy={busy}
            actions={actions}
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
        {!searching && (
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
        )}
      </div>
    </section>
  );
}

/**
 * A small square button in the card's action row. Deliberately plain and always
 * visible: a control that only appears on hover is one nobody finds, and this
 * screen is read as much as it is pointed at.
 */
function CardAction({
  label,
  title,
  danger,
  disabled,
  onClick,
}: {
  label: string;
  title: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`rounded px-1 py-0.5 text-[11px] leading-none disabled:opacity-40 ${
        danger
          ? 'text-slate-400 hover:bg-red-50 hover:text-red-600'
          : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'
      }`}
    >
      {label}
    </button>
  );
}

function DesignCard({
  design,
  unsaved,
  busy,
  actions,
}: {
  design: PalletSummary;
  /** The browser is holding changes to this design that the store has not got. */
  unsaved: boolean;
  busy: boolean;
  actions: DesignActions;
}) {
  const name = design.palletName || 'Untitled';

  return (
    <div
      className={`flex h-28 w-44 flex-col rounded border bg-white hover:shadow-sm ${
        unsaved ? 'border-amber-400' : 'border-slate-300'
      }`}
    >
      <button
        type="button"
        onClick={() => actions.onOpen(design.id)}
        title={unsaved ? 'Has changes that were never saved. Opening it picks them up.' : `Open ${name}`}
        className="flex min-h-0 flex-1 flex-col p-2.5 pb-0 text-left"
      >
        <span className="truncate text-sm font-medium text-slate-800">{name}</span>
        <span className="truncate text-xs text-slate-500">{design.palletCode || 'no code'}</span>
        {/* The date reads with the design rather than with the buttons: it is
            something the card says, not something the card does, and the row
            below has only as much room as four actions need. */}
        <span className="mt-auto flex items-center gap-1.5 text-[11px]">
          <span className="whitespace-nowrap tabular-nums text-slate-400">{design.updatedAt}</span>
          {unsaved && <span className="font-medium text-amber-700">unsaved</span>}
        </span>
      </button>

      {/* What is most often wanted of a design that is not being changed: its
          sheet, a copy of it, the design itself as a file, or its removal. */}
      <div className="flex items-center justify-end gap-0.5 px-1.5 pb-1">
        <CardAction
          label="PDF"
          title={`Open the sheet for ${name}`}
          disabled={busy}
          onClick={() => actions.onSheet(design.id)}
        />
        <CardAction
          label="Copy"
          title={
            'A copy, opened as a new design. This is how an old design is kept ' +
            'before reworking it — name one of the two “… (old)”.'
          }
          disabled={busy}
          onClick={() => actions.onDuplicate(design.id)}
        />
        <CardAction
          label="JSON"
          title={
            `Download ${name} as a file. Unlike the PDF this is the design ` +
            'itself, so it can be imported again here or on another computer.'
          }
          disabled={busy}
          onClick={() => actions.onExport(design.id)}
        />
        <CardAction
          label="×"
          title={`Delete ${name}`}
          danger
          disabled={busy}
          onClick={() => {
            // Saving overwrites and nothing keeps a previous version, so a
            // deleted design is gone. Name it, so the wrong card is not the
            // one confirmed.
            if (window.confirm(`Delete ${name}? This cannot be undone.`)) actions.onDelete(design);
          }}
        />
      </div>
    </div>
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
