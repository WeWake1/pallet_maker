import { useMemo, useRef } from 'react';
import type { Layout } from '../geometry/types.js';
import { renderView } from '../render/views.js';
import type { Action, Selection } from './state.js';
import { sameSource } from './state.js';

/**
 * A live preview of the top view, regenerated from the document on every change.
 *
 * Clicking a board selects it. Selection only: there is no dragging, because a
 * position that came from dragging would live on the drawing rather than on the
 * component, and the two would drift apart.
 */
export function Preview({
  layout,
  selection,
  dispatch,
}: {
  layout: Layout;
  selection: Selection | null;
  dispatch: (action: Action) => void;
}) {
  const box = useRef<HTMLDivElement>(null);

  const selectedIndex = useMemo(() => {
    if (!selection) return undefined;
    const index = layout.pieces.findIndex(
      (piece) => piece.layerId === selection.layerId && sameSource(piece.source, selection.source),
    );
    return index >= 0 ? index : undefined;
  }, [layout, selection]);

  const svg = useMemo(
    () =>
      renderView(layout, 'top', {
        targetWidth: 560,
        targetHeight: 420,
        interactive: true,
        selectedPiece: selectedIndex,
        title: false,
      }),
    [layout, selectedIndex],
  );

  return (
    <div
      ref={box}
      className="flex flex-1 items-center justify-center overflow-auto bg-slate-50 p-3"
      onClick={(event) => {
        const target = (event.target as Element).closest('[data-piece]');
        if (!target) {
          dispatch({ type: 'select', selection: null });
          return;
        }
        const index = Number(target.getAttribute('data-piece'));
        const piece = layout.pieces[index];
        if (piece) {
          dispatch({
            type: 'select',
            selection: { layerId: piece.layerId, source: piece.source },
          });
        }
      }}
      // The SVG comes from the same renderer the sheet and the PDF use, so what
      // is on screen is what will print.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
