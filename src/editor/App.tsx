import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { computeCosting } from '../costing/costing.js';
import type { Costing } from '../costing/costing.js';
import type { Rates } from '../costing/rates.js';
import { analysePallet } from '../geometry/layout.js';
import { duplicatePallet } from '../revisions.js';
import { PalletSchema, parsePallet } from '../schema.js';
import { renderSheet } from '../sheet/sheet.js';
import type { LayerKind, Pallet } from '../types.js';
import { api } from './api.js';
import type { PalletSummary } from './api.js';
import { DesignList } from './DesignList.jsx';
import { LayerEditor } from './LayerEditor.jsx';
import { Preview } from './Preview.jsx';
import { reducer, selectedSlot } from './state.js';
import type { Action } from './state.js';
import { newPallet } from './templates.js';
import { Button, Field, NumberInput, Panel, Select, TextInput } from './ui.jsx';

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

export function App() {
  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    pallet: newPallet(),
    selection: null,
  }));
  const { pallet, selection } = state;
  const fileInput = useRef<HTMLInputElement>(null);

  const [designs, setDesigns] = useState<PalletSummary[]>([]);
  const [rates, setRates] = useState<Rates | null>(null);
  const [savedDoc, setSavedDoc] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
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

  const stored = designs.some((design) => design.id === pallet.id);
  const dirty = savedDoc !== JSON.stringify(pallet);
  const canStore = missing.length === 0 && errors.length === 0;

  const patch = (patch: Partial<Pallet>) => dispatch({ type: 'patchPallet', patch });

  const refresh = useCallback(async () => {
    setDesigns(await api.list());
  }, []);

  /** Anything that talks to the store: one place to hold the error it returns. */
  const attempt = useCallback(
    async (work: () => Promise<Pallet | null>) => {
      setBusy(true);
      setProblem(null);
      try {
        const result = await work();
        if (result) {
          dispatch({ type: 'replace', pallet: result });
          setSavedDoc(JSON.stringify(result));
        }
        await refresh();
      } catch (error) {
        setProblem(error instanceof Error ? error.message : String(error));
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

  // Costed as it is edited, not only once it has been saved.
  const costing = useMemo(
    () => (rates ? computeCosting(layout, pallet.nails, rates) : null),
    [layout, pallet.nails, rates],
  );

  const load = (id: string) => attempt(() => api.get(id));
  const save = () => attempt(() => (stored ? api.save(pallet) : api.create(pallet)));
  const freeze = () =>
    attempt(async () => {
      if (!stored || dirty) await (stored ? api.save(pallet) : api.create(pallet));
      return api.freeze(pallet.id);
    });
  const revise = () => attempt(() => api.revise(pallet.id));
  const copy = () =>
    attempt(async () => (stored ? api.duplicate(pallet.id) : api.create(duplicatePallet(pallet))));
  const remove = () =>
    attempt(async () => {
      await api.remove(pallet.id);
      return newPallet();
    });

  /** The PDF comes from the store, so what is printed is what is recorded. */
  const openPdf = () =>
    attempt(async () => {
      const saved = stored ? await api.save(pallet) : await api.create(pallet);
      window.open(api.sheetUrl(saved.id), '_blank');
      return saved;
    });

  /** The DXF comes from the store too, for the same reason the PDF does. */
  const openDxf = () =>
    attempt(async () => {
      const saved = stored ? await api.save(pallet) : await api.create(pallet);
      window.open(api.dxfUrl(saved.id), '_blank');
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
    link.download = pallet.palletCode + '-rev-' + pallet.revision + '.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  const importJson = async (file: File) => {
    try {
      dispatch({ type: 'replace', pallet: parsePallet(JSON.parse(await file.text())) });
      setSavedDoc(null);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  };

  const open = (next: Pallet) => {
    dispatch({ type: 'replace', pallet: next });
    setSavedDoc(null);
    setProblem(null);
  };

  return (
    <div className="flex h-full flex-col bg-slate-100 text-slate-900">
      <header className="flex items-center gap-2 border-b border-slate-300 bg-white px-3 py-2">
        <h1 className="mr-2 text-sm font-semibold">Pallet spec</h1>
        <Button onClick={() => open(newPallet())}>New</Button>
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
            if (found) open(parsePallet(found.pallet));
          }}
        >
          <option value="">Open example…</option>
          {FIXTURES.map((fixture) => (
            <option key={fixture.name} value={fixture.name}>
              {fixture.name}
            </option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-2">
          {pallet.frozen ? (
            <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
              Rev {pallet.revision} published — never edited
            </span>
          ) : (
            <span className="text-xs text-slate-500">
              Rev {pallet.revision} draft{dirty ? ' · unsaved' : ''}
            </span>
          )}
          <span className="text-xs text-slate-500">
            {layout.pieces.length} pieces · {layout.overallLength} × {layout.overallWidth} ×{' '}
            {layout.overallHeight}
          </span>

          <Button onClick={() => void copy()} disabled={busy} title="A new design, linked to nothing">
            Duplicate
          </Button>
          {pallet.frozen ? (
            <Button
              tone="primary"
              onClick={() => void revise()}
              disabled={busy}
              title="Start the next revision. This one stays exactly as it is."
            >
              Revise
            </Button>
          ) : (
            <>
              <Button
                onClick={() => void remove()}
                tone="danger"
                disabled={busy || !stored}
                title="Delete this draft"
              >
                Delete
              </Button>
              <Button
                onClick={() => void freeze()}
                disabled={busy || !canStore}
                title="Publish. From here it is read-only and kept forever."
              >
                Publish
              </Button>
              <Button onClick={() => void save()} disabled={busy || !canStore || !dirty}>
                Save
              </Button>
            </>
          )}
          <Button onClick={openSheet} disabled={errors.length > 0}>
            Sheet
          </Button>
          <Button onClick={() => void openDxf()} disabled={busy || !canStore}>
            DXF
          </Button>
          <Button tone="primary" onClick={() => void openPdf()} disabled={busy || !canStore}>
            PDF
          </Button>
        </div>
      </header>

      {problem && (
        <div className="border-b border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700">
          {problem}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <DesignList
          designs={designs}
          currentId={stored ? pallet.id : null}
          onOpen={(id) => void load(id)}
        />

        <div className="min-w-0 flex-1 space-y-2.5 overflow-y-auto p-2.5">
          <Panel title="Design">
            {/* A published revision is read-only, so it does not invite an edit
                that the store would only refuse. */}
            <fieldset disabled={pallet.frozen} className="contents">
            <div className="grid grid-cols-4 gap-2">
              <Field label="Pallet code">
                <TextInput value={pallet.palletCode} onChange={(palletCode) => patch({ palletCode })} placeholder="AP-001" />
              </Field>
              <Field label="Client">
                <TextInput value={pallet.clientName} onChange={(clientName) => patch({ clientName })} />
              </Field>
              <Field label="Client part no">
                <TextInput
                  value={pallet.clientPartNo ?? ''}
                  onChange={(value) => patch({ clientPartNo: value === '' ? undefined : value })}
                />
              </Field>
              <Field label="Pallet name">
                <TextInput value={pallet.palletName} onChange={(palletName) => patch({ palletName })} />
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

            <div className="mt-2 grid grid-cols-4 gap-2">
              <Field label="Type">
                <Select
                  value={pallet.palletType}
                  options={[
                    ['block_4way', 'Block, 4-way'],
                    ['stringer_2way', 'Stringer, 2-way'],
                    ['plywood_type1', 'Plywood type 1, sheet on blocks'],
                    ['plywood_type2', 'Plywood type 2, sheet on centre boards'],
                    ['plywood_type3', 'Plywood type 3, sheet over a boarded deck'],
                    ['wing', 'Wing'],
                    ['other', 'Other'],
                  ]}
                  onChange={(palletType) => patch({ palletType })}
                />
              </Field>
              <Field label="Deck">
                <Select
                  value={pallet.deckType}
                  options={[
                    ['single_face', 'Single face'],
                    ['double_face_reversible', 'Double face, reversible'],
                    ['double_face_non_reversible', 'Double face, non-reversible'],
                  ]}
                  onChange={(deckType) => patch({ deckType })}
                />
              </Field>
              <Field label="Entry">
                <Select
                  value={pallet.entry}
                  options={[
                    ['2_way', '2-way'],
                    ['4_way', '4-way'],
                    ['partial_4way', 'Partial 4-way'],
                  ]}
                  onChange={(entry) => patch({ entry })}
                />
              </Field>
              <Field label="Species">
                <TextInput value={pallet.species} onChange={(species) => patch({ species })} />
              </Field>
            </div>

            <div className="mt-2 grid grid-cols-4 gap-2">
              <Field label="Planing">
                <Select
                  value={pallet.planing}
                  options={[
                    ['none', 'None'],
                    ['1_side', '1 side'],
                    ['2_side', '2 sides'],
                    ['4_side', '4 sides'],
                  ]}
                  onChange={(planing) => patch({ planing })}
                />
              </Field>
              <Field label="Static load (kg)">
                <NumberInput
                  value={pallet.staticLoadKg ?? 0}
                  min={0}
                  onChange={(value) => patch({ staticLoadKg: value > 0 ? value : undefined })}
                />
              </Field>
              <Field label="Dynamic load (kg)">
                <NumberInput
                  value={pallet.dynamicLoadKg ?? 0}
                  min={0}
                  onChange={(value) => patch({ dynamicLoadKg: value > 0 ? value : undefined })}
                />
              </Field>
              <Field label="Revision">
                <div className="flex gap-1">
                  <TextInput value={pallet.revision} onChange={(revision) => patch({ revision })} />
                  <TextInput value={pallet.revisionDate} onChange={(revisionDate) => patch({ revisionDate })} />
                </div>
              </Field>
            </div>

            <div className="mt-2">
              <Field label="Notes">
                <TextInput value={pallet.notes ?? ''} onChange={(value) => patch({ notes: value === '' ? undefined : value })} />
              </Field>
            </div>
            </fieldset>
          </Panel>

          {pallet.layers.map((layer) => (
            <LayerEditor
              key={layer.id}
              layer={layer}
              computed={layout.layers.find((computed) => computed.layerId === layer.id)}
              frozen={pallet.frozen}
              selection={selection}
              dispatch={dispatch}
            />
          ))}

          <Panel
            title="Add layer"
            actions={
              <div className="flex flex-wrap gap-1">
                {LAYER_KINDS.map(([kind, label]) => (
                  <Button key={kind} disabled={pallet.frozen} onClick={() => dispatch({ type: 'addLayer', kind })}>
                    + {label}
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
                slotLabel={`Part ${chosen.slot.partNo}, board ${chosen.index + 1}`}
                value={chosen.slot.nudgeMm}
                frozen={pallet.frozen}
                dispatch={dispatch}
              />
            ) : (
              <p className="text-xs text-slate-500">
                Click a board to select it. Selection only — boards are never dragged.
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
  frozen,
  dispatch,
}: {
  slotLabel: string;
  value: number;
  frozen: boolean;
  dispatch: (action: Action) => void;
}) {
  return (
    <div className="flex items-end gap-2">
      <div className="flex-1">
        <Field label={`Nudge — ${slotLabel}`}>
          <NumberInput
            value={value}
            disabled={frozen}
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
      <Button disabled={frozen} onClick={() => dispatch({ type: 'nudge', delta: -1 })}>
        −1
      </Button>
      <Button disabled={frozen} onClick={() => dispatch({ type: 'nudge', delta: 1 })}>
        +1
      </Button>
      <Button disabled={frozen || value === 0} onClick={() => dispatch({ type: 'setNudge', value: 0 })}>
        Clear
      </Button>
    </div>
  );
}

function Nails({ pallet, dispatch }: { pallet: Pallet; dispatch: (action: Action) => void }) {
  return (
    <Panel
      title="Nails"
      actions={
        <Button disabled={pallet.frozen} onClick={() => dispatch({ type: 'addNail' })}>
          Add
        </Button>
      }
    >
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
                  disabled={pallet.frozen}
                  placeholder="top board to centre board"
                  onChange={(label) => dispatch({ type: 'patchNail', index, patch: { label } })}
                />
              </td>
              <td className="pr-1">
                <TextInput
                  value={nail.type}
                  disabled={pallet.frozen}
                  onChange={(type) => dispatch({ type: 'patchNail', index, patch: { type } })}
                />
              </td>
              <td className="pr-1">
                <NumberInput
                  value={nail.sizeMm}
                  min={1}
                  disabled={pallet.frozen}
                  onChange={(sizeMm) => dispatch({ type: 'patchNail', index, patch: { sizeMm } })}
                />
              </td>
              <td className="pr-1">
                <NumberInput
                  value={nail.count}
                  min={0}
                  disabled={pallet.frozen}
                  onChange={(count) => dispatch({ type: 'patchNail', index, patch: { count } })}
                />
              </td>
              <td>
                <Button tone="danger" disabled={pallet.frozen} onClick={() => dispatch({ type: 'removeNail', index })}>
                  ×
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-slate-500">
        Dots are placed automatically where a deck board crosses the layer against it. The label
        names the two layers, which is how the count finds its crossings.
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
