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
  span: 'How far across the pallet this layer of boards reaches. Left at 0 it uses the full width, which is nearly always what is wanted.',
  offset:
    'Where the layer starts, measured from the edge. 0 means flush with the edge; a larger number sets the whole layer in.',
  runSpan:
    'How long the boards themselves are, along the way they run. Left at 0 they run the whole length.',
  runOffset: 'How far along their own run the boards start, measured from the end.',
  slack:
    'The room left over once every board in the layer is laid out and evenly spaced. Negative means the boards add up to more than the space they have — the layer is over-full and will not print.',
  gap: 'The space between one board and the next, worked out by spreading the layer evenly. It is not typed in: change a width or a count and the gaps re-space themselves.',
  nudge:
    'Moving one board off the evenly-spaced position the layout gave it, in millimetres. It is the only record of where a board sits — nothing here is ever dragged.',
  variant:
    'A mark distinguishing two boards that are the same size but not the same part — a different notch or bevel, say. Boards with different variants get different part numbers.',
  joined:
    'This board and the one before it are one board, butted end to end, rather than two with a gap between them.',
  sameLevel:
    'This layer sits alongside the one above it in the same course of timber, not on top of it. It is how a deck whose boards run two different ways is built.',
  derivedHeight:
    'Left at 0, the height is whatever the layers add up to — shown beside it as the stack. Type a number only to state a height the timber does not itself give.',
  palletType:
    'How the pallet is built. Block pallets sit on blocks and can be entered from all four sides; stringer pallets sit on long runners and take a fork from two.',
  deckType:
    'Whether there is timber on the underside as well as the top, and if so whether the pallet can be used either way up.',
  entry:
    'Which sides a fork lift can get its forks into. 4-way means all four; 2-way means the two ends only.',
  planing: 'How many faces of the timber are planed smooth rather than left sawn.',
  staticLoad: 'What the pallet will carry standing still — stacked in a rack or on the floor.',
  dynamicLoad:
    'What the pallet will carry while it is being moved. Always the lower of the two figures.',
  species: 'The timber the pallet is made from — pine, hardwood, and so on.',
  handling:
    'What the finished pallet may be moved with. Ticked prints as a tick on the sheet, unticked as a cross — the sheet says both, because what a pallet must not be lifted with is what gets it dropped.',
  palletCode: 'The shop’s own number for this design. A design can be drawn, saved and printed before it has one.',
  clientPartNo: 'The number the client knows this pallet by, which is rarely the same as the shop’s.',
  sheetNote: 'A line printed in the title block beside the date — a client drawing number, or “(old)”.',
  cft: 'Cubic feet. Timber is bought and priced by volume, and this is the unit the yard quotes in.',
} as const;

export type HintKey = keyof typeof HINTS;

/**
 * The glossary, in the order it is worth reading rather than alphabetically.
 * Terms someone meets in the first ten minutes come first.
 */
export const GLOSSARY: Array<{ term: string; hint: HintKey }> = [
  { term: 'Span', hint: 'span' },
  { term: 'Offset', hint: 'offset' },
  { term: 'Run span', hint: 'runSpan' },
  { term: 'Run offset', hint: 'runOffset' },
  { term: 'Gap', hint: 'gap' },
  { term: 'Slack', hint: 'slack' },
  { term: 'Nudge', hint: 'nudge' },
  { term: 'Joined', hint: 'joined' },
  { term: 'Variant', hint: 'variant' },
  { term: 'Same level', hint: 'sameLevel' },
  { term: 'Entry', hint: 'entry' },
  { term: 'Deck', hint: 'deckType' },
  { term: 'Static load', hint: 'staticLoad' },
  { term: 'Dynamic load', hint: 'dynamicLoad' },
  { term: 'Planing', hint: 'planing' },
  { term: 'Handling', hint: 'handling' },
  { term: 'cft', hint: 'cft' },
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
  handling: 'Handling',
  staticLoadKg: 'Static load',
  dynamicLoadKg: 'Dynamic load',
  note: 'Sheet note',
  notes: 'Notes',
  length: 'length',
  width: 'width',
  thickness: 'thickness',
  height: 'height',
  material: 'material',
  variant: 'variant',
  nudgeMm: 'nudge',
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
    // person can be told to look. The number after them is the board.
    if (step === 'content' || step === 'slots' || step === 'cells') {
      index += 1;
      continue;
    }

    if (typeof step === 'number') {
      const container = path[index - 1];
      const noun = container === 'cells' ? 'block' : container === 'nails' ? 'row' : 'board';
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
