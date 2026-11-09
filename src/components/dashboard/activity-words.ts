import { activityOutcome, type ResourceActivity } from '@/lib/api/resource-activity';
import { parseTime, relativeTime } from '@/lib/time';

/**
 * The app Activity tab in plain English: events grouped by day, each one the
 * API's own sentence with who did it and when, failures marked. apid writes
 * `summary` as a display-ready sentence ("Bahadir deployed payments",
 * handlers_org_activity.go orgActivitySummary); the console never rewrites it,
 * and only falls back to the raw kind when the summary is empty.
 */

const DAY = 24 * 60 * 60 * 1000;

function dayKey(ms: number, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ms);
}

/** "Today", "Yesterday", "Mon, Nov 3", or "Mon, Nov 3, 2025" before this year. */
export function dayLabel(
  ms: number,
  opts: { now?: number; locale?: string; timeZone?: string } = {}
): string {
  const now = opts.now ?? Date.now();
  const key = dayKey(ms, opts.timeZone);
  if (key === dayKey(now, opts.timeZone)) return 'Today';
  if (key === dayKey(now - DAY, opts.timeZone)) return 'Yesterday';
  const sameYear = key.slice(0, 4) === dayKey(now, opts.timeZone).slice(0, 4);
  return new Intl.DateTimeFormat(opts.locale ?? 'en-US', {
    timeZone: opts.timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' as const }),
  }).format(ms);
}

export interface DayGroup {
  key: string;
  label: string;
  rows: ResourceActivity[];
}

/**
 * Consecutive events that share a local day, in the API's newest-first
 * order. An event with no readable time gets a "Date unknown" group where it
 * falls rather than being moved or dated.
 */
export function groupByDay(
  rows: readonly ResourceActivity[],
  opts: { now?: number; locale?: string; timeZone?: string } = {}
): DayGroup[] {
  const groups: (DayGroup & { day: string })[] = [];
  for (const row of rows) {
    const ms = parseTime(row.occurred_at);
    const day = ms === undefined ? 'unknown' : dayKey(ms, opts.timeZone);
    const last = groups.at(-1);
    if (last && last.day === day) last.rows.push(row);
    else
      groups.push({
        day,
        // Unique even when a day reappears after an undated row.
        key: `${day}:${groups.length}`,
        label: ms === undefined ? 'Date unknown' : dayLabel(ms, opts),
        rows: [row],
      });
  }
  return groups.map(({ key, label, rows: grouped }) => ({ key, label, rows: grouped }));
}

/** The API's sentence, or — only when it sent none — who and the raw kind. */
export function activitySentence(row: ResourceActivity): string {
  const summary = row.summary?.trim();
  if (summary) return summary;
  const actor = row.actor.label?.trim() || 'Unknown actor';
  return `${actor}: ${row.kind}`;
}

const ACTOR_TYPE: Record<string, string> = {
  api_key: 'API key',
  github: 'GitHub',
  system: 'system',
  operator: 'operator',
};

/**
 * "GitHub Actions", "deploy-bot (API key)", "Certificate manager (system)":
 * the captured name, with the kind of actor when the name does not say it.
 */
export function actorWords(actor: ResourceActivity['actor']): string {
  const label = actor.label?.trim() || 'Unknown actor';
  const type = ACTOR_TYPE[actor.type];
  if (!type || label.toLowerCase().includes(type.toLowerCase())) return label;
  return `${label} (${type})`;
}

/** Whether the sentence already names who did it, so the row need not repeat it. */
export function namesActor(row: ResourceActivity): boolean {
  const label = row.actor.label?.trim();
  return Boolean(label && row.summary?.includes(label));
}

export interface OutcomeMark {
  word: string;
  tone: 'critical' | 'muted';
}

/**
 * Only the outcomes worth a second look are named: success is the norm, and
 * a request already says "requested" in its sentence. An unknown kind is
 * never read as success.
 */
export function outcomeMark(kind: string): OutcomeMark | undefined {
  const outcome = activityOutcome(kind);
  if (outcome === 'Failed') return { word: 'Failed', tone: 'critical' };
  if (outcome === 'Cancelled') return { word: 'Cancelled', tone: 'muted' };
  if (outcome.startsWith('Recorded')) return { word: 'Outcome unknown', tone: 'muted' };
  return undefined;
}

function startOfToday(now: number, timeZone?: string): number {
  // Walk back from now to the first instant that is still "today" locally.
  const today = dayKey(now, timeZone);
  let lo = now - DAY - 2 * 60 * 60 * 1000;
  let hi = now;
  while (hi - lo > 1000) {
    const mid = Math.floor((lo + hi) / 2);
    if (dayKey(mid, timeZone) === today) hi = mid;
    else lo = mid;
  }
  return hi;
}

/**
 * The tab's one sentence. Counts for today are exact only when the loaded
 * history reaches back past midnight (or there is nothing older); otherwise
 * the sentence says "at least".
 */
export function activityHeadline(
  rows: readonly ResourceActivity[],
  opts: { now?: number; hasOlder: boolean; filtered: boolean; timeZone?: string }
): string | undefined {
  const now = opts.now ?? Date.now();
  const dated = rows
    .map((row) => ({ row, ms: parseTime(row.occurred_at) }))
    .filter((item): item is { row: ResourceActivity; ms: number } => item.ms !== undefined);
  if (dated.length === 0) return undefined;
  const midnight = startOfToday(now, opts.timeZone);
  const today = dated.filter((item) => item.ms >= midnight);
  const noun = opts.filtered ? 'matching event' : 'event';
  if (today.length === 0) {
    const latest = Math.max(...dated.map((item) => item.ms));
    return `No ${opts.filtered ? 'matching ' : ''}activity today. The last was ${relativeTime(latest, now)}.`;
  }
  const failed = today.filter((item) => outcomeMark(item.row.kind)?.word === 'Failed').length;
  const complete = !opts.hasOlder || dated.some((item) => item.ms < midnight);
  const count = `${today.length} ${noun}${today.length === 1 ? '' : 's'} today`;
  if (!complete) return `At least ${count}${failed ? `, ${failed} of them failed` : ''} so far.`;
  if (failed === 0) return `${count}, none failed.`;
  return `${count}, ${failed} failed.`;
}
