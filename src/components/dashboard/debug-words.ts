import type { DebugStatus } from '@/lib/api/debug';
import type { DebugSearch } from './debug-search';

/*
 * The Debugger's opening sentence, built only from GET .../debug/status
 * (faas pkg/apid/rolloutevidence/status.go). apid picks the verdict, worst
 * first; these words say what that verdict means for the routes and point at
 * the requests that show it. Exact figures stay in the details.
 */

export type DebugTone = 'good' | 'warning' | 'critical' | 'idle';

export interface DebugAction {
  label: string;
  /** Where the action takes the request list, or `details` to open the status details. */
  patch?: Partial<DebugSearch>;
  details?: true;
}

export interface DebugWords {
  sentence: string;
  tone: DebugTone;
  action?: DebugAction;
}

type Regression = DebugStatus['regressions'][number];

const NUMBER = new Intl.NumberFormat('en-US');
const count = (n: number) => NUMBER.format(n);
const plural = (n: number, noun: string) => `${count(n)} ${noun}${n === 1 ? '' : 's'}`;

const UNITS: Record<string, [string, string]> = {
  m: ['minute', 'minutes'],
  h: ['hour', 'hours'],
  d: ['day', 'days'],
};

/** "1h" → "the last hour", "6h" → "the last 6 hours", "72h" → "the last 3 days". */
export function windowWords(since: string): string {
  const match = /^(\d+)([mhd])$/.exec(since.trim());
  if (!match) return `the last ${since}`;
  let n = Number(match[1]);
  let unit = match[2];
  // apid formats whole days as "3d", but a request echoes the window asked for.
  if (unit === 'h' && n >= 48 && n % 24 === 0) {
    n /= 24;
    unit = 'd';
  }
  const [one, many] = UNITS[unit];
  return n === 1 ? `the last ${one}` : `the last ${n} ${many}`;
}

/** How many times slower, as people say it: "7×", "1.4×". Undefined when it cannot be told. */
export function slowdown(r: Pick<Regression, 'regression_factor' | 'p95_ms' | 'p95_base_ms'>) {
  const stated = Number.parseFloat(r.regression_factor);
  const factor =
    Number.isFinite(stated) && stated > 1
      ? stated
      : r.p95_base_ms > 0 && r.p95_ms > r.p95_base_ms
        ? r.p95_ms / r.p95_base_ms
        : undefined;
  if (factor === undefined) return undefined;
  return factor >= 2 ? `${Math.round(factor)}×` : `${factor.toFixed(1)}×`;
}

/** "12%", "0.4%": whole percent once it is big enough to read that way. */
function share(pct: number): string {
  return pct >= 10 ? `${Math.round(pct)}%` : `${Number(pct.toFixed(1))}%`;
}

/** "/orders/{id} is 7× slower", "/webhooks/stripe fails 12% of the time", or both. */
export function regressionPhrase(r: Regression): string {
  const slower = r.kind === 'errors' ? undefined : slowdown(r);
  const fails =
    r.kind === 'latency' || r.kind === undefined
      ? undefined
      : r.error_rate_pct !== undefined
        ? `fails ${share(r.error_rate_pct)} of the time`
        : 'fails more often';
  const slowerWords = slower
    ? `is ${slower} slower`
    : r.kind === 'errors'
      ? undefined
      : 'is slower';
  return [r.route, [slowerWords, fails].filter(Boolean).join(' and ')].join(' ');
}

/** The same regression with the numbers it was measured by, for the details. */
export function regressionFigures(r: Regression): string {
  const latency = `95% within ${count(r.p95_ms)} ms (was ${count(r.p95_base_ms)} ms)`;
  const errors =
    r.error_rate_pct !== undefined
      ? `${share(r.error_rate_pct)} server errors (was ${r.error_rate_base_pct !== undefined ? share(r.error_rate_base_pct) : 'unknown'})`
      : undefined;
  if (r.kind === 'errors') return errors ?? latency;
  if (r.kind === 'latency_and_errors') return [latency, errors].filter(Boolean).join(' · ');
  return latency;
}

/** "a and b", "a, b and c". */
function list(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function regressionSentence(data: DebugStatus, window: string): string {
  const shown = data.regressions;
  const serving = new Set(data.deployments.map((d) => d.id));
  const inServing = shown.length > 0 && shown.every((r) => serving.has(r.deployment_id));
  const where = inServing
    ? data.deployments.length === 1
      ? 'in the serving release'
      : 'in a release taking traffic'
    : `in ${window}`;
  const routes = new Set(shown.map((r) => r.route)).size;
  // Rows are (deployment, route); call them routes only when every one is here
  // and no route repeats, or the count would say more routes than there are.
  const subject =
    shown.length === data.regressions_total && routes === shown.length
      ? `${plural(routes, 'route')} got worse`
      : `${plural(data.regressions_total, 'regression')} ${data.regressions_total === 1 ? 'is' : 'are'} open`;
  if (shown.length === 0) return `${subject} ${where}.`;
  const named = shown.slice(0, 2).map(regressionPhrase);
  const more = data.regressions_total - named.length;
  const tail = more > 0 ? [...named, `${plural(more, 'other')}`] : named;
  return `${subject} ${where}: ${list(tail)}.`;
}

const FAILED: DebugAction = {
  label: 'Look at the failed requests',
  patch: { debugView: 'requests', debugFilter: 'failed', request: undefined },
};
const AFFECTED: DebugAction = {
  label: 'Look at the affected requests',
  patch: { debugView: 'requests', debugFilter: 'regressions', request: undefined },
};

/** apid's verdict as one sentence, its tone, and the one thing to look at. */
export function describeDebugStatus(data: DebugStatus): DebugWords {
  const window = windowWords(data.since);
  const { requests, server_errors: errors, p95_ms: p95 } = data.health;
  switch (data.verdict) {
    case 'failing':
      return {
        tone: 'critical',
        sentence: `${count(errors)} of ${plural(requests, 'request')} failed with a server error in ${window}.`,
        action: FAILED,
      };
    case 'rolled_back':
      return {
        tone: 'critical',
        sentence: data.rollout?.headline || data.headline,
        action: data.regressions_total > 0 ? AFFECTED : errors > 0 ? FAILED : undefined,
      };
    case 'degraded': {
      const kills = data.oom_kills ?? [];
      // apid's order: out-of-memory kills, then regressions, then server errors.
      if ((data.oom_kills_total ?? 0) > 0 && kills.length > 0) {
        const newest = kills[0];
        const peak =
          newest.peak_mb > 0 && newest.plan_mb > 0
            ? ` The latest needed ${count(newest.peak_mb)} MB on a ${count(newest.plan_mb)} MB plan.`
            : '';
        const times = data.oom_kills_total === 1 ? 'once' : `${count(data.oom_kills_total!)} times`;
        return {
          tone: 'warning',
          sentence: `The app ran out of memory ${times} in ${window}.${peak}`,
          action: data.oom_fix ? { label: 'See what to do', details: true } : undefined,
        };
      }
      if (data.regressions_total > 0)
        return { tone: 'warning', sentence: regressionSentence(data, window), action: AFFECTED };
      return {
        tone: 'warning',
        sentence: `${plural(errors, 'request')} ended in a server error in ${window}.`,
        action: FAILED,
      };
    }
    case 'releasing':
      return { tone: 'warning', sentence: data.rollout?.headline || data.headline };
    case 'healthy':
      return {
        tone: 'good',
        sentence: `Healthy: ${plural(requests, 'request')} in ${window}, no server errors, 95% answered within ${count(p95)} ms.`,
      };
    case 'idle':
      return { tone: 'idle', sentence: `No requests in ${window}.` };
  }
  // A verdict newer than this console: apid's own headline says it.
  return { tone: 'idle', sentence: data.headline };
}
