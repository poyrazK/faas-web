const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "5m ago" / "in 5m". Within a minute either side reads "just now". Rounds the
 * way the console always has: minutes (at least 1) under an hour, then hours
 * under a day, then days.
 */
export function relativeTime(ms: number, now: number = Date.now()): string {
  const diff = now - ms;
  const distance = Math.abs(diff);
  if (distance < MINUTE) return 'just now';

  let amount: string;
  if (distance < HOUR) amount = `${Math.max(1, Math.round(distance / MINUTE))}m`;
  else if (distance < DAY) amount = `${Math.round(distance / HOUR)}h`;
  else amount = `${Math.round(distance / DAY)}d`;

  return diff < 0 ? `in ${amount}` : `${amount} ago`;
}

/** Date, time and zone, e.g. "Oct 20, 2026, 2:03:05 PM UTC". Defaults to the viewer's locale and zone. */
export function absoluteTime(
  ms: number,
  opts: { locale?: string; timeZone?: string } = {}
): string {
  return new Intl.DateTimeFormat(opts.locale, {
    dateStyle: 'medium',
    timeStyle: 'long',
    timeZone: opts.timeZone,
  }).format(ms);
}

/**
 * Epoch milliseconds for an API timestamp, or `undefined` when there is
 * nothing real to show. A zero or negative time is the API's "never", not 1970.
 */
export function parseTime(value: string | number | Date | null | undefined): number | undefined {
  if (value == null || value === '') return undefined;
  const ms =
    value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(ms) && ms > 0 ? ms : undefined;
}
