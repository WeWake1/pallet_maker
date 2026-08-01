import type { Layout } from '../geometry/types.js';
import type { LayerKind, Pallet } from '../types.js';

/**
 * The components table. Grouped by layer, one row per part number, so a layer
 * with two board widths produces two rows under the same heading.
 *
 * Quantities are counted off the drawing, dimensions are read from the data.
 * The two can never disagree, because both come from the same document.
 *
 * No material per row: the pallet states its species once, and where a part is
 * made of something else — the panel on a plywood pallet — the part names it.
 * Costing reads material off the pieces, not off this table.
 */

export interface ComponentRow {
  partNo: number;
  description: string;
  variant: string;
  quantity: number;
  thickness: number;
  width: number;
  length: number;
}

export interface ComponentGroup {
  layerId: string;
  heading: string;
  rows: ComponentRow[];
}

/** Domain vocabulary, used verbatim on the sheet. */
const HEADING: Record<LayerKind, string> = {
  panel: 'Plywood sheet',
  top_deck: 'Top boards',
  bearer: 'Centre boards',
  block: 'Blocks',
  runner: 'Runners',
  bottom_deck: 'Bottom boards',
};

const DESCRIPTION: Record<LayerKind, string> = {
  panel: 'Plywood sheet',
  top_deck: 'Top board',
  bearer: 'Centre board',
  block: 'Block',
  runner: 'Runner',
  bottom_deck: 'Bottom board',
};

export function componentTable(pallet: Pallet, layout: Layout): ComponentGroup[] {
  const ordered = [...pallet.layers].sort((a, b) => a.order - b.order);

  return ordered.map((layer) => {
    const quantity = (partNo: number): number =>
      layout.pieces.filter((p) => p.layerId === layer.id && p.partNo === partNo).length;

    const rows = new Map<number, ComponentRow>();
    const add = (row: Omit<ComponentRow, 'quantity'>): void => {
      if (rows.has(row.partNo)) return;
      rows.set(row.partNo, { ...row, quantity: quantity(row.partNo) });
    };

    const content = layer.content;
    if (content.type === 'sequence') {
      for (const slot of content.slots) {
        add({
          partNo: slot.partNo,
          description: DESCRIPTION[layer.kind],
          variant: slot.variant ?? '',
          thickness: slot.thickness,
          width: slot.width,
          length: slot.length,
        });
      }
    } else if (content.type === 'grid') {
      for (const cell of content.grid.cells.flat()) {
        add({
          partNo: cell.partNo,
          description: DESCRIPTION[layer.kind],
          variant: cell.variant ?? '',
          thickness: cell.heightMm,
          width: cell.widthMm,
          length: cell.lengthMm,
        });
      }
    } else {
      const sheet = content.sheet;
      add({
        partNo: sheet.partNo,
        description: 'Plywood sheet',
        variant: '',
        thickness: sheet.thickness,
        width: sheet.width,
        length: sheet.length,
      });
    }

    return {
      layerId: layer.id,
      heading: content.type === 'sheet' ? 'Plywood sheet' : HEADING[layer.kind],
      rows: [...rows.values()].sort((a, b) => a.partNo - b.partNo),
    };
  });
}

/** Total number of pieces, for the sheet to state what is being built. */
export function totalPieces(groups: ComponentGroup[]): number {
  return groups.reduce(
    (sum, group) => sum + group.rows.reduce((n, row) => n + row.quantity, 0),
    0,
  );
}
