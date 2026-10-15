import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { DEFAULT_BRAND } from '../brand/defaults.js';
import type { Brand } from '../brand/types.js';
import { emptyChoices } from '../choices.js';
import type { ChoiceField, Choices } from '../choices.js';
import { duplicatePallet } from '../duplicate.js';
import { analysePallet } from '../geometry/layout.js';
import { dayMonthYear } from '../ids.js';
import { PalletSchema, parsePallet } from '../schema.js';
import { downloadName } from '../sheet/filename.js';
import { HANDLING_HEADING, handlingCatalogue, handlingIconSvg } from '../sheet/handling.js';
import { renderSheet } from '../sheet/sheet.js';
import {
  DEFAULT_COMPONENT_TOLERANCE,
  DEFAULT_PALLET_TOLERANCE,
  HANDLING_METHODS,
} from '../types.js';
import type { Client, HandlingMethod, LayerKind, Pallet } from '../types.js';
import { api, StaleEdit, StoreUnavailable, Unauthenticated } from './api.js';
import type { ClientDesigns, Session, StoreStatus } from './api.js';
import { ChoiceSelect } from './ChoiceSelect.jsx';
import { AcceptInvitation, invitationTokenInHash, SignIn } from './SignIn.jsx';
import { VendorAdmin } from './VendorAdmin.jsx';
import { Dashboard } from './Dashboard.jsx';
import type { DesignActions } from './Dashboard.jsx';
import {
  clearDraft,
  clearDrafts,
  draftAge,
  draftsBelongTo,
  listDrafts,
  readDraft,
  writeDraft,
} from './drafts.js';
import type { Draft } from './drafts.js';
import { Help } from './Help.jsx';
import { describePath, fieldId, HINTS, pathAnchor, sayIssue } from './hints.js';
import { canRedo, canUndo, historyReducer, initialHistory } from './history.js';
import { Layers } from './LayerEditor.jsx';
import { Preview } from './Preview.jsx';
import { shortcutLabel, useShortcuts } from './shortcuts.js';
import { fingerprint } from '../store/fingerprint.js';
import { selectedSlot } from './state.js';
import { IconItem, StoreUnreachable, TopBar } from './TopBar.jsx';
import type { Action } from './state.js';
import { emptyPallet, newPallet } from './templates.js';
import {
  Button,
  Field,
  Hint,
  Icon,
  IconButton,
  Menu,
  MenuHeading,
  MenuItem,
  NumberInput,
  NumberOrNaInput,
  OptionalNumberInput,
  Prop,
  Section,
  TextInput,
  Unit,
  useDismiss,
} from './ui.jsx';

const fixtureModules = import.meta.glob('../../fixtures/*.json', { eager: true }) as Record<
  string,
  { default: unknown }
>;

const FIXTURES = Object.entries(fixtureModules)
  .map(([path, module]) => ({
    name: path.split('/').pop()!.replace('.json', ''),
    pallet: module.default,
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

const LAYER_KINDS: Array<[LayerKind, string]> = [
  ['panel', 'Plywood sheet over the deck'],
  ['top_deck', 'Top boards'],
  ['bearer', 'Centre boards'],
  ['block', 'Blocks'],
  ['runner', 'Runners'],
  ['bottom_deck', 'Bottom boards'],
];

/**
 * Which way each arrow key moves the selected board: along the run, the same
 * sense as the arrows in the nudge field.
 */
const NUDGE_KEYS: Array<[string, number]> = [
  ['arrowright', 1],
  ['arrowup', 1],
  ['arrowleft', -1],
  ['arrowdown', -1],
];

/** A design open in the editor: what is being edited, and what the store has. */
interface OpenDesign {
  pallet: Pallet;
  /** The stored design, or null for one the store has never had. */
  saved: Pallet | null;
  /** Set when `pallet` came back from a draft rather than from the store. */
  recoveredAt?: string;
}

/**
 * Drafts worth keeping, given what the store currently holds.
 *
 * A draft for a client who has since been deleted can never be saved — the
 * store would refuse the client id — so it is dropped rather than left on a
 * dashboard with no section to sit in.
 */
function usableDrafts(sections: ClientDesigns[]): Draft[] {
  const clients = new Set(sections.map((section) => section.client.id));
  const kept: Draft[] = [];
  const orphaned: string[] = [];
  for (const draft of listDrafts()) {
    if (clients.has(draft.pallet.clientId)) kept.push(draft);
    else orphaned.push(draft.pallet.id);
  }
  clearDrafts(orphaned);
  return kept;
}

/** "1 design", "3 designs". Counts get read out loud after an import. */
function count(n: number, thing: string): string {
  return `${n} ${thing}${n === 1 ? '' : 's'}`;
}

/**
 * Two screens: the dashboard of clients and their designs, and the editor for
 * one of them. The dashboard is home; opening a card gives the editor the whole
 * window.
 */
export function App() {
  const [sections, setSections] = useState<ClientDesigns[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  /**
   * Until the server answers, the sheet is drawn with no name on it. That is
   * the honest thing to show for the half-second it takes: a name that turns
   * out to be wrong is worse than no name at all.
   */
  const [brand, setBrand] = useState<Brand>(DEFAULT_BRAND);
  /** What the company has added to the lists of type, deck, entry and planing. */
  const [choices, setChoices] = useState<Choices>(emptyChoices);
  const [open, setOpen] = useState<OpenDesign | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // What an import did. An import that quietly succeeds looks the same as one
  // that quietly did nothing, and the counts are the only difference.
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState(false);
  /**
   * Which folder the designs are in. Null only until the first answer comes
   * back; after that it is known even when the folder cannot be reached, which
   * is the state the setup screen exists for.
   */
  const [folder, setFolder] = useState<StoreStatus | null>(null);
  /**
   * Who is signed in, and whether this server asks at all.
   *
   * Null until the first answer comes back. Everything else waits on it: on a
   * server there is nothing worth fetching until it is known whose designs
   * they would be.
   */
  const [session, setSession] = useState<Session | null>(null);
  /** Set when the address bar carries an invitation link. */
  const [invitation, setInvitation] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : invitationTokenInHash(window.location.hash),
  );

  // A link pasted into a tab that is already open changes only the part of
  // the address after the hash, which is not a page load. Watch for it, or
  // the invitation would be ignored and the sign-in screen would sit there.
  useEffect(() => {
    const onHash = () => {
      const token = invitationTokenInHash(window.location.hash);
      if (token) setInvitation(token);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const libraryFile = useRef<HTMLInputElement>(null);

  const clients = useMemo(() => sections.map((section) => section.client), [sections]);

  const refresh = useCallback(async () => {
    const status = await api.settings();
    setFolder(status);
    if (!status.ready) {
      // Nothing to show and nothing to ask for: the setup screen takes over
      // from here, and asking for designs would only produce a second error
      // saying the same thing.
      setSections([]);
      setDrafts([]);
      return;
    }
    const next = await api.dashboard();
    setSections(next);
    setDrafts(usableDrafts(next));
  }, []);

  /** Nobody is signed in any more: the sign-in screen takes the window. */
  const signedOut = useCallback(() => {
    setSession({ signInRequired: true, user: null, company: null });
    setSections([]);
    setDrafts([]);
    setChoices(emptyChoices());
    setOpen(null);
  }, []);

  /** Anything that talks to the store: one place to hold the error it returns. */
  const attempt = useCallback(
    async <T,>(work: () => Promise<T>): Promise<T | undefined> => {
      setBusy(true);
      setProblem(null);
      setNotice(null);
      try {
        const result = await work();
        await refresh();
        return result;
      } catch (error) {
        // A session that ran out while the tab was open is answered by asking
        // for it again, not by an error across the top of a library that is no
        // longer there.
        if (error instanceof Unauthenticated) {
          signedOut();
          return undefined;
        }
        // The folder having gone is not a failed action to report at the top of
        // the library — there is no library to put it at the top of. Take the
        // screen over instead.
        if (error instanceof StoreUnavailable) {
          await api.settings().then(setFolder).catch(() => undefined);
          return undefined;
        }
        setProblem(error instanceof Error ? error.message : String(error));
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [refresh, signedOut],
  );

  /**
   * Everything the library needs, once it is known whose library it is.
   *
   * Kept behind the session on purpose: asking for designs before that would
   * be asking for somebody's designs without knowing whose, and would answer
   * with a sign-in screen's worth of failures rather than one.
   */
  const load = useCallback(async () => {
    await refresh();
    await Promise.all([
      api.brand().then(setBrand).catch(() => setBrand(DEFAULT_BRAND)),
      // The lists still offer their built-in choices without these, so a
      // failure here is not worth more than an empty list of the company's own.
      api.choices().then(setChoices).catch(() => setChoices(emptyChoices())),
    ]);
  }, [refresh]);

  const signedIn = useCallback(
    (next: Session) => {
      setSession(next);
      setInvitation(null);
      // Unsaved work is kept in this browser, and this browser may be used by
      // somebody who works for two companies. Say which one before anything
      // reads or writes a draft.
      draftsBelongTo(next.company?.slug ?? null);
      // Somebody who looks after the service has no library to load.
      if (next.user?.role === 'vendor') return;
      void load().catch((error: unknown) => {
        setProblem(error instanceof Error ? error.message : String(error));
      });
    },
    [load],
  );

  useEffect(() => {
    // An invitation is answered before anything else: whoever is following one
    // has no session yet, and asking for designs would only be refused.
    if (invitation) return;
    void api
      .session()
      .then((held) => {
        setSession(held);
        draftsBelongTo(held.company?.slug ?? null);
        if (held.signInRequired && !held.user) return undefined;
        if (held.user?.role === 'vendor') return undefined;
        return load();
      })
      .catch((error: unknown) => {
        if (error instanceof Unauthenticated) {
          signedOut();
          return;
        }
        setProblem(error instanceof Error ? error.message : String(error));
      });
  }, [invitation, load, signedOut]);

  /**
   * Open a stored design — or, where the browser held work that never reached
   * the store, that work instead. The stored copy is carried along either way,
   * so the editor knows what Save would be changing and the draft can be thrown
   * away in favour of it.
   */
  const openDesign = async (id: string) => {
    const saved = await attempt(() => api.get(id));
    if (!saved) return;
    const draft = readDraft(id);
    setOpen(
      draft
        ? { pallet: draft.pallet, saved, recoveredAt: draft.at }
        : { pallet: saved, saved },
    );
  };

  /** Work on a design the store never had. The draft is the only copy there is. */
  const openDraft = (draft: Draft) => {
    setProblem(null);
    setOpen({ pallet: draft.pallet, saved: null, recoveredAt: draft.at });
  };

  const discardDraft = (id: string) => {
    clearDraft(id);
    setDrafts((current) => current.filter((draft) => draft.pallet.id !== id));
  };

  /**
   * What a card offers without the editor being opened.
   *
   * A copy is opened rather than left on the dashboard. It carries the name and
   * the code of what it was copied from, so two cards that cannot be told apart
   * is exactly what leaving it there would produce; the editor is where one of
   * them gets renamed.
   *
   * Deleting takes the browser's copy with it. A draft left behind would come
   * straight back as a card of a design that has just been thrown away, and
   * could be saved again from there, which is not what deleting it meant.
   *
   * The sheet is the stored design's, as it is everywhere else — what is
   * printed is what is recorded — so a card with unsaved changes prints what
   * was last saved, not what the browser is holding.
   */
  const designActions: DesignActions = {
    onOpen: (id) => void openDesign(id),
    onDuplicate: (id) =>
      void attempt(() => api.duplicate(id)).then((copy) => {
        if (copy) setOpen({ pallet: copy, saved: copy });
      }),
    onDelete: (design) =>
      void attempt(async () => {
        await api.remove(design.id);
        clearDraft(design.id);
      }),
    onSheet: (id) => {
      window.open(api.sheetUrl(id), '_blank');
    },
    onExport: (id) => {
      window.open(api.designUrl(id), '_blank');
    },
  };

  /**
   * A design from a file, as a new design of that client's.
   *
   * It is opened afterwards, as a copy is, because an imported design arrives
   * named whatever it was called wherever it came from — and that is exactly
   * the thing most likely to need changing.
   */
  const importDesign = (clientId: string, file: File) =>
    void attempt(async () => {
      const added = await api.importDesign(JSON.parse(await file.text()), clientId);
      setOpen({ pallet: added, saved: added });
      return added;
    });

  /**
   * A library file read back in.
   *
   * Nothing is overwritten on the first pass. Designs the library already holds
   * are counted and left alone, and only then is replacing them offered — with
   * the number said out loud, because the answer is different for restoring
   * your own backup and for merging somebody else's file.
   */
  const importLibrary = (file: File) =>
    void attempt(async () => {
      const library = JSON.parse(await file.text()) as unknown;
      const report = await api.importLibrary(library, 'skip');

      const added =
        report.designsAdded === 0 && report.clientsAdded === 0
          ? 'Nothing in that file was new.'
          : `Added ${count(report.designsAdded, 'design')}${
              report.clientsAdded > 0 ? ` and ${count(report.clientsAdded, 'new client')}` : ''
            }.`;

      if (report.designsSkipped === 0) {
        setNotice(added);
        return report;
      }

      const one = report.designsSkipped === 1;
      const already = `${count(report.designsSkipped, 'design')} ${
        one ? 'was' : 'were'
      } already in your library and ${one ? 'was' : 'were'} left alone.`;

      if (
        !window.confirm(
          `${added}\n\n${already}\n\nReplace ${
            one ? 'it' : 'them'
          } with the version in the file? Whatever is here now would be overwritten and cannot be got back.`,
        )
      ) {
        setNotice(`${added} ${already}`);
        return report;
      }

      const replaced = await api.importLibrary(library, 'replace');
      setNotice(
        `${added} ${count(replaced.designsReplaced, 'design')} overwritten from the file.`,
      );
      return replaced;
    });

  /**
   * A new design starts in the editor only. It reaches the dashboard when it is
   * first saved, so backing out of one started by accident leaves nothing
   * behind — though it is kept as a draft in the meantime, so closing the tab
   * by accident is not the same as backing out.
   */
  const createDesign = (clientId: string) => {
    const client = clients.find((candidate) => candidate.id === clientId);
    if (!client) return;
    setProblem(null);
    setOpen({ pallet: newPallet(client, brand.defaults), saved: null });
  };

  const retryFolder = () => {
    void attempt(async () => {
      setFolder(await api.retryStore());
    });
  };

  /**
   * Words put on one of the company's lists, or taken off it. Not through
   * `attempt`: nothing on the dashboard changes, and an editor half way
   * through a design has no reason to go busy for it.
   */
  const changeChoices = (work: () => Promise<Choices>) => {
    setProblem(null);
    void work()
      .then(setChoices)
      .catch((error: unknown) => {
        if (error instanceof Unauthenticated) {
          signedOut();
          return;
        }
        setProblem(error instanceof Error ? error.message : String(error));
      });
  };

  // Somebody following an invitation link, who has no account yet.
  if (invitation) {
    return (
      <AcceptInvitation
        token={invitation}
        onSignedIn={signedIn}
        onGiveUp={() => {
          setInvitation(null);
          signedOut();
        }}
      />
    );
  }

  // Until the first answer comes back there is nothing worth drawing: showing
  // an empty library for a moment would be showing something untrue.
  if (session === null) {
    return <div className="flex h-full flex-col bg-slate-100 text-slate-900" />;
  }

  if (session.signInRequired && !session.user) {
    return <SignIn onSignedIn={signedIn} />;
  }

  // Somebody who looks after the service belongs to no company and has no
  // designs: what they see is the companies, and the way into any of them.
  if (session.user?.role === 'vendor') {
    return (
      <VendorAdmin
        userName={session.user.name}
        userEmail={session.user.email}
        onSignOut={() => {
          void api.signOut().catch(() => undefined).finally(signedOut);
        }}
      />
    );
  }

  if (folder === null) {
    return <div className="flex h-full flex-col bg-slate-100 text-slate-900" />;
  }

  /**
   * The designs cannot be reached, or nobody has said where they are. Either
   * way the library is not a thing that can be shown, and offering the folder
   * is the only useful screen there is.
   */
  if (!folder.ready) {
    return (
      <div className="h-full overflow-auto bg-slate-100 text-slate-900">
        {problem && (
          <div className="border-b border-red-200 bg-red-50 px-3 py-2 text-label text-red-700">
            {problem}
          </div>
        )}
        <StoreUnreachable status={folder} busy={busy} onRetry={retryFolder} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-slate-100 text-slate-900">
      {problem && (
        <div className="border-b border-red-200 bg-red-50 px-3 py-2 text-label text-red-700">
          {problem}
        </div>
      )}

      {notice && (
        <div className="flex items-center gap-2 border-b border-emerald-200 bg-emerald-50 px-3 py-2 text-label text-emerald-800">
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="ml-auto rounded px-1 leading-none hover:bg-emerald-100"
            title="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {open ? (
        <Editor
          key={open.pallet.id}
          initial={open.pallet}
          saved={open.saved}
          recoveredAt={open.recoveredAt}
          clients={clients}
          brand={brand}
          choices={choices}
          onKeepChoice={(field, words) => changeChoices(() => api.addChoice(field, words))}
          onForgetChoice={(field, words) => changeChoices(() => api.removeChoice(field, words))}
          onBack={() => {
            setOpen(null);
            // The editor writes out its pending draft as it goes; picking it up
            // again here is what puts an unsaved design back on the dashboard.
            void refresh().catch(() => undefined);
          }}
          onProblem={setProblem}
          onRefresh={refresh}
        />
      ) : (
        <>
          {/* The library in and out of a file, and help: things done now and
              then, never mid-design, so they wait in the list under the name
              rather than taking the bar. */}
          <TopBar
            status={folder}
            session={session}
            busy={busy}
            onSignOut={() => {
              void api
                .signOut()
                .catch(() => undefined)
                .finally(signedOut);
            }}
            menu={(close) => (
              <>
                <IconItem
                  icon="download"
                  disabled={busy}
                  onClick={() => {
                    close();
                    window.open(api.libraryUrl(), '_blank');
                  }}
                >
                  Export library
                </IconItem>
                <IconItem
                  icon="upload"
                  disabled={busy}
                  onClick={() => {
                    close();
                    libraryFile.current?.click();
                  }}
                >
                  Import library
                </IconItem>
                <IconItem
                  icon="help"
                  onClick={() => {
                    close();
                    setHelp(true);
                  }}
                >
                  Help
                </IconItem>
              </>
            )}
          />
          {/* Outside the list, which is gone by the time a file is chosen. */}
          <input
            ref={libraryFile}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) importLibrary(file);
              event.target.value = '';
            }}
          />
          <Dashboard
            sections={sections}
            drafts={drafts}
            busy={busy}
            actions={designActions}
            onOpenDraft={openDraft}
            onDiscardDraft={discardDraft}
            onCreate={createDesign}
            onAddClient={(name) => void attempt(() => api.addClient(name))}
            onRenameClient={(id, name) => void attempt(() => api.renameClient(id, name))}
            onRemoveClient={(id) => void attempt(() => api.removeClient(id))}
            onImportDesign={importDesign}
          />
          {help && <Help onClose={() => setHelp(false)} />}
        </>
      )}
    </div>
  );
}

/**
 * How long typing pauses before the draft is written. Long enough that a number
 * being typed is not written a digit at a time, short enough that nothing worth
 * missing sits only on screen. The tab closing writes immediately regardless.
 */
const DRAFT_DELAY_MS = 500;

/**
 * One design, edited in place. Saving overwrites it: there is no previous
 * version kept anywhere. To keep an old design, duplicate it before reworking
 * it, which makes two rows that never meet again.
 */
function Editor({
  initial,
  saved,
  recoveredAt,
  clients,
  brand,
  choices,
  onKeepChoice,
  onForgetChoice,
  onBack,
  onProblem,
  onRefresh,
}: {
  initial: Pallet;
  /** What the store holds for this design, or null if it has never held it. */
  saved: Pallet | null;
  recoveredAt?: string;
  clients: Client[];
  brand: Brand;
  /** What the company has added to the lists of type, deck, entry and planing. */
  choices: Choices;
  onKeepChoice: (field: ChoiceField, words: string) => void;
  onForgetChoice: (field: ChoiceField, words: string) => void;
  onBack: () => void;
  onProblem: (message: string | null) => void;
  onRefresh: () => Promise<void>;
}) {
  const [history, dispatch] = useReducer(historyReducer, undefined, () =>
    initialHistory({ pallet: initial, selection: null }),
  );
  const { pallet, selection } = history.present;
  const fileInput = useRef<HTMLInputElement>(null);

  const [stored, setStored] = useState(saved !== null);
  const [savedDoc, setSavedDoc] = useState<string | null>(saved ? JSON.stringify(saved) : null);
  const [recovered, setRecovered] = useState<string | null>(recoveredAt ?? null);
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState(false);
  /**
   * Which folder the designs are in. Null only until the first answer comes
   * back; after that it is known even when the folder cannot be reached, which
   * is the state the setup screen exists for.
   */
  // The drawing is always regenerated from the data, on every keystroke.
  const layout = useMemo(() => analysePallet(pallet), [pallet]);
  const errors = layout.issues.filter((issue) => issue.severity === 'error');
  const warnings = layout.issues.filter((issue) => issue.severity === 'warning');

  /**
   * A design being worked on is allowed to be incomplete, but it has to be told
   * what is still missing before it can be saved or printed.
   *
   * What the schema reports is where the value sits in the document —
   * `layers.0.content.slots.2.length` — which is exact and no help at all when
   * the question is which box on which card is empty. `describePath` says the
   * same thing as a place on the screen, given what the layers are called.
   */
  const missing = useMemo(() => {
    const parsed = PalletSchema.safeParse(pallet);
    if (parsed.success) return [];

    const layerNames = pallet.layers.map(
      (layer) => LAYER_KINDS.find(([kind]) => kind === layer.kind)?.[1] ?? layer.kind,
    );

    return parsed.error.issues.map((issue) => ({
      where: describePath(issue.path, layerNames),
      message: sayIssue(issue.message),
      anchor: pathAnchor(issue.path),
    }));
  }, [pallet]);
  const chosen = selectedSlot(pallet, selection);
  const dirty = savedDoc !== JSON.stringify(pallet);
  const canStore = missing.length === 0 && errors.length === 0;

  const patch = (patch: Partial<Pallet>) => dispatch({ type: 'patchPallet', patch });

  /** One of the four lists, with the company's own entries on it. */
  const choice = (field: ChoiceField) => (
    <ChoiceSelect
      field={field}
      value={pallet[field]}
      saved={choices[field]}
      onChange={(value) => patch({ [field]: value } as Partial<Pallet>)}
      onKeep={(words) => onKeepChoice(field, words)}
      onForget={(words) => onForgetChoice(field, words)}
    />
  );

  /**
   * Work the store does not have: either changes since the last Save, or a
   * design it has never had at all. This is exactly what a draft is for, and
   * exactly what leaving the page would otherwise lose.
   */
  const unsaved = !stored || dirty;

  // What the listeners below need to see, without re-registering on every
  // keystroke. They fire when the page is going away, so they read the latest.
  const latest = useRef({ pallet, unsaved });
  useEffect(() => {
    latest.current = { pallet, unsaved };
  }, [pallet, unsaved]);

  // The draft, written a moment after typing stops. Once the store has the same
  // thing there is nothing left worth keeping, so the draft goes.
  useEffect(() => {
    if (!unsaved) {
      clearDraft(pallet.id);
      return;
    }
    const timer = setTimeout(() => writeDraft(pallet), DRAFT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [pallet, unsaved]);

  /**
   * The tab going away, which is the case this is all for. The pending write
   * has to land now — a timer that has not fired yet never will — and the
   * browser is asked to confirm, so an accidental close is caught before it
   * happens rather than only recovered from afterwards.
   */
  useEffect(() => {
    const flush = () => {
      if (latest.current.unsaved) writeDraft(latest.current.pallet);
    };
    const onHidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    const onLeave = (event: BeforeUnloadEvent) => {
      flush();
      if (latest.current.unsaved) event.preventDefault();
    };
    // `pagehide` and a hidden `visibilitychange` are the pair that fire
    // reliably when a tab is closed or the phone is put down; `beforeunload` is
    // what actually raises the "leave site?" prompt.
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', onLeave);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', onLeave);
      // Leaving for the dashboard unmounts this editor, and the pending write
      // still has to land or the last thing typed would be the one thing lost.
      flush();
    };
  }, []);

  /**
   * Stop keeping this design in the browser — it has been saved, thrown away,
   * or deleted. The flush on the way out is told not to write it straight back.
   */
  const abandonDraft = useCallback(() => {
    latest.current = { ...latest.current, unsaved: false };
    clearDraft(pallet.id);
  }, [pallet.id]);

  /**
   * Throw the recovered work away. Where the store has a copy the editor goes
   * back to it; where it has none there is nothing to go back to, so the design
   * itself goes.
   */
  const discardRecovered = () => {
    abandonDraft();
    setRecovered(null);
    if (saved) dispatch({ type: 'replace', pallet: saved });
    else onBack();
  };

  const attempt = useCallback(
    async (work: () => Promise<Pallet | null>) => {
      setBusy(true);
      onProblem(null);
      try {
        const result = await work();
        if (result) {
          // Saved: the steps that led here are all in the store, so there is
          // nothing left to undo past this point.
          dispatch({ type: 'replace', pallet: result, reset: true });
          setSavedDoc(JSON.stringify(result));
          setStored(true);
          // The store now holds this, so the browser's copy has nothing left to
          // say and the recovery notice has nothing left to warn about.
          abandonDraft();
          setRecovered(null);
        }
        await onRefresh();
      } catch (error) {
        onProblem(error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(false);
      }
    },
    [abandonDraft, onProblem, onRefresh],
  );

  /**
   * Write the design back, refusing to overwrite somebody else's save.
   *
   * The store is a shared folder, so a colleague can have saved this same
   * design in the time it has been open here. `basedOn` is the version this
   * editor started from; where the folder no longer holds it, the save comes
   * back refused and the choice goes to whoever is at the keyboard. Nobody's
   * afternoon is thrown away without them being asked.
   */
  const store = async (): Promise<Pallet> => {
    if (!stored) return api.create(pallet);

    try {
      return await api.save(pallet, savedDoc ? fingerprint(JSON.parse(savedDoc)) : undefined);
    } catch (error) {
      if (!(error instanceof StaleEdit)) throw error;

      const theirs = await api.get(pallet.id).catch(() => null);
      const mine = window.confirm(
        `${error.message}\n\n` +
          'Saving now would replace their version with yours, and theirs could not be got back.\n\n' +
          'OK to save yours over theirs. Cancel to leave theirs alone — yours stays on screen, ' +
          'and you can copy what you need out of it.',
      );
      if (!mine) {
        // Take on their version as the one being edited against, so the next
        // save is judged against what is actually in the folder.
        if (theirs) setSavedDoc(JSON.stringify(theirs));
        throw new Error(
          'Left their version alone. Yours is still on screen and has not been saved.',
        );
      }
      // Said plainly, so it overwrites rather than being refused again.
      return api.save(pallet);
    }
  };

  const save = () => attempt(store);

  const copy = () =>
    attempt(async () => {
      const source = stored ? await store() : pallet;
      return stored ? api.duplicate(source.id) : api.create(duplicatePallet(source));
    });

  const remove = () =>
    attempt(async () => {
      if (stored) await api.remove(pallet.id);
      abandonDraft();
      onBack();
      return null;
    });

  /** The PDF comes from the store, so what is printed is what is recorded. */
  const openPdf = () =>
    attempt(async () => {
      const saved = await store();
      window.open(api.sheetUrl(saved.id), '_blank');
      return saved;
    });

  /** The DXF comes from the store too, for the same reason the PDF does. */
  const openDxf = () =>
    attempt(async () => {
      const saved = await store();
      window.open(api.dxfUrl(saved.id), '_blank');
      return saved;
    });

  /**
   * The whole sheet as one SVG. The DXF is a CAD file and page-layout software
   * will not read it; this is the same drawing in a form that Canva,
   * Illustrator and Inkscape all open and let you work on.
   */
  const openSvg = () =>
    attempt(async () => {
      const saved = await store();
      window.open(api.svgUrl(saved.id), '_blank');
      return saved;
    });

  const openSheet = () => {
    const html = renderSheet(pallet, layout, { brand });
    const tab = window.open('', '_blank');
    if (!tab) return;
    tab.document.write(html);
    tab.document.close();
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(pallet, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = downloadName(pallet, 'json');
    link.click();
    URL.revokeObjectURL(url);
  };

  /**
   * An imported document, or an example, replaces the geometry of the design
   * being edited and keeps its identity. Which client a design belongs to is
   * settled on the dashboard, not by whatever file happens to be opened into it.
   */
  const adopt = (incoming: Pallet) => {
    dispatch({
      type: 'replace',
      pallet: {
        ...incoming,
        id: pallet.id,
        clientId: pallet.clientId,
        clientName: pallet.clientName,
        palletCode: pallet.palletCode || incoming.palletCode,
      },
    });
  };

  const importJson = async (file: File) => {
    try {
      adopt(parsePallet(JSON.parse(await file.text())));
    } catch (error) {
      onProblem(error instanceof Error ? error.message : String(error));
    }
  };

  /**
   * The keyboard.
   *
   * Undo and Save are the two that have to work from wherever the cursor is,
   * including mid-field: the document is what they act on, and a field being
   * open does not change what either of them means. The browser's own Undo
   * inside a field is given up for the document's, which is the only one that
   * knows about the board that was deleted a moment ago.
   *
   * The rest act on the selected board, so they wait until nothing is being
   * typed into — Delete belongs to the digits under the cursor first.
   */
  useShortcuts([
    { keys: 'mod+z', whileTyping: true, run: () => dispatch({ type: 'undo' }) },
    { keys: 'mod+shift+z', whileTyping: true, run: () => dispatch({ type: 'redo' }) },
    // What Windows has always used for Redo, and what a hand used to it reaches for.
    { keys: 'mod+y', whileTyping: true, run: () => dispatch({ type: 'redo' }) },
    {
      keys: 'mod+s',
      whileTyping: true,
      // Always caught, even when there is nothing to save: the alternative is
      // the browser offering to save the page to disk, which is never meant.
      run: () => {
        if (!busy && canStore && dirty) void save();
      },
    },
    {
      keys: 'escape',
      whileTyping: true,
      run: () => {
        // Out of the field first, then out of the selection: one press to stop
        // typing, a second to let the board go.
        const focused = document.activeElement;
        if (focused instanceof HTMLElement && focused !== document.body) focused.blur();
        else dispatch({ type: 'select', selection: null });
      },
    },
    ...NUDGE_KEYS.flatMap(([key, direction]) =>
      [1, 10].map((step) => ({
        // Shift for the coarse step, matching the nudge field's own arrows.
        keys: step === 1 ? key : `shift+${key}`,
        disabled: !chosen,
        run: () => dispatch({ type: 'nudge', delta: direction * step }),
      })),
    ),
    ...['delete', 'backspace'].map((key) => ({
      keys: key,
      disabled: !chosen,
      run: () => {
        if (chosen) dispatch({ type: 'removeSlot', layerId: chosen.layer.id, index: chosen.index });
      },
    })),
  ]);

  return (
    <>
      {recovered && (
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2 text-label text-amber-900">
          <span>
            {saved ? 'Restored unsaved changes' : 'Restored an unsaved design'} · {draftAge(recovered)}
          </span>
          <div className="ml-auto flex gap-1">
            <Button
              onClick={discardRecovered}
              title={
                saved
                  ? 'Throw the restored changes away and go back to the saved design'
                  : 'Throw this design away — the store has no copy of it'
              }
            >
              {saved ? 'Use the saved version' : 'Discard'}
            </Button>
            <Button onClick={() => setRecovered(null)} title="Keep the restored work">
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {/*
        Five groups, not eleven buttons.
        The row used to hold every action the editor has, at one weight, four of
        them acronyms. Two of those actions are done constantly — going back, and
        saving — and the rest are done once a design is finished. So the constant
        two keep their place on the row, and the others move into two lists that
        have room to say what each one is actually for.
      */}
      <header className="flex items-center gap-2 border-b border-line bg-card px-3 py-2">
        <Button onClick={onBack} title="Back to the design library">
          <span className="flex items-center gap-1.5">
            <Icon name="arrowLeft" size={14} />
            Designs
          </span>
        </Button>

        <div className="ml-1 mr-2 min-w-0">
          <h1 className="truncate text-ui font-semibold leading-tight text-ink">
            {pallet.palletName || 'Untitled'}
          </h1>
          <p className="truncate text-micro leading-tight text-ink-faint">{pallet.clientName}</p>
        </div>

        {/* The keyboard is how these are actually used; the buttons are here so
            that the shortcut is written down somewhere the hand can find it. */}
        <div className="flex items-center gap-0.5">
          <IconButton
            icon="undo"
            label={`Undo (${shortcutLabel('mod+z')})`}
            onClick={() => dispatch({ type: 'undo' })}
            disabled={!canUndo(history)}
          />
          <IconButton
            icon="redo"
            label={`Redo (${shortcutLabel('mod+shift+z')})`}
            onClick={() => dispatch({ type: 'redo' })}
            disabled={!canRedo(history)}
          />
        </div>

        <input
          ref={fileInput}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importJson(file);
            event.target.value = '';
          }}
        />

        <div className="ml-auto flex items-center gap-2">
          {/* Unsaved work is kept in this browser as it is typed; the word is
              enough here, and hovering says where it is kept. */}
          <div
            className="mr-1 text-right leading-tight"
            title={unsaved ? 'Kept in this browser until you press Save' : undefined}
          >
            <div className={`text-micro ${dirty || !stored ? 'text-amber-700' : 'text-ink-faint'}`}>
              {stored && !dirty ? `saved ${dayMonthYear(pallet.updatedAt)}` : 'unsaved'}
            </div>
            <div className="text-micro tabular-nums text-ink-faint">
              {layout.pieces.length} pieces · {layout.overallLength} × {layout.overallWidth} ×{' '}
              {layout.overallHeight}
            </div>
          </div>

          {/* The one export that is wanted constantly — it is the sheet the
              whole program exists to print — so it keeps a button of its own.
              The other four are occasional and can afford the extra click. */}
          <Button
            onClick={() => void openPdf()}
            disabled={busy || !canStore}
            title="The specification sheet, ready to print or send"
          >
            PDF
          </Button>

          <Menu label="Export" caret title="Other ways of getting this design out">
            {(close) => (
              <>
                <MenuItem
                  onClick={() => {
                    close();
                    openSheet();
                  }}
                  disabled={errors.length > 0}
                  note="In a browser tab, without saving"
                >
                  Sheet preview
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    close();
                    void openDxf();
                  }}
                  disabled={busy || !canStore}
                  note="CAD file, for AutoCAD"
                >
                  DXF
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    close();
                    void openSvg();
                  }}
                  disabled={busy || !canStore}
                  note="Vector, for Canva or Illustrator"
                >
                  SVG
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    close();
                    exportJson();
                  }}
                  note="The design as a .json file"
                >
                  Export as file
                </MenuItem>
              </>
            )}
          </Menu>

          <Menu label={<Icon name="more" size={16} />} title="More to do with this design">
            {(close) => (
              <>
                <MenuItem
                  onClick={() => {
                    close();
                    void copy();
                  }}
                  disabled={busy || !canStore}
                >
                  Duplicate
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    close();
                    fileInput.current?.click();
                  }}
                  note="Replaces this design"
                >
                  Import from file
                </MenuItem>

                <MenuHeading>Start again</MenuHeading>
                {/* Not through parsePallet: a pallet with no layers is exactly
                    what the schema refuses, and refusing it is the point. It
                    goes in as it is and the problem list says what it needs. */}
                <MenuItem
                  onClick={() => {
                    close();
                    if (
                      window.confirm(
                        'Clear this design back to an empty pallet? Everything drawn so far goes.',
                      )
                    ) {
                      adopt(emptyPallet({ id: pallet.clientId, name: pallet.clientName }, brand.defaults));
                    }
                  }}
                >
                  Start from scratch
                </MenuItem>

                <MenuHeading>Start from an example</MenuHeading>
                <div className="max-h-56 overflow-y-auto">
                  {FIXTURES.map((fixture) => (
                    <MenuItem
                      key={fixture.name}
                      onClick={() => {
                        close();
                        adopt(parsePallet(fixture.pallet));
                      }}
                    >
                      {fixture.name}
                    </MenuItem>
                  ))}
                </div>

                <MenuHeading>Careful</MenuHeading>
                <MenuItem
                  tone="danger"
                  disabled={busy}
                  onClick={() => {
                    close();
                    if (window.confirm('Delete this design? This cannot be undone.')) void remove();
                  }}
                  note="Cannot be undone"
                >
                  Delete this design
                </MenuItem>
              </>
            )}
          </Menu>

          <IconButton icon="help" label="Help, and what the words mean" onClick={() => setHelp(true)} />

          <Button
            tone="primary"
            onClick={() => void save()}
            disabled={busy || !canStore || !dirty}
            title={`Save (${shortcutLabel('mod+s')})`}
          >
            Save
          </Button>
        </div>
      </header>

      {help && <Help onClose={() => setHelp(false)} />}

      {/*
        The form is as wide as it needs and no wider, and the drawing has the
        rest. It used to be the other way round: the drawing had a fixed share
        and the form sat centred in what was left, which on a big screen was
        grey margin either side of it. The drawing still keeps at least its old
        share, so on a small laptop it is the form that gives way.
      */}
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-[0_1_62rem] overflow-y-auto bg-ground px-4 py-4" data-form-scroll>
          {/*
            One sheet, read top to bottom in the order a design is thought
            about: what it is called and whose it is, how big, what kind of
            pallet, then the timber layer by layer. It used to be a stack of
            boxed cards with every field the width of its column; the parts
            are now ruled off one sheet, and a field is as wide as its answer.

            A container, so what goes two columns does so by the width the
            sheet has rather than the width of the window.
          */}
          <div className="@container rounded-card border border-line bg-card shadow-card">
            <div className="px-6 pb-5 pt-5">
              {/* Optional: unnamed, the sheet heads itself with the overall
                  size and the dashboard reads "Untitled". */}
              <div id={fieldId('palletName')}>
                <input
                  aria-label="Pallet name"
                  value={pallet.palletName}
                  placeholder={`${pallet.overallLength} x ${pallet.overallWidth}`}
                  onChange={(event) => patch({ palletName: event.target.value })}
                  className="-mx-2 w-[calc(100%+1rem)] rounded-md border border-transparent bg-transparent px-2 py-1
                             text-[1.5rem] font-semibold leading-tight tracking-tight text-ink transition-colors
                             placeholder:text-slate-300 hover:border-line focus:border-accent focus:outline-none
                             focus:ring-2 focus:ring-accent-ring/30"
                />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {/* The name is a copy of the client's, kept on the document so
                    a sheet can be printed from it alone. Both move together. */}
                <Labelled label="Client" id={fieldId('clientId')}>
                  <select
                    className={`${bare} max-w-64`}
                    value={pallet.clientId}
                    onChange={(event) => {
                      const client = clients.find((candidate) => candidate.id === event.target.value);
                      if (client) patch({ clientId: client.id, clientName: client.name });
                    }}
                  >
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                  </select>
                </Labelled>
                {/* Optional: a design is drawn and printed long before the shop
                    has a code to give it. */}
                <Labelled label="Code" hint={HINTS.palletCode} id={fieldId('palletCode')}>
                  <input
                    className={`${bare} w-32 text-center`}
                    value={pallet.palletCode}
                    placeholder={brand.defaults.palletCodePlaceholder}
                    onChange={(event) => patch({ palletCode: event.target.value })}
                  />
                </Labelled>
                <Labelled label="Client part no" hint={HINTS.clientPartNo} id={fieldId('clientPartNo')}>
                  <input
                    className={`${bare} w-32 text-center`}
                    value={pallet.clientPartNo ?? ''}
                    onChange={(event) =>
                      patch({ clientPartNo: event.target.value === '' ? undefined : event.target.value })
                    }
                  />
                </Labelled>
              </div>
            </div>

            <Section title="Size" note="mm">
              <div className="flex flex-wrap items-end gap-x-2 gap-y-3">
                <Field label="Length" id={fieldId('overallLength')}>
                  <NumberInput
                    className="w-24 text-key"
                    value={pallet.overallLength}
                    min={1}
                    onChange={(overallLength) => patch({ overallLength })}
                  />
                </Field>
                <span className="pb-2 text-ink-faint">×</span>
                <Field label="Width" id={fieldId('overallWidth')}>
                  <NumberInput
                    className="w-24 text-key"
                    value={pallet.overallWidth}
                    min={1}
                    onChange={(overallWidth) => patch({ overallWidth })}
                  />
                </Field>
                <span className="pb-2 text-ink-faint">×</span>
                {/* Left empty, the height is what the layers add up to — shown
                    greyed in the field rather than in a box of its own. */}
                <Field label="Height" id={fieldId('overallHeight')} hint={HINTS.derivedHeight}>
                  <OptionalNumberInput
                    className="w-24 text-key"
                    value={pallet.overallHeight > 0 ? pallet.overallHeight : undefined}
                    min={0}
                    placeholder={String(layout.derivedHeight)}
                    onChange={(overallHeight) => patch({ overallHeight: overallHeight ?? 0 })}
                  />
                </Field>
                <span className="pb-2 pl-1 text-label text-ink-faint">
                  {pallet.overallHeight === 0 ? (
                    'height from the layers'
                  ) : pallet.overallHeight !== layout.derivedHeight ? (
                    <span className="text-amber-700">layers add up to {layout.derivedHeight}</span>
                  ) : null}
                </span>
              </div>
            </Section>

            {/* Every attribute below is allowed not to have an answer, and the
                two ways of not having one mean different things on the sheet.
                See NOT_APPLICABLE in types.ts. Two columns where the sheet is
                wide enough for the tolerances to sit on one line. */}
            <Section title="Specification">
              <div className="grid grid-cols-1 gap-x-10 gap-y-2 @min-[56rem]:grid-cols-2">
                <Prop label="Type" id={fieldId('palletType')} hint={HINTS.palletType}>
                  {choice('palletType')}
                </Prop>
                <Prop label="Deck" id={fieldId('deckType')} hint={HINTS.deckType}>
                  {choice('deckType')}
                </Prop>
                <Prop label="Entry" id={fieldId('entry')} hint={HINTS.entry}>
                  {choice('entry')}
                </Prop>
                <Prop label="Planing" id={fieldId('planing')} hint={HINTS.planing}>
                  {choice('planing')}
                </Prop>
                <Prop label="Species" id={fieldId('species')} hint={HINTS.species}>
                  <TextInput
                    className="w-40 text-center"
                    value={pallet.species}
                    placeholder={brand.defaults.species}
                    onChange={(species) => patch({ species })}
                  />
                </Prop>
                <Prop label="Tolerance" group id={fieldId('componentTolerance')} hint={HINTS.componentTolerance}>
                  <label className="flex items-center gap-2">
                    <span className="text-label text-ink-faint">part</span>
                    <TextInput
                      className="w-24 text-center"
                      label="Component tolerance"
                      value={pallet.componentTolerance}
                      placeholder={DEFAULT_COMPONENT_TOLERANCE}
                      onChange={(componentTolerance) => patch({ componentTolerance })}
                    />
                  </label>
                  <label id={fieldId('palletTolerance')} className="flex items-center gap-2">
                    <span className="pl-1 text-label text-ink-faint">pallet</span>
                    <TextInput
                      className="w-24 text-center"
                      label="Total pallet tolerance"
                      value={pallet.palletTolerance}
                      placeholder={DEFAULT_PALLET_TOLERANCE}
                      onChange={(palletTolerance) => patch({ palletTolerance })}
                    />
                  </label>
                </Prop>
                <Prop label="Static load" id={fieldId('staticLoadKg')} hint={HINTS.staticLoad}>
                  <Unit unit="kg">
                    <NumberOrNaInput
                      className="w-28 pr-8"
                      value={pallet.staticLoadKg}
                      onChange={(staticLoadKg) => patch({ staticLoadKg })}
                    />
                  </Unit>
                </Prop>
                <Prop label="Dynamic load" id={fieldId('dynamicLoadKg')} hint={HINTS.dynamicLoad}>
                  <Unit unit="kg">
                    <NumberOrNaInput
                      className="w-28 pr-8"
                      value={pallet.dynamicLoadKg}
                      onChange={(dynamicLoadKg) => patch({ dynamicLoadKg })}
                    />
                  </Unit>
                </Prop>
                {/* The whole width: it is the one free-text line on the sheet. */}
                <div className="col-span-full">
                  <Prop label="Notes" id={fieldId('notes')}>
                    <TextInput
                      value={pallet.notes ?? ''}
                      onChange={(value) => patch({ notes: value === '' ? undefined : value })}
                    />
                  </Prop>
                </div>
              </div>

              <p className="mt-4 text-label text-ink-faint">
                Blank prints “—”. Type <code className="rounded bg-ground px-1">na</code>, or pick
                n/a, to remove the line from the sheet.
              </p>
            </Section>

            <Layers layers={pallet.layers} layout={layout} selection={selection} dispatch={dispatch} />

            <Nails pallet={pallet} dispatch={dispatch} nailType={brand.defaults.nailType} />

            <Handling pallet={pallet} patch={patch} />
          </div>
        </div>

        <div className="flex min-w-[36%] flex-1 flex-col border-l border-line bg-card">
          <Preview layout={layout} selection={selection} dispatch={dispatch} />

          {/* Only there while a board is picked: a board is the one thing
              under the drawing that can be nudged. */}
          {chosen && (
            <div className="border-t border-line-soft p-3">
              <NudgeControl
                slotLabel={`${LAYER_KINDS.find(([kind]) => kind === chosen.layer.kind)?.[1] ?? chosen.layer.kind}, board ${chosen.index + 1}`}
                value={chosen.slot.nudgeMm}
                dispatch={dispatch}
              />
            </div>
          )}

          <Problems missing={missing} errors={errors} warnings={warnings} />
        </div>
      </div>
    </>
  );
}

/**
 * What the pallet may be moved with, and whether it may be racked — the block
 * printed in the corner of the sheet, edited with the same icons it prints
 * with. Last on the form, as it is last on the sheet's written side.
 *
 * A yes or a no each, not the three states the fields above it have. Ticking is
 * a claim about what the shop may put under this pallet, so the list is rebuilt
 * from the catalogue on every change: the document then carries the methods in
 * the order they print, once each, whatever order they were clicked in.
 */
function Handling({
  pallet,
  patch,
}: {
  pallet: Pallet;
  patch: (patch: Partial<Pallet>) => void;
}) {
  const toggle = (method: HandlingMethod, on: boolean): void => {
    patch({
      handling: HANDLING_METHODS.filter((each) =>
        each === method ? on : pallet.handling.includes(each),
      ),
    });
  };

  return (
    <Section title={HANDLING_HEADING} id={fieldId('handling')}>
      {/* A tick or a cross each, as the sheet prints them: what the pallet
          may not be lifted with is said as plainly as what it may. */}
      <div className="flex flex-wrap gap-2">
        {handlingCatalogue().map(({ method, label }) => {
          const on = pallet.handling.includes(method);
          return (
            <button
              key={method}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(method, !on)}
              title={on ? `${label}: allowed — click to rule it out` : `${label}: ruled out — click to allow it`}
              className={
                'flex items-center gap-2 rounded-full border py-1 pl-2.5 pr-2 text-ui transition-colors ' +
                (on
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-950 hover:bg-emerald-100'
                  : 'border-line bg-card text-ink-faint hover:border-slate-400 hover:text-ink-soft')
              }
            >
              {/* The sheet's own icon, taking its colour from the label around
                  it, so the row on screen is the row on paper. */}
              <span
                className="inline-block h-5 w-5 shrink-0"
                dangerouslySetInnerHTML={{ __html: handlingIconSvg(method, 'currentColor', '100%') }}
              />
              {label}
              <Icon
                name={on ? 'check' : 'x'}
                size={14}
                className={on ? 'text-emerald-600' : 'text-slate-400'}
              />
            </button>
          );
        })}
      </div>
    </Section>
  );
}

/**
 * A field with its name inside the same box, in front of it — for the short
 * line of facts under the design's name, where a caption over each one would
 * take a second line to say three words.
 */
function Labelled({
  label,
  hint,
  id,
  children,
}: {
  label: string;
  hint?: string;
  id?: string;
  children: ReactNode;
}) {
  return (
    <label
      id={id}
      className="flex h-8 items-stretch overflow-hidden rounded-md border border-line bg-card transition-colors
                 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-ring/30 hover:border-slate-400"
    >
      <span className="flex items-center gap-1 border-r border-line-soft bg-ground-soft px-2 text-label text-ink-soft">
        {label}
        {hint && <Hint text={hint} />}
      </span>
      {children}
    </label>
  );
}

/** A field inside Labelled: the box is Labelled's, so it has none of its own. */
const bare = 'min-w-0 bg-transparent px-2 text-ui text-ink placeholder:text-slate-400 focus:outline-none';

/** What is still to be filled in, and what does not add up. */
interface Missing {
  /** Where on the screen, said in the words the screen uses. */
  where: string;
  message: string;
  /** The field to scroll to, where the path names one. */
  anchor: string | null;
}

/**
 * The list of what is standing between this design and a printed sheet.
 *
 * Three kinds of thing, and they are not equally bad. Something not filled in
 * yet is the ordinary state of a design being worked on. An error is timber
 * that does not fit in the space it has been given, and stops the sheet. A
 * warning is worth reading and stops nothing. Saying which is which, and how
 * many, is most of the work; the rest is being able to get to the box.
 *
 * It is one line under the drawing, and the list itself opens over the
 * drawing when that line is clicked. It used to sit open below it, and every
 * problem that turned up took its height out of the drawing — the one thing
 * on this side that is looked at all the time — for a list that is read now
 * and then. The line keeps the counts in view, in their colours, so an error
 * stopping the sheet is still never out of sight.
 */
function Problems({
  missing,
  errors,
  warnings,
}: {
  missing: Missing[];
  errors: Array<{ message: string }>;
  warnings: Array<{ message: string }>;
}) {
  const total = missing.length + errors.length + warnings.length;
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const box = useDismiss(open, close);

  // Everything fixed: fold it away, so it does not come back open onto an
  // empty list the next time something turns up.
  useEffect(() => {
    if (total === 0) setOpen(false);
  }, [total]);

  /** Put the field on screen and in the cursor, from a click on its name. */
  const goTo = (anchor: string) => {
    const field = document.getElementById(anchor);
    if (!field) return;
    setOpen(false);
    field.scrollIntoView({ behavior: 'smooth', block: 'center' });
    field.querySelector<HTMLElement>('input, select, textarea')?.focus();
  };

  return (
    <div ref={box} className="relative shrink-0 border-t border-line-soft">
      {open && total > 0 && (
        <div
          className="absolute inset-x-2 bottom-full z-20 mb-1 max-h-[min(24rem,60vh)] overflow-y-auto
                     rounded-card border border-line bg-card p-3 shadow-raised"
        >
          <ul className="space-y-1.5 text-label">
            {errors.map((issue, index) => (
              <li
                key={`e${index}`}
                className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-red-800"
              >
                {issue.message}
              </li>
            ))}
            {missing.map((item, index) => (
              <li key={`m${index}`}>
                {item.anchor ? (
                  <button
                    type="button"
                    onClick={() => goTo(item.anchor as string)}
                    title="Go to this field"
                    className="block w-full rounded-md border border-line-soft bg-ground-soft px-2.5 py-1.5
                               text-left text-ink-soft transition-colors hover:border-line hover:bg-ground"
                  >
                    <span className="font-medium text-ink">{item.where}</span> — {item.message}
                    <span className="ml-1 text-ink-faint" aria-hidden="true">
                      ↗
                    </span>
                  </button>
                ) : (
                  <div className="rounded-md border border-line-soft bg-ground-soft px-2.5 py-1.5 text-ink-soft">
                    <span className="font-medium text-ink">{item.where}</span> — {item.message}
                  </div>
                )}
              </li>
            ))}
            {warnings.map((issue, index) => (
              <li
                key={`w${index}`}
                className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-amber-900"
              >
                {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {total === 0 ? (
        <p className="flex items-center gap-2 px-3 py-2 text-label text-emerald-700">
          <span aria-hidden="true">✓</span>
          Ready to save and print.
        </p>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          title={open ? 'Hide the list' : 'Show what needs attention'}
          className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-ground-soft"
        >
          <span className="shrink-0 text-micro font-semibold uppercase tracking-wider text-ink-faint">
            Needs attention
          </span>
          <span className="flex min-w-0 flex-wrap gap-x-2 text-micro">
            {errors.length > 0 && (
              <span className="font-medium text-red-700">{errors.length} stopping the sheet</span>
            )}
            {missing.length > 0 && <span className="text-ink-soft">{missing.length} not filled in</span>}
            {warnings.length > 0 && <span className="text-amber-800">{warnings.length} to look at</span>}
          </span>
          <span className="ml-auto shrink-0 text-micro text-ink-faint">{open ? 'Hide ▾' : 'Show ▴'}</span>
        </button>
      )}
    </div>
  );
}

/**
 * The nudge: typed in millimetres or stepped with the arrow keys, and saved to
 * the slot. Nothing else records where the board is.
 */
function NudgeControl({
  slotLabel,
  value,
  dispatch,
}: {
  slotLabel: string;
  value: number;
  dispatch: (action: Action) => void;
}) {
  return (
    <div className="flex items-end gap-2">
      <div className="flex-1">
        <Field label={`Nudge — ${slotLabel}`}>
          <NumberInput
            value={value}
            onChange={(next) => dispatch({ type: 'setNudge', value: next })}
            onKeyDown={(event) => {
              const step = event.shiftKey ? 10 : 1;
              if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
                event.preventDefault();
                dispatch({ type: 'nudge', delta: step });
              } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
                event.preventDefault();
                dispatch({ type: 'nudge', delta: -step });
              }
            }}
          />
        </Field>
      </div>
      <Button onClick={() => dispatch({ type: 'nudge', delta: -1 })}>−1</Button>
      <Button onClick={() => dispatch({ type: 'nudge', delta: 1 })}>+1</Button>
      <Button disabled={value === 0} onClick={() => dispatch({ type: 'setNudge', value: 0 })}>
        Clear
      </Button>
    </div>
  );
}

const NAIL_COLUMNS =
  'grid grid-cols-[minmax(10rem,1fr)_10rem_6rem_5rem_1.75rem] items-center gap-x-2';

/**
 * The nail schedule printed on the sheet: typed, not worked out. Where the
 * nails go on the drawing is a separate thing, set by clicking crossings in
 * the top and bottom views.
 */
function Nails({
  pallet,
  dispatch,
  nailType,
}: {
  pallet: Pallet;
  dispatch: (action: Action) => void;
  /** What this company buys, so a new row starts there. */
  nailType: string;
}) {
  return (
    <Section
      title="Nails"
      actions={
        <Button onClick={() => dispatch({ type: 'addNail', nailType })}>
          <span className="flex items-center gap-1.5">
            <Icon name="plus" size={14} />
            Add row
          </span>
        </Button>
      }
    >
      {/* No schedule until one is typed: an empty table is a row of headings
          standing over nothing, and a pallet with no schedule prints none. */}
      {pallet.nails.length > 0 && (
        <div>
          <div className={`${NAIL_COLUMNS} pb-1.5 text-label text-ink-faint`}>
            <span>Joint</span>
            <span>Type</span>
            <span>Size</span>
            <span>Qty</span>
            <span />
          </div>
          <div className="space-y-1.5">
            {pallet.nails.map((nail, index) => (
              <div key={index} className={NAIL_COLUMNS}>
                <TextInput
                  className="w-full text-center"
                  label={`Nail row ${index + 1}: joint`}
                  value={nail.label}
                  placeholder="top board to centre board"
                  onChange={(label) => dispatch({ type: 'patchNail', index, patch: { label } })}
                />
                <TextInput
                  className="w-full text-center"
                  label={`Nail row ${index + 1}: type`}
                  value={nail.type}
                  onChange={(type) => dispatch({ type: 'patchNail', index, patch: { type } })}
                />
                <Unit unit="mm">
                  <OptionalNumberInput
                    label={`Nail row ${index + 1}: size`}
                    className="w-full pr-9"
                    value={nail.sizeMm}
                    min={1}
                    onChange={(sizeMm) => dispatch({ type: 'patchNail', index, patch: { sizeMm } })}
                  />
                </Unit>
                <OptionalNumberInput
                  label={`Nail row ${index + 1}: quantity`}
                  value={nail.count}
                  min={0}
                  onChange={(count) => dispatch({ type: 'patchNail', index, patch: { count } })}
                />
                <IconButton
                  icon="x"
                  size="sm"
                  tone="danger"
                  label={`Remove nail row ${index + 1}`}
                  onClick={() => dispatch({ type: 'removeNail', index })}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}
