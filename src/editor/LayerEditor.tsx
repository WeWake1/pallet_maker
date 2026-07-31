import { useEffect, useRef } from 'react';
import type { LayerLayout } from '../geometry/types.js';
import { mmLabel } from '../render/scene.js';
import type { Direction, Layer, LayerContent } from '../types.js';
import type { Action, Selection } from './state.js';
import { sameSource } from './state.js';
import { Button, Check, Field, NumberInput, Panel, Select, TextInput } from './ui.jsx';

/**
 * The form is layer based: add slots one at a time and set what each one is.
 * Nothing here draws anything; it edits the numbers the drawing is made from.
 */

const KIND_LABEL: Array<[Layer['kind'], string]> = [
  ['panel', 'Plywood sheet over the deck'],
  ['top_deck', 'Top boards'],
  ['bearer', 'Centre boards'],
  ['block', 'Blocks'],
  ['runner', 'Runners'],
  ['bottom_deck', 'Bottom boards'],
];

const DIRECTIONS: Array<[Direction, string]> = [
  ['along_length', 'Along length'],
  ['across_width', 'Across width'],
];

const CONTENTS: Array<[LayerContent['type'], string]> = [
  ['sequence', 'Boards'],
  ['grid', 'Block grid'],
  ['sheet', 'Plywood sheet'],
];

export function LayerEditor({
  layer,
  computed,
  frozen,
  selection,
  dispatch,
}: {
  layer: Layer;
  computed: LayerLayout | undefined;
  frozen: boolean;
  selection: Selection | null;
  dispatch: (action: Action) => void;
}) {
  const spread = computed?.spread;

  return (
    <Panel
      title={KIND_LABEL.find(([kind]) => kind === layer.kind)?.[1] ?? layer.kind}
      actions={
        <div className="flex gap-1">
          <Button onClick={() => dispatch({ type: 'moveLayer', layerId: layer.id, by: -1 })} disabled={frozen} title="Move up">
            ↑
          </Button>
          <Button onClick={() => dispatch({ type: 'moveLayer', layerId: layer.id, by: 1 })} disabled={frozen} title="Move down">
            ↓
          </Button>
          <Button tone="danger" onClick={() => dispatch({ type: 'removeLayer', layerId: layer.id })} disabled={frozen}>
            Remove
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-4 gap-2">
        <Field label="Kind">
          <Select
            value={layer.kind}
            options={KIND_LABEL}
            disabled={frozen}
            onChange={(kind) => dispatch({ type: 'patchLayer', layerId: layer.id, patch: { kind } })}
          />
        </Field>
        <Field label="Content">
          <Select
            value={layer.content.type}
            options={CONTENTS}
            disabled={frozen}
            onChange={(contentType) => dispatch({ type: 'setContent', layerId: layer.id, contentType })}
          />
        </Field>
        <Field label="Direction">
          <Select
            value={layer.direction}
            options={DIRECTIONS}
            disabled={frozen || layer.content.type === 'grid'}
            onChange={(direction) => dispatch({ type: 'patchLayer', layerId: layer.id, patch: { direction } })}
          />
        </Field>
        <div className="flex items-end text-xs text-slate-500">
          {spread ? (
            <span className={spread.slack < 0 ? 'text-red-600' : ''}>
              gap {mmLabel(spread.gap)} · slack {mmLabel(spread.slack)}
            </span>
          ) : computed?.rows ? (
            <span>
              rows {mmLabel(computed.rows.gap)} · cols {mmLabel(computed.cols?.gap ?? 0)}
            </span>
          ) : null}
        </div>
      </div>

      {layer.content.type !== 'grid' && (
        <div className="mt-2 grid grid-cols-4 gap-2">
          <Field label="Span (mm)">
            <NumberInput
              value={layer.spanMm ?? 0}
              min={0}
              disabled={frozen}
              onChange={(value) =>
                dispatch({ type: 'patchLayer', layerId: layer.id, patch: { spanMm: value > 0 ? value : null } })
              }
            />
          </Field>
          <Field label="Offset (mm)">
            <NumberInput
              value={layer.offsetMm}
              disabled={frozen}
              onChange={(offsetMm) => dispatch({ type: 'patchLayer', layerId: layer.id, patch: { offsetMm } })}
            />
          </Field>
          <Field label="Run span (mm)">
            <NumberInput
              value={layer.runSpanMm ?? 0}
              min={0}
              disabled={frozen}
              onChange={(value) =>
                dispatch({ type: 'patchLayer', layerId: layer.id, patch: { runSpanMm: value > 0 ? value : null } })
              }
            />
          </Field>
          <Field label="Run offset (mm)">
            <NumberInput
              value={layer.runOffsetMm}
              disabled={frozen}
              onChange={(runOffsetMm) => dispatch({ type: 'patchLayer', layerId: layer.id, patch: { runOffsetMm } })}
            />
          </Field>
        </div>
      )}

      {layer.content.type === 'sequence' && (
        <Slots layer={layer} slots={layer.content.slots} frozen={frozen} selection={selection} dispatch={dispatch} />
      )}
      {layer.content.type === 'grid' && <Grid layer={layer} frozen={frozen} dispatch={dispatch} />}
      {layer.content.type === 'sheet' && <Sheet layer={layer} frozen={frozen} dispatch={dispatch} />}
    </Panel>
  );
}

function Slots({
  layer,
  slots,
  frozen,
  selection,
  dispatch,
}: {
  layer: Layer;
  slots: import('../types.js').Slot[];
  frozen: boolean;
  selection: Selection | null;
  dispatch: (action: Action) => void;
}) {
  return (
    <div className="mt-3">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-slate-400">
            <th className="w-8 text-left font-medium">#</th>
            <th className="w-14 text-left font-medium">Part</th>
            <th className="text-left font-medium">Thick</th>
            <th className="text-left font-medium">Width</th>
            <th className="text-left font-medium">Length</th>
            <th className="text-left font-medium">Material</th>
            <th className="text-left font-medium">Variant</th>
            <th className="w-16 text-left font-medium">Nudge</th>
            <th className="w-20 text-left font-medium">Joined</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {slots.map((slot, index) => (
            <SlotRow
              key={index}
              layerId={layer.id}
              slot={slot}
              index={index}
              frozen={frozen}
              selected={
                selection?.layerId === layer.id &&
                sameSource(selection.source, { kind: 'slot', index })
              }
              dispatch={dispatch}
            />
          ))}
        </tbody>
      </table>
      <div className="mt-2">
        <Button onClick={() => dispatch({ type: 'addSlot', layerId: layer.id })} disabled={frozen}>
          Add board
        </Button>
      </div>
    </div>
  );
}

function SlotRow({
  layerId,
  slot,
  index,
  frozen,
  selected,
  dispatch,
}: {
  layerId: string;
  slot: import('../types.js').Slot;
  index: number;
  frozen: boolean;
  selected: boolean;
  dispatch: (action: Action) => void;
}) {
  const row = useRef<HTMLTableRowElement>(null);
  const patch = (patch: Partial<import('../types.js').Slot>) =>
    dispatch({ type: 'patchSlot', layerId, index, patch });

  // Clicking a board in the preview selects it and focuses its row here.
  useEffect(() => {
    if (selected) row.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selected]);

  return (
    <tr
      ref={row}
      onClick={() => dispatch({ type: 'select', selection: { layerId, source: { kind: 'slot', index } } })}
      className={selected ? 'bg-blue-50 outline outline-1 outline-blue-400' : 'hover:bg-slate-50'}
    >
      <td className="text-xs text-slate-400">{index + 1}</td>
      <td className="pr-1">
        <NumberInput value={slot.partNo} min={1} disabled={frozen} onChange={(partNo) => patch({ partNo })} />
      </td>
      <td className="pr-1">
        <NumberInput value={slot.thickness} min={1} disabled={frozen} onChange={(thickness) => patch({ thickness })} />
      </td>
      <td className="pr-1">
        <NumberInput value={slot.width} min={1} disabled={frozen} onChange={(width) => patch({ width })} />
      </td>
      <td className="pr-1">
        <NumberInput value={slot.length} min={1} disabled={frozen} onChange={(length) => patch({ length })} />
      </td>
      <td className="pr-1">
        <TextInput value={slot.material} disabled={frozen} onChange={(material) => patch({ material })} />
      </td>
      <td className="pr-1">
        <TextInput
          value={slot.variant ?? ''}
          disabled={frozen}
          onChange={(value) => patch({ variant: value === '' ? undefined : value })}
        />
      </td>
      <td className="pr-1">
        <NumberInput value={slot.nudgeMm} disabled={frozen} onChange={(nudgeMm) => patch({ nudgeMm })} />
      </td>
      <td>
        <Check
          checked={slot.joinedToPrev}
          disabled={frozen || index === 0}
          label=""
          onChange={(joinedToPrev) => patch({ joinedToPrev })}
        />
      </td>
      <td>
        <Button tone="danger" disabled={frozen} onClick={() => dispatch({ type: 'removeSlot', layerId, index })}>
          ×
        </Button>
      </td>
    </tr>
  );
}

function Grid({
  layer,
  frozen,
  dispatch,
}: {
  layer: Layer;
  frozen: boolean;
  dispatch: (action: Action) => void;
}) {
  if (layer.content.type !== 'grid') return null;
  const grid = layer.content.grid;

  return (
    <div className="mt-3">
      <div className="grid grid-cols-6 gap-2">
        <Field label="Rows">
          <NumberInput
            value={grid.rows}
            min={1}
            disabled={frozen}
            onChange={(rows) => dispatch({ type: 'patchGrid', layerId: layer.id, patch: { rows } })}
          />
        </Field>
        <Field label="Cols">
          <NumberInput
            value={grid.cols}
            min={1}
            disabled={frozen}
            onChange={(cols) => dispatch({ type: 'patchGrid', layerId: layer.id, patch: { cols } })}
          />
        </Field>
        <Field label="Row span">
          <NumberInput
            value={grid.rowSpanMm ?? 0}
            min={0}
            disabled={frozen}
            onChange={(value) =>
              dispatch({ type: 'patchGrid', layerId: layer.id, patch: { rowSpanMm: value > 0 ? value : null } })
            }
          />
        </Field>
        <Field label="Row offset">
          <NumberInput
            value={grid.rowOffsetMm}
            disabled={frozen}
            onChange={(rowOffsetMm) => dispatch({ type: 'patchGrid', layerId: layer.id, patch: { rowOffsetMm } })}
          />
        </Field>
        <Field label="Col span">
          <NumberInput
            value={grid.colSpanMm ?? 0}
            min={0}
            disabled={frozen}
            onChange={(value) =>
              dispatch({ type: 'patchGrid', layerId: layer.id, patch: { colSpanMm: value > 0 ? value : null } })
            }
          />
        </Field>
        <Field label="Col offset">
          <NumberInput
            value={grid.colOffsetMm}
            disabled={frozen}
            onChange={(colOffsetMm) => dispatch({ type: 'patchGrid', layerId: layer.id, patch: { colOffsetMm } })}
          />
        </Field>
      </div>

      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-slate-400">
            <th className="w-12 text-left font-medium">Cell</th>
            <th className="w-14 text-left font-medium">Part</th>
            <th className="text-left font-medium">Length</th>
            <th className="text-left font-medium">Width</th>
            <th className="text-left font-medium">Height</th>
            <th className="text-left font-medium">Material</th>
            <th className="w-24" />
          </tr>
        </thead>
        <tbody>
          {grid.cells.map((row, r) =>
            row.map((cell, c) => {
              const patch = (patch: Partial<import('../types.js').BlockCell>) =>
                dispatch({ type: 'patchCell', layerId: layer.id, row: r, col: c, patch });
              return (
                <tr key={`${r}-${c}`} className="hover:bg-slate-50">
                  <td className="text-xs text-slate-400">
                    r{r + 1} c{c + 1}
                  </td>
                  <td className="pr-1">
                    <NumberInput value={cell.partNo} min={1} disabled={frozen} onChange={(partNo) => patch({ partNo })} />
                  </td>
                  <td className="pr-1">
                    <NumberInput value={cell.lengthMm} min={1} disabled={frozen} onChange={(lengthMm) => patch({ lengthMm })} />
                  </td>
                  <td className="pr-1">
                    <NumberInput value={cell.widthMm} min={1} disabled={frozen} onChange={(widthMm) => patch({ widthMm })} />
                  </td>
                  <td className="pr-1">
                    <NumberInput value={cell.heightMm} min={1} disabled={frozen} onChange={(heightMm) => patch({ heightMm })} />
                  </td>
                  <td className="pr-1">
                    <TextInput value={cell.material} disabled={frozen} onChange={(material) => patch({ material })} />
                  </td>
                  <td>
                    <Button
                      disabled={frozen}
                      title="Copy this cell to every cell in the grid"
                      onClick={() => dispatch({ type: 'fillGrid', layerId: layer.id, row: r, col: c })}
                    >
                      Fill all
                    </Button>
                  </td>
                </tr>
              );
            }),
          )}
        </tbody>
      </table>
    </div>
  );
}

function Sheet({
  layer,
  frozen,
  dispatch,
}: {
  layer: Layer;
  frozen: boolean;
  dispatch: (action: Action) => void;
}) {
  if (layer.content.type !== 'sheet') return null;
  const sheet = layer.content.sheet;
  const patch = (patch: Partial<import('../types.js').SheetSpec>) =>
    dispatch({ type: 'patchSheet', layerId: layer.id, patch });

  return (
    <div className="mt-3 grid grid-cols-5 gap-2">
      <Field label="Part">
        <NumberInput value={sheet.partNo} min={1} disabled={frozen} onChange={(partNo) => patch({ partNo })} />
      </Field>
      <Field label="Thickness">
        <NumberInput value={sheet.thickness} min={1} disabled={frozen} onChange={(thickness) => patch({ thickness })} />
      </Field>
      <Field label="Width">
        <NumberInput value={sheet.width} min={1} disabled={frozen} onChange={(width) => patch({ width })} />
      </Field>
      <Field label="Length">
        <NumberInput value={sheet.length} min={1} disabled={frozen} onChange={(length) => patch({ length })} />
      </Field>
      <Field label="Material">
        <TextInput value={sheet.material} disabled={frozen} onChange={(material) => patch({ material })} />
      </Field>
    </div>
  );
}
