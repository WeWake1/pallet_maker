import { circle, el, path, rect } from '../render/svg.js';
import { HANDLING_METHODS } from '../types.js';
import type { HandlingMethod } from '../types.js';

/**
 * The handling block: what the pallet may be moved with, said in pictures.
 *
 * A tick beside a word is read across a workshop; a word on its own is not. So
 * each method is drawn as well as named, and the drawing is the thing that
 * carries at arm's length — which is the whole point of putting it in the
 * corner of a sheet somebody is holding while they load a truck.
 *
 * **The geometry lives here rather than in either presenter**, because the sheet
 * is set out twice and the two must draw the same icon. It is emitted as plain
 * shapes with their colours on them — no CSS, no `<use>`, no sprite — so the
 * same string can go inside an `<svg>` in the HTML sheet, inside a scaled `<g>`
 * in the SVG sheet, and inside the editor's own checkbox row.
 *
 * **Every icon is geometry and none is a picture**, the same rule the company
 * mark follows in `src/brand/logo.ts` and for the same two reasons. An `<image>`
 * holding a base64 raster is one of the things a page-layout program cannot take
 * apart, and one element it cannot take apart tends to make it give up and
 * flatten the whole sheet to a picture; and a 512-pixel drawing set 6.4 mm wide
 * prints as a smudge where a path prints as a line. The pallet truck and the
 * forklift are drawn from the artwork in `assets/icons/` — redrawn at this
 * stroke weight, not traced off it, since the reference's own hairlines would
 * come out at a tenth of a millimetre. **If that artwork changes, these shapes
 * have to be drawn again**: nothing here reads the files.
 */

/** Every icon is drawn in this box and scaled to wherever it is placed. */
export const ICON_BOX = 24;

/** Line weight, in icon units. Lands at about 0.45 mm at the printed size. */
const STROKE = 1.7;

/** What each method prints as, on the sheet and in the editor alike. */
export const HANDLING_LABEL: Record<HandlingMethod, string> = {
  pallet_truck: 'Hand pallet truck',
  forklift: 'Forklift',
  crane: 'Crane',
  conveyor: 'Conveyor',
  manual: 'Manual lift',
};

/**
 * A cleared method is drawn in the sheet's ink; a crossed one in the grey the
 * rules are drawn in, so the corner reads as a list of what may be done with a
 * glance to spare for what may not.
 */
export const HANDLING_INK = {
  allowed: '#111111',
  crossed: '#9aa1aa',
} as const;

/** One stroked shape of an icon. Nothing is ever filled. */
type Shape =
  | { d: string }
  | { cx: number; cy: number; r: number }
  | { x: number; y: number; w: number; h: number };

/**
 * The five icons, each a side view in the 24-unit box.
 *
 * Side views throughout, and all five sit on the same imaginary floor, so the
 * row reads as five ways of moving one pallet rather than five unrelated marks.
 */
const ICONS: Record<HandlingMethod, readonly Shape[]> = {
  // Loop tiller, pump housing and steer wheel at the near end; the fork running
  // away to its tandem load rollers — the shape in
  // `assets/icons/hand-pallet-truck.jpg`, less the second fork, which at this
  // size would only merge with the first.
  pallet_truck: [
    { d: 'M2.5 5a3.4 1.5 0 0 1 6.8 0' },
    { d: 'M2.5 5L5.9 8.2' },
    { d: 'M9.3 5L5.9 8.2' },
    { d: 'M5.9 8.2V11' },
    { x: 4.3, y: 11, w: 3.2, h: 2.8 },
    { cx: 5.9, cy: 17, r: 1.9 },
    { d: 'M9.2 11V15.8' },
    { d: 'M9.2 15.8H21.6' },
    { cx: 18.2, cy: 18, r: 1.1 },
    { cx: 20.8, cy: 18, r: 1.1 },
  ],
  // Overhead guard, body on its wheels, and the mast standing at the front with
  // one tine off it — the shape in `assets/icons/forklift.png`. The seat is in
  // the artwork and not here: at 6.4 mm it closed the cab into a blot.
  forklift: [
    { d: 'M2.6 5.4H10.2' },
    { d: 'M3.2 5.4V11.6' },
    { d: 'M9.8 5.4L12.6 10.8' },
    { d: 'M2.6 16.4V11.6H12.4V16.4Z' },
    { cx: 5.2, cy: 17.6, r: 2 },
    { cx: 10.6, cy: 17.6, r: 1.6 },
    { d: 'M13.8 2.6V17.2' },
    { d: 'M12.8 2.6H14.8' },
    { d: 'M13.8 14.6H20.8' },
  ],
  // A tower crane: mast, jib and counter-jib, and the hook down on its rope.
  // The counter-jib is what stops the L of a mast and a jib reading as a
  // gallows, which is exactly what it read as without one.
  crane: [
    { d: 'M9 20V5' },
    { d: 'M6 20H12' },
    { d: 'M3 5H21' },
    { d: 'M6.5 5L9 2L11.5 5' },
    { d: 'M17 5V11' },
    { d: 'M17 11v1.6a1.9 1.9 0 1 0 1.9 1.9' },
  ],
  // A load on a roller bed. Five rollers, so it reads as a run and not a trolley.
  conveyor: [
    { x: 6.5, y: 4, w: 11, h: 6.5 },
    { cx: 4, cy: 12.2, r: 1.7 },
    { cx: 8, cy: 12.2, r: 1.7 },
    { cx: 12, cy: 12.2, r: 1.7 },
    { cx: 16, cy: 12.2, r: 1.7 },
    { cx: 20, cy: 12.2, r: 1.7 },
    { d: 'M2 15H22' },
    { d: 'M4.5 15V20' },
    { d: 'M19.5 15V20' },
  ],
  // Somebody carrying it.
  manual: [
    { cx: 6.5, cy: 4.5, r: 2.2 },
    { d: 'M6.5 6.7V13' },
    { d: 'M6.5 13L4.7 20' },
    { d: 'M6.5 13L8.3 20' },
    { d: 'M6.5 9L11 11' },
    { x: 11, y: 9.5, w: 7.5, h: 6.5 },
  ],
};

/** The tick, and the box it sits in. Drawn in the same 24-unit box. */
const CHECKBOX: readonly Shape[] = [{ x: 3, y: 3, w: 18, h: 18 }];
const TICK: readonly Shape[] = [{ d: 'M7.2 12.4L10.6 15.8L17 8.6' }];
const CROSS: readonly Shape[] = [{ d: 'M8.4 8.4L15.6 15.6' }, { d: 'M15.6 8.4L8.4 15.6' }];

/** One icon's shapes, in one colour, ready to be placed. */
export function handlingIcon(method: HandlingMethod, colour: string): string {
  return shapes(ICONS[method], colour);
}

/**
 * The box beside an icon: ticked where the method is cleared, crossed where it
 * is not. Crossed rather than empty on purpose — an empty box is a question
 * nobody got to, and the sheet has to be able to say no.
 */
export function handlingMark(allowed: boolean, colour: string): string {
  return shapes([...CHECKBOX, ...(allowed ? TICK : CROSS)], colour);
}

/** The icon set as an `<svg>`, for HTML and for the editor. */
export function handlingIconSvg(method: HandlingMethod, colour: string, size: string): string {
  return el(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      viewBox: `0 0 ${ICON_BOX} ${ICON_BOX}`,
      width: size,
      height: size,
      'aria-hidden': 'true',
    },
    handlingIcon(method, colour),
  );
}

export function handlingMarkSvg(allowed: boolean, colour: string, size: string): string {
  return el(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      viewBox: `0 0 ${ICON_BOX} ${ICON_BOX}`,
      width: size,
      height: size,
      'aria-hidden': 'true',
    },
    handlingMark(allowed, colour),
  );
}

/** Every method with its label, for anything that lists them all. */
export function handlingCatalogue(): Array<{ method: HandlingMethod; label: string }> {
  return HANDLING_METHODS.map((method) => ({ method, label: HANDLING_LABEL[method] }));
}

function shapes(list: readonly Shape[], colour: string): string {
  const stroke = {
    fill: 'none',
    stroke: colour,
    'stroke-width': STROKE,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  };
  return list
    .map((shape) => {
      if ('d' in shape) return path(shape.d, stroke);
      if ('r' in shape) return circle(shape.cx, shape.cy, shape.r, stroke);
      return rect(shape.x, shape.y, shape.w, shape.h, stroke);
    })
    .join('');
}
