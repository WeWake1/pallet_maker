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

/**
 * Today, as the ISO date the documents use.
 *
 * In the zone given, or in UTC without one. The difference is the date on the
 * sheet: a design saved at eight in the evening in Bengaluru is a design saved
 * today, and UTC would stamp it with yesterday until half past five in the
 * morning. The server passes the company's zone; the tests pass nothing and
 * get the same answer everywhere.
 */
export function today(timeZone?: string): string {
  if (!timeZone) return new Date().toISOString().slice(0, 10);
  // en-CA writes a date as YYYY-MM-DD, which is the ISO form without any
  // assembling of parts by hand.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Whether a name is one the runtime knows as a time zone, like Asia/Kolkata. */
export function isTimeZone(name: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

/** The zone this machine is set to. */
export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
