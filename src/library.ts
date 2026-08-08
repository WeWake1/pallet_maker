import { z } from 'zod';
import { today } from './ids.js';
import { ClientSchema, PalletSchema, parsed } from './schema.js';

/**
 * The whole library as one file.
 *
 * The store is a SQLite file on one machine, which is a database and not
 * something to email, hand to a colleague or open on another computer. This is
 * the same designs written out as plain JSON: every client and every design of
 * theirs, in a form that can be dropped in a Drive folder, kept as a backup, or
 * read back in years from now by something that is not this program.
 *
 * Designs keep their ids on the way out. That is what makes importing a file
 * twice harmless — the second time round every design in it is recognised as
 * one already held, and nothing is written. A backup restored onto an empty
 * machine comes back as exactly what it was, not as copies of it.
 *
 * `format` and `version` are here so that a file picked out of a folder can be
 * told apart from any other JSON, and so that a later change to the shape can
 * still read what this version wrote.
 */

export const LIBRARY_FORMAT = 'pallet-library';
export const LIBRARY_VERSION = 1;

export const LibrarySchema = z.object({
  format: z.literal(LIBRARY_FORMAT),
  version: z.number().int().positive(),
  exportedAt: z.string().min(1).default(() => today()),
  clients: z.array(ClientSchema),
  designs: z.array(PalletSchema),
});

export type Library = z.infer<typeof LibrarySchema>;

/**
 * What an import did.
 *
 * Reported rather than assumed, because the interesting number is `skipped`:
 * designs the library already held, which were left exactly as they were. Its
 * being non-zero is the difference between "your backup is restored" and "most
 * of it was already here", and only the person importing knows which they
 * meant.
 */
export interface ImportReport {
  clientsAdded: number;
  designsAdded: number;
  /** Already held, and left alone. */
  designsSkipped: number;
  /** Already held, and overwritten because that was asked for. */
  designsReplaced: number;
}

/**
 * What to do about a design the library already holds.
 *
 * `skip` is the default everywhere and the only safe one: a design in the store
 * is one somebody may be building to, and an import must never quietly write
 * over it. `replace` exists because restoring a backup deliberately over the
 * top of newer edits is a real thing to want, and it is only ever chosen after
 * being told how many designs it would take.
 */
export type ImportMode = 'skip' | 'replace';

/** Parse and validate a library file, throwing a readable error. */
export function parseLibrary(input: unknown): Library {
  return parsed(LibrarySchema.safeParse(input), 'library');
}

/**
 * What the file is called on the way out. Dated, because the only question ever
 * asked of a backup is which of them is the recent one.
 */
export function libraryFileName(now: string = today()): string {
  return `pallet-library-${now}.json`;
}
