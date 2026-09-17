import type { BlockCell, Layer, Notch, Pallet, SheetSpec, Slot } from '../types.js';
import { notchRadius } from './notch.js';

/**
 * Part numbers, worked out from the design rather than typed into it.
 *
 * A part is a distinct piece of timber: one kind of component, one size, one
 * material, one variant. Two boards that are all four of those things are the
 * same part and carry the same number; change one board's width and it becomes
 * a part of its own.
 *
 * These used to be typed in, which meant every new board needed a number
 * choosing for it and a number reused for two different sizes was an error the
 * layout engine had to report. Deriving them makes both impossible: the
 * numbering follows the sizes, so it is always right and never has to be
 * maintained.
 */

/**
 * Numbers run top layer down, in the order components appear within a layer.
 *
 * Notches are part of the signature — a notched runner is not the same piece of
 * timber as a plain one — but only where there are any, so a design without
 * them signs exactly as it did before notches existed and nothing renumbers.
 */
export function partSignature(
  kind: string,
  length: number,
  width: number,
  thickness: number,
  material: string,
  variant?: string,
  notches?: Notch[],
): string {
  const cuts =
    notches && notches.length > 0
      ? `/n${notches.map((n) => `${n.offsetMm}+${n.lengthMm}x${n.depthMm}`).join(',')}`
      : '';
  return `${kind}/${length}x${width}x${thickness}/${material}/${variant ?? ''}${cuts}`;
}

export function slotSignature(layer: Layer, slot: Slot): string {
  return partSignature(
    layer.kind,
    slot.length,
    slot.width,
    slot.thickness,
    slot.material,
    slot.variant,
    slot.notches,
  );
}

/**
 * The notches of a part, said in words for the components table and the
 * editor: "2 notches 229 × 35 R38" — length at the mouth, depth, and the
 * radius the top corners are cut to. Nothing where there are none. Sizes
 * only, since where they sit is what the drawing dimensions; where they come
 * in more than one size, each size is named.
 */
export function describeNotches(notches: Notch[] | undefined): string {
  if (!notches || notches.length === 0) return '';
  const sizes = [
    ...new Set(notches.map((n) => `${n.lengthMm} × ${n.depthMm} R${notchRadius(n)}`)),
  ];
  const count = notches.length === 1 ? '1 notch' : `${notches.length} notches`;
  return `${count} ${sizes.join(', ')}`;
}

/** A block is stated length x width x height; its height is its thickness. */
export function cellSignature(layer: Layer, cell: BlockCell): string {
  return partSignature(
    layer.kind,
    cell.lengthMm,
    cell.widthMm,
    cell.heightMm,
    cell.material,
    cell.variant,
  );
}

export function sheetSignature(layer: Layer, sheet: SheetSpec): string {
  return partSignature(layer.kind, sheet.length, sheet.width, sheet.thickness, sheet.material);
}

/** Every component of a layer, in the order it is laid out. */
export function layerSignatures(layer: Layer): string[] {
  const content = layer.content;
  switch (content.type) {
    case 'sequence':
      return content.slots.map((slot) => slotSignature(layer, slot));
    case 'grid':
      return content.grid.cells.flat().map((cell) => cellSignature(layer, cell));
    case 'sheet':
      return [sheetSignature(layer, content.sheet)];
  }
}

/**
 * The part number of every distinct part in the pallet, keyed by signature.
 *
 * One pass over the layers top to bottom, numbering each new signature as it is
 * first met, so a design's numbering is stable as long as its sizes are and the
 * same map serves the drawing and the components table alike.
 */
export function partNumbers(pallet: Pallet): Map<string, number> {
  const numbers = new Map<string, number>();
  for (const layer of [...pallet.layers].sort((a, b) => a.order - b.order)) {
    for (const signature of layerSignatures(layer)) {
      if (!numbers.has(signature)) numbers.set(signature, numbers.size + 1);
    }
  }
  return numbers;
}
