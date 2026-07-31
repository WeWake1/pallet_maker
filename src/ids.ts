/**
 * Ids are only ever generated here, so nothing can accidentally share one.
 * `crypto.randomUUID` exists in the browser and in Node; the fallback is only
 * for an insecure context.
 */
export function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Today, as the ISO date the documents use. */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
