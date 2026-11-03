import { createHash, randomUUID } from 'node:crypto';
import type { components } from '../src/lib/api/schema';
import * as db from './data';

/**
 * Dev-mock answers for Issues alert policies, saved views, deployment source
 * maps, the Linear connection, tracker links and native Linear tickets (faas
 * docs/issues.md). Routes are registered in `plugin.ts`, one line each; the
 * plugin resolves the issue or deployment before calling in here.
 *
 * Modelled on faas handlers_issue_*.go and handlers_issues.go writeIssueError:
 * policies are replaced whole against `expected_revision` (409 with the
 * policy's own code when stale), a saved view or tracker link past its quota is
 * 409 `issue_quota_exceeded`, a different manifest for a deployment is 409
 * `issue_source_maps_conflict` even after retirement, and the Linear key is
 * write-only. A key that does not start `lin_api_` fails verification, and a
 * ticket titled with "timeout" leaves its first create unconfirmed so recovery
 * can be seen.
 */

type S = components['schemas'];
type Issue = S['Issue'];
export type MockProblem = { status: number; code: string; detail: string };
export type Answer = { status: number; body?: unknown } | MockProblem;
export const isProblem = (a: Answer): a is MockProblem => 'code' in a;

const problem = (status: number, code: string, detail: string): MockProblem => ({
  status,
  code,
  detail,
});
const ok = (body: unknown, status = 200): Answer => ({ status, body });
const invalid = (detail: string) => problem(400, 'validation_failed', detail);
const NONE: Answer = { status: 204 };

const KEY = /^[a-z0-9][a-z0-9-]{0,47}$/;
const ENVIRONMENT = /^[a-z0-9][a-z0-9-]{0,62}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const int = (v: unknown, min: number, max: number) =>
  Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

// --- Alert policies ---------------------------------------------------------

const impact = new Map<string, number>();
export function getImpact(slug: string): Answer {
  const n = impact.get(slug) ?? 0;
  return ok({ enabled: n > 0, minimum_customers: n, window_seconds: 86400 });
}
export function putImpact(slug: string, body: Record<string, unknown>): Answer {
  if (!int(body.minimum_customers, 0, 10000))
    return invalid('minimum_customers must be between 0 and 10000');
  impact.set(slug, body.minimum_customers as number);
  return getImpact(slug);
}

type Rule = S['IssueFrequencyAlertRule'] & { minimum_customers?: number };
type Rules = { revision: number; rules: Rule[] };
const frequency = new Map<string, Rules>();
const compound = new Map<string, Rules>();

/** The first app starts with one frequency rule, as the docs' example. */
if (db.apps[0] && !db.EMPTY)
  frequency.set(db.apps[0].slug, {
    revision: 1,
    rules: [
      {
        key: 'production-burst',
        enabled: true,
        environment: '',
        minimum_events: 50,
        window_seconds: 300,
        cooldown_seconds: 1800,
      },
    ],
  });

function ruleProblem(rules: unknown, withCustomers: boolean): string | undefined {
  if (!Array.isArray(rules)) return 'rules must be an array; use [] to remove all rules';
  if (rules.length > 10) return 'at most 10 rules';
  const keys = new Set<string>();
  for (const r of rules as Rule[]) {
    if (typeof r?.key !== 'string' || !KEY.test(r.key)) return 'rule key is invalid';
    if (keys.has(r.key)) return `duplicate rule key ${r.key}`;
    keys.add(r.key);
    if (typeof r.enabled !== 'boolean') return 'enabled is required';
    if (typeof r.environment !== 'string' || (r.environment && !ENVIRONMENT.test(r.environment)))
      return 'environment is invalid';
    if (!int(r.minimum_events, 1, 100000)) return 'minimum_events must be 1 to 100000';
    if (withCustomers && !int(r.minimum_customers, 1, 10000))
      return 'minimum_customers must be 1 to 10000';
    if (!int(r.window_seconds, 60, 86400)) return 'window_seconds must be 60 to 86400';
    if (!int(r.cooldown_seconds, 60, 604800)) return 'cooldown_seconds must be 60 to 604800';
  }
  return undefined;
}

function putRules(
  store: Map<string, Rules>,
  slug: string,
  body: Record<string, unknown>,
  withCustomers: boolean,
  staleCode: string
): Answer {
  const current = store.get(slug) ?? { revision: 0, rules: [] };
  const reason = ruleProblem(body.rules, withCustomers);
  if (reason) return invalid(reason);
  if (body.expected_revision !== current.revision)
    return problem(409, staleCode, 'reload the policy before saving');
  const next = { revision: current.revision + 1, rules: body.rules as Rule[] };
  store.set(slug, next);
  return ok(next);
}

export const getFrequency = (slug: string): Answer =>
  ok(frequency.get(slug) ?? { revision: 0, rules: [] });
export const putFrequency = (slug: string, body: Record<string, unknown>): Answer =>
  putRules(frequency, slug, body, false, 'issue_frequency_alert_revision_conflict');
export const getCompound = (slug: string): Answer =>
  ok(compound.get(slug) ?? { revision: 0, rules: [] });
export const putCompound = (slug: string, body: Record<string, unknown>): Answer =>
  putRules(compound, slug, body, true, 'issue_compound_alert_revision_conflict');

const lifecycle = new Map<string, S['IssueLifecycleAlertPolicy']>();
/** When each issue last had a lifecycle alert queued: ten minutes ago for every seeded issue. */
const lastLifecycleAlert = Date.now() - 10 * 60_000;

function environmentsProblem(env: unknown, cooldown: unknown): string | undefined {
  if (!Array.isArray(env) || env.length > 20) return 'environments must be up to 20 names';
  if (new Set(env).size !== env.length) return 'environments must be unique';
  if (!env.every((e) => typeof e === 'string' && ENVIRONMENT.test(e)))
    return 'environment names are lowercase letters, digits and dashes';
  if (!int(cooldown, 0, 604800)) return 'cooldown_seconds must be 0 to 604800';
  return undefined;
}

export const getLifecycle = (slug: string): Answer =>
  ok(lifecycle.get(slug) ?? { revision: 0, environments: [], cooldown_seconds: 0 });

export function putLifecycle(slug: string, body: Record<string, unknown>): Answer {
  const current = lifecycle.get(slug) ?? { revision: 0, environments: [], cooldown_seconds: 0 };
  const reason = environmentsProblem(body.environments, body.cooldown_seconds);
  if (reason) return invalid(reason);
  if (body.expected_revision !== current.revision)
    return problem(
      409,
      'issue_lifecycle_alert_policy_changed',
      'reload the lifecycle alert policy before saving'
    );
  const environments = body.environments as string[];
  const cooldown = body.cooldown_seconds as number;
  const same =
    JSON.stringify(environments) === JSON.stringify(current.environments) &&
    cooldown === current.cooldown_seconds;
  const next = {
    revision: same ? current.revision : current.revision + 1,
    environments,
    cooldown_seconds: cooldown,
  };
  lifecycle.set(slug, next);
  return ok(next);
}

export function previewLifecycle(
  slug: string,
  issue: Issue,
  body: Record<string, unknown>
): Answer {
  const reason = environmentsProblem(body.environments, body.cooldown_seconds);
  if (reason) return invalid(reason);
  if (body.event !== 'created' && body.event !== 'regressed')
    return invalid('event must be created or regressed');
  const environments = body.environments as string[];
  const cooldown = body.cooldown_seconds as number;
  const base = {
    issue_id: issue.id,
    event: body.event,
    environment: issue.environment,
    policy_revision: lifecycle.get(slug)?.revision ?? 0,
  };
  if (environments.length && !environments.includes(issue.environment))
    return ok({ ...base, allowed: false, reason: 'environment_excluded' });
  const next = lastLifecycleAlert + cooldown * 1000;
  if (cooldown > 0 && next > Date.now())
    return ok({
      ...base,
      allowed: false,
      reason: 'cooldown',
      next_eligible_at: new Date(next).toISOString(),
    });
  return ok({ ...base, allowed: true, reason: 'eligible' });
}

export function previewCompound(slug: string, issue: Issue, body: Record<string, unknown>): Answer {
  const rule = body.rule as Rule | undefined;
  const reason = ruleProblem(rule ? [rule] : undefined, true);
  if (reason || !rule) return invalid(reason ?? 'rule is required');
  const now = Date.now();
  const events = issue.impact_24h?.observed_events ?? 0;
  const customers = issue.impact_24h?.identified_customers ?? 0;
  const environmentMatches = !rule.environment || rule.environment === issue.environment;
  const suppressed = issue.state === 'ignored';
  const eventsMatched = events >= rule.minimum_events;
  const customersMatched = customers >= (rule.minimum_customers ?? 1);
  const why = !rule.enabled
    ? 'disabled'
    : !environmentMatches
      ? 'environment_excluded'
      : suppressed
        ? 'suppressed'
        : !eventsMatched
          ? 'event_threshold'
          : !customersMatched
            ? 'customer_threshold'
            : 'eligible';
  return ok({
    issue_id: issue.id,
    rule_key: rule.key,
    environment: issue.environment,
    policy_revision: compound.get(slug)?.revision ?? 0,
    window_start: new Date(now - rule.window_seconds * 1000).toISOString(),
    window_end: new Date(now).toISOString(),
    observed_events: events,
    identified_customers: customers,
    enabled: rule.enabled,
    environment_matches: environmentMatches,
    events_matched: eventsMatched,
    customers_matched: customersMatched,
    suppressed,
    cooldown_ready: true,
    allowed: why === 'eligible',
    reason: why,
  });
}

// --- Saved views ---------------------------------------------------------------

const views = new Map<string, S['IssueSavedView'][]>();
if (db.apps[0] && !db.EMPTY)
  views.set(db.apps[0].slug, [
    {
      key: 'open-by-impact',
      name: 'Open by impact',
      filters: { state: 'open', sort: 'impact', min_customers: 1 },
      created_at: db.iso(3 * 86_400_000),
      updated_at: db.iso(3 * 86_400_000),
      updated_by_account_id: db.ACCOUNT_ID,
    },
  ]);
const FILTERS = new Set([
  'state',
  'environment',
  'assignee',
  'sort',
  'min_customers',
  'tag',
  'team',
]);

export const listViews = (slug: string): Answer => ok({ items: views.get(slug) ?? [] });

export function putView(slug: string, key: string, body: Record<string, unknown>): Answer {
  if (!KEY.test(key)) return invalid('view key is invalid');
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 64) return invalid('name must be 1 to 64 characters');
  const filters = (body.filters ?? {}) as Record<string, unknown>;
  if (Object.keys(filters).some((k) => !FILTERS.has(k))) return invalid('unknown filter');
  if (filters.team && filters.assignee) return invalid('team and assignee are mutually exclusive');
  if (filters.team && !UUID.test(String(filters.team))) return invalid('team must be a UUID');
  const rows = views.get(slug) ?? [];
  const existing = rows.find((v) => v.key === key);
  if (!existing && rows.length >= 20)
    return problem(
      409,
      'issue_quota_exceeded',
      'issue storage or ingest-token limit reached; see /docs/issues'
    );
  const now = new Date().toISOString();
  const view: S['IssueSavedView'] = {
    key,
    name,
    filters: filters as S['IssueSavedViewFilters'],
    created_at: existing?.created_at ?? now,
    updated_at: now,
    updated_by_account_id: db.ACCOUNT_ID,
  };
  views.set(
    slug,
    [...rows.filter((v) => v.key !== key), view].sort(
      (a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key)
    )
  );
  return ok(view);
}

export function deleteView(slug: string, key: string): Answer {
  const rows = views.get(slug) ?? [];
  if (!rows.some((v) => v.key === key))
    return problem(404, 'not_found', 'issue resource not found');
  views.set(
    slug,
    rows.filter((v) => v.key !== key)
  );
  return NONE;
}

// --- Source maps -----------------------------------------------------------------

type Maps = S['IssueSourceMapsMetadata'];
const sourceMaps = new Map<string, Maps & { app: string }>();
const live = db.apps[0] && db.deployments.find((d) => d.app_id === db.apps[0].id);
if (live && !db.EMPTY)
  sourceMaps.set(live.id, {
    app: db.apps[0].slug,
    deployment_id: live.id,
    manifest_sha256: createHash('sha256').update(`seed-${live.id}`).digest('hex'),
    map_count: 3,
    ready: true,
    created_at: db.iso(86_400_000),
  });
const strip = ({ app: _app, ...meta }: Maps & { app: string }): Maps => meta;

export function getMaps(deploymentId: string): Answer {
  const meta = sourceMaps.get(deploymentId);
  return meta ? ok(strip(meta)) : problem(404, 'not_found', 'issue resource not found');
}

export function publishMaps(
  slug: string,
  deploymentId: string,
  body: Record<string, unknown>
): Answer {
  const directory = body.directory;
  const manifest = body.manifest as S['IssueSourceMapManifest'] | undefined;
  if (typeof directory !== 'string' || !directory.startsWith('/') || directory.length > 512)
    return invalid('directory must be an absolute path');
  if (
    !manifest ||
    manifest.version !== 1 ||
    !Array.isArray(manifest.artifacts) ||
    manifest.artifacts.length < 1 ||
    manifest.artifacts.length > 32 ||
    manifest.artifacts.some(
      (a) =>
        typeof a?.generatedFile !== 'string' ||
        typeof a.payload !== 'string' ||
        !/^[0-9a-f]{64}$/.test(String(a.sha256))
    )
  )
    return invalid('invalid or oversized source-map manifest');
  const digest = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  const existing = sourceMaps.get(deploymentId);
  if (existing && existing.manifest_sha256 !== digest)
    return problem(
      409,
      'issue_source_maps_conflict',
      'source-map manifest is immutable for this deployment'
    );
  if (!existing || existing.retired_at) {
    const ready = [...sourceMaps.values()].filter((m) => m.app === slug && m.ready).length;
    if (ready >= 32)
      return problem(
        409,
        'issue_quota_exceeded',
        'issue storage or ingest-token limit reached; see /docs/issues'
      );
  }
  const meta = {
    app: slug,
    deployment_id: deploymentId,
    manifest_sha256: digest,
    map_count: manifest.artifacts.length,
    ready: true,
    created_at: existing?.created_at ?? new Date().toISOString(),
  };
  sourceMaps.set(deploymentId, meta);
  return ok(strip(meta));
}

export function retireMaps(deploymentId: string): Answer {
  const meta = sourceMaps.get(deploymentId);
  if (!meta) return problem(404, 'not_found', 'issue resource not found');
  if (!meta.retired_at) Object.assign(meta, { ready: false, retired_at: new Date().toISOString() });
  return ok(strip(meta));
}

// --- Linear connection, tracker links and tickets ------------------------------------

type Connection = S['IssueTrackerLinearConnection'];
const connections = new Map<string, Connection>();
const connection = (slug: string): Connection =>
  connections.get(slug) ?? { connected: false, revision: 0 };

export const getConnection = (slug: string): Answer => ok(connection(slug));

export function putConnection(slug: string, body: Record<string, unknown>): Answer {
  const current = connection(slug);
  if (
    !int(body.expected_revision, 0, Number.MAX_SAFE_INTEGER) ||
    typeof body.connected !== 'boolean'
  )
    return invalid('connected and expected_revision are required');
  if (!body.connected && (body.api_key || body.team_id || body.webhook_secret))
    return invalid(
      'expected_revision must be nonnegative; disconnected requests must omit credentials and team'
    );
  if (body.expected_revision !== current.revision)
    return problem(
      409,
      'issue_tracker_linear_connection_changed',
      'read the connection again before changing it'
    );
  if (!body.connected) {
    const next = { connected: false, revision: current.revision + 1 };
    connections.set(slug, next);
    return ok(next);
  }
  const secret = body.webhook_secret;
  if (secret !== undefined && (typeof secret !== 'string' || secret.length < 32))
    return invalid('webhook_secret must be at least 32 characters');
  if (
    typeof body.team_id !== 'string' ||
    !UUID.test(body.team_id) ||
    typeof body.api_key !== 'string' ||
    !body.api_key.startsWith('lin_api_')
  )
    return problem(
      400,
      'issue_tracker_linear_verification_failed',
      'check the API key and active team UUID'
    );
  const next: Connection = {
    connected: true,
    revision: current.revision + 1,
    auth_method: 'api_key',
    webhook_enabled: Boolean(secret),
    ...(secret ? { callback_path: `/hooks/issue-trackers/linear/${randomUUID()}` } : {}),
    workspace_id: '6f1c2a4e-1d9b-4c7a-9a39-0b8d6f0f4c11',
    team_id: body.team_id,
    viewer_id: '0d9e8f7a-6b5c-4d3e-8f2a-1b0c9d8e7f6a',
  };
  connections.set(slug, next);
  return ok(next);
}

type Link = S['IssueTrackerLink'];
const links = new Map<string, Link[]>();

/** Canonical identity of a public GitHub issue or Linear issue URL, as apid normalises it. */
export function canonicalTicket(
  raw: string
): { provider: Link['provider']; key: string; url: string } | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:') return undefined;
  const gh = /^\/([^/]+)\/([^/]+)\/issues\/0*(\d+)\/?$/.exec(url.pathname);
  if (url.hostname === 'github.com' && gh)
    return {
      provider: 'github',
      key: `${gh[1]}/${gh[2]}#${gh[3]}`,
      url: `https://github.com/${gh[1]}/${gh[2]}/issues/${gh[3]}`,
    };
  const linear = /^\/([^/]+)\/issue\/([A-Za-z0-9]+-\d+)(?:\/[^/]*)?\/?$/.exec(url.pathname);
  if (url.hostname === 'linear.app' && linear)
    return {
      provider: 'linear',
      key: linear[2].toUpperCase(),
      url: `https://linear.app/${linear[1]}/issue/${linear[2].toUpperCase()}`,
    };
  return undefined;
}

export const listLinks = (issue: Issue): Answer => ok({ items: links.get(issue.id) ?? [] });

function attach(
  issue: Issue,
  ticket: { provider: Link['provider']; key: string; url: string },
  title?: string
): Link | MockProblem {
  const rows = links.get(issue.id) ?? [];
  const now = new Date().toISOString();
  const existing = rows.find(
    (l) => l.provider === ticket.provider && l.external_key === ticket.key
  );
  if (existing) {
    if (title !== undefined && title !== existing.title)
      Object.assign(existing, { title, updated_at: now });
    return existing;
  }
  if (rows.length >= 20)
    return problem(
      409,
      'issue_quota_exceeded',
      'issue storage or ingest-token limit reached; see /docs/issues'
    );
  const link: Link = {
    id: randomUUID(),
    original_issue_id: issue.id,
    provider: ticket.provider,
    external_key: ticket.key,
    url: ticket.url,
    created_at: now,
    updated_at: now,
    created_by_account_id: db.ACCOUNT_ID,
    ...(title ? { title } : {}),
  };
  links.set(issue.id, [...rows, link]);
  return link;
}

export function saveLink(issue: Issue, body: Record<string, unknown>): Answer {
  const ticket = canonicalTicket(String(body.url ?? ''));
  if (!ticket) return invalid('url must be a public GitHub issue or Linear issue URL');
  if (body.title !== undefined && (typeof body.title !== 'string' || body.title.length > 256))
    return invalid('title is at most 256 bytes');
  const out = attach(issue, ticket, body.title as string | undefined);
  return 'code' in out ? out : ok(out);
}

export function deleteLink(issue: Issue, linkId: string): Answer {
  const rows = links.get(issue.id) ?? [];
  if (!rows.some((l) => l.id === linkId))
    return problem(404, 'not_found', 'issue resource not found');
  links.set(
    issue.id,
    rows.filter((l) => l.id !== linkId)
  );
  return NONE;
}

type Receipt = { inputs: string; state: 'unconfirmed' | 'linked'; number: number };
const receipts = new Map<string, Receipt>();
let ticketNumber = 100;

export function createTicket(slug: string, issue: Issue, body: Record<string, unknown>): Answer {
  const current = connection(slug);
  if (!current.connected)
    return problem(
      409,
      'issue_tracker_connection_required',
      "connect the app owner's Linear personal API key to the selected active team"
    );
  if (typeof body.request_id !== 'string' || !UUID_V4.test(body.request_id))
    return invalid('request_id must be a UUID v4');
  const title = typeof body.title === 'string' ? body.title : '';
  if (!title || title.length > 256) return invalid('title must be 1 to 256 bytes');
  if (body.team_id !== current.team_id)
    return problem(
      409,
      'issue_tracker_connection_changed',
      'the issue group, reference or provider connection changed; preview again'
    );
  const inputs = JSON.stringify([issue.id, body.team_id, title, body.description ?? '']);
  const receipt = receipts.get(body.request_id);
  if (receipt && receipt.inputs !== inputs)
    return problem(
      409,
      'issue_tracker_request_conflict',
      'request ID belongs to different inputs or a different connection; preserve the original request for recovery'
    );
  if (!receipt && /timeout/i.test(title)) {
    receipts.set(body.request_id, { inputs, state: 'unconfirmed', number: ++ticketNumber });
    return problem(
      409,
      'issue_tracker_creation_unconfirmed',
      'reuse the same request ID and inputs; after the dispatch window use recover=true for Linear to verify the existing ticket'
    );
  }
  if (receipt?.state === 'unconfirmed' && body.recover !== true)
    return problem(
      409,
      'issue_tracker_creation_unconfirmed',
      'reuse the same request ID and inputs; after the dispatch window use recover=true for Linear to verify the existing ticket'
    );
  const number = receipt?.number ?? ++ticketNumber;
  receipts.set(body.request_id, { inputs, state: 'linked', number });
  const url = `https://linear.app/acme/issue/ENG-${number}`;
  const link = attach(issue, { provider: 'linear', key: `ENG-${number}`, url }, title);
  if ('code' in link) return link;
  return ok({ request_id: body.request_id, state: 'linked', ticket_url: url, link_id: link.id });
}
