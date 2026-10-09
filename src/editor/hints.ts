/**
 * The words this editor uses, and what each one means, in one sentence.
 *
 * A pallet is described in trade terms — span, slack, nudge, variant — that are
 * exact to whoever has built one and opaque to whoever has not. The terms are
 * kept, because they are what the shop floor says and renaming them would only
 * move the confusion to the first conversation about a design. What changes is
 * that the editor now says what they mean, where they are used.
 *
 * This file is the only copy of that wording. The ⓘ beside a field reads from
 * it, and so does the glossary in the help panel, so the two can never come to
 * say different things.
 */
export const HINTS = {
  span: 'How far across the pallet the layer reaches; 0 is the full width.',
  offset: 'How far in from the edge the layer starts; 0 is flush.',
  runSpan: 'How long the boards are along their run; 0 is the full length.',
  runOffset: 'How far from the end the boards start.',
  slack: 'Room left once the boards are evenly spaced; below zero, they do not fit.',
  gap: 'The space between neighbouring boards, worked out from the widths and count.',
  nudge: 'Millimetres this board is moved off its evenly spaced position.',
  variant: 'Tells apart two boards of one size that are different parts.',
  joined: 'Butted end to end with the board before it, as one board.',
  notches: 'Two cuts in the underside of each runner, so a fork can enter from the side.',
  notchFromEnd: 'From the end of the runner to the near edge of the notch.',
  sameLevel: 'Sits beside the layer above, in the same course, rather than on it.',
  derivedHeight: 'Leave empty to use what the layers add up to.',
  palletType: 'How it is built: on blocks, on runners, or with a sheet deck.',
  deckType: 'Whether it has a bottom deck, and whether it can be used either way up.',
  entry: 'Which sides a fork can enter: 4-way is all four, 2-way the ends only.',
  planing: 'How many faces of the timber are planed smooth.',
  staticLoad: 'What it carries standing still.',
  dynamicLoad: 'What it carries while being moved.',
  species: 'The timber — pine, hardwood and so on.',
  componentTolerance: 'How far one board or block may be off its size; na removes it from the sheet.',
  palletTolerance: 'How far the whole pallet may be off its size; na removes it from the sheet.',
  palletCode: 'Your own number for this design. Optional.',
  clientPartNo: 'The number the client knows this pallet by.',
} as const;

export type HintKey = keyof typeof HINTS;

/**
 * The glossary, in the order it is worth reading rather than alphabetically.
 * Terms someone meets in the first ten minutes come first.
 */
export const GLOSSARY: Array<{ term: string; hint: HintKey }> = [
  { term: 'Gap', hint: 'gap' },
  { term: 'Slack', hint: 'slack' },
  { term: 'Nudge', hint: 'nudge' },
  { term: 'Joined', hint: 'joined' },
  { term: 'Variant', hint: 'variant' },
  { term: 'Notches', hint: 'notches' },
  { term: 'Same level', hint: 'sameLevel' },
  // Folded away under "Inset & offset" on each layer: a wing pallet, or a
  // deck cut to fit between boards, and little else.
  { term: 'Span', hint: 'span' },
  { term: 'Offset', hint: 'offset' },
  { term: 'Run span', hint: 'runSpan' },
  { term: 'Run offset', hint: 'runOffset' },
  { term: 'Entry', hint: 'entry' },
  { term: 'Deck', hint: 'deckType' },
  { term: 'Static load', hint: 'staticLoad' },
  { term: 'Dynamic load', hint: 'dynamicLoad' },
  { term: 'Planing', hint: 'planing' },
];

/** The id a field carries so the problem list can scroll to it. */
export function fieldId(path: string): string {
  return `field-${path.replace(/[^a-zA-Z0-9]+/g, '-')}`;
}

/** What the document calls a field, against what a person calls it. */
const FIELD_LABEL: Record<string, string> = {
  layers: 'Layers',
  palletCode: 'Pallet code',
  palletName: 'Pallet name',
  clientId: 'Client',
  clientName: 'Client',
  clientPartNo: 'Client part no',
  overallLength: 'Length',
  overallWidth: 'Width',
  overallHeight: 'Height',
  palletType: 'Type',
  deckType: 'Deck',
  entry: 'Entry',
  species: 'Species',
  planing: 'Planing',
  handling: 'Handling and storage',
  staticLoadKg: 'Static load',
  dynamicLoadKg: 'Dynamic load',
  notes: 'Notes',
  length: 'length',
  width: 'width',
  thickness: 'thickness',
  height: 'height',
  material: 'material',
  variant: 'variant',
  nudgeMm: 'nudge',
  lengthMm: 'length',
  depthMm: 'depth',
  spanMm: 'span',
  offsetMm: 'offset',
  runSpanMm: 'run span',
  runOffsetMm: 'run offset',
  direction: 'direction',
  kind: 'kind',
  joint: 'joint',
  type: 'type',
  size: 'size',
  count: 'quantity',
  rows: 'rows',
  cols: 'columns',
};

/**
 * A validation path, said as a place in the editor.
 *
 * What the schema reports is where the value sits in the document —
 * `layers.0.content.slots.2.length`. That is exact and unhelpful: it names a
 * position in a data structure, and what is needed is which card to scroll to
 * and which box on it is empty. Given the layer names, the same path reads
 * "Top boards, board 3 — length".
 */
export function describePath(path: Array<string | number>, layerNames: string[]): string {
  const parts: string[] = [];
  let index = 0;

  while (index < path.length) {
    const step = path[index];

    if (step === 'layers' && typeof path[index + 1] === 'number') {
      const which = path[index + 1] as number;
      parts.push(layerNames[which] ?? `Layer ${which + 1}`);
      index += 2;
      continue;
    }

    // `content` and `slots` are how the document is shaped, not anywhere a
    // person can be told to look. The number after them is the board, and
    // the number after `notches` is the notch in it.
    if (step === 'content' || step === 'slots' || step === 'cells' || step === 'notches') {
      index += 1;
      continue;
    }

    if (typeof step === 'number') {
      const container = path[index - 1];
      const noun =
        container === 'cells'
          ? 'block'
          : container === 'nails'
            ? 'row'
            : container === 'notches'
              ? 'notch'
              : 'board';
      parts.push(`${noun} ${step + 1}`);
      index += 1;
      continue;
    }

    if (step === 'nails') {
      parts.push('Nails');
      index += 1;
      continue;
    }

    const name = String(step);
    parts.push(FIELD_LABEL[name] ?? name);
    index += 1;
  }

  if (parts.length === 0) return 'This design';
  // The last part is the box itself; everything before it says where.
  const box = parts.pop() as string;
  return parts.length > 0 ? `${parts.join(', ')} — ${box}` : box;
}

/**
 * Where in the editor a validation path points, if it is a field with an id.
 *
 * Only the top-level attributes have a box of their own to be sent to. A board
 * deep inside a layer is reported by name — "Top boards, board 3" — and found
 * by scrolling to that card, which is what the layer names are for.
 *
 * Two names on the document are one field on the screen: picking a client sets
 * the id and copies the name, so a complaint about either goes to the one list.
 */
const ANCHOR_ALIAS: Record<string, string> = { clientName: 'clientId' };

export function pathAnchor(path: Array<string | number>): string | null {
  const first = path[0];
  if (path.length !== 1 || typeof first !== 'string') return null;
  return fieldId(ANCHOR_ALIAS[first] ?? first);
}

/**
 * A schema complaint, said in words.
 *
 * Zod describes what it checked — "String must contain at least 1
 * character(s)" — because it does not know what the string was for. Next to a
 * field that has just been named, what is wanted is what to do about it.
 */
export function sayIssue(message: string): string {
  if (/^Required$/i.test(message)) return 'needs filling in';
  if (/String must contain at least 1/.test(message)) return 'needs filling in';
  if (/String must contain at least (\d+)/.test(message)) {
    return `needs at least ${/at least (\d+)/.exec(message)?.[1]} characters`;
  }
  if (/Array must contain at least 1/.test(message)) return 'needs at least one — add a layer';
  if (/Number must be greater than 0/.test(message)) return 'has to be more than zero';
  if (/Number must be greater than or equal to 0/.test(message)) return 'cannot be negative';
  if (/Expected number/.test(message)) return 'has to be a number';
  if (/Invalid enum value/.test(message)) return 'is not one of the choices offered';
  // Anything this does not know about is passed through: a message nobody
  // wrote a translation for is still better than no message.
  return message;
}
