import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Layout } from '../geometry/types.js';
import { ISO_ORIENTATION, MAX_PITCH } from '../render/orbit.js';
import type { Orientation } from '../render/orbit.js';
import { renderOrbit } from '../render/orbitView.js';
import type { ViewKind } from '../render/project.js';
import { renderView } from '../render/views.js';
import type { Action, Selection } from './state.js';
import { sameSource } from './state.js';

/**
 * A live preview, regenerated from the document on every change.
 *
 * Five views share one panel: the four flat views the sheet prints, and a 3D
 * view that can be turned to any angle. Clicking a piece selects it in every
 * one of them. Selection only: there is no dragging, because a position that
 * came from dragging would live on the drawing rather than on the component,
 * and the two would drift apart.
 *
 * The top and bottom views have a second mode, for placing nails. A nail is not
 * a position on the drawing in the way a board is — it is a count on a crossing,
 * and the crossing is found from the boards — so clicking one is an edit to the
 * document like any other, and the drawing stays a thing that is generated.
 */

type Mode = ViewKind | 'orbit';

const MODES: Array<[Mode, string]> = [
  ['top', 'Top'],
  ['bottom', 'Bottom'],
  ['side', 'Side'],
  ['end', 'End'],
  ['orbit', '3D'],
];

/** How far one press of an arrow turns the view. */
const STEP = Math.PI / 12;
const ZOOM_LIMIT = { min: 0.4, max: 5 };
/** Radians per pixel dragged. */
const DRAG_RATE = 0.008;
/** A pointer that moved less than this was a click at a piece, not a drag. */
const DRAG_SLOP = 4;

export function Preview({
  layout,
  selection,
  dispatch,
}: {
  layout: Layout;
  selection: Selection | null;
  dispatch: (action: Action) => void;
}) {
  const [mode, setMode] = useState<Mode>('top');
  const [orientation, setOrientation] = useState<Orientation>(ISO_ORIENTATION);
  const [zoom, setZoom] = useState(1);
  const [placingNails, setPlacingNails] = useState(false);

  // Only the two plan views show nails, so the mode has nothing to offer in the
  // others and turns itself off rather than sitting there armed and invisible.
  const plan = mode === 'top' || mode === 'bottom';
  const nailMode = placingNails && plan;

  const selectedIndex = useMemo(() => {
    if (!selection) return undefined;
    const index = layout.pieces.findIndex(
      (piece) => piece.layerId === selection.layerId && sameSource(piece.source, selection.source),
    );
    return index >= 0 ? index : undefined;
  }, [layout, selection]);

  const select = useCallback(
    (target: EventTarget) => {
      const hit = (target as Element).closest('[data-piece]');
      if (!hit) {
        dispatch({ type: 'select', selection: null });
        return;
      }
      const piece = layout.pieces[Number(hit.getAttribute('data-piece'))];
      if (piece) {
        dispatch({
          type: 'select',
          selection: { layerId: piece.layerId, source: piece.source },
        });
      }
    },
    [layout, dispatch],
  );

  /**
   * A click while nails are being placed. It steps the crossing on rather than
   * selecting a board, so the two modes never fight over the same click.
   */
  const clickCrossing = useCallback(
    (target: EventTarget) => {
      const hit = (target as Element).closest('[data-crossing]');
      if (!hit) return;
      const crossing = layout.nailCrossings[Number(hit.getAttribute('data-crossing'))];
      if (crossing) dispatch({ type: 'cycleNailCrossing', crossing });
    },
    [layout, dispatch],
  );

  // Both take the current value rather than closing over it, so they stay the
  // same function across renders — the wheel listener is hung off onZoom.
  const turn = useCallback((dYaw: number, dPitch: number) => {
    setOrientation((current) => ({
      yaw: current.yaw + dYaw,
      pitch: clamp(current.pitch + dPitch, -MAX_PITCH, MAX_PITCH),
    }));
  }, []);

  const changeZoom = useCallback((factor: number) => {
    setZoom((current) => clamp(current * factor, ZOOM_LIMIT.min, ZOOM_LIMIT.max));
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {mode === 'orbit' ? (
        <OrbitStage
          layout={layout}
          selectedIndex={selectedIndex}
          orientation={orientation}
          zoom={zoom}
          onSelect={select}
          onTurn={turn}
          onZoom={changeZoom}
        />
      ) : (
        <FlatStage
          layout={layout}
          view={mode}
          selectedIndex={selectedIndex}
          nailMode={nailMode}
          onSelect={nailMode ? clickCrossing : select}
        />
      )}

      {plan && (
        <NailControls
          layout={layout}
          on={placingNails}
          view={mode as ViewKind}
          onToggle={() => setPlacingNails((current) => !current)}
          dispatch={dispatch}
        />
      )}

      {mode === 'orbit' && (
        <OrbitControls
          onTurn={turn}
          onReset={() => {
            setOrientation(ISO_ORIENTATION);
            setZoom(1);
          }}
        />
      )}

      <div className="flex shrink-0 gap-1 border-t border-line-soft bg-ground-soft px-2 py-2">
        {MODES.map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            aria-pressed={mode === value}
            className={
              'flex-1 rounded-md px-2 py-1 text-label font-medium transition-colors ' +
              (mode === value
                ? 'bg-slate-800 text-white shadow-xs'
                : 'bg-card text-ink-soft shadow-xs hover:bg-ground')
            }
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** One of the four printed views, at the size the panel gives it. */
function FlatStage({
  layout,
  view,
  selectedIndex,
  nailMode,
  onSelect,
}: {
  layout: Layout;
  view: ViewKind;
  selectedIndex: number | undefined;
  nailMode: boolean;
  onSelect: (target: EventTarget) => void;
}) {
  const svg = useMemo(
    () =>
      renderView(layout, view, {
        targetWidth: 560,
        targetHeight: 420,
        interactive: true,
        selectedPiece: selectedIndex,
        nailTargets: nailMode,
        title: false,
        // On screen the layers under the top one are what is being positioned,
        // so they are drawn to be read rather than held back for the print.
        emphasis: 'screen',
      }),
    [layout, view, selectedIndex, nailMode],
  );

  return (
    <div
      className={
        'flex flex-1 items-center justify-center overflow-auto bg-ground-soft p-3 ' +
        (nailMode ? 'cursor-pointer' : '')
      }
      onClick={(event) => onSelect(event.target)}
      // The SVG comes from the same renderer the sheet and the PDF use, so what
      // is on screen is what will print.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/**
 * The nail mode switch, and what it does while it is on.
 *
 * Reset is here rather than in the form because this is where nails are placed:
 * it puts every crossing in the pallet back to two on a diagonal and three at
 * the corners, which is where a design that has not been fiddled with starts.
 */
function NailControls({
  layout,
  on,
  view,
  onToggle,
  dispatch,
}: {
  layout: Layout;
  on: boolean;
  view: ViewKind;
  onToggle: () => void;
  dispatch: (action: Action) => void;
}) {
  const shown = layout.nailCrossings.filter((crossing) => crossing.face === view);
  const dots = shown.reduce((sum, crossing) => sum + crossing.count, 0);
  const changed = layout.nailCrossings.filter((crossing) => crossing.manual).length;

  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-line-soft bg-card px-2.5 py-2">
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={on}
        className={
          'rounded-md border px-2 py-0.5 text-label font-medium transition-colors ' +
          (on
            ? 'border-accent bg-accent text-white'
            : 'border-line bg-card text-ink-soft shadow-xs hover:bg-ground')
        }
      >
        Place nails
      </button>

      <span className="text-micro text-ink-faint">
        {on
          ? `click a crossing to step it 0 → 4 and round · ${dots} nails in this view`
          : `${dots} nails in this view`}
      </span>

      {changed > 0 && (
        <button
          type="button"
          onClick={() => dispatch({ type: 'clearNailPlacements' })}
          className="ml-auto rounded-md border border-line bg-card px-2 py-0.5 text-label text-ink-soft shadow-xs transition-colors hover:bg-ground"
          title="Put every crossing back to two on a diagonal, three at the corners"
        >
          Reset {changed}
        </button>
      )}
    </div>
  );
}

/**
 * The 3D view. Drag to turn it, wheel to zoom. It is redrawn from the document
 * on every frame of the drag, which is the same path a keystroke in the form
 * takes — so adding a layer or changing a size shows up here immediately.
 */
function OrbitStage({
  layout,
  selectedIndex,
  orientation,
  zoom,
  onSelect,
  onTurn,
  onZoom,
}: {
  layout: Layout;
  selectedIndex: number | undefined;
  orientation: Orientation;
  zoom: number;
  onSelect: (target: EventTarget) => void;
  onTurn: (dYaw: number, dPitch: number) => void;
  onZoom: (factor: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const size = useSize(box, { width: 420, height: 380 });
  const drag = useRef<{ x: number; y: number; moved: boolean; hit: EventTarget } | null>(null);

  // The wheel has to be a non-passive listener or the panel scrolls as well as
  // zooming. React attaches its own passively, so this one is added by hand.
  useEffect(() => {
    const node = box.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      onZoom(event.deltaY < 0 ? 1.12 : 1 / 1.12);
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [onZoom]);

  const svg = useMemo(
    () =>
      renderOrbit(layout, {
        orientation,
        width: size.width,
        height: size.height,
        zoom,
        interactive: true,
        selectedPiece: selectedIndex,
      }),
    [layout, orientation, size.width, size.height, zoom, selectedIndex],
  );

  return (
    <div
      ref={box}
      className="flex-1 cursor-grab touch-none select-none overflow-hidden bg-ground-soft active:cursor-grabbing"
      onPointerDown={(event) => {
        // The piece under the pointer is remembered now, because capturing the
        // pointer retargets every event after this one at the box itself.
        drag.current = { x: event.clientX, y: event.clientY, moved: false, hit: event.target };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const from = drag.current;
        if (!from) return;
        const dx = event.clientX - from.x;
        const dy = event.clientY - from.y;
        if (!from.moved && Math.abs(dx) + Math.abs(dy) < DRAG_SLOP) return;
        from.moved = true;
        from.x = event.clientX;
        from.y = event.clientY;
        // The pallet follows the pointer: drag right and it turns to the right,
        // drag down and its near edge comes down. As though it were being
        // turned by hand rather than the eye being flown around it.
        onTurn(dx * DRAG_RATE, dy * DRAG_RATE);
      }}
      onPointerUp={() => {
        const from = drag.current;
        drag.current = null;
        if (from && !from.moved) onSelect(from.hit);
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/**
 * Four arrows for turning the view a fixed step at a time. Each one moves the
 * pallet the way a drag in that direction would, so the two agree. A drag is
 * quicker, but it will not land on the same angle twice; these will.
 */
function OrbitControls({
  onTurn,
  onReset,
}: {
  onTurn: (dYaw: number, dPitch: number) => void;
  onReset: () => void;
}) {
  const arrow =
    'flex h-6 w-7 items-center justify-center rounded-md border border-line bg-card ' +
    'text-ink-soft shadow-xs transition-colors hover:bg-ground';

  return (
    <div className="flex shrink-0 items-center justify-center gap-3 border-t border-line-soft bg-card px-2.5 py-2">
      <div className="flex items-center gap-1">
        <button type="button" className={arrow} title="Turn left" aria-label="Turn left" onClick={() => onTurn(-STEP, 0)}>
          ←
        </button>
        <div className="flex flex-col gap-1">
          <button type="button" className={arrow} title="Tip up" aria-label="Tip up" onClick={() => onTurn(0, -STEP)}>
            ↑
          </button>
          <button type="button" className={arrow} title="Tip down" aria-label="Tip down" onClick={() => onTurn(0, STEP)}>
            ↓
          </button>
        </div>
        <button type="button" className={arrow} title="Turn right" aria-label="Turn right" onClick={() => onTurn(STEP, 0)}>
          →
        </button>
      </div>
      <button
        type="button"
        onClick={onReset}
        className="rounded-md border border-line bg-card px-2 py-0.5 text-label text-ink-soft shadow-xs transition-colors hover:bg-ground"
        title="Back to the isometric the sheet prints"
      >
        Reset
      </button>
      <span className="text-micro text-ink-faint">drag to turn · wheel to zoom</span>
    </div>
  );
}

/** The drawing is generated at the size of its box, so the box has to be measured. */
function useSize(
  ref: React.RefObject<HTMLElement | null>,
  fallback: { width: number; height: number },
): { width: number; height: number } {
  const [size, setSize] = useState(fallback);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      const rect = entry?.contentRect;
      if (!rect) return;
      setSize({
        width: Math.max(Math.round(rect.width), 1),
        height: Math.max(Math.round(rect.height), 1),
      });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}
