import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { computeCosting } from '../costing/costing.js';
import type { Costing } from '../costing/costing.js';
import type { Rates } from '../costing/rates.js';
import { duplicatePallet } from '../duplicate.js';
import { analysePallet } from '../geometry/layout.js';
import { LAYER_STYLE } from '../render/theme.js';
import { PalletSchema, parsePallet } from '../schema.js';
import { renderSheet } from '../sheet/sheet.js';
import { NOT_APPLICABLE } from '../types.js';
import type { Client, LayerKind, Pallet, Unstated } from '../types.js';
import { api } from './api.js';
import type { ClientDesigns } from './api.js';
import { Dashboard } from './Dashboard.jsx';
import type { DesignActions } from './Dashboard.jsx';
import { clearDraft, clearDrafts, draftAge, listDrafts, readDraft, writeDraft } from './drafts.js';
import type { Draft } from './drafts.js';
import { canRedo, canUndo, historyReducer, initialHistory } from './history.js';
import { LayerEditor } from './LayerEditor.jsx';
import { Preview } from './Preview.jsx';
import { shortcutLabel, useShortcuts } from './shortcuts.js';
import { selectedSlot } from './state.js';
import type { Action } from './state.js';
import { newPallet } from './templates.js';
import {
  Button,
  Field,
  NumberInput,
  NumberOrNaInput,
  OptionalNumberInput,
  Panel,
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
  const [busy, setBusy] = useState(false);

  const clients = useMemo(() => sections.map((section) => section.client), [sections]);

  const refresh = useCallback(async () => {
    const next = await api.dashboard();
    setSections(next);
    setDrafts(usableDrafts(next));
  }, []);

  /** Anything that talks to the store: one place to hold the error it returns. */
  const attempt = useCallback(
    async <T,>(work: () => Promise<T>): Promise<T | undefined> => {
      setBusy(true);
      setProblem(null);
      try {
        const result = await work();
        await refresh();
        return result;
      } catch (error) {
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
  };

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

  return (
    <div className="flex h-full flex-col bg-slate-100 text-slate-900">
      {problem && (
        <div className="border-b border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700">
          {problem}
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
          <header className="flex items-center gap-2 border-b border-slate-300 bg-white px-3 py-2">
            <h1 className="text-sm font-semibold">Pallet spec</h1>
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
          />
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

  // The drawing is always regenerated from the data, on every keystroke.
  const layout = useMemo(() => analysePallet(pallet), [pallet]);
  const errors = layout.issues.filter((issue) => issue.severity === 'error');
  const warnings = layout.issues.filter((issue) => issue.severity === 'warning');

  // A design being worked on is allowed to be incomplete, but it has to be told
  // what is still missing before it can be saved or printed.
  const missing = useMemo(() => {
    const parsed = PalletSchema.safeParse(pallet);
    return parsed.success
      ? []
      : parsed.error.issues.map((issue) => `${issue.path.join('.') || 'pallet'}: ${issue.message}`);
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
    link.download = `${pallet.palletCode || 'pallet'}-${pallet.updatedAt}.json`;
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
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
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

      <header className="flex items-center gap-2 border-b border-slate-300 bg-white px-3 py-2">
        <Button onClick={onBack} title="Back to the design library">
          ← Designs
        </Button>
        <h1 className="ml-1 mr-2 text-sm font-semibold">
          {pallet.palletName || 'Untitled'}
          <span className="ml-2 font-normal text-slate-400">{pallet.clientName}</span>
        </h1>

        {/* The keyboard is how these are actually used; the buttons are here so
            that the shortcut is written down somewhere the hand can find it. */}
        <Button
          onClick={() => dispatch({ type: 'undo' })}
          disabled={!canUndo(history)}
          title={`Undo (${shortcutLabel('mod+z')})`}
        >
          ↶
        </Button>
        <Button
          onClick={() => dispatch({ type: 'redo' })}
          disabled={!canRedo(history)}
          title={`Redo (${shortcutLabel('mod+shift+z')})`}
        >
          ↷
        </Button>

        <Button onClick={() => fileInput.current?.click()}>Import</Button>
        <Button onClick={exportJson}>Export</Button>
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
        <select
          className="rounded border border-slate-300 px-1.5 py-1 text-sm"
          value=""
          onChange={(event) => {
            const found = FIXTURES.find((fixture) => fixture.name === event.target.value);
            if (found) adopt(parsePallet(found.pallet));
          }}
        >
          <option value="">Start from example…</option>
          {FIXTURES.map((fixture) => (
            <option key={fixture.name} value={fixture.name}>
              {fixture.name}
            </option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-2">
          {/* Unsaved work is kept in this browser as it is typed, so say so
              rather than only warning — the warning was the whole message
              before, and it is not the frightening half that is true. */}
          <span className="text-xs text-slate-500" title={unsaved ? 'Kept in this browser until you press Save' : undefined}>
            {stored
              ? dirty
                ? 'unsaved changes · kept in this browser'
                : `saved ${pallet.updatedAt}`
              : 'not saved yet · kept in this browser'}
          </span>
          <span className="text-xs text-slate-500">
            {layout.pieces.length} pieces · {layout.overallLength} × {layout.overallWidth} ×{' '}
            {layout.overallHeight}
          </span>

          <Button
            onClick={() => void copy()}
            disabled={busy || !canStore}
            title="A copy, as a new design. This is how an old design is kept before reworking it."
          >
            Duplicate
          </Button>
          <Button
            onClick={() => {
              if (window.confirm('Delete this design? This cannot be undone.')) void remove();
            }}
            tone="danger"
            disabled={busy}
            title="Delete this design"
          >
            Delete
          </Button>
          <Button onClick={openSheet} disabled={errors.length > 0}>
            Sheet
          </Button>
          <Button
            onClick={() => void openDxf()}
            disabled={busy || !canStore}
            title="The plan as a CAD file, for AutoCAD and the like"
          >
            DXF
          </Button>
          <Button
            onClick={() => void openSvg()}
            disabled={busy || !canStore}
            title="The whole sheet as vector, to work on in Canva, Illustrator or Inkscape"
          >
            SVG
          </Button>
          <Button onClick={() => void openPdf()} disabled={busy || !canStore}>
            PDF
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

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 space-y-2.5 overflow-y-auto p-2.5">
          <Panel title="Design">
            <div className="grid grid-cols-4 gap-2">
              {/* Optional: a design is drawn and printed long before the shop
                  has a code to give it. */}
              <Field label="Pallet code (optional)">
                <TextInput value={pallet.palletCode} onChange={(palletCode) => patch({ palletCode })} placeholder="AP-001" />
              </Field>
              {/* The name is a copy of the client's, kept on the document so a
                  sheet can be printed from it alone. Both move together. */}
              <Field label="Client">
                <Select
                  value={pallet.clientId}
                  options={clients.map((client) => [client.id, client.name] as [string, string])}
                  onChange={(clientId) => {
                    const client = clients.find((candidate) => candidate.id === clientId);
                    if (client) patch({ clientId: client.id, clientName: client.name });
                  }}
                />
              </Field>
              <Field label="Client part no">
                <TextInput
                  value={pallet.clientPartNo ?? ''}
                  onChange={(value) => patch({ clientPartNo: value === '' ? undefined : value })}
                />
              </Field>
              {/* Optional as well: unnamed, the sheet heads itself with the
                  overall size and the dashboard reads "Untitled". */}
              <Field label="Pallet name (optional)">
                <TextInput
                  value={pallet.palletName}
                  onChange={(palletName) => patch({ palletName })}
                  placeholder="1000 x 800"
                />
              </Field>
            </div>

            <div className="mt-2 grid grid-cols-4 gap-2">
              <Field label="Length (mm)">
                <NumberInput value={pallet.overallLength} min={1} onChange={(overallLength) => patch({ overallLength })} />
              </Field>
              <Field label="Width (mm)">
                <NumberInput value={pallet.overallWidth} min={1} onChange={(overallWidth) => patch({ overallWidth })} />
              </Field>
              <Field label="Height (mm, 0 = derived)">
                <NumberInput value={pallet.overallHeight} min={0} onChange={(overallHeight) => patch({ overallHeight })} />
              </Field>
              <div className="flex items-end pb-1 text-xs text-slate-500">
                stack {layout.derivedHeight}
              </div>
            </div>

            {/* Every attribute below is allowed not to have an answer, and the
                two ways of not having one mean different things on the sheet.
                See NOT_APPLICABLE in types.ts. */}
            <div className="mt-2 grid grid-cols-4 gap-2">
              <Field label="Type">
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
              <Field label="Deck">
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
              <Field label="Entry">
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
              <Field label="Species">
                <TextInput
                  value={pallet.species}
                  placeholder="pine"
                  onChange={(species) => patch({ species })}
                />
              </Field>
            </div>

            <div className="mt-2 grid grid-cols-4 gap-2">
              <Field label="Planing">
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
              <Field label="Static load (kg)">
                <NumberOrNaInput
                  value={pallet.staticLoadKg}
                  placeholder="kg"
                  onChange={(staticLoadKg) => patch({ staticLoadKg })}
                />
              </Field>
              <Field label="Dynamic load (kg)">
                <NumberOrNaInput
                  value={pallet.dynamicLoadKg}
                  placeholder="kg"
                  onChange={(dynamicLoadKg) => patch({ dynamicLoadKg })}
                />
              </Field>
              {/* Printed in the title block under the date. Free text: a client
                  drawing number, "(old)", or nothing at all. */}
              <Field label="Sheet note">
                <TextInput
                  value={pallet.note ?? ''}
                  placeholder="printed beside the date"
                  onChange={(value) => patch({ note: value === '' ? undefined : value })}
                />
              </Field>
            </div>

            <div className="mt-2">
              <Field label="Notes">
                <TextInput value={pallet.notes ?? ''} onChange={(value) => patch({ notes: value === '' ? undefined : value })} />
              </Field>
            </div>

            <p className="mt-2 text-[11px] text-slate-500">
              Left blank, an attribute prints as “—” on the sheet — still asked, not yet answered.
              Typed as <code className="rounded bg-slate-100 px-1">na</code>, or picked as{' '}
              <em>not applicable</em> from a list, the whole line comes off the sheet.
            </p>
          </Panel>

          {pallet.layers.map((layer) => (
            <LayerEditor
              key={layer.id}
              layer={layer}
              computed={layout.layers.find((computed) => computed.layerId === layer.id)}
              selection={selection}
              dispatch={dispatch}
            />
          ))}

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
            <p className="text-xs text-slate-500">
              Layers are ordered top to bottom. A new layer goes underneath the rest.
            </p>
          </Panel>

          <Nails pallet={pallet} dispatch={dispatch} />
          <CostingPanel costing={costing} />
        </div>

        <div className="flex w-[36%] min-w-0 shrink-0 flex-col border-l border-slate-300 bg-white">
          <Preview layout={layout} selection={selection} dispatch={dispatch} />

          <div className="border-t border-slate-200 p-2.5">
            {chosen ? (
              <NudgeControl
                slotLabel={`${LAYER_KINDS.find(([kind]) => kind === chosen.layer.kind)?.[1] ?? chosen.layer.kind}, board ${chosen.index + 1}`}
                value={chosen.slot.nudgeMm}
                dispatch={dispatch}
              />
            ) : (
              <p className="text-xs text-slate-500">
                Click a board to select it. Selection only — boards are never dragged; the arrow
                keys nudge the selected one, Shift by ten, Delete removes it, Esc lets it go.
              </p>
            )}
          </div>

          <div className="max-h-56 overflow-y-auto border-t border-slate-200 p-2.5">
            {errors.length === 0 && warnings.length === 0 && missing.length === 0 ? (
              <p className="text-xs text-slate-500">No problems.</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {missing.map((message, index) => (
                  <li key={`m${index}`} className="rounded bg-slate-100 px-2 py-1 text-slate-600">
                    Not filled in — {message}
                  </li>
                ))}
                {errors.map((issue, index) => (
                  <li key={`e${index}`} className="rounded bg-red-50 px-2 py-1 text-red-700">
                    {issue.message}
                  </li>
                ))}
                {warnings.map((issue, index) => (
                  <li key={`w${index}`} className="rounded bg-amber-50 px-2 py-1 text-amber-800">
                    {issue.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </>
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
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-slate-400">
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
                <Button tone="danger" onClick={() => dispatch({ type: 'removeNail', index })}>
                  ×
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-slate-500">
        The schedule printed on the sheet and priced by costing. Typed as you work it out; nothing
        here is derived, and nothing here moves a dot on the drawing.
      </p>
      <p className="mt-1 text-xs text-slate-500">
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
      <table className="w-full text-sm">
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
          <tr>
            <td className="text-slate-600">nails</td>
            <td className="text-right tabular-nums text-slate-500">{costing.nailCount}</td>
            <td className="text-right tabular-nums">{money(costing.nailCost)}</td>
          </tr>
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
      <p className="mt-2 text-xs text-slate-500">
        Rates come from <code>config/rates.json</code>. Nothing here is printed on the sheet.
      </p>
    </Panel>
  );
}
