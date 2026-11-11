/* ------------------------------------------------------------------ *
 * The Health panel's "Last 24 hours" strip, as pure arithmetic over the
 * recorded history (GET /v1/apps/{slug}/health/history, faas
 * docs/app-health.md § Recorded health history).
 *
 * History records a first assessment and then only meaningful changes, so
 * each entry's status holds until the next entry. A `gap` entry sits at the
 * old evidence's expiry and means nothing was collected from then on; an
 * `unknown` assessment was collected but could not be confirmed. Neither is
 * an outage or a recovery, so both stay neutral — and the two are kept
 * apart, because "not checked" and "checked, unconfirmed" are different
 * facts. The newest entry holds only while the latest background
 * assessment is still valid; past that the strip says "Not checked".
 *
 * Time before the oldest loaded entry is "Not checked" only when the API
 * says history ends there (no next page, and the oldest entry is the first
 * assessment). Otherwise older records exist or were pruned, and the strip
 * says "No record" rather than guess.
 * ------------------------------------------------------------------ */

export type BandState =
  'healthy' | 'degraded' | 'unhealthy' | 'unconfirmed' | 'unchecked' | 'unrecorded';

export interface Band {
  start: number;
  end: number;
  state: BandState;
}

export interface TimelineEntry {
  kind: 'baseline' | 'transition' | 'gap';
  observed_at: string;
  assessment: { status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown' };
}

export const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/** Plain words first; the API's term follows where it differs. */
export const BAND_LABEL: Record<BandState, string> = {
  healthy: 'Healthy',
  degraded: 'Slow or erroring',
  unhealthy: 'Down',
  unconfirmed: 'Unconfirmed',
  unchecked: 'Not checked',
  unrecorded: 'No record',
};

export const BAND_TERM: Partial<Record<BandState, string>> = {
  degraded: 'degraded',
  unhealthy: 'unhealthy',
};

const ORDER: BandState[] = [
  'healthy',
  'degraded',
  'unhealthy',
  'unconfirmed',
  'unchecked',
  'unrecorded',
];

function stateOf(entry: TimelineEntry): BandState {
  if (entry.kind === 'gap') return 'unchecked';
  const status = entry.assessment.status;
  return status === 'unknown' ? 'unconfirmed' : status;
}

/**
 * Contiguous bands covering exactly `[now - windowMs, now]`, oldest first,
 * adjacent equal states merged.
 *
 * `entries` may come in any order (the API sends newest first).
 * `evidenceUntil` is when the latest background assessment stops being
 * valid; `complete` is true when no older page exists.
 */
export function healthBands({
  entries,
  now,
  windowMs = DAY_MS,
  evidenceUntil,
  complete,
}: {
  entries: readonly TimelineEntry[];
  now: number;
  windowMs?: number;
  evidenceUntil?: number;
  complete: boolean;
}): Band[] {
  const windowStart = now - windowMs;
  const points = entries
    .map((entry) => ({ entry, at: Date.parse(entry.observed_at) }))
    .filter((p) => Number.isFinite(p.at))
    .map((p) => ({ ...p, at: Math.min(p.at, now) }))
    .sort((a, b) => a.at - b.at);

  const raw: Band[] = [];
  const oldest = points[0];
  const leading: BandState =
    complete && oldest?.entry.kind === 'baseline' ? 'unchecked' : 'unrecorded';
  raw.push({ start: windowStart, end: oldest ? oldest.at : now, state: leading });

  points.forEach((point, i) => {
    const next = points[i + 1];
    if (next) {
      raw.push({ start: point.at, end: next.at, state: stateOf(point.entry) });
      return;
    }
    // The newest entry holds only while its evidence is still valid.
    const holds =
      evidenceUntil === undefined || !Number.isFinite(evidenceUntil)
        ? now
        : Math.min(now, Math.max(evidenceUntil, point.at));
    raw.push({ start: point.at, end: holds, state: stateOf(point.entry) });
    if (holds < now) raw.push({ start: holds, end: now, state: 'unchecked' });
  });

  const bands: Band[] = [];
  for (const band of raw) {
    const start = Math.max(band.start, windowStart);
    const end = Math.min(band.end, now);
    if (end <= start) continue;
    const last = bands.at(-1);
    if (last && last.state === band.state && last.end >= start) last.end = end;
    else bands.push({ start, end, state: band.state });
  }
  return bands;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * "3 hours", "40 minutes", "under a minute". Part of a window never rounds
 * up to the whole of it, so 23.6 of 24 hours reads "23 hours".
 */
export function duration(ms: number, windowMs = Infinity): string {
  if (ms < MINUTE_MS) return 'under a minute';
  if (ms < HOUR_MS) return plural(Math.min(59, Math.round(ms / MINUTE_MS)), 'minute');
  const hours = Math.round(ms / HOUR_MS);
  return plural(ms < windowMs && hours * HOUR_MS >= windowMs ? hours - 1 : hours, 'hour');
}

function times(n: number): string {
  if (n === 1) return 'once';
  if (n === 2) return 'twice';
  return `${n} times`;
}

export interface TimelineSummary {
  /** "Healthy for 12 of 24 hours · slow or erroring twice, down once". */
  sentence: string;
  /** Every state's total, for the strip's accessible name. */
  ariaLabel: string;
  totals: Record<BandState, number>;
  spells: Record<BandState, number>;
}

export function summarizeBands(bands: readonly Band[], windowMs = DAY_MS): TimelineSummary {
  const totals = Object.fromEntries(ORDER.map((s) => [s, 0])) as Record<BandState, number>;
  const spells = Object.fromEntries(ORDER.map((s) => [s, 0])) as Record<BandState, number>;
  for (const band of bands) {
    totals[band.state] += band.end - band.start;
    spells[band.state] += 1;
  }
  const windowHours = Math.round(windowMs / HOUR_MS);
  const span = `${windowHours} hours`;

  const lead: string[] = [];
  const healthy = totals.healthy;
  if (healthy >= windowMs) lead.push(`Healthy for all ${span}`);
  else if (healthy >= HOUR_MS)
    // Rounded down, so a day with a blip never reads "24 of 24".
    lead.push(`Healthy for ${Math.floor(healthy / HOUR_MS)} of ${span}`);
  else if (healthy > 0) lead.push(`Healthy for ${duration(healthy)} of the last ${span}`);

  const rest: string[] = [];
  if (spells.degraded) rest.push(`slow or erroring ${times(spells.degraded)}`);
  if (spells.unhealthy) rest.push(`down ${times(spells.unhealthy)}`);
  if (totals.unconfirmed) rest.push(`unconfirmed for ${duration(totals.unconfirmed, windowMs)}`);
  if (totals.unchecked) rest.push(`not checked for ${duration(totals.unchecked, windowMs)}`);
  if (totals.unrecorded) rest.push(`no record for ${duration(totals.unrecorded, windowMs)}`);

  const tail = rest.join(', ');
  const joined = lead.length ? [lead[0], tail].filter(Boolean).join(' · ') : tail;
  const sentence = joined ? joined[0].toUpperCase() + joined.slice(1) : 'Nothing recorded';

  const parts = ORDER.filter((s) => totals[s] > 0).map((s) => {
    const base = `${BAND_LABEL[s].toLowerCase()} ${duration(totals[s], windowMs)}`;
    return (s === 'degraded' || s === 'unhealthy') && spells[s] > 1
      ? `${base} in ${spells[s]} spells`
      : base;
  });
  const ariaLabel = `Health over the last ${span}: ${parts.join(', ') || 'nothing recorded'}`;
  return { sentence, ariaLabel, totals, spells };
}
