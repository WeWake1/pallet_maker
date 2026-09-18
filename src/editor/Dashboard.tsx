import { useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { analysePallet } from '../geometry/layout.js';
import type { ClientDesigns, PalletSummary } from './api.js';
import { draftAge } from './drafts.js';
import type { Draft } from './drafts.js';
import { Thumbnail, useDesignLayout, useInView } from './Thumbnail.jsx';
import { Button, Menu, MenuItem } from './ui.jsx';

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
 *
 * Every card has a picture of its pallet, because "1200 x 800" is what half
 * the cards on the shelf say and the picture is what tells a block pallet
 * from a stringer one at a glance. See Thumbnail.tsx for where it comes from.
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

/**
 * One size for every card in a row — design, recovered draft and the blank one
 * that starts a new design — so the rows stay rows. Tall enough for the
 * picture and, under it, the name, the code and two short lines.
 */
const CARD = 'h-47 w-44';

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
  startingSize,
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
  /** The size a new design opens at, e.g. "1200 × 800", from the company's defaults. */
  startingSize: string;
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
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <h2 className="text-title font-semibold text-ink">Designs</h2>
          <span className="text-label text-ink-faint">
            {searching
              ? `${total} matching`
              : `${total} across ${shown.length} ${shown.length === 1 ? 'client' : 'clients'}`}
          </span>
          {drafts.length > 0 && !searching && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-micro font-medium text-amber-800">
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
              className="w-56 rounded-md border border-line bg-card px-2.5 py-1.5 text-ui shadow-xs
                         transition-colors placeholder:text-slate-400
                         focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-ring/30"
            />
            <select
              value={order}
              onChange={(event) => setOrder(event.target.value as SortOrder)}
              title="How designs are ordered within each client"
              aria-label="How designs are ordered within each client"
              className="rounded-md border border-line bg-card px-2 py-1.5 text-ui shadow-xs
                         focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-ring/30"
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
          /*
            The first thing anyone sees, and it used to be one sentence and a
            button in the far corner. Someone who has never used this does not
            know that a design belongs to a client, or that the client comes
            first — so say it, and put the way of doing it right here.
          */
          <div className="rounded-card border border-line bg-card p-10 text-center shadow-card">
            <h3 className="text-title font-semibold text-ink">Nothing here yet</h3>
            <p className="mx-auto mt-2 max-w-md text-ui leading-relaxed text-ink-soft">
              Every design belongs to a client, so a client comes first. Add one and you can start
              a design straight away — it opens as a complete {startingSize} pallet, ready to have
              its numbers changed.
            </p>
            <div className="mt-5 flex justify-center">
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
                  Add your first client
                </Button>
              )}
            </div>
          </div>
        ) : shown.length === 0 ? (
          <div className="rounded-card border border-dashed border-line bg-card p-10 text-center shadow-card">
            <p className="text-ui text-ink-soft">Nothing matches “{search.trim()}”.</p>
            <div className="mt-4 flex justify-center">
              <Button onClick={() => setSearch('')}>Clear search</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {shown.map((section) => (
              <ClientSection
                startingSize={startingSize}
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
  startingSize,
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
  /** The size a new design opens at, said on the card that starts one. */
  startingSize: string;
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
      <header className="mb-3 flex items-center gap-2 border-b border-line pb-2">
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
            <h3 className="text-key font-semibold text-ink">{client.name}</h3>
            <span className="text-label text-ink-faint">
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
            className={`flex ${CARD} flex-col items-center justify-center rounded-card border-2 border-dashed
                       border-line bg-card px-3 text-center text-ink-faint transition-colors
                       hover:border-accent hover:bg-blue-50/40 hover:text-accent disabled:opacity-40`}
          >
            <span className="text-2xl leading-none">+</span>
            <span className="mt-1 text-label font-medium">New design</span>
            {/* A new design is not an empty one, and someone who has not seen
                that yet has no reason to expect it. */}
            {designs.length === 0 && (
              <span className="mt-1 text-micro leading-tight text-ink-faint">
                starts as a complete {startingSize} pallet
              </span>
            )}
          </button>
        )}
      </div>
    </section>
  );
}

/**
 * One design in the library.
 *
 * The face of the card is what the card says — name, code, date — and opening
 * it is the whole of what the card does when it is clicked. The four other
 * things worth doing to a design without opening it went behind ⋯: as four
 * 11-pixel words in a row they were the loudest thing on a screen of dozens of
 * cards, and `PDF Copy JSON ×` says nothing about what any of them produces.
 */
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
  const card = useRef<HTMLDivElement>(null);
  // The picture is of the design the store holds, which is what the card is
  // a card of; a draft's own changes are seen by opening it.
  const layout = useDesignLayout(design.id, design.fingerprint, useInView(card));
  const [resting, setResting] = useState(false);

  return (
    <div
      ref={card}
      className={`group relative flex ${CARD} flex-col overflow-hidden rounded-card border bg-card shadow-card
                  transition-all hover:-translate-y-0.5 hover:shadow-raised ${
                    unsaved ? 'border-amber-400' : 'border-line'
                  }`}
      // A mouse resting on the card turns the pallet. A finger cannot rest,
      // and a tap that set the pallet turning would leave it turning.
      onPointerEnter={(event) => setResting(event.pointerType === 'mouse')}
      onPointerLeave={() => setResting(false)}
    >
      <button
        type="button"
        onClick={() => actions.onOpen(design.id)}
        title={unsaved ? 'Has changes that were never saved. Opening it picks them up.' : `Open ${name}`}
        className="flex min-h-0 flex-1 flex-col text-left"
      >
        <Thumbnail layout={layout} turning={resting} />
        <CardWords name={name} code={design.palletCode}>
          {/* The date reads with the design rather than with the buttons: it is
              something the card says, not something the card does. */}
          <span className="tabular-nums text-slate-400">{design.updatedAt}</span>
          {unsaved && <span className="font-medium text-amber-700">unsaved</span>}
        </CardWords>
      </button>

      {/* What is most often wanted of a design that is not being changed: its
          sheet, a copy of it, the design itself as a file, or its removal. */}
      <div className="absolute right-1 top-1">
        <Menu label="⋯" tone="subtle" align="right" width="sm" disabled={busy} title={`More for ${name}`}>
          {(close) => (
            <>
              <MenuItem
                onClick={() => {
                  close();
                  actions.onSheet(design.id);
                }}
                note="The sheet, ready to print"
              >
                Open the PDF
              </MenuItem>
              <MenuItem
                onClick={() => {
                  close();
                  actions.onDuplicate(design.id);
                }}
                note="Kept as it is; the copy is what gets reworked"
              >
                Duplicate
              </MenuItem>
              <MenuItem
                onClick={() => {
                  close();
                  actions.onExport(design.id);
                }}
                note="The design itself, to import elsewhere"
              >
                Download as file
              </MenuItem>
              <MenuItem
                tone="danger"
                onClick={() => {
                  close();
                  // Saving overwrites and nothing keeps a previous version, so a
                  // deleted design is gone. Name it, so the wrong card is not the
                  // one confirmed.
                  if (window.confirm(`Delete ${name}? This cannot be undone.`)) {
                    actions.onDelete(design);
                  }
                }}
                note="Cannot be undone"
              >
                Delete
              </MenuItem>
            </>
          )}
        </Menu>
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
  // The design is right here, so there is nothing to fetch.
  const layout = useMemo(() => analysePallet(pallet), [pallet]);
  const [resting, setResting] = useState(false);

  return (
    <div
      className={`relative flex ${CARD} flex-col overflow-hidden rounded-card border border-dashed border-amber-400 bg-amber-50 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-raised`}
      onPointerEnter={(event) => setResting(event.pointerType === 'mouse')}
      onPointerLeave={() => setResting(false)}
    >
      <button type="button" onClick={onOpen} className="flex min-h-0 flex-1 flex-col text-left">
        <Thumbnail layout={layout} turning={resting} />
        <CardWords name={pallet.palletName || 'Untitled'} code={pallet.palletCode}>
          <span className="font-medium text-amber-700">never saved</span>
          <span className="text-ink-faint">edited {draftAge(draft.at)}</span>
        </CardWords>
      </button>
      <button
        type="button"
        onClick={onDiscard}
        aria-label="Discard this recovered design"
        title="Discard this recovered design"
        className="absolute right-1 top-1 rounded px-1 text-ui leading-none text-slate-400 transition-colors hover:bg-amber-100 hover:text-red-600"
      >
        ×
      </button>
    </div>
  );
}

/**
 * What a card says, under its picture: the name, the code, and at the foot
 * the date on a stored design or the state of a recovered one.
 *
 * The foot is a row of short things — a date and "unsaved", or "never saved"
 * and how long ago — that sit together when they fit and go one under the
 * other when they do not, each kept whole.
 */
function CardWords({
  name,
  code,
  children,
}: {
  name: string;
  code: string;
  children: ReactNode;
}) {
  return (
    <span className="flex min-h-0 w-full flex-1 flex-col border-t border-line-soft px-3 pb-2.5 pt-2">
      <span className="truncate text-ui font-semibold text-ink">{name}</span>
      <span className="truncate text-label text-ink-faint">{code || 'no code'}</span>
      <span className="mt-auto flex flex-wrap items-center gap-x-1.5 text-micro whitespace-nowrap">
        {children}
      </span>
    </span>
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
        className="rounded-md border border-line bg-card px-2 py-1.5 text-ui shadow-xs
                   focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-ring/30"
      />
      <Button tone="primary" onClick={submit}>
        Save
      </Button>
      <Button onClick={onCancel}>Cancel</Button>
    </div>
  );
}
