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
  return dayIn(Date.now(), timeZone);
}

/** The ISO date an instant falls on, in the zone given or in UTC. */
export function dayIn(at: number, timeZone?: string): string {
  if (!timeZone) return new Date(at).toISOString().slice(0, 10);
  // en-CA writes a date as YYYY-MM-DD, which is the ISO form without any
  // assembling of parts by hand.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(at));
}

/**
 * An ISO date the way it is written on a sheet: day, month, year — 06-08-2026.
 *
 * The store keeps YYYY-MM-DD, which sorts and compares as text; this is only
 * how it reads. Anything not in that form is handed back untouched rather
 * than rearranged into something it never said.
 */
export function dayMonthYear(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : iso;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far ahead of UTC a zone's clocks are at an instant, in milliseconds. */
function offsetAt(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(at));
  const part = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
  return wall - Math.floor(at / 1000) * 1000;
}

/**
 * The last moment of a calendar day in a zone, as an ISO instant.
 *
 * "Until 9 October" means all of the ninth, and the ninth where the company
 * is rather than where the server is: it ends at their midnight. Null for
 * anything that is not a real YYYY-MM-DD date.
 */
export function endOfDay(date: string, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const start = new Date(Date.UTC(year, month - 1, day));
  // 2026-02-30 is not a date, though Date.UTC will happily make it 2 March.
  if (start.getUTCFullYear() !== year || start.getUTCMonth() !== month - 1 || start.getUTCDate() !== day) return null;
  // Midnight at the start of the next day, read as though the zone were UTC
  // and then moved by the zone's offset. Asked twice, for the day a clock
  // changes, when the offset at the guess is not the offset at the answer.
  const midnight = start.getTime() + DAY_MS;
  let at = midnight - offsetAt(midnight, timeZone);
  at = midnight - offsetAt(at, timeZone);
  return new Date(at - 1).toISOString();
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
