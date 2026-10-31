/** Five-field UTC schedules, matching the scheduler's robfig/cron grammar. */
const MONTHS = Object.fromEntries(
  ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].map(
    (name, i) => [name, i + 1]
  )
);
const WEEKDAYS = Object.fromEntries(
  ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((name, i) => [name, i])
);
const FIELDS = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12, names: MONTHS },
  { min: 0, max: 6, names: WEEKDAYS },
];
type ParsedField = { values: number[]; wildcard: boolean };

function number(value: string, names?: Record<string, number>): number | undefined {
  if (names && Object.hasOwn(names, value.toLowerCase())) return names[value.toLowerCase()];
  if (!/^\+?\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function parseField(
  text: string,
  { min, max, names }: { min: number; max: number; names?: Record<string, number> }
): ParsedField | undefined {
  const values = new Set<number>();
  let wildcard = false;
  for (const segment of text.split(',')) {
    const parts = segment.split('/');
    if (parts.length > 2) return;
    const [base, rawStep] = parts;
    const step = rawStep === undefined ? 1 : number(rawStep);
    if (step === undefined || step === 0) return;
    const bounds = base.split('-');
    if (bounds.length > 2) return;
    const [rawStart, rawEnd] = bounds;
    const star = rawStart === '*' || rawStart === '?';
    if (star && rawEnd !== undefined) return;
    const start = star ? min : number(rawStart, names);
    const end = star
      ? max
      : rawEnd !== undefined
        ? number(rawEnd, names)
        : rawStep !== undefined
          ? max
          : start;
    if (start === undefined || end === undefined || start < min || end > max || start > end) return;
    // robfig clears the wildcard bit for */N when N > 1, including day fields.
    wildcard ||= star && step === 1;
    for (let value = start; value <= end; value += step) values.add(value);
  }
  return { values: [...values].sort((a, b) => a - b), wildcard };
}

function parseSchedule(value: string): ParsedField[] | undefined {
  const fields = value.trim().split(/\s+/);
  if (fields.length !== 5) return;
  const parsed = fields.map((field, i) => parseField(field, FIELDS[i]));
  if (parsed.some((field) => !field)) return;
  return parsed as ParsedField[];
}

export const isCronSchedule = (value: string) => Boolean(parseSchedule(value));

/** Calendar jumps keep annual/leap-day previews cheap; no minute-by-minute scan. */
export function upcomingCronRuns(value: string, after: Date, count = 3): Date[] | undefined {
  const fields = parseSchedule(value);
  if (!fields || !Number.isFinite(after.getTime())) return;
  const [minute, hour, dom, month, dow] = fields;
  const day = new Date(Date.UTC(after.getUTCFullYear(), after.getUTCMonth(), after.getUTCDate()));
  const results: Date[] = [];
  const yearLimit = after.getUTCFullYear() + 5;
  while (day.getUTCFullYear() <= yearLimit && results.length < count) {
    const domMatch = dom.values.includes(day.getUTCDate());
    const dowMatch = dow.values.includes(day.getUTCDay());
    const dayMatch = dom.wildcard || dow.wildcard ? domMatch && dowMatch : domMatch || dowMatch;
    if (month.values.includes(day.getUTCMonth() + 1) && dayMatch) {
      for (const h of hour.values) {
        for (const m of minute.values) {
          const next = new Date(day.getTime() + (h * 60 + m) * 60_000);
          if (next > after) results.push(next);
          if (results.length === count) return results;
        }
      }
    }
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return results;
}

export const SCHEDULE_PRESETS = [
  { label: 'Every 15 minutes', value: '*/15 * * * *' },
  { label: 'Every hour', value: '0 * * * *' },
  { label: 'Daily at 09:00 UTC', value: '0 9 * * *' },
  { label: 'Weekdays at 09:00 UTC', value: '0 9 * * MON-FRI' },
  { label: 'Monthly on the 1st', value: '0 0 1 * *' },
] as const;

export function describeCronSchedule(value: string): string {
  if (!isCronSchedule(value)) return 'Invalid schedule';
  const normalized = value.trim().replace(/\s+/g, ' ').toUpperCase();
  const preset = SCHEDULE_PRESETS.find((preset) => preset.value.toUpperCase() === normalized);
  if (preset) return preset.label;
  if (normalized === '* * * * *') return 'Every minute';
  const [minute, hour, dom, month, dow] = normalized.split(' ');
  const interval = /^\*\/(\d+)$/.exec(minute);
  if (
    interval &&
    hour === '*' &&
    dom === '*' &&
    month === '*' &&
    dow === '*' &&
    60 % Number(interval[1]) === 0
  )
    return `Every ${Number(interval[1])} minutes`;
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && dom === '*' && month === '*' && dow === '*')
    return `Daily at ${hour.padStart(2, '0')}:${minute.padStart(2, '0')} UTC`;
  return 'Custom schedule · UTC';
}

export function formatCronTime(date: Date): string {
  return (
    new Intl.DateTimeFormat('en', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: 'UTC',
    }).format(date) + ' UTC'
  );
}
