import { useEffect, useRef } from 'react';
import { fitRun } from '../geometry/fit.js';
import type { LayerLayout, Layout } from '../geometry/types.js';
import { mmLabel } from '../render/scene.js';
import { LAYER_STYLE } from '../render/theme.js';
import type { LayerStyle } from '../render/theme.js';
import type { BlockCell, Direction, Layer, LayerContent, SheetSpec, Slot } from '../types.js';
import type { Action, Selection } from './state.js';
import { MAX_GRID_SIDE, MAX_SLOTS, sameSource } from './state.js';
import {
  Button,
  Check,
  Disclosure,
  Field,
  KeyFields,
  NumberInput,
  Panel,
  Select,
  TextInput,
} from './ui.jsx';

/**
 * The form is layer based: say how many components the layer has and what size
 * they are, then correct any that differ.
 * Nothing here draws anything; it edits the numbers the drawing is made from.
 */

/**
 * The value every component in a layer shares, or null where they differ.
 *
 * Nearly every layer is one size repeated, so nearly every one of these is a
 * value, and the row that stands for the whole layer can be filled in.
 */
function common<T, V>(items: T[], read: (item: T) => V): V | null {
  const first = items[0];
  if (first === undefined) return null;
  const value = read(first);
  return items.every((item) => read(item) === value) ? value : null;
}

/** A number for a field standing in for a whole layer: blank when they differ. */
function sharedNumber<T>(items: T[], read: (item: T) => number): number {
  return common(items, read) ?? Number.NaN;
}

const MIXED = 'mixed';

/**
 * How many distinct sizes a layer's components come in.
 *
 * One is the normal case and the case the layer row describes on its own; more
 * than one is the design that needs the table underneath opening.
 */
function sizeCount(sizes: string[]): number {
  return new Set(sizes).size;
}

/** What the folded-away table is called, and whether it has anything to say. */
function componentSummary(what: string, sizes: string[]): string {
  const distinct = sizeCount(sizes);
  const each = `${sizes.length} ${what}${sizes.length === 1 ? '' : 's'}`;
  return distinct <= 1
    ? `${each}, all the same — open to change one on its own`
    : `${each} in ${distinct} sizes — open to see them`;
}

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
  layout,
  computed,
  first,
  selection,
  dispatch,
}: {
  layer: Layer;
  layout: Layout;
  computed: LayerLayout | undefined;
  /** The topmost layer, which has nothing above it to share a level with. */
  first: boolean;
  selection: Selection | null;
  dispatch: (action: Action) => void;
}) {
  const spread = computed?.spread;
  // The colour this layer is drawn in, worn by its card and by the boxed row
  // inside it, so the two agree about what is what.
  const accent = LAYER_STYLE[layer.kind];
  // Only offered once there is something to fit between: the button is the
  // arithmetic, and with nothing sharing the level there is no sum to do.
  const fit = layer.content.type === 'grid' ? null : fitRun(layout, layer.id);

  return (
    <Panel
      title={KIND_LABEL.find(([kind]) => kind === layer.kind)?.[1] ?? layer.kind}
      accent={accent}
      actions={
        <div className="flex gap-1">
          <Button onClick={() => dispatch({ type: 'moveLayer', layerId: layer.id, by: -1 })} title="Move up">
            ↑
          </Button>
          <Button onClick={() => dispatch({ type: 'moveLayer', layerId: layer.id, by: 1 })} title="Move down">
            ↓
          </Button>
          <Button tone="danger" onClick={() => dispatch({ type: 'removeLayer', layerId: layer.id })}>
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
            onChange={(kind) => dispatch({ type: 'patchLayer', layerId: layer.id, patch: { kind } })}
          />
        </Field>
        <Field label="Content">
          <Select
            value={layer.content.type}
            options={CONTENTS}
            onChange={(contentType) => dispatch({ type: 'setContent', layerId: layer.id, contentType })}
          />
        </Field>
        <Field label="Direction">
          <Select
            value={layer.direction}
            options={DIRECTIONS}
            disabled={layer.content.type === 'grid'}
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

      {/* A deck whose boards do not all run the same way is built as one layer
          per direction, marked to share a height rather than to stack. Not
          offered on the top layer, which has nothing above it. */}
      {!first && (
        <div className="mt-2">
          <Check
            checked={layer.sameLevelAsPrev}
            label="Same level as the layer above — one course of timber, not stacked on it"
            onChange={(sameLevelAsPrev) =>
              dispatch({ type: 'patchLayer', layerId: layer.id, patch: { sameLevelAsPrev } })
            }
          />
        </div>
      )}

      {layer.content.type !== 'grid' && (
        <div className="mt-2 grid grid-cols-4 gap-2">
          <Field label="Span (mm)">
            <NumberInput
              value={layer.spanMm ?? 0}
              min={0}
              onChange={(value) =>
                dispatch({ type: 'patchLayer', layerId: layer.id, patch: { spanMm: value > 0 ? value : null } })
              }
            />
          </Field>
          <Field label="Offset (mm)">
            <NumberInput
              value={layer.offsetMm}
              onChange={(offsetMm) => dispatch({ type: 'patchLayer', layerId: layer.id, patch: { offsetMm } })}
            />
          </Field>
          <Field label="Run span (mm)">
            <NumberInput
              value={layer.runSpanMm ?? 0}
              min={0}
              onChange={(value) =>
                dispatch({ type: 'patchLayer', layerId: layer.id, patch: { runSpanMm: value > 0 ? value : null } })
              }
            />
          </Field>
          <Field label="Run offset (mm)">
            <NumberInput
              value={layer.runOffsetMm}
              onChange={(runOffsetMm) => dispatch({ type: 'patchLayer', layerId: layer.id, patch: { runOffsetMm } })}
            />
          </Field>
        </div>
      )}

      {/* The numbers above, worked out from the boards this layer has to stop
          short of. It fills the fields in and leaves them yours to change:
          nothing here is applied behind the form. */}
      {fit && (
        <div className="mt-2 flex items-center gap-2">
          <Button
            onClick={() => dispatch({ type: 'fitRun', layerId: layer.id, ...fit })}
            title="Cut these boards to the space left by the boards sharing this level, and start them where that space starts"
          >
            Fit between the boards on this level
          </Button>
          <span className="text-xs text-slate-500">
            run {fit.runSpanMm} from {fit.runOffsetMm}
          </span>
        </div>
      )}

      {layer.content.type === 'sequence' && (
        <Slots
          layer={layer}
          slots={layer.content.slots}
          selection={selection}
          dispatch={dispatch}
          accent={accent}
        />
      )}
      {layer.content.type === 'grid' && <Grid layer={layer} dispatch={dispatch} accent={accent} />}
      {layer.content.type === 'sheet' && <Sheet layer={layer} dispatch={dispatch} accent={accent} />}
    </Panel>
  );
}

/**
 * The whole layer in one row: how many boards, and the one size they all are.
 *
 * In about eight designs in ten every board in a layer is identical, so this is
 * the row that actually gets filled in — seven boards is a 7 in the count, not
 * seven rows of the same three numbers typed out again. Where a design is one
 * of the other two in ten, the field reads "mixed" and the folded-away table
 * below is still there to correct the odd board out.
 */
function AllBoards({
  layer,
  slots,
  dispatch,
  accent,
}: {
  layer: Layer;
  slots: Slot[];
  dispatch: (action: Action) => void;
  accent?: LayerStyle;
}) {
  const all = (patch: Partial<Slot>) =>
    dispatch({ type: 'patchAllSlots', layerId: layer.id, patch });

  return (
    <KeyFields
      caption="Every board"
      note="sets the whole layer — nudges and joins are left alone"
      accent={accent}
    >
      <div className="grid grid-cols-5 gap-2">
        <Field label="Length">
          <NumberInput
            value={sharedNumber(slots, (slot) => slot.length)}
            min={1}
            placeholder={MIXED}
            onChange={(length) => all({ length })}
          />
        </Field>
        <Field label="Width">
          <NumberInput
            value={sharedNumber(slots, (slot) => slot.width)}
            min={1}
            placeholder={MIXED}
            onChange={(width) => all({ width })}
          />
        </Field>
        <Field label="Thick">
          <NumberInput
            value={sharedNumber(slots, (slot) => slot.thickness)}
            min={1}
            placeholder={MIXED}
            onChange={(thickness) => all({ thickness })}
          />
        </Field>
        <Field label="Qty">
          <NumberInput
            value={slots.length}
            min={1}
            max={MAX_SLOTS}
            onChange={(count) => dispatch({ type: 'setSlotCount', layerId: layer.id, count })}
          />
        </Field>
        <Field label="Material">
          <TextInput
            value={common(slots, (slot) => slot.material) ?? ''}
            placeholder={MIXED}
            onChange={(material) => all({ material })}
          />
        </Field>
      </div>
    </KeyFields>
  );
}

function Slots({
  layer,
  slots,
  selection,
  dispatch,
  accent,
}: {
  layer: Layer;
  slots: Slot[];
  selection: Selection | null;
  dispatch: (action: Action) => void;
  accent?: LayerStyle;
}) {
  const sizes = slots.map((slot) => `${slot.length}x${slot.width}x${slot.thickness}`);
  // A board picked on the drawing has to be reachable, so a selection inside
  // this layer opens the table rather than hiding the row it just focused.
  const selectedHere = selection?.layerId === layer.id && selection.source.kind === 'slot';

  return (
    <div className="mt-3 space-y-2">
      <AllBoards layer={layer} slots={slots} dispatch={dispatch} accent={accent} />
      <Disclosure
        summary={componentSummary('board', sizes)}
        defaultOpen={sizeCount(sizes) > 1}
        openWhen={selectedHere}
      >
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-slate-400">
              <th className="w-8 text-left font-medium">#</th>
              <th className="text-left font-medium">Length</th>
              <th className="text-left font-medium">Width</th>
              <th className="text-left font-medium">Thick</th>
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
          <Button onClick={() => dispatch({ type: 'addSlot', layerId: layer.id })}>
            Add board
          </Button>
        </div>
      </Disclosure>
    </div>
  );
}

function SlotRow({
  layerId,
  slot,
  index,
  selected,
  dispatch,
}: {
  layerId: string;
  slot: Slot;
  index: number;
  selected: boolean;
  dispatch: (action: Action) => void;
}) {
  const row = useRef<HTMLTableRowElement>(null);
  const patch = (patch: Partial<Slot>) => dispatch({ type: 'patchSlot', layerId, index, patch });

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
        <NumberInput value={slot.length} min={1} onChange={(length) => patch({ length })} />
      </td>
      <td className="pr-1">
        <NumberInput value={slot.width} min={1} onChange={(width) => patch({ width })} />
      </td>
      <td className="pr-1">
        <NumberInput value={slot.thickness} min={1} onChange={(thickness) => patch({ thickness })} />
      </td>
      <td className="pr-1">
        <TextInput value={slot.material} onChange={(material) => patch({ material })} />
      </td>
      <td className="pr-1">
        <TextInput
          value={slot.variant ?? ''}
          onChange={(value) => patch({ variant: value === '' ? undefined : value })}
        />
      </td>
      <td className="pr-1">
        <NumberInput value={slot.nudgeMm} onChange={(nudgeMm) => patch({ nudgeMm })} />
      </td>
      <td>
        <Check
          checked={slot.joinedToPrev}
          disabled={index === 0}
          label=""
          onChange={(joinedToPrev) => patch({ joinedToPrev })}
        />
      </td>
      <td>
        <Button tone="danger" onClick={() => dispatch({ type: 'removeSlot', layerId, index })}>
          ×
        </Button>
      </td>
    </tr>
  );
}

function Grid({
  layer,
  dispatch,
  accent,
}: {
  layer: Layer;
  dispatch: (action: Action) => void;
  accent?: LayerStyle;
}) {
  if (layer.content.type !== 'grid') return null;
  const grid = layer.content.grid;
  const cells = grid.cells.flat();
  const cellSizes = cells.map((cell) => `${cell.lengthMm}x${cell.widthMm}x${cell.heightMm}`);
  const all = (patch: Partial<BlockCell>) =>
    dispatch({ type: 'patchAllCells', layerId: layer.id, patch });

  return (
    <div className="mt-3">
      {/* The nine blocks under a pallet are nearly always one size, so they are
          set once here. The table below is for the design where they are not. */}
      <KeyFields
        caption="Every block"
        note={`sets all ${cells.length} at once`}
        accent={accent}
      >
        <div className="grid grid-cols-4 gap-2">
          <Field label="Length">
            <NumberInput
              value={sharedNumber(cells, (cell) => cell.lengthMm)}
              min={1}
              placeholder={MIXED}
              onChange={(lengthMm) => all({ lengthMm })}
            />
          </Field>
          <Field label="Width">
            <NumberInput
              value={sharedNumber(cells, (cell) => cell.widthMm)}
              min={1}
              placeholder={MIXED}
              onChange={(widthMm) => all({ widthMm })}
            />
          </Field>
          <Field label="Height">
            <NumberInput
              value={sharedNumber(cells, (cell) => cell.heightMm)}
              min={1}
              placeholder={MIXED}
              onChange={(heightMm) => all({ heightMm })}
            />
          </Field>
          <Field label="Material">
            <TextInput
              value={common(cells, (cell) => cell.material) ?? ''}
              placeholder={MIXED}
              onChange={(material) => all({ material })}
            />
          </Field>
        </div>
      </KeyFields>

      <div className="mt-3 grid grid-cols-6 gap-2">
        <Field label="Rows">
          <NumberInput
            value={grid.rows}
            min={1}
            max={MAX_GRID_SIDE}
            onChange={(rows) => dispatch({ type: 'patchGrid', layerId: layer.id, patch: { rows } })}
          />
        </Field>
        <Field label="Cols">
          <NumberInput
            value={grid.cols}
            min={1}
            max={MAX_GRID_SIDE}
            onChange={(cols) => dispatch({ type: 'patchGrid', layerId: layer.id, patch: { cols } })}
          />
        </Field>
        <Field label="Row span">
          <NumberInput
            value={grid.rowSpanMm ?? 0}
            min={0}
            onChange={(value) =>
              dispatch({ type: 'patchGrid', layerId: layer.id, patch: { rowSpanMm: value > 0 ? value : null } })
            }
          />
        </Field>
        <Field label="Row offset">
          <NumberInput
            value={grid.rowOffsetMm}
            onChange={(rowOffsetMm) => dispatch({ type: 'patchGrid', layerId: layer.id, patch: { rowOffsetMm } })}
          />
        </Field>
        <Field label="Col span">
          <NumberInput
            value={grid.colSpanMm ?? 0}
            min={0}
            onChange={(value) =>
              dispatch({ type: 'patchGrid', layerId: layer.id, patch: { colSpanMm: value > 0 ? value : null } })
            }
          />
        </Field>
        <Field label="Col offset">
          <NumberInput
            value={grid.colOffsetMm}
            onChange={(colOffsetMm) => dispatch({ type: 'patchGrid', layerId: layer.id, patch: { colOffsetMm } })}
          />
        </Field>
      </div>

      <div className="mt-3">
        <Disclosure
          summary={componentSummary('block', cellSizes)}
          defaultOpen={sizeCount(cellSizes) > 1}
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-slate-400">
                <th className="w-12 text-left font-medium">Cell</th>
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
                  const patch = (patch: Partial<BlockCell>) =>
                    dispatch({ type: 'patchCell', layerId: layer.id, row: r, col: c, patch });
                  return (
                    <tr key={`${r}-${c}`} className="hover:bg-slate-50">
                      <td className="text-xs text-slate-400">
                        r{r + 1} c{c + 1}
                      </td>
                      <td className="pr-1">
                        <NumberInput value={cell.lengthMm} min={1} onChange={(lengthMm) => patch({ lengthMm })} />
                      </td>
                      <td className="pr-1">
                        <NumberInput value={cell.widthMm} min={1} onChange={(widthMm) => patch({ widthMm })} />
                      </td>
                      <td className="pr-1">
                        <NumberInput value={cell.heightMm} min={1} onChange={(heightMm) => patch({ heightMm })} />
                      </td>
                      <td className="pr-1">
                        <TextInput value={cell.material} onChange={(material) => patch({ material })} />
                      </td>
                      <td>
                        <Button
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
        </Disclosure>
      </div>
    </div>
  );
}

function Sheet({
  layer,
  dispatch,
  accent,
}: {
  layer: Layer;
  dispatch: (action: Action) => void;
  accent?: LayerStyle;
}) {
  if (layer.content.type !== 'sheet') return null;
  const sheet = layer.content.sheet;
  const patch = (patch: Partial<SheetSpec>) =>
    dispatch({ type: 'patchSheet', layerId: layer.id, patch });

  return (
    <div className="mt-3">
      <KeyFields caption="The sheet" accent={accent}>
        <div className="grid grid-cols-4 gap-2">
          <Field label="Length">
            <NumberInput value={sheet.length} min={1} onChange={(length) => patch({ length })} />
          </Field>
          <Field label="Width">
            <NumberInput value={sheet.width} min={1} onChange={(width) => patch({ width })} />
          </Field>
          <Field label="Thickness">
            <NumberInput
              value={sheet.thickness}
              min={1}
              onChange={(thickness) => patch({ thickness })}
            />
          </Field>
          <Field label="Material">
            <TextInput value={sheet.material} onChange={(material) => patch({ material })} />
          </Field>
        </div>
      </KeyFields>
    </div>
  );
}
