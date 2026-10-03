import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { fitRun } from '../geometry/fit.js';
import { describeNotches } from '../geometry/parts.js';
import type { LayerLayout, Layout } from '../geometry/types.js';
import { mmLabel } from '../render/scene.js';
import { LAYER_STYLE } from '../render/theme.js';
import type { BlockCell, BlockGrid, Direction, Layer, LayerContent, LayerKind, SheetSpec, Slot } from '../types.js';
import type { Action, Selection } from './state.js';
import { MAX_GRID_SIDE, MAX_SLOTS, sameSource } from './state.js';
import { fieldId, HINTS } from './hints.js';
import { NOTCHES_PER_BOARD, defaultNotchPattern, notchPattern } from './notches.js';
import type { NotchPattern } from './notches.js';
import {
  Button,
  Check,
  Disclosure,
  Hint,
  Icon,
  IconButton,
  Menu,
  MenuItem,
  NumberInput,
  Section,
  Select,
  TextInput,
} from './ui.jsx';

/**
 * The layers, as one table: a row each, top to bottom, in the order they are
 * stacked.
 *
 * A pallet is described in the shop as a list — top boards 1200 by 95 by 20,
 * five of them; centre boards; nine blocks — and this is that list, with the
 * numbers in it typed into, the size first and the count after it. Each row is the whole layer in the one size
 * nearly every layer is; the rest of what a layer can be told — how it is
 * set in, whether it shares a level, the odd board out — is folded under its
 * row, and the row says in a word or two when any of it is in use.
 *
 * It used to be a card per layer, each one a coloured band, a box inside it
 * and a dozen captioned fields, and a five-layer pallet was five screens of
 * that. Lined up as rows, the sizes sit in columns and can be compared down
 * the page, which is most of what checking a design is.
 *
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

/** Whether any of the four placing numbers is off its default. */
function insetSet(span: number | null, offset: number, runSpan: number | null, runOffset: number): boolean {
  return span !== null || offset !== 0 || runSpan !== null || runOffset !== 0;
}

export const KIND_LABEL: Array<[LayerKind, string]> = [
  ['panel', 'Plywood sheet over the deck'],
  ['top_deck', 'Top boards'],
  ['bearer', 'Centre boards'],
  ['block', 'Blocks'],
  ['runner', 'Runners'],
  ['bottom_deck', 'Bottom boards'],
];

const kindLabel = (kind: LayerKind): string => KIND_LABEL.find(([each]) => each === kind)?.[1] ?? kind;

const DIRECTIONS: Array<[Direction, string]> = [
  ['along_length', 'Along length'],
  ['across_width', 'Across width'],
];

const CONTENTS: Array<[LayerContent['type'], string]> = [
  ['sequence', 'Boards'],
  ['grid', 'Block grid'],
  ['sheet', 'Plywood sheet'],
];

/**
 * The columns, shared by the heading and every row so the numbers line up
 * down the page. The size columns are four digits wide and no wider.
 */
const COLUMNS =
  'grid grid-cols-[minmax(8.5rem,1fr)_4.25rem_4.25rem_4.25rem_4.5rem_minmax(5rem,0.55fr)_7.75rem_1.75rem] items-center gap-x-2';

/**
 * The colour a layer is drawn in, as the key on a drawing gives it: a small
 * square of its fill, ruled in its line. It is the one thing that ties a row
 * here to the boards on the picture beside it.
 */
export function Swatch({ kind }: { kind: LayerKind }) {
  const style = LAYER_STYLE[kind];
  return (
    <span
      aria-hidden="true"
      className="inline-block h-3 w-3 shrink-0 rounded-[3px]"
      style={{ background: style.fill, boxShadow: `inset 0 0 0 1px ${style.stroke}` }}
    />
  );
}

export function Layers({
  layers,
  layout,
  selection,
  dispatch,
}: {
  layers: Layer[];
  layout: Layout;
  selection: Selection | null;
  dispatch: (action: Action) => void;
}) {
  return (
    // Named so the problem list has somewhere to send a design that has no
    // layers yet — the answer to "needs at least one" is here.
    <Section
      id={fieldId('layers')}
      title="Layers"
      note="top to bottom · mm"
      actions={
        <Menu
          caret
          align="right"
          label={
            <span className="flex items-center gap-1.5">
              <Icon name="plus" size={14} />
              Add layer
            </span>
          }
        >
          {(close) =>
            KIND_LABEL.map(([kind, label]) => (
              <MenuItem
                key={kind}
                onClick={() => {
                  close();
                  dispatch({ type: 'addLayer', kind });
                }}
              >
                <span className="flex items-center gap-2">
                  <Swatch kind={kind} />
                  {label}
                </span>
              </MenuItem>
            ))
          }
        </Menu>
      }
    >
      {layers.length === 0 ? (
        <p className="py-2 text-ui text-ink-faint">No layers yet.</p>
      ) : (
        <div className="-mx-2">
          <div className={`${COLUMNS} px-2 pb-1.5 text-label text-ink-faint`}>
            <span className="pl-6">Layer</span>
            <span>Length</span>
            <span>Width</span>
            <span>Thick</span>
            <span>Qty</span>
            <span>Material</span>
            <span>Runs</span>
            <span />
          </div>
          {layers.map((layer, index) => (
            <LayerRow
              key={layer.id}
              layer={layer}
              layout={layout}
              computed={layout.layers.find((computed) => computed.layerId === layer.id)}
              first={index === 0}
              last={index === layers.length - 1}
              selection={selection}
              dispatch={dispatch}
            />
          ))}
        </div>
      )}
    </Section>
  );
}

/**
 * What the folded part of a row holds, said in a word each, so a layer that
 * is not the plain case says so without being opened.
 */
function flags(layer: Layer): string[] {
  const said: string[] = [];
  if (layer.sameLevelAsPrev) said.push('same level');
  const content = layer.content;
  if (content.type === 'grid') {
    const grid = content.grid;
    if (insetSet(grid.rowSpanMm, grid.rowOffsetMm, grid.colSpanMm, grid.colOffsetMm)) said.push('inset');
    const sizes = grid.cells.flat().map((cell) => `${cell.lengthMm}x${cell.widthMm}x${cell.heightMm}`);
    if (new Set(sizes).size > 1) said.push('mixed sizes');
    return said;
  }
  if (insetSet(layer.spanMm, layer.offsetMm, layer.runSpanMm, layer.runOffsetMm)) said.push('inset');
  if (content.type === 'sequence') {
    const slots = content.slots;
    if (slots.some((slot) => (slot.notches?.length ?? 0) > 0)) said.push('notched');
    const sizes = slots.map((slot) => `${slot.length}x${slot.width}x${slot.thickness}`);
    if (new Set(sizes).size > 1) said.push('mixed sizes');
    if (slots.some((slot) => slot.nudgeMm !== 0)) said.push('nudged');
    if (slots.some((slot) => slot.joinedToPrev)) said.push('joined');
  }
  return said;
}

function LayerRow({
  layer,
  layout,
  computed,
  first,
  last,
  selection,
  dispatch,
}: {
  layer: Layer;
  layout: Layout;
  computed: LayerLayout | undefined;
  /** The topmost layer, which has nothing above it to share a level with. */
  first: boolean;
  last: boolean;
  selection: Selection | null;
  dispatch: (action: Action) => void;
}) {
  // A piece picked on the drawing has to be reachable, so a selection inside
  // this layer opens it rather than leaving the row it lit folded away.
  const selectedHere = selection?.layerId === layer.id;
  const [open, setOpen] = useState(selectedHere);
  useEffect(() => {
    if (selectedHere) setOpen(true);
  }, [selectedHere]);

  const name = kindLabel(layer.kind);
  const spread = computed?.spread;
  const said = flags(layer);
  const content = layer.content;

  // Worked out, not typed. Slack going negative is the layer being over-full,
  // which is the one number here that stops a sheet.
  const spacing = spread ? (
    <span className={spread.slack < 0 ? 'font-medium text-red-600' : ''} title={spread.slack < 0 ? HINTS.slack : HINTS.gap}>
      gap {mmLabel(spread.gap)} · slack {mmLabel(spread.slack)}
    </span>
  ) : computed?.rows ? (
    <span title={HINTS.gap}>
      rows {mmLabel(computed.rows.gap)} · cols {mmLabel(computed.cols?.gap ?? 0)}
    </span>
  ) : null;

  return (
    <div className="border-t border-line-soft">
      <div className={`${COLUMNS} rounded-md px-2 py-1.5 ${open ? 'bg-ground-soft' : 'hover:bg-ground-soft/70'}`}>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          title={open ? 'Fold this layer away' : 'Everything else about this layer'}
          className="flex min-w-0 items-center gap-2 rounded-md py-0.5 text-left"
        >
          <Icon
            name="chevronRight"
            size={14}
            className={`text-ink-faint transition-transform ${open ? 'rotate-90' : ''}`}
          />
          <Swatch kind={layer.kind} />
          <span className="min-w-0">
            <span className="block truncate text-ui font-medium text-ink">{name}</span>
            {(spacing || said.length > 0) && (
              <span className="block text-micro leading-snug text-ink-faint">
                {spacing}
                {spacing && said.length > 0 && ' · '}
                {said.join(' · ')}
              </span>
            )}
          </span>
        </button>

        {content.type === 'sequence' && <BoardsRow layer={layer} slots={content.slots} dispatch={dispatch} />}
        {content.type === 'grid' && <BlocksRow layer={layer} dispatch={dispatch} />}
        {content.type === 'sheet' && <SheetRow layer={layer} sheet={content.sheet} dispatch={dispatch} />}

        {content.type === 'grid' ? (
          <span className="px-2 text-ui text-ink-faint">—</span>
        ) : (
          <Select
            label={`${name}: which way the boards run`}
            className="compact w-full"
            value={layer.direction}
            options={DIRECTIONS}
            onChange={(direction) => dispatch({ type: 'patchLayer', layerId: layer.id, patch: { direction } })}
          />
        )}

        <Menu label={<Icon name="more" size={16} />} tone="subtle" size="sm" width="sm" title={`More for ${name}`}>
          {(close) => (
            <>
              <MenuItem
                disabled={first}
                onClick={() => {
                  close();
                  dispatch({ type: 'moveLayer', layerId: layer.id, by: -1 });
                }}
              >
                Move up
              </MenuItem>
              <MenuItem
                disabled={last}
                onClick={() => {
                  close();
                  dispatch({ type: 'moveLayer', layerId: layer.id, by: 1 });
                }}
              >
                Move down
              </MenuItem>
              <MenuItem
                tone="danger"
                onClick={() => {
                  close();
                  dispatch({ type: 'removeLayer', layerId: layer.id });
                }}
              >
                Remove layer
              </MenuItem>
            </>
          )}
        </Menu>
      </div>

      {open && (
        <div className="mb-2 ml-8 mr-2 mt-1 space-y-4 border-l-2 border-line-soft pb-2 pl-4 pt-1">
          <Details layer={layer} layout={layout} first={first} selection={selection} dispatch={dispatch} />
        </div>
      )}
    </div>
  );
}

/**
 * The whole layer in one row: the one size its boards all are, and how many.
 *
 * In about eight designs in ten every board in a layer is identical, so this is
 * the row that actually gets filled in — seven boards is a 7 in the count, not
 * seven rows of the same three numbers typed out again. Where a design is one
 * of the other two in ten, the field reads "mixed" and the table folded under
 * the row is still there to correct the odd board out.
 */
function BoardsRow({
  layer,
  slots,
  dispatch,
}: {
  layer: Layer;
  slots: Slot[];
  dispatch: (action: Action) => void;
}) {
  const all = (patch: Partial<Slot>) => dispatch({ type: 'patchAllSlots', layerId: layer.id, patch });
  const name = kindLabel(layer.kind);
  return (
    <>
      <NumberInput
        label={`${name}: length`}
        value={sharedNumber(slots, (slot) => slot.length)}
        min={1}
        placeholder={MIXED}
        onChange={(length) => all({ length })}
      />
      <NumberInput
        label={`${name}: width`}
        value={sharedNumber(slots, (slot) => slot.width)}
        min={1}
        placeholder={MIXED}
        onChange={(width) => all({ width })}
      />
      <NumberInput
        label={`${name}: thickness`}
        value={sharedNumber(slots, (slot) => slot.thickness)}
        min={1}
        placeholder={MIXED}
        onChange={(thickness) => all({ thickness })}
      />
      <NumberInput
        label={`${name}: how many`}
        value={slots.length}
        min={1}
        max={MAX_SLOTS}
        onChange={(count) => dispatch({ type: 'setSlotCount', layerId: layer.id, count })}
      />
      <TextInput
        label={`${name}: material`}
        value={common(slots, (slot) => slot.material) ?? ''}
        placeholder={MIXED}
        onChange={(material) => all({ material })}
      />
    </>
  );
}

/**
 * The blocks: the one size they are, and how many rows and columns of them.
 * The nine blocks under a pallet are nearly always one size, so they are set
 * once here; the table folded under the row is for the design where not.
 */
function BlocksRow({ layer, dispatch }: { layer: Layer; dispatch: (action: Action) => void }) {
  if (layer.content.type !== 'grid') return null;
  const grid = layer.content.grid;
  const cells = grid.cells.flat();
  const all = (patch: Partial<BlockCell>) => dispatch({ type: 'patchAllCells', layerId: layer.id, patch });
  return (
    <>
      <NumberInput
        label="Blocks: length"
        value={sharedNumber(cells, (cell) => cell.lengthMm)}
        min={1}
        placeholder={MIXED}
        onChange={(lengthMm) => all({ lengthMm })}
      />
      <NumberInput
        label="Blocks: width"
        value={sharedNumber(cells, (cell) => cell.widthMm)}
        min={1}
        placeholder={MIXED}
        onChange={(widthMm) => all({ widthMm })}
      />
      <NumberInput
        label="Blocks: height"
        value={sharedNumber(cells, (cell) => cell.heightMm)}
        min={1}
        placeholder={MIXED}
        onChange={(heightMm) => all({ heightMm })}
      />
      <span className="flex items-center gap-0.5" title={`${grid.rows} rows of ${grid.cols}`}>
        <NumberInput
          label="Rows of blocks"
          className="w-full min-w-0 px-1! text-center"
          value={grid.rows}
          min={1}
          max={MAX_GRID_SIDE}
          onChange={(rows) => dispatch({ type: 'patchGrid', layerId: layer.id, patch: { rows } })}
        />
        <span className="text-label text-ink-faint">×</span>
        <NumberInput
          label="Blocks in each row"
          className="w-full min-w-0 px-1! text-center"
          value={grid.cols}
          min={1}
          max={MAX_GRID_SIDE}
          onChange={(cols) => dispatch({ type: 'patchGrid', layerId: layer.id, patch: { cols } })}
        />
      </span>
      <TextInput
        label="Blocks: material"
        value={common(cells, (cell) => cell.material) ?? ''}
        placeholder={MIXED}
        onChange={(material) => all({ material })}
      />
    </>
  );
}

/** A sheet is one piece, so its row is its size and nothing else. */
function SheetRow({
  layer,
  sheet,
  dispatch,
}: {
  layer: Layer;
  sheet: SheetSpec;
  dispatch: (action: Action) => void;
}) {
  const patch = (patch: Partial<SheetSpec>) => dispatch({ type: 'patchSheet', layerId: layer.id, patch });
  return (
    <>
      <NumberInput label="Sheet: length" value={sheet.length} min={1} onChange={(length) => patch({ length })} />
      <NumberInput label="Sheet: width" value={sheet.width} min={1} onChange={(width) => patch({ width })} />
      <NumberInput
        label="Sheet: thickness"
        value={sheet.thickness}
        min={1}
        onChange={(thickness) => patch({ thickness })}
      />
      <span className="px-2 text-ui text-ink-faint">1</span>
      <TextInput label="Sheet: material" value={sheet.material} onChange={(material) => patch({ material })} />
    </>
  );
}

/** A small caption over one group of what is folded under a row. */
function Caption({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-1.5 flex items-center gap-1 text-label font-medium text-ink-soft">
      {children}
      {hint && <Hint text={hint} />}
    </div>
  );
}

/** A number with its name over it, sized for four digits. */
function Small({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block w-24">
      <span className="mb-1 flex items-center gap-1 text-label text-ink-faint">
        {label}
        {hint && <Hint text={hint} />}
      </span>
      {children}
    </label>
  );
}

/**
 * Everything about a layer that its row does not say: what it is made of,
 * whether it shares a level, where it sits when it is not flush to the edges,
 * the notches, and the components one at a time.
 */
function Details({
  layer,
  layout,
  first,
  selection,
  dispatch,
}: {
  layer: Layer;
  layout: Layout;
  first: boolean;
  selection: Selection | null;
  dispatch: (action: Action) => void;
}) {
  // Only offered once there is something to fit between: the button is the
  // arithmetic, and with nothing sharing the level there is no sum to do.
  const fit = layer.content.type === 'grid' ? null : fitRun(layout, layer.id);
  const patchLayer = (patch: Partial<Layer>) => dispatch({ type: 'patchLayer', layerId: layer.id, patch });
  const patchGrid = (patch: Partial<Omit<BlockGrid, 'cells'>>) =>
    dispatch({ type: 'patchGrid', layerId: layer.id, patch });

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <label className="flex items-center gap-2 text-label text-ink-soft">
          Content
          <Select
            className="compact w-36"
            value={layer.content.type}
            options={CONTENTS}
            onChange={(contentType) => dispatch({ type: 'setContent', layerId: layer.id, contentType })}
          />
        </label>
        {/* A deck whose boards do not all run the same way is built as one
            layer per direction, marked to share a height rather than to stack.
            Not offered on the top layer, which has nothing above it. */}
        {!first && (
          <span className="flex items-center gap-1.5">
            <Check
              checked={layer.sameLevelAsPrev}
              label="Same level as layer above"
              onChange={(sameLevelAsPrev) => patchLayer({ sameLevelAsPrev })}
            />
            <Hint text={HINTS.sameLevel} />
          </span>
        )}
      </div>

      {/* Where the layer sits, when it is not the whole pallet flush to the
          edges. Almost never: across the designs in use, span and offset had
          never been set, and run span and offset only by the Fit button. */}
      {layer.content.type === 'grid' ? (
        <Disclosure
          summary="Inset & offset"
          openWhen={insetSet(
            layer.content.grid.rowSpanMm,
            layer.content.grid.rowOffsetMm,
            layer.content.grid.colSpanMm,
            layer.content.grid.colOffsetMm,
          )}
        >
          <div className="flex flex-wrap items-end gap-2">
            <Small label="Row span">
              <NumberInput
                value={layer.content.grid.rowSpanMm ?? 0}
                min={0}
                onChange={(value) => patchGrid({ rowSpanMm: value > 0 ? value : null })}
              />
            </Small>
            <Small label="Row offset">
              <NumberInput
                value={layer.content.grid.rowOffsetMm}
                onChange={(rowOffsetMm) => patchGrid({ rowOffsetMm })}
              />
            </Small>
            <Small label="Col span">
              <NumberInput
                value={layer.content.grid.colSpanMm ?? 0}
                min={0}
                onChange={(value) => patchGrid({ colSpanMm: value > 0 ? value : null })}
              />
            </Small>
            <Small label="Col offset">
              <NumberInput
                value={layer.content.grid.colOffsetMm}
                onChange={(colOffsetMm) => patchGrid({ colOffsetMm })}
              />
            </Small>
          </div>
        </Disclosure>
      ) : (
        <Disclosure
          summary="Inset & offset"
          openWhen={insetSet(layer.spanMm, layer.offsetMm, layer.runSpanMm, layer.runOffsetMm) || fit !== null}
        >
          <div className="flex flex-wrap items-end gap-2">
            <Small label="Span" hint={HINTS.span}>
              <NumberInput
                value={layer.spanMm ?? 0}
                min={0}
                placeholder="full"
                onChange={(value) => patchLayer({ spanMm: value > 0 ? value : null })}
              />
            </Small>
            <Small label="Offset" hint={HINTS.offset}>
              <NumberInput value={layer.offsetMm} onChange={(offsetMm) => patchLayer({ offsetMm })} />
            </Small>
            <Small label="Run span" hint={HINTS.runSpan}>
              <NumberInput
                value={layer.runSpanMm ?? 0}
                min={0}
                placeholder="full"
                onChange={(value) => patchLayer({ runSpanMm: value > 0 ? value : null })}
              />
            </Small>
            <Small label="Run offset" hint={HINTS.runOffset}>
              <NumberInput value={layer.runOffsetMm} onChange={(runOffsetMm) => patchLayer({ runOffsetMm })} />
            </Small>
            {/* The run span and offset, worked out from the boards this layer
                has to stop short of. It fills the fields in and leaves them
                yours to change: nothing here is applied behind the form. */}
            {fit && (
              <span className="flex items-center gap-2 pb-1">
                <Button
                  onClick={() => dispatch({ type: 'fitRun', layerId: layer.id, ...fit })}
                  title="Set the run span and offset to the space the other boards on this level leave"
                >
                  Fit to this level
                </Button>
                <span className="text-label text-ink-faint">
                  run {fit.runSpanMm} from {fit.runOffsetMm}
                </span>
              </span>
            )}
          </div>
        </Disclosure>
      )}

      {layer.content.type === 'sequence' &&
        (layer.kind === 'runner' || layer.content.slots.some((slot) => (slot.notches?.length ?? 0) > 0)) && (
          <Notches layer={layer} slots={layer.content.slots} dispatch={dispatch} />
        )}

      {layer.content.type === 'sequence' && (
        <BoardTable layer={layer} slots={layer.content.slots} selection={selection} dispatch={dispatch} />
      )}
      {layer.content.type === 'grid' && <BlockTable layer={layer} selection={selection} dispatch={dispatch} />}
    </>
  );
}

/**
 * The notches, for the whole layer at once: whether the runners are notched
 * — which means two notches each, one for each fork — how big, and how far
 * in from the ends. A stringer is specified that way and every runner in it
 * is cut alike, so there is no per-board table under this row. A board
 * notched differently by hand in the document reads here as "mixed", and
 * typing anything cuts every board to what is typed.
 *
 * Only offered on runners — the boards that are notched — and on any layer
 * that already carries notches, so nothing loaded is left uneditable.
 */
function Notches({
  layer,
  slots,
  dispatch,
}: {
  layer: Layer;
  slots: Slot[];
  dispatch: (action: Action) => void;
}) {
  const patterns = slots.map(notchPattern);
  const known = patterns.filter((pattern): pattern is NotchPattern => pattern !== null);
  const custom = known.length < patterns.length;
  const shared = (read: (pattern: NotchPattern) => number): number =>
    custom ? Number.NaN : sharedNumber(known, read);

  // Notched is every board having notches; a layer where some have and some
  // have not reads as not, and ticking it cuts them all alike.
  const count = shared((pattern) => pattern.count);
  const notched = !custom && count > 0;
  // What the three fields fall back to where they read "mixed", so a tick
  // over a muddle still cuts something sensible.
  const fallback = defaultNotchPattern(slots[0]?.length ?? 0);
  const settled = (read: (pattern: NotchPattern) => number, base: number): number => {
    const value = shared(read);
    return Number.isNaN(value) ? base : value;
  };
  const set = (patch: Partial<NotchPattern>): void =>
    dispatch({
      type: 'setNotches',
      layerId: layer.id,
      pattern: {
        count: settled((pattern) => pattern.count, 0),
        lengthMm: settled((pattern) => pattern.lengthMm, fallback.lengthMm),
        depthMm: settled((pattern) => pattern.depthMm, fallback.depthMm),
        fromEndMm: settled((pattern) => pattern.fromEndMm, fallback.fromEndMm),
        ...patch,
      },
    });

  return (
    <div>
      <Caption hint={HINTS.notches}>Notches</Caption>
      <div className="flex flex-wrap items-end gap-2">
        <span className="pb-1.5 pr-2">
          <Check
            checked={notched}
            label="Notched"
            onChange={(on) => set({ count: on ? NOTCHES_PER_BOARD : 0 })}
          />
        </span>
        <Small label="Length">
          <NumberInput
            value={shared((pattern) => pattern.lengthMm)}
            min={1}
            disabled={!notched}
            placeholder={MIXED}
            onChange={(lengthMm) => set({ lengthMm })}
          />
        </Small>
        <Small label="Depth">
          <NumberInput
            value={shared((pattern) => pattern.depthMm)}
            min={1}
            disabled={!notched}
            placeholder={MIXED}
            onChange={(depthMm) => set({ depthMm })}
          />
        </Small>
        <Small label="From end" hint={HINTS.notchFromEnd}>
          <NumberInput
            value={shared((pattern) => pattern.fromEndMm)}
            min={0}
            disabled={!notched}
            placeholder={MIXED}
            onChange={(fromEndMm) => set({ fromEndMm })}
          />
        </Small>
      </div>
    </div>
  );
}

const BOARD_COLUMNS =
  'grid grid-cols-[1.75rem_4.75rem_4.75rem_4.75rem_minmax(5rem,1fr)_minmax(4rem,0.8fr)_4.25rem_3.25rem_1.75rem] items-center gap-x-1.5';

/** The boards one at a time, for the odd one out. */
function BoardTable({
  layer,
  slots,
  selection,
  dispatch,
}: {
  layer: Layer;
  slots: Slot[];
  selection: Selection | null;
  dispatch: (action: Action) => void;
}) {
  // Two boards of one size cut differently are two sizes to the table too.
  const sizes = new Set(
    slots.map((slot) => `${slot.length}x${slot.width}x${slot.thickness} ${describeNotches(slot.notches)}`),
  );
  return (
    <div>
      <Caption>
        Board by board
        {sizes.size > 1 && <span className="font-normal text-ink-faint">{sizes.size} sizes</span>}
      </Caption>
      <div className={`${BOARD_COLUMNS} pb-1 text-micro text-ink-faint`}>
        <span>#</span>
        <span>Length</span>
        <span>Width</span>
        <span>Thick</span>
        <span>Material</span>
        <span className="flex items-center gap-1">
          Variant <Hint text={HINTS.variant} />
        </span>
        <span className="flex items-center gap-1">
          Nudge <Hint text={HINTS.nudge} />
        </span>
        <span className="flex items-center gap-1">
          Joined <Hint text={HINTS.joined} />
        </span>
        <span />
      </div>
      <div className="space-y-1">
        {slots.map((slot, index) => (
          <SlotRow
            key={index}
            layerId={layer.id}
            slot={slot}
            index={index}
            selected={
              selection?.layerId === layer.id && sameSource(selection.source, { kind: 'slot', index })
            }
            dispatch={dispatch}
          />
        ))}
      </div>
      <div className="mt-2">
        <Button size="sm" onClick={() => dispatch({ type: 'addSlot', layerId: layer.id })}>
          <span className="flex items-center gap-1">
            <Icon name="plus" size={12} />
            Add board
          </span>
        </Button>
      </div>
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
  const row = useRef<HTMLDivElement>(null);
  const patch = (patch: Partial<Slot>) => dispatch({ type: 'patchSlot', layerId, index, patch });
  const select = () => {
    if (!selected) dispatch({ type: 'select', selection: { layerId, source: { kind: 'slot', index } } });
  };

  // Clicking a board in the preview selects it and brings its row into view.
  useEffect(() => {
    if (selected) row.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selected]);

  return (
    <div
      ref={row}
      onClick={select}
      onFocus={select}
      className={`${BOARD_COLUMNS} rounded-md ${selected ? 'bg-blue-50 outline-1 outline-blue-400' : ''}`}
    >
      <span className="pl-1 text-label tabular-nums text-ink-faint">{index + 1}</span>
      <NumberInput label={`Board ${index + 1}: length`} value={slot.length} min={1} onChange={(length) => patch({ length })} />
      <NumberInput label={`Board ${index + 1}: width`} value={slot.width} min={1} onChange={(width) => patch({ width })} />
      <NumberInput
        label={`Board ${index + 1}: thickness`}
        value={slot.thickness}
        min={1}
        onChange={(thickness) => patch({ thickness })}
      />
      <TextInput label={`Board ${index + 1}: material`} value={slot.material} onChange={(material) => patch({ material })} />
      <TextInput
        label={`Board ${index + 1}: variant`}
        value={slot.variant ?? ''}
        onChange={(value) => patch({ variant: value === '' ? undefined : value })}
      />
      <NumberInput label={`Board ${index + 1}: nudge`} value={slot.nudgeMm} onChange={(nudgeMm) => patch({ nudgeMm })} />
      <span className="flex justify-center">
        <Check
          checked={slot.joinedToPrev}
          disabled={index === 0}
          label=""
          hiddenLabel={`Board ${index + 1} is joined to the board before it`}
          onChange={(joinedToPrev) => patch({ joinedToPrev })}
        />
      </span>
      <IconButton
        icon="x"
        size="sm"
        tone="danger"
        label={`Remove board ${index + 1}`}
        onClick={() => dispatch({ type: 'removeSlot', layerId, index })}
      />
    </div>
  );
}

const CELL_COLUMNS =
  'grid grid-cols-[3rem_4.75rem_4.75rem_4.75rem_minmax(5rem,1fr)_auto] items-center gap-x-1.5';

/** The blocks one at a time, for the grid where they are not all alike. */
function BlockTable({
  layer,
  selection,
  dispatch,
}: {
  layer: Layer;
  selection: Selection | null;
  dispatch: (action: Action) => void;
}) {
  if (layer.content.type !== 'grid') return null;
  const grid = layer.content.grid;
  return (
    <div>
      <Caption>Block by block</Caption>
      <div className={`${CELL_COLUMNS} pb-1 text-micro text-ink-faint`}>
        <span>Cell</span>
        <span>Length</span>
        <span>Width</span>
        <span>Height</span>
        <span>Material</span>
        <span />
      </div>
      <div className="space-y-1">
        {grid.cells.map((row, r) =>
          row.map((cell, c) => (
            <CellRow
              key={`${r}-${c}`}
              layerId={layer.id}
              cell={cell}
              row={r}
              col={c}
              selected={
                selection?.layerId === layer.id &&
                sameSource(selection.source, { kind: 'cell', row: r, col: c })
              }
              dispatch={dispatch}
            />
          )),
        )}
      </div>
    </div>
  );
}

/**
 * One block in the grid. Picked on the drawing, it is lit and scrolled to;
 * clicked or tabbed into here, it is picked on the drawing — the same both
 * ways as a board's row.
 */
function CellRow({
  layerId,
  cell,
  row,
  col,
  selected,
  dispatch,
}: {
  layerId: string;
  cell: BlockCell;
  row: number;
  col: number;
  selected: boolean;
  dispatch: (action: Action) => void;
}) {
  const line = useRef<HTMLDivElement>(null);
  const patch = (patch: Partial<BlockCell>) => dispatch({ type: 'patchCell', layerId, row, col, patch });
  const select = () => {
    if (!selected) dispatch({ type: 'select', selection: { layerId, source: { kind: 'cell', row, col } } });
  };
  const where = `r${row + 1} c${col + 1}`;

  useEffect(() => {
    if (selected) line.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selected]);

  return (
    <div
      ref={line}
      onClick={select}
      onFocus={select}
      className={`${CELL_COLUMNS} rounded-md ${selected ? 'bg-blue-50 outline-1 outline-blue-400' : ''}`}
    >
      <span className="pl-1 text-label tabular-nums text-ink-faint">{where}</span>
      <NumberInput label={`Block ${where}: length`} value={cell.lengthMm} min={1} onChange={(lengthMm) => patch({ lengthMm })} />
      <NumberInput label={`Block ${where}: width`} value={cell.widthMm} min={1} onChange={(widthMm) => patch({ widthMm })} />
      <NumberInput label={`Block ${where}: height`} value={cell.heightMm} min={1} onChange={(heightMm) => patch({ heightMm })} />
      <TextInput label={`Block ${where}: material`} value={cell.material} onChange={(material) => patch({ material })} />
      <Button
        size="sm"
        title="Copy this cell to every cell in the grid"
        onClick={() => dispatch({ type: 'fillGrid', layerId, row, col })}
      >
        Fill all
      </Button>
    </div>
  );
}
