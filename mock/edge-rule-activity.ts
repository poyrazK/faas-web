import type { components } from '../src/lib/api/schema';

type S = components['schemas'];
type Rule = S['EdgeRuleResponse'];
type Event = S['EdgeRuleEventResponse'];
type Outcome = Event['outcome'];

/**
 * Per-rule match counts and sampled events for the dev mock, shaped like faas
 * pkg/apid/edgerules/stats.go (hourly buckets from the window's start
 * truncated to the hour, rules without matches left out) and events.go (a
 * `since` clamped to the plan's event window, newest first, an opaque
 * cursor). The numbers are seeded from each rule's id, so a page reads the
 * same on every request; disabled rules count nothing.
 */

const H = 3_600_000;
const WINDOW_HOURS: Record<string, number> = { '1h': 1, '24h': 24, '7d': 168 };
/** docs/edge-rules.md §Limits: Free 24 h, Hobby 72 h, Pro and Scale 7 days. */
const EVENT_HOURS: Record<string, number> = { free: 24, hobby: 72, pro: 168, scale: 168 };
const OUTCOMES = new Set<Outcome>([
  'matched',
  'logged',
  'detected',
  'warned',
  'blocked',
  'challenged',
  'rejected',
  'solved',
  'failed',
  'boxed',
]);

function seed(id: string) {
  let h = 2166136261;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return Math.abs(h);
}

export function stats(
  rules: Rule[],
  window: string,
  withSeries: boolean,
  now = Date.now()
): S['EdgeRuleStatsResponse'] | string {
  const hours = WINDOW_HOURS[window];
  if (!hours) return 'window must be 1h, 24h or 7d';
  const since = Math.floor((now - hours * H) / H) * H;
  const buckets = Math.floor(now / H) - since / H + 1;
  const out: S['EdgeRuleHitStatsResponse'][] = [];
  for (const r of rules) {
    if (!r.enabled) continue;
    const base = seed(r.id) % 40;
    const series = Array.from(
      { length: buckets },
      (_, i) => ((base + i * 7) % 11) * ((base % 5) + 1)
    );
    const total = series.reduce((a, b) => a + b, 0);
    if (!total) continue;
    const log = r.mode === 'log';
    out.push({
      rule_id: r.id,
      matched: log ? 0 : total,
      logged: log ? total : 0,
      ...(withSeries ? { series } : {}),
    });
  }
  return {
    window: window as S['EdgeRuleStatsResponse']['window'],
    since: new Date(since).toISOString(),
    rules: out,
  };
}

function outcomeFor(r: Rule, i: number): Outcome {
  if (r.mode === 'log') return 'logged';
  const action = (r.action ?? {}) as { mode?: string };
  if (r.kind === 'waf')
    return action.mode === 'block' ? 'blocked' : action.mode === 'warn' ? 'warned' : 'detected';
  if (r.kind === 'challenge') return (['challenged', 'solved', 'rejected'] as const)[i % 3];
  if (r.penalty && i % 5 === 4) return 'boxed';
  return 'matched';
}

const PATHS = ['/v1/search', '/login', '/admin/users', '/v1/orders/42', '/wp-login.php'];
const AGENTS = ['Mozilla/5.0 (Macintosh)', 'curl/8.4.0', 'python-requests/2.32', 'GPTBot/1.2'];
const COUNTRIES = ['DE', 'US', 'FR', 'BR', 'IN'];

/** Six samples per enabled rule, spread over the last day. */
function sampled(rules: Rule[], host: string, now: number): Event[] {
  const out: Event[] = [];
  for (const r of rules) {
    if (!r.enabled) continue;
    const s = seed(r.id);
    for (let i = 0; i < 6; i++) {
      const outcome = outcomeFor(r, i);
      const waf = r.kind === 'waf';
      out.push({
        id: `${r.id.slice(0, 8)}-${i}`,
        rule_id: r.id,
        ...(r.name ? { rule_name: r.name } : {}),
        rule_kind: r.kind,
        outcome,
        occurred_at: new Date(now - ((s % 50) + i * 173) * 60_000).toISOString(),
        request_id: `req_${((s + i) % 0xffffff).toString(16).padStart(6, '0')}`,
        method: r.match_methods?.[0] ?? (i % 2 ? 'POST' : 'GET'),
        host,
        path: PATHS[(s + i) % PATHS.length],
        client_ip: `203.0.113.${(s + i * 17) % 250}`,
        country: COUNTRIES[(s + i) % COUNTRIES.length],
        user_agent: AGENTS[(s + i) % AGENTS.length],
        ...(waf && outcome !== 'logged'
          ? {
              waf_rule_ids: [942100 + ((s + i) % 5) * 10],
              waf_categories: [i % 2 ? 'xss' : 'sqli'],
              waf_score: 5 + ((s + i) % 3) * 5,
            }
          : {}),
      });
    }
  }
  return out.sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at));
}

export function events(
  rules: Rule[],
  host: string,
  plan: string,
  query: URLSearchParams,
  now = Date.now()
): S['EdgeRuleEventsResponse'] | string {
  const raw = query.get('since') ?? '24h';
  const m = /^(\d+)(h|d)$/.exec(raw);
  if (!m) return 'since must be a duration such as 1h, 24h or 7d';
  const asked = Number(m[1]) * (m[2] === 'd' ? 24 : 1);
  const since = now - Math.min(asked, EVENT_HOURS[plan] ?? 24) * H;
  const outcome = query.get('outcome');
  if (outcome && !OUTCOMES.has(outcome as Outcome))
    return 'outcome must be matched, logged, detected, warned, blocked, challenged, rejected, solved, failed or boxed';
  const rule = query.get('rule');
  const requestId = query.get('request_id');
  const limit = Math.min(Math.max(Number(query.get('limit') ?? 50) || 50, 1), 200);
  const offset = Number(query.get('cursor') ?? 0) || 0;
  const all = sampled(rules, host, now).filter(
    (e) =>
      Date.parse(e.occurred_at) >= since &&
      (!rule || e.rule_id === rule) &&
      (!outcome || e.outcome === outcome) &&
      (!requestId || e.request_id === requestId)
  );
  const page = all.slice(offset, offset + limit);
  return {
    since: new Date(since).toISOString(),
    events: page,
    ...(offset + limit < all.length ? { next_cursor: String(offset + limit) } : {}),
  };
}
