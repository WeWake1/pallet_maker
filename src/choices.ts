import { z } from 'zod';
import { NOT_APPLICABLE, notApplicable } from './types.js';

/**
 * The four attributes picked from a list — and that take the design's own
 * words where the list has nothing that fits.
 *
 * Each list is the built-in choices below, then whatever the company has added
 * to it. A design stores the code of a built-in choice, or the words
 * themselves: the sheet prints a code as its label and words as they were
 * typed, so no design depends on the company's list to print. Taking an entry
 * off the list leaves every design that used it exactly as it was.
 */
export const CHOICE_FIELDS = ['palletType', 'deckType', 'entry', 'planing'] as const;

export type ChoiceField = (typeof CHOICE_FIELDS)[number];

/**
 * The built-in choices, in the order they are offered, each with the label it
 * is offered and printed under. One list for the editor and the sheet, so the
 * two cannot come to call a choice different things.
 */
export const BUILT_IN_CHOICES: Record<ChoiceField, ReadonlyArray<readonly [code: string, label: string]>> = {
  palletType: [
    ['block_4way', '4-way'],
    ['stringer_2way', '2-way'],
    ['plywood', 'Plywood pallet'],
  ],
  deckType: [
    ['single_face', 'Single face'],
    ['double_face_reversible', 'Double face, reversible'],
    ['double_face_non_reversible', 'Double face, non-reversible'],
  ],
  entry: [
    ['2_way', '2-way'],
    ['4_way', '4-way'],
    ['partial_4way', 'Partial 4-way'],
  ],
  planing: [
    ['none', 'None'],
    ['1_side', '1 side'],
    ['2_side', '2 sides'],
    ['4_side', '4 sides'],
  ],
};

/**
 * What a value prints as: a built-in code's label, or the design's own words
 * as they were typed. Blank and `na` are not values, and are the caller's to
 * deal with — see `stated` in the sheet's content.
 */
export function choiceLabel(field: ChoiceField, value: string): string {
  const built = BUILT_IN_CHOICES[field].find(([code]) => code === value);
  return built ? built[1] : value;
}

/** Whether a value is the design's own words rather than a code, blank or `na`. */
export function isOwnWords(field: ChoiceField, value: string): boolean {
  return (
    value.trim() !== '' &&
    !notApplicable(value) &&
    !BUILT_IN_CHOICES[field].some(([code]) => code === value)
  );
}

/**
 * Words typed for a field, as the design keeps them.
 *
 * Words that already name a choice become that choice — "4-way" typed as the
 * type is the built-in 4-way, "euro" where the list holds "Euro" is that entry
 * — so a list never shows the same thing twice. Anything else stands as
 * typed, less the spaces around it.
 */
export function settleWords(field: ChoiceField, typed: string, saved: readonly string[]): string {
  const text = typed.trim();
  if (notApplicable(text)) return NOT_APPLICABLE;
  const key = text.toLowerCase();
  const built = BUILT_IN_CHOICES[field].find(
    ([code, label]) => code === text || label.toLowerCase() === key,
  );
  if (built) return built[0];
  return saved.find((held) => held.toLowerCase() === key) ?? text;
}

/**
 * Pallet types this program no longer offers, and what a design carrying one
 * is read as.
 *
 * The three plywood types became one. Wing and Other went from the list; a
 * design that had one keeps the word as words of its own, so its sheet goes on
 * printing what it printed.
 */
const RETIRED_PALLET_TYPES = new Map<string, string>([
  ['plywood_type1', 'plywood'],
  ['plywood_type2', 'plywood'],
  ['plywood_type3', 'plywood'],
  ['wing', 'Wing'],
  ['other', 'Other'],
]);

export function currentPalletType(value: string): string {
  return RETIRED_PALLET_TYPES.get(value) ?? value;
}

/** What a company has added to each list, in the order it was added. */
export type Choices = Record<ChoiceField, string[]>;

/** Long enough for a name, short enough to fit its row on the sheet. */
export const MAX_CHOICE_LENGTH = 60;

/** Past this a list is not a list any more. */
export const MAX_SAVED_CHOICES = 50;

/**
 * One list as read from a file. An entry this version would not have added is
 * dropped on its own rather than refusing the whole file: the next addition
 * writes the file again, and would otherwise write it without any of the rest.
 */
const savedList = z
  .array(z.unknown())
  .default([])
  .transform((list) =>
    list.filter(
      (entry): entry is string =>
        typeof entry === 'string' && entry.trim() !== '' && entry.length <= MAX_CHOICE_LENGTH,
    ),
  );

export const ChoicesSchema = z.object({
  palletType: savedList,
  deckType: savedList,
  entry: savedList,
  planing: savedList,
});

export function emptyChoices(): Choices {
  return { palletType: [], deckType: [], entry: [], planing: [] };
}

export function isChoiceField(value: unknown): value is ChoiceField {
  return typeof value === 'string' && (CHOICE_FIELDS as readonly string[]).includes(value);
}

/** Something the list will not take, said so it can be shown. */
export class ChoiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChoiceError';
  }
}

/**
 * The lists with these words added to one of them.
 *
 * Words the list already offers — a built-in choice, or an entry spelled
 * another way — leave it as it was rather than adding a second of the same.
 */
export function withChoice(choices: Choices, field: ChoiceField, typed: string): Choices {
  const text = typed.trim();
  if (text === '') throw new ChoiceError('There is nothing to add');
  if (notApplicable(text)) throw new ChoiceError('n/a is on every list already');
  if (text.length > MAX_CHOICE_LENGTH) {
    throw new ChoiceError(`Keep it to ${MAX_CHOICE_LENGTH} characters`);
  }
  const settled = settleWords(field, text, choices[field]);
  if (!isOwnWords(field, settled) || choices[field].includes(settled)) return choices;
  if (choices[field].length >= MAX_SAVED_CHOICES) {
    throw new ChoiceError(`A list holds ${MAX_SAVED_CHOICES} of your own at most`);
  }
  return { ...choices, [field]: [...choices[field], settled] };
}

/** The lists with an entry taken off one. Designs that use it keep it. */
export function withoutChoice(choices: Choices, field: ChoiceField, value: string): Choices {
  return { ...choices, [field]: choices[field].filter((held) => held !== value) };
}
