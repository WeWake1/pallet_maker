import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { computeCosting } from '../costing/costing.js';
import type { Costing } from '../costing/costing.js';
import type { Rates } from '../costing/rates.js';
import { duplicatePallet } from '../duplicate.js';
import { analysePallet } from '../geometry/layout.js';
import { LAYER_STYLE } from '../render/theme.js';
import { PalletSchema, parsePallet } from '../schema.js';
import { downloadName } from '../sheet/filename.js';
import { handlingCatalogue, handlingIconSvg } from '../sheet/handling.js';
import { renderSheet } from '../sheet/sheet.js';
import { HANDLING_METHODS, NOT_APPLICABLE } from '../types.js';
import type { Client, HandlingMethod, LayerKind, Pallet, Unstated } from '../types.js';
import { api, StoreUnavailable } from './api.js';
import type { ClientDesigns, StoreStatus } from './api.js';
import { Dashboard } from './Dashboard.jsx';
import type { DesignActions } from './Dashboard.jsx';
import { clearDraft, clearDrafts, draftAge, listDrafts, readDraft, writeDraft } from './drafts.js';
import type { Draft } from './drafts.js';
import { Help } from './Help.jsx';
import { describePath, fieldId, HINTS, pathAnchor, sayIssue } from './hints.js';
import { canRedo, canUndo, historyReducer, initialHistory } from './history.js';
import { LayerEditor } from './LayerEditor.jsx';
import { Preview } from './Preview.jsx';
import { shortcutLabel, useShortcuts } from './shortcuts.js';
import { selectedSlot } from './state.js';
import { StoreFolderBar, StoreSetup } from './StoreFolder.jsx';
import type { Action } from './state.js';
import { emptyPallet, newPallet } from './templates.js';
import {
  Button,
  Check,
  Field,
  Hint,
  Menu,
  MenuHeading,
  MenuItem,
  NumberInput,
  NumberOrNaInput,
  OptionalNumberInput,
  Panel,
  Readout,
  SectionHeading,
  Select,
  TextInput,
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

/**
 * The two choices every stated attribute carries besides its own, and what each
 * of them does to the printed sheet. Both are offered on every list so that a
 * dropdown answers the same way a typed field does.
 */
const BLANK: [Unstated, string] = ['', '— not stated'];
const NOT_ON_SHEET: [Unstated, string] = [NOT_APPLICABLE, 'n/a — leave off the sheet'];

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
  const [rates, setRates] = useState<Rates | null>(null);
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
  /** Set from the library screen, to change folders while everything is fine. */
  const [choosing, setChoosing] = useState(false);
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
    [refresh],
  );

  useEffect(() => {
    void refresh().catch((error: unknown) => {
      setProblem(error instanceof Error ? error.message : String(error));
    });
    void api
      .rates()
      .then(setRates)
      .catch(() => setRates(null));
  }, [refresh]);

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
    setOpen({ pallet: newPallet(client), saved: null });
  };

  /** Point the tool at a folder, and open what is in it. */
  const useFolder = (root: string) => {
    setChoosing(false);
    void attempt(async () => {
      setFolder(await api.useStoreFolder(root));
    });
  };

  const retryFolder = () => {
    void attempt(async () => {
      setFolder(await api.retryStore());
    });
  };

  /** The native dialog, in the app. Cancelling changes nothing. */
  const browseForFolder = () => {
    void attempt(async () => {
      const status = await api.browseForFolder();
      setFolder(status);
      if (status.ready) setChoosing(false);
    });
  };

  // Until the first answer comes back there is nothing worth drawing: showing
  // an empty library for a moment would be showing something untrue.
  if (folder === null) {
    return <div className="flex h-full flex-col bg-slate-100 text-slate-900" />;
  }

  /**
   * The designs cannot be reached, or nobody has said where they are. Either
   * way the library is not a thing that can be shown, and offering the folder
   * is the only useful screen there is.
   */
  if (!folder.ready || choosing) {
    return (
      <div className="h-full overflow-auto bg-slate-100 text-slate-900">
        {problem && (
          <div className="border-b border-red-200 bg-red-50 px-3 py-2 text-label text-red-700">
            {problem}
          </div>
        )}
        <StoreSetup
          status={folder}
          busy={busy}
          onUse={useFolder}
          onBrowse={folder.canBrowse ? browseForFolder : null}
          onRetry={retryFolder}
        />
        {choosing && folder.ready && (
          <div className="mx-auto max-w-2xl px-4 pb-10">
            <Button onClick={() => setChoosing(false)}>Back to the library</Button>
          </div>
        )}
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
          rates={rates}
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
          <StoreFolderBar status={folder} busy={busy} onChange={() => setChoosing(true)} />
          <header className="flex items-center gap-2 border-b border-line bg-card px-4 py-2.5">
            <h1 className="text-title font-semibold tracking-tight text-ink">Pallet spec</h1>

            {/* The library in and out of a file. Everything else on this screen
                acts on one design; these two are the whole of it, and are the
                only copy of it that survives this computer. */}
            <div className="ml-auto flex gap-1.5">
              <Button
                onClick={() => setHelp(true)}
                label="Help"
                title="Help, and what the words mean"
              >
                ?
              </Button>
              <Button
                disabled={busy}
                onClick={() => window.open(api.libraryUrl(), '_blank')}
                title={
                  'Download every client and design as one file. Keep it somewhere ' +
                  'other than this computer — it is the only copy that survives this one.'
                }
              >
                Export library
              </Button>
              <Button
                disabled={busy}
                onClick={() => libraryFile.current?.click()}
                title={
                  'Read a library file back in. Designs already here are left alone ' +
                  'unless you say otherwise.'
                }
              >
                Import library
              </Button>
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
            </div>
          </header>
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
  rates,
  onBack,
  onProblem,
  onRefresh,
}: {
  initial: Pallet;
  /** What the store holds for this design, or null if it has never held it. */
  saved: Pallet | null;
  recoveredAt?: string;
  clients: Client[];
  rates: Rates | null;
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
  const [folder, setFolder] = useState<StoreStatus | null>(null);
  /** Set from the library screen, to change folders while everything is fine. */
  const [choosing, setChoosing] = useState(false);

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

  // Costed as it is edited, not only once it has been saved.
  const costing = useMemo(
    () => (rates ? computeCosting(pallet, layout, rates) : null),
    [pallet, layout, rates],
  );

  const store = () => (stored ? api.save(pallet) : api.create(pallet));
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
    const html = renderSheet(pallet, layout);
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
            Restored what you were working on {draftAge(recovered)}.{' '}
            {saved
              ? 'These changes are not in the library until you press Save.'
              : 'This design has never been saved.'}
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
          ← Designs
        </Button>

        <div className="ml-1 mr-2 min-w-0">
          <h1 className="truncate text-ui font-semibold leading-tight text-ink">
            {pallet.palletName || 'Untitled'}
          </h1>
          <p className="truncate text-micro leading-tight text-ink-faint">{pallet.clientName}</p>
        </div>

        {/* The keyboard is how these are actually used; the buttons are here so
            that the shortcut is written down somewhere the hand can find it. */}
        <div className="flex overflow-hidden rounded-md border border-line shadow-xs">
          <button
            type="button"
            onClick={() => dispatch({ type: 'undo' })}
            disabled={!canUndo(history)}
            aria-label="Undo"
            title={`Undo (${shortcutLabel('mod+z')})`}
            className="border-r border-line bg-card px-2.5 py-1 text-ui text-slate-700
                       transition-colors hover:bg-ground-soft disabled:opacity-40 disabled:hover:bg-card"
          >
            ↶
          </button>
          <button
            type="button"
            onClick={() => dispatch({ type: 'redo' })}
            disabled={!canRedo(history)}
            aria-label="Redo"
            title={`Redo (${shortcutLabel('mod+shift+z')})`}
            className="bg-card px-2.5 py-1 text-ui text-slate-700 transition-colors
                       hover:bg-ground-soft disabled:opacity-40 disabled:hover:bg-card"
          >
            ↷
          </button>
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
          {/* Unsaved work is kept in this browser as it is typed, so say so
              rather than only warning — the warning was the whole message
              before, and it is not the frightening half that is true. */}
          <div
            className="mr-1 text-right leading-tight"
            title={unsaved ? 'Kept in this browser until you press Save' : undefined}
          >
            <div className={`text-micro ${dirty || !stored ? 'text-amber-700' : 'text-ink-faint'}`}>
              {stored
                ? dirty
                  ? 'unsaved changes · kept in this browser'
                  : `saved ${pallet.updatedAt}`
                : 'not saved yet · kept in this browser'}
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

          <Menu label="Export ▾" title="Other ways of getting this design out">
            {(close) => (
              <>
                <MenuItem
                  onClick={() => {
                    close();
                    openSheet();
                  }}
                  disabled={errors.length > 0}
                  note="The same sheet in a browser tab, without saving"
                >
                  Sheet preview
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    close();
                    void openDxf();
                  }}
                  disabled={busy || !canStore}
                  note="The plan as a CAD file, for AutoCAD and the like"
                >
                  DXF
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    close();
                    void openSvg();
                  }}
                  disabled={busy || !canStore}
                  note="The whole sheet as vector, for Canva, Illustrator or Inkscape"
                >
                  SVG
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    close();
                    exportJson();
                  }}
                  note="The design itself, to send to another copy of this program"
                >
                  Export as file
                </MenuItem>
              </>
            )}
          </Menu>

          <Menu label="⋯" title="More to do with this design">
            {(close) => (
              <>
                <MenuItem
                  onClick={() => {
                    close();
                    void copy();
                  }}
                  disabled={busy || !canStore}
                  note="A copy, as a new design. This is how an old design is kept before reworking it."
                >
                  Duplicate
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    close();
                    fileInput.current?.click();
                  }}
                  note="Read a design file in over this one"
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
                      adopt(emptyPallet({ id: pallet.clientId, name: pallet.clientName }));
                    }
                  }}
                  note="No layers at all, to build up from nothing"
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
                  note="Gone from the library. This cannot be undone."
                >
                  Delete this design
                </MenuItem>
              </>
            )}
          </Menu>

          <Button onClick={() => setHelp(true)} label="Help" title="Help, and what the words mean">
            ?
          </Button>

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

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 space-y-2.5 overflow-y-auto p-2.5">
          <Panel title="Design">
            {/*
              Four named groups rather than five identical grids. The fields are
              the same fields; what changes is that there are now four places to
              look instead of seventeen boxes at one weight.
            */}
            <SectionHeading>This design</SectionHeading>
            <div className="grid grid-cols-4 gap-3">
              {/* Optional: a design is drawn and printed long before the shop
                  has a code to give it. */}
              <Field
                label="Pallet code (optional)"
                id={fieldId('palletCode')}
                hint={HINTS.palletCode}
              >
                <TextInput value={pallet.palletCode} onChange={(palletCode) => patch({ palletCode })} placeholder="AP-001" />
              </Field>
              {/* The name is a copy of the client's, kept on the document so a
                  sheet can be printed from it alone. Both move together. */}
              <Field label="Client" id={fieldId('clientId')}>
                <Select
                  value={pallet.clientId}
                  options={clients.map((client) => [client.id, client.name] as [string, string])}
                  onChange={(clientId) => {
                    const client = clients.find((candidate) => candidate.id === clientId);
                    if (client) patch({ clientId: client.id, clientName: client.name });
                  }}
                />
              </Field>
              <Field label="Client part no" id={fieldId('clientPartNo')} hint={HINTS.clientPartNo}>
                <TextInput
                  value={pallet.clientPartNo ?? ''}
                  onChange={(value) => patch({ clientPartNo: value === '' ? undefined : value })}
                />
              </Field>
              {/* Optional as well: unnamed, the sheet heads itself with the
                  overall size and the dashboard reads "Untitled". */}
              <Field label="Pallet name (optional)" id={fieldId('palletName')}>
                <TextInput
                  value={pallet.palletName}
                  onChange={(palletName) => patch({ palletName })}
                  placeholder="1200 x 800"
                />
              </Field>
            </div>

            <div className="mt-5">
              <SectionHeading note="millimetres, always">Overall size</SectionHeading>
              <div className="grid grid-cols-4 gap-3">
                <Field label="Length" id={fieldId('overallLength')}>
                  <NumberInput value={pallet.overallLength} min={1} onChange={(overallLength) => patch({ overallLength })} />
                </Field>
                <Field label="Width" id={fieldId('overallWidth')}>
                  <NumberInput value={pallet.overallWidth} min={1} onChange={(overallWidth) => patch({ overallWidth })} />
                </Field>
                <Field
                  label="Height"
                  id={fieldId('overallHeight')}
                  hint={HINTS.derivedHeight}
                >
                  <NumberInput
                    value={pallet.overallHeight}
                    min={0}
                    placeholder="0 — use the stack"
                    onChange={(overallHeight) => patch({ overallHeight })}
                  />
                </Field>
                <Readout
                  label="Stack"
                  value={`${layout.derivedHeight} mm`}
                  hint="What the layers themselves add up to. With the height left at 0, this is the height the sheet prints."
                />
              </div>
            </div>

            {/* Every attribute below is allowed not to have an answer, and the
                two ways of not having one mean different things on the sheet.
                See NOT_APPLICABLE in types.ts. */}
            <div className="mt-5">
              <SectionHeading>Specification</SectionHeading>
              <div className="grid grid-cols-4 gap-3">
              <Field label="Type" id={fieldId('palletType')} hint={HINTS.palletType}>
                <Select
                  value={pallet.palletType}
                  options={[
                    BLANK,
                    ['block_4way', 'Block, 4-way'],
                    ['stringer_2way', 'Stringer, 2-way'],
                    ['plywood_type1', 'Plywood type 1, sheet on blocks'],
                    ['plywood_type2', 'Plywood type 2, sheet on centre boards'],
                    ['plywood_type3', 'Plywood type 3, sheet over a boarded deck'],
                    ['wing', 'Wing'],
                    ['other', 'Other'],
                    NOT_ON_SHEET,
                  ]}
                  onChange={(palletType) => patch({ palletType })}
                />
              </Field>
              <Field label="Deck" id={fieldId('deckType')} hint={HINTS.deckType}>
                <Select
                  value={pallet.deckType}
                  options={[
                    BLANK,
                    ['single_face', 'Single face'],
                    ['double_face_reversible', 'Double face, reversible'],
                    ['double_face_non_reversible', 'Double face, non-reversible'],
                    NOT_ON_SHEET,
                  ]}
                  onChange={(deckType) => patch({ deckType })}
                />
              </Field>
              <Field label="Entry" id={fieldId('entry')} hint={HINTS.entry}>
                <Select
                  value={pallet.entry}
                  options={[
                    BLANK,
                    ['2_way', '2-way'],
                    ['4_way', '4-way'],
                    ['partial_4way', 'Partial 4-way'],
                    NOT_ON_SHEET,
                  ]}
                  onChange={(entry) => patch({ entry })}
                />
              </Field>
              <Field label="Species" id={fieldId('species')} hint={HINTS.species}>
                <TextInput
                  value={pallet.species}
                  placeholder="pine"
                  onChange={(species) => patch({ species })}
                />
              </Field>
              <Field label="Planing" id={fieldId('planing')} hint={HINTS.planing}>
                <Select
                  value={pallet.planing}
                  options={[
                    BLANK,
                    ['none', 'None'],
                    ['1_side', '1 side'],
                    ['2_side', '2 sides'],
                    ['4_side', '4 sides'],
                    NOT_ON_SHEET,
                  ]}
                  onChange={(planing) => patch({ planing })}
                />
              </Field>
              </div>
            </div>

            <Handling pallet={pallet} patch={patch} />

            <div className="mt-5">
              <SectionHeading>Load and notes</SectionHeading>
              <div className="grid grid-cols-4 gap-3">
                <Field label="Static load (kg)" id={fieldId('staticLoadKg')} hint={HINTS.staticLoad}>
                  <NumberOrNaInput
                    value={pallet.staticLoadKg}
                    placeholder="kg"
                    onChange={(staticLoadKg) => patch({ staticLoadKg })}
                  />
                </Field>
                <Field
                  label="Dynamic load (kg)"
                  id={fieldId('dynamicLoadKg')}
                  hint={HINTS.dynamicLoad}
                >
                  <NumberOrNaInput
                    value={pallet.dynamicLoadKg}
                    placeholder="kg"
                    onChange={(dynamicLoadKg) => patch({ dynamicLoadKg })}
                  />
                </Field>
                {/* Printed in the title block under the date. Free text: a client
                    drawing number, "(old)", or nothing at all. */}
                <Field label="Sheet note" id={fieldId('note')} hint={HINTS.sheetNote}>
                  <TextInput
                    value={pallet.note ?? ''}
                    placeholder="printed beside the date"
                    onChange={(value) => patch({ note: value === '' ? undefined : value })}
                  />
                </Field>
                <Field label="Notes" id={fieldId('notes')}>
                  <TextInput value={pallet.notes ?? ''} onChange={(value) => patch({ notes: value === '' ? undefined : value })} />
                </Field>
              </div>

              <p className="mt-3 rounded-md bg-ground-soft px-3 py-2 text-micro text-ink-soft">
                Left blank, an attribute prints as “—” on the sheet — still asked, not yet answered.
                Typed as <code className="rounded bg-slate-200 px-1">na</code>, or picked as{' '}
                <em>not applicable</em> from a list, the whole line comes off the sheet.
              </p>
            </div>
          </Panel>

          {pallet.layers.map((layer, index) => (
            <LayerEditor
              key={layer.id}
              layer={layer}
              layout={layout}
              computed={layout.layers.find((computed) => computed.layerId === layer.id)}
              first={index === 0}
              selection={selection}
              dispatch={dispatch}
            />
          ))}

          {/* Named so the problem list has somewhere to send a design that has
              no layers yet — the answer to "needs at least one" is here. */}
          <div id={fieldId('layers')}>
          <Panel
            title="Add layer"
            actions={
              <div className="flex flex-wrap gap-1">
                {/* The swatch is the colour the layer will be drawn in, and the
                    colour its card will wear once it is there. */}
                {LAYER_KINDS.map(([kind, label]) => (
                  <Button key={kind} onClick={() => dispatch({ type: 'addLayer', kind })}>
                    <span
                      className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm align-middle"
                      style={{
                        background: LAYER_STYLE[kind].fill,
                        boxShadow: `inset 0 0 0 1px ${LAYER_STYLE[kind].stroke}`,
                      }}
                    />
                    {label}
                  </Button>
                ))}
              </div>
            }
          >
            <p className="text-label leading-relaxed text-ink-faint">
              Layers are ordered top to bottom. A new layer goes underneath the rest. A deck
              whose boards do not all run the same way is built as one layer per direction,
              each marked <em>same level as the layer above</em>.
            </p>
          </Panel>
          </div>

          <Nails pallet={pallet} dispatch={dispatch} />
          <CostingPanel costing={costing} />
        </div>

        <div className="flex w-[36%] min-w-0 shrink-0 flex-col border-l border-line bg-card">
          <Preview layout={layout} selection={selection} dispatch={dispatch} />

          <div className="border-t border-line-soft p-3">
            {chosen ? (
              <NudgeControl
                slotLabel={`${LAYER_KINDS.find(([kind]) => kind === chosen.layer.kind)?.[1] ?? chosen.layer.kind}, board ${chosen.index + 1}`}
                value={chosen.slot.nudgeMm}
                dispatch={dispatch}
              />
            ) : (
              <p className="text-label leading-relaxed text-ink-faint">
                Click a board to select it. Selection only — boards are never dragged; the arrow
                keys nudge the selected one, Shift by ten, Delete removes it, Esc lets it go.
              </p>
            )}
          </div>

          <Problems missing={missing} errors={errors} warnings={warnings} />
        </div>
      </div>
    </>
  );
}

/**
 * What the pallet may be moved with — the block printed in the corner of the
 * sheet, edited with the same icons it prints with.
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
    <div className="mt-5" id={fieldId('handling')}>
      <SectionHeading note="printed in the corner of the sheet, ticked and crossed">
        Handling
      </SectionHeading>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {handlingCatalogue().map(({ method, label }) => (
          <Check
            key={method}
            checked={pallet.handling.includes(method)}
            onChange={(on) => toggle(method, on)}
            label={label}
            strikeWhenOff
            // The sheet's own icon, taking its colour from the label around it,
            // so the row on screen is the row on paper.
            icon={
              <span
                className="inline-block h-5 w-5 shrink-0"
                dangerouslySetInnerHTML={{ __html: handlingIconSvg(method, 'currentColor', '100%') }}
              />
            }
          />
        ))}
      </div>
      <p className="mt-2 text-micro text-ink-faint">{HINTS.handling}</p>
    </div>
  );
}

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

  /** Put the field on screen and in the cursor, from a click on its name. */
  const goTo = (anchor: string) => {
    const field = document.getElementById(anchor);
    if (!field) return;
    field.scrollIntoView({ behavior: 'smooth', block: 'center' });
    field.querySelector<HTMLElement>('input, select, textarea')?.focus();
  };

  return (
    <div className="flex min-h-0 flex-col border-t border-line-soft">
      <div className="flex shrink-0 items-baseline gap-2 px-3 pt-3">
        <h3 className="text-micro font-semibold uppercase tracking-wider text-ink-faint">
          {total === 0 ? 'Ready' : 'Needs attention'}
        </h3>
        {total > 0 && (
          <span className="text-micro text-ink-faint">
            {[
              errors.length > 0 && `${errors.length} stopping the sheet`,
              missing.length > 0 && `${missing.length} not filled in`,
              warnings.length > 0 && `${warnings.length} to look at`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        )}
      </div>

      <div className="max-h-56 min-h-0 overflow-y-auto p-3 pt-2">
        {total === 0 ? (
          <p className="flex items-center gap-2 text-label text-emerald-700">
            <span aria-hidden="true">✓</span>
            Nothing to fix. This design is ready to save and print.
          </p>
        ) : (
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
        )}
      </div>
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

function Nails({ pallet, dispatch }: { pallet: Pallet; dispatch: (action: Action) => void }) {
  return (
    <Panel title="Nails" actions={<Button onClick={() => dispatch({ type: 'addNail' })}>Add</Button>}>
      {/* No schedule until one is typed: an empty table is a row of headings
          standing over nothing, and a pallet with no schedule prints none. */}
      {pallet.nails.length > 0 && (
        <table className="w-full text-ui">
          <thead>
            <tr className="text-micro uppercase tracking-wide text-slate-400">
              <th className="text-left font-medium">Joint</th>
              <th className="w-32 text-left font-medium">Type</th>
              <th className="w-20 text-left font-medium">Size</th>
              <th className="w-20 text-left font-medium">Qty</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {pallet.nails.map((nail, index) => (
              <tr key={index}>
                <td className="pr-1">
                  <TextInput
                    value={nail.label}
                    placeholder="top board to centre board"
                    onChange={(label) => dispatch({ type: 'patchNail', index, patch: { label } })}
                  />
                </td>
                <td className="pr-1">
                  <TextInput
                    value={nail.type}
                    onChange={(type) => dispatch({ type: 'patchNail', index, patch: { type } })}
                  />
                </td>
                <td className="pr-1">
                  <OptionalNumberInput
                    value={nail.sizeMm}
                    min={1}
                    placeholder="mm"
                    onChange={(sizeMm) => dispatch({ type: 'patchNail', index, patch: { sizeMm } })}
                  />
                </td>
                <td className="pr-1">
                  <OptionalNumberInput
                    value={nail.count}
                    min={0}
                    placeholder="qty"
                    onChange={(count) => dispatch({ type: 'patchNail', index, patch: { count } })}
                  />
                </td>
                <td>
                  <Button
                    size="sm"
                    tone="danger"
                    label={`Remove nail row ${index + 1}`}
                    onClick={() => dispatch({ type: 'removeNail', index })}
                  >
                    ×
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-3 text-label leading-relaxed text-ink-faint">
        The schedule printed on the sheet and priced by costing. Typed as you work it out; nothing
        here is derived, and nothing here moves a dot on the drawing. With no rows added, the sheet
        carries no nail table at all.
      </p>
      <p className="mt-1.5 text-label leading-relaxed text-ink-faint">
        Where the nails <em>go</em> is set on the drawing instead. Every crossing gets two on a
        diagonal, and the four corners of the top face get three. To change one, open the top or
        bottom view, turn on <em>Place nails</em> and click the crossing.
      </p>
    </Panel>
  );
}

/**
 * What the pallet costs at the rates in the config file. Not on the client
 * sheet, which is a specification and not a quotation.
 */
function CostingPanel({ costing }: { costing: Costing | null }) {
  if (!costing) return null;
  const money = (value: number): string => `${costing.currency} ${value.toFixed(2)}`;

  return (
    <Panel title="Timber and cost">
      <table className="w-full text-ui">
        <tbody>
          {costing.materials.map((line) => (
            <tr key={line.material}>
              <td className="text-slate-600">
                {line.material} <span className="text-slate-400">× {line.pieces}</span>
              </td>
              <td className="text-right tabular-nums text-slate-500">
                {line.cft.toFixed(3)} cft @ {line.ratePerCft}
              </td>
              <td className="w-24 text-right tabular-nums">{money(line.cost)}</td>
            </tr>
          ))}
          {/* Only where a schedule has been typed. Nothing is counted off the
              drawing, so with no rows there is no nail cost to state. */}
          {costing.nails.length > 0 && (
            <tr>
              <td className="text-slate-600">nails</td>
              <td className="text-right tabular-nums text-slate-500">{costing.nailCount}</td>
              <td className="text-right tabular-nums">{money(costing.nailCost)}</td>
            </tr>
          )}
          <tr>
            <td className="text-slate-600">overhead</td>
            <td className="text-right tabular-nums text-slate-500">
              {costing.overhead.perPallet} + {costing.overhead.percentOfMaterial}%
            </td>
            <td className="text-right tabular-nums">{money(costing.overhead.amount)}</td>
          </tr>
          <tr className="border-t border-slate-300 font-medium">
            <td>total</td>
            <td className="text-right tabular-nums text-slate-500">
              {costing.cft.toFixed(3)} cft
            </td>
            <td className="text-right tabular-nums">{money(costing.total)}</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-3 flex items-start gap-1.5 text-label leading-relaxed text-ink-faint">
        <span className="mt-0.5 shrink-0">
          <Hint text={HINTS.cft} />
        </span>
        <span>
          Rates come from <code className="rounded bg-ground px-1">config/rates.json</code>. Nothing
          here is printed on the sheet.
        </span>
      </p>
    </Panel>
  );
}
