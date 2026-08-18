/**
 * A short, stable name for exactly this version of a design.
 *
 * Two people can have the same design open at once. Nothing stops them — the
 * designs are files in a shared folder, and there is no server between them to
 * hold a lock. What can be stopped is the second save quietly throwing away the
 * first, which is what happens without this: the editor says which version it
 * started from, and a save is refused if the folder no longer holds that one.
 *
 * Computed from the document rather than from a date, because the date a design
 * carries is only a date — two edits on the same afternoon share it, and that
 * is exactly when two people are most likely to collide.
 *
 * The same function runs in the editor and in the server, so the two agree
 * about what "unchanged" means. Keys are sorted, so a document that survived a
 * trip through JSON is still recognised as itself.
 */

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    // A key that is absent and a key set to undefined are the same document.
    // Only one of them survives being sent as JSON, and both must hash alike.
    .filter(([, held]) => held !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries.map(([key, held]) => `${JSON.stringify(key)}:${canonical(held)}`).join(',')}}`;
}

/**
 * A 32-bit FNV-1a of the canonical form, as hex.
 *
 * Not a cryptographic hash and does not need to be: it is guarding against a
 * colleague's save, not against anybody trying to slip a document past. What it
 * has to be is identical in Node and in the browser, which rules out `crypto`
 * without a great deal more ceremony than this is worth.
 */
export function fingerprint(document: unknown): string {
  const text = canonical(document);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    // The FNV prime, as shifts, so this stays in 32 bits in both runtimes.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
