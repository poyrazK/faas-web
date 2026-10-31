import type { components } from '../src/lib/api/schema';
import * as db from './data';

type S = components['schemas'];
type Rule = S['EdgeRuleResponse'];

/**
 * Edge-rule versions, suggestions, the WAF review and rule lists for the dev
 * mock, modelled on faas pkg/apid/edgerules (versions.go, suggestions.go,
 * waf_review.go, lists.go). Every committed rule change records a version of
 * the app's whole rule set; the route handlers in plugin.ts call `record`.
 */

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const H = 3_600_000;

/** A block-mode WAF rule on the first app, so the review has something to read. */
const first = db.apps[0];
if (first && !db.EMPTY) {
  db.edgeRules.push({
    id: db.id(),
    account_id: db.ACCOUNT_ID,
    app_id: first.id,
    name: 'API WAF',
    match_host: '@app',
    match_path: '/v1/*',
    match_methods: [],
    match_headers: {},
    priority: 5,
    enabled: true,
    kind: 'waf',
    validate_mode: 'block',
    action: { mode: 'block', paranoia_level: 1, anomaly_threshold: 5, exclude_rule_ids: [920350] },
    created_at: db.iso(20 * 24 * H),
    updated_at: db.iso(3 * 24 * H),
  });
}

/** An admin area only the office list may reach, so a list shows as in use. */
if (first && !db.EMPTY) {
  db.edgeRules.push({
    id: db.id(),
    account_id: db.ACCOUNT_ID,
    app_id: first.id,
    name: 'Admin from the office',
    match_host: '@app',
    match_path: '/admin/*',
    match_methods: [],
    match_headers: {},
    priority: 8,
    enabled: true,
    kind: 'ip',
    validate_mode: 'block',
    action: { deny: ['0.0.0.0/0', '::/0'] },
    match: { not: { field: 'client_ip', op: 'in_list', list: 'office-ips' } },
    penalty: { seconds: 900, after: 3, within_seconds: 60 },
    created_at: db.iso(10 * 24 * H),
    updated_at: db.iso(4 * 24 * H),
  });
}

interface Version {
  version: number;
  created_at: string;
  rules: Rule[];
}
const versions = new Map<string, Version[]>();

function digest(rules: Rule[]) {
  let h = 0;
  for (const c of JSON.stringify(rules)) h = (h * 31 + c.charCodeAt(0)) | 0;
  return (h >>> 0).toString(16).padStart(8, '0').repeat(8);
}

/** Records the app's current rule set as its next version (versions.go). */
export function record(appId: string, at = db.iso(0)) {
  const list = versions.get(appId) ?? [];
  const rules = clone(db.edgeRules.filter((r) => r.app_id === appId));
  list.unshift({ version: (list[0]?.version ?? 0) + 1, created_at: at, rules });
  versions.set(appId, list.slice(0, 100));
}

// Seeded history: v1 had a scanner block since deleted and an older order;
// v2 added the rest; v3 is the rules now.
for (const a of db.apps) {
  const now = db.edgeRules.filter((r) => r.app_id === a.id);
  if (!now.length) continue;
  const scanner: Rule = {
    ...clone(now[0]),
    id: db.id(),
    kind: 'ip',
    name: 'Block vulnerability scanner paths',
    description: 'Created from the block-scanner-paths protection recipe.',
    match_host: '@app',
    match_path: '/**',
    match_methods: [],
    priority: 1,
    action: { deny: ['0.0.0.0/0', '::/0'] },
    match: { field: 'path', op: 'prefix', values: ['/.env', '/.git/'] },
    mode: 'log',
  };
  const v1 = [scanner, ...clone(now.slice(0, 1)).map((r) => ({ ...r, priority: r.priority + 5 }))];
  versions.set(a.id, [
    { version: 3, created_at: db.iso(2 * 24 * H), rules: clone(now) },
    { version: 2, created_at: db.iso(6 * 24 * H), rules: clone(now.slice(0, -1)) },
    { version: 1, created_at: db.iso(12 * 24 * H), rules: v1 },
  ]);
}

export function list(appId: string): S['EdgeRuleSetVersionResponse'][] {
  const all = versions.get(appId) ?? [];
  return all.slice(0, 50).map((v, i) => ({
    version: v.version,
    rule_count: v.rules.length,
    rules_sha256: digest(v.rules),
    created_at: v.created_at,
    current: i === 0,
  }));
}

export function latest(appId: string) {
  return versions.get(appId)?.[0]?.version ?? 0;
}

export function get(appId: string, version: number): S['EdgeRuleSetVersionResponse'] | null {
  const all = versions.get(appId) ?? [];
  const v = all.find((x) => x.version === version);
  if (!v) return null;
  return {
    version: v.version,
    rule_count: v.rules.length,
    rules_sha256: digest(v.rules),
    created_at: v.created_at,
    current: v.version === all[0]?.version,
    rules: clone(v.rules),
  };
}

/** Replaces the app's rules with the version's, keeping rule ids, and records it. */
export function restore(appId: string, version: number): Rule[] | null {
  const v = (versions.get(appId) ?? []).find((x) => x.version === version);
  if (!v) return null;
  for (let i = db.edgeRules.length - 1; i >= 0; i--)
    if (db.edgeRules[i].app_id === appId && db.edgeRules[i].managed_by !== 'attack_mode')
      db.edgeRules.splice(i, 1);
  const restored = clone(v.rules).filter((r) => r.managed_by !== 'attack_mode');
  db.edgeRules.push(...restored.map((r) => ({ ...r, updated_at: db.iso(0) })));
  record(appId);
  return db.edgeRules.filter((r) => r.app_id === appId);
}

const recipeAdded = (appId: string, recipe: string) =>
  db.edgeRules.some(
    (r) => r.app_id === appId && r.description === `Created from the ${recipe} protection recipe.`
  );

/** Ranked suggestions as suggestions.go would make them from busy traffic. */
export function suggestions(appId: string): S['EdgeRuleRecipeSuggestionsResponse'] {
  const out: S['EdgeRuleRecipeSuggestion'][] = [];
  if (!recipeAdded(appId, 'rate-limit-path'))
    out.push({
      recipe: 'rate-limit-path',
      title: 'Rate-limit a path per client IP',
      reason:
        'POST /login received 1840 requests in the last 7 days, 31% of them failed. A per-IP limit slows credential stuffing without affecting normal sign-ins.',
      params: { path: '/login', methods: 'POST' },
      alternative: {
        recipe: 'challenge-path',
        title: 'Challenge visitors on a path',
        params: { path: '/login' },
      },
    });
  if (!recipeAdded(appId, 'allow-ips-only'))
    out.push({
      recipe: 'allow-ips-only',
      title: 'Allow only listed IPs on a path',
      reason:
        '/admin received 212 requests in the last 7 days and is open to every IP. Limit it to your own addresses.',
      params: { path: '/admin/**' },
      alternative: {
        recipe: 'challenge-path',
        title: 'Challenge visitors on a path',
        params: { path: '/admin/**' },
      },
    });
  if (!recipeAdded(appId, 'block-scanner-paths'))
    out.push({
      recipe: 'block-scanner-paths',
      title: 'Block vulnerability scanner paths',
      reason:
        '96 requests in the last 7 days probed paths such as /.env, /.git/, /wp-: vulnerability scans, not your users.',
    });
  return { window: '7d', since: db.iso(7 * 24 * H), suggestions: out };
}

/** Detections for the app's waf rules, grouped and assessed (waf_review.go). */
export function wafReview(appId: string): S['EdgeWAFReviewResponse'] {
  const groups: S['EdgeWAFReviewGroup'][] = [];
  for (const rule of db.edgeRules.filter((r) => r.app_id === appId && r.kind === 'waf')) {
    const action = rule.action as S['EdgeRuleWAFAction'];
    const excluded = new Set(action.exclude_rule_ids ?? []);
    const seed = [
      {
        crs: 942100,
        category: 'sqli',
        path: '/v1/search',
        events: 64,
        clients: 23,
        top: 8,
        scanner: 0,
        known: 'search boxes that accept SQL-like text',
      },
      {
        crs: 930120,
        category: 'lfi',
        path: '/v1/files/{id}',
        events: 41,
        clients: 2,
        top: 88,
        scanner: 92,
      },
      {
        crs: 920350,
        category: 'protocol',
        path: '/v1/health',
        events: 12,
        clients: 4,
        top: 50,
        scanner: 0,
      },
      {
        crs: 941100,
        category: 'xss',
        path: '/v1/comments',
        events: 5,
        clients: 1,
        top: 100,
        scanner: 0,
      },
    ];
    for (const g of seed) {
      const isExcluded = excluded.has(g.crs);
      const assessment: S['EdgeWAFReviewGroup']['assessment'] = isExcluded
        ? 'excluded'
        : g.scanner >= 50
          ? 'likely_attack'
          : g.known || (g.clients >= 3 && g.top <= 50)
            ? 'likely_false_positive'
            : 'review';
      const reason = {
        excluded: `the rule excludes CRS ${g.crs} now; these detections came before the exclusion`,
        likely_attack: `${g.scanner}% of these detections came from clients flagged on 5 or more paths, as scanners are`,
        likely_false_positive: g.known
          ? `a documented false positive: ${g.known}`
          : `${g.clients} clients were flagged on this path and none sent most of the detections; attacks usually come from a few clients across many paths`,
        review: 'too few clients to tell; open the example requests',
      }[assessment];
      groups.push({
        rule_id: rule.id,
        rule_name: rule.name,
        rule_mode: action.mode,
        crs_rule_id: g.crs,
        category: g.category,
        path: g.path,
        events: g.events,
        detected: 0,
        warned: 0,
        blocked: g.events,
        clients: g.clients,
        top_client_percent: g.top,
        scanner_percent: g.scanner,
        first_seen: db.iso(6 * 24 * H),
        last_seen: db.iso(2 * H),
        request_ids: [db.id(), db.id()],
        known_false_positive: g.known,
        excluded: isExcluded,
        assessment,
        reason,
      });
    }
  }
  groups.sort((a, b) => b.events - a.events);
  return {
    since: db.iso(7 * 24 * H),
    scanned: groups.reduce((n, g) => n + g.events, 0),
    truncated: false,
    groups,
  };
}

/** The account's rule lists (lists.go); items stored sorted and deduplicated. */
export const lists: (S['EdgeRuleListResponse'] & { items: string[] })[] = db.EMPTY
  ? []
  : [
      {
        id: db.id(),
        name: 'office-ips',
        kind: 'ip',
        description: 'HQ and the VPN egress',
        item_count: 2,
        items: ['198.51.100.0/24', '203.0.113.7/32'],
        referenced_by: [],
        created_at: db.iso(30 * 24 * H),
        updated_at: db.iso(4 * 24 * H),
      },
      {
        id: db.id(),
        name: 'blocked-countries',
        kind: 'country',
        item_count: 2,
        items: ['IR', 'KP'],
        referenced_by: [],
        created_at: db.iso(14 * 24 * H),
        updated_at: db.iso(14 * 24 * H),
      },
    ];

/** Rules whose condition names the list with in_list. */
export function referencedBy(name: string) {
  const uses = (m: S['EdgeRuleMatchExpr'] | undefined): boolean =>
    !!m &&
    ((m.op === 'in_list' && m.list === name) ||
      (m.all ?? []).some(uses) ||
      (m.any ?? []).some(uses) ||
      uses(m.not));
  return db.edgeRules.filter((r) => uses(r.match)).map((r) => r.id);
}

export function normalizeItems(kind: string, items: string[]) {
  const out = items
    .map((i) => i.trim())
    .filter(Boolean)
    .map((i) => (kind === 'country' ? i.toUpperCase() : kind === 'host' ? i.toLowerCase() : i));
  return [...new Set(out)].sort();
}

export const LIST_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;
/** limits.go: lists per account and items per list, by plan. */
export const LIST_LIMITS: Record<string, [number, number]> = {
  free: [0, 0],
  hobby: [5, 100],
  pro: [20, 1000],
  scale: [100, 10000],
};
