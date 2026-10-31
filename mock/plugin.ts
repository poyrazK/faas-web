import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Connect, Logger, Plugin } from 'vite';
import type { components } from '../src/lib/api/schema';
import * as db from './data';
import * as automationMock from './automations';
import { registerMonetizationMock } from './monetization';
import * as logDrainMock from './log-drains';
import { mockCapabilities } from './capabilities';
import * as deploymentDetail from './deployment-detail';
import { registerEventMocks } from './events';
import { mockOpenAPIPreview } from './openapi-preview';
import { isDigestPinnedImage } from '../src/lib/oci-image';
import { advancePolicy, mockRuntimePolicy } from './runtime-policy';
import { readWakeAhead, writeWakeAhead } from './wake-ahead';
import { projects, projectSummaries } from './projects';
import {
  mockPromotionPreview,
  mockPromotionHistory,
  mockPromotionReceipt,
  mockApprovalId,
} from './environment-readiness';
import { getStageQueueRecord, putStageQueueRecord } from './stage-queues';
import {
  advanceDeployments,
  buildLogAt,
  stagesAt,
  startDeployment,
  trackedDeployment,
} from './deploy-lifecycle';
import { CONNECT_FORBIDDEN, MOCK_INSTALL_ID, connectReturnTarget } from './github-connect';
import * as configHistory from './config-history';
import {
  environmentInventory,
  environmentState,
  environmentDiff,
  previewSet,
} from './environments';
import {
  FREE_TRIGGER_ERROR_CODE,
  KAFKA_SASL_MECHANISMS,
  TRIGGER_CAPABILITIES_BY_PLAN,
  triggerDefaultsFor,
} from './trigger-contract';

/**
 * Dev-only mock of `apid`, as a Vite middleware.
 *
 * Registered by `vite.config.ts` only when `MOCK_API=1` (`npm run dev:mock`).
 * It answers the same paths the proxy would otherwise forward — `/v1/*`,
 * `POST /login`, `POST /signup` — with real HTTP on the dev origin, so the
 * app's fetch client, its cookies, and the `EventSource` log stream all run
 * unchanged. Nothing here is reachable from a production build: Vite plugins
 * do not ship, and `src/` never imports this directory.
 *
 * Coverage is the set of operations the console actually calls (see the
 * inventory in the PR that added this). Anything else under `/v1` gets a
 * `not_mocked` problem+json and a line on the dev-server console, so a gap
 * announces itself rather than hanging a spinner.
 */

type Handler = (ctx: {
  params: Record<string, string>;
  query: URLSearchParams;
  body: Record<string, unknown>;
  req: IncomingMessage;
  res: ServerResponse;
}) => unknown | Promise<unknown>;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

const routes: Route[] = [];

function route(method: string, template: string, handler: Handler) {
  const keys: string[] = [];
  const source = template
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\\\{(\w+)\\\}/g, (_, k: string) => {
      keys.push(k);
      return '([^/]+)';
    });
  routes.push({ method, pattern: new RegExp(`^${source}$`), keys, handler });
}

/** Thrown by a handler to answer with an RFC 7807 problem. */
class Problem extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail?: string,
    /** Typed Problem extensions, such as `bindings_check` or `crossed_releases`. */
    readonly extra?: Record<string, unknown>
  ) {
    super(detail ?? code);
  }
}

/** Signals "204 No Content". */
const NO_CONTENT = Symbol('no-content');
/** Wraps a body with a non-200 status. */
const status = (code: number, body: unknown) => ({ __status: code, body });

const latency = () => Number(process.env.MOCK_LATENCY ?? 180) + Math.random() * 160;

// Release approval policies (faas release_approvals.go). webhook-router requires
// approvals, so switching it to the immediate release policy is warned about.
route('GET', '/v1/apps/{slug}/release-approval-policy', ({ params }) => {
  if (params.slug !== 'webhook-router')
    throw new Problem(
      404,
      'release_approval_policy_not_found',
      'This app does not require approvals.'
    );
  return {
    app: params.slug,
    required_approvals: 1,
    after_stage: 1,
    timeout_minutes: 60,
    approvers: ['design@gregale.dev'],
    allow_self_approval: false,
    notify_channels: [],
    updated_by: 'design@gregale.dev',
    created_at: '2026-10-20T09:00:00Z',
    updated_at: '2026-10-20T09:00:00Z',
  };
});
const HIDDEN_AT_BOOT = new Set(
  (process.env.MOCK_HIDDEN_CAPABILITIES ?? '').split(',').filter(Boolean)
);
const hiddenCapabilities = new Set(HIDDEN_AT_BOOT);

route('GET', '/v1/capabilities', ({ res }) => {
  res.setHeader('Cache-Control', 'no-store');
  const raw = process.env.MOCK_PLAN ?? db.account.plan;
  const plan = raw === 'free' || raw === 'hobby' || raw === 'pro' || raw === 'scale' ? raw : 'pro';
  const registry = mockCapabilities(
    plan,
    (process.env.MOCK_UNAVAILABLE_CAPABILITIES ?? '').split(',')
  );
  // Catalog ids whose platform flag is off for the account, as apid lists them
  // (internal ones included); the console hides those tabs and pages.
  const hidden = [...hiddenCapabilities];
  return hidden.length ? { ...registry, hidden_capabilities: hidden } : registry;
});

// Self-serve previews (faas ADR-20261021080640). Joining one turns its
// capability on, so a page hidden by MOCK_HIDDEN_CAPABILITIES appears.
const PREVIEWS = [
  {
    key: 'events',
    capability: 'events',
    label: 'Events',
    description: 'Publish, subscribe to and replay application events.',
    retire_by: '2027-03-31',
    eligible: true,
  },
  {
    key: 'realtime',
    capability: 'realtime',
    label: 'Realtime',
    description: 'Channels, presence and occupancy for live clients.',
    eligible: true,
  },
  {
    key: 'gitlab',
    capability: 'gitlab-deploys',
    label: 'GitLab deploys',
    description: 'Connect GitLab projects and deploy on push.',
    eligible: false,
  },
];
const joinedPreviews = new Set<string>();
function previewView(p: (typeof PREVIEWS)[number]) {
  const joined = joinedPreviews.has(p.key);
  return {
    key: p.key,
    label: p.label,
    description: p.description,
    ...(p.retire_by ? { retire_by: p.retire_by } : {}),
    joined,
    eligible: p.eligible,
    enabled: joined || !hiddenCapabilities.has(p.capability),
  };
}
function changePreview(key: string, join: boolean) {
  const p = PREVIEWS.find((x) => x.key === key);
  if (!p) throw new Problem(404, 'preview_not_offered', 'Not a preview open to self-serve.');
  if (join && !p.eligible)
    throw new Problem(403, 'preview_plan_not_eligible', 'Your plan cannot join this preview.');
  if (join) {
    joinedPreviews.add(key);
    hiddenCapabilities.delete(p.capability);
  } else {
    joinedPreviews.delete(key);
    if (HIDDEN_AT_BOOT.has(p.capability)) hiddenCapabilities.add(p.capability);
  }
  return previewView(p);
}
route('GET', '/v1/previews', () => ({ items: PREVIEWS.map(previewView) }));
route('PUT', '/v1/previews/{key}', ({ params }) => changePreview(params.key, true));
route('DELETE', '/v1/previews/{key}', ({ params }) => changePreview(params.key, false));
route('GET', '/v1/orgs/{slug}/previews', () => ({ items: PREVIEWS.map(previewView) }));
route('PUT', '/v1/orgs/{slug}/previews/{key}', ({ params }) => changePreview(params.key, true));
route('DELETE', '/v1/orgs/{slug}/previews/{key}', ({ params }) => changePreview(params.key, false));

// --- Public status -----------------------------------------------------------

route('GET', '/v1/status', ({ res }) => {
  res.setHeader('Cache-Control', 'public, max-age=15, stale-while-revalidate=45');
  return db.publicStatus;
});
route('GET', '/status/slo.json', ({ res }) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  return {
    api_availability_pct: db.publicStatus.indicators[0].value,
    wake_p95_ms: db.publicStatus.indicators[1].value,
    build_success_pct: db.publicStatus.indicators[2].value,
    degraded: db.publicStatus.overall_status !== 'operational',
    as_of: db.publicStatus.updated_at,
    source: 'prometheus',
  };
});
route('GET', '/v1/status/incidents/{public_id}', ({ params }) => {
  const events = [
    ...db.publicStatus.active_events,
    ...db.publicStatus.upcoming_maintenance,
    ...db.publicStatus.resolved_incidents,
  ];
  const event = events.find((candidate) => candidate.id === params.public_id);
  if (!event) throw new Problem(404, 'NotFound', 'Status event not found.');
  return event;
});

// --- Migration preflight -----------------------------------------------------

/**
 * `GET /v1/preflight` — the public "will it run here" check.
 *
 * The real endpoint reads a repository; there is nothing to read without a
 * backend, so the verdict is keyed off the pasted text. That keeps every state
 * of the page reachable on demand — the point of the mock — without pretending
 * to have analysed anything:
 *
 *   gregale/api          green, runs as written
 *   owner/express-api    amber, needs a change
 *   owner/legacy-volume  red, a hard disqualifier
 *   owner/private-thing  404, private or missing
 *   owner/enormous       422, too large
 *   owner/ratelimited    429, too many checks
 *
 * Plan budgets mirror pkg/api/limits.go: billed RAM is the plan tier plus the
 * 8 MB per-VM overhead, and the included minutes are that allowance converted
 * to running time.
 */
const PREFLIGHT_PLAN_BUDGETS = [
  {
    plan: 'free',
    ram_mb: 128,
    billed_ram_mb: 136,
    included_running_minutes: 2258,
    included_gb_hours: 5,
    price_millicents: 0,
    overage_millicents_per_gb_hour: 1000,
  },
  {
    plan: 'hobby',
    ram_mb: 256,
    billed_ram_mb: 264,
    included_running_minutes: 11636,
    included_gb_hours: 50,
    price_millicents: 900000,
    overage_millicents_per_gb_hour: 1000,
  },
  {
    plan: 'pro',
    ram_mb: 512,
    billed_ram_mb: 520,
    included_running_minutes: 29538,
    included_gb_hours: 250,
    price_millicents: 2900000,
    overage_millicents_per_gb_hour: 1000,
  },
  {
    plan: 'scale',
    ram_mb: 1024,
    billed_ram_mb: 1032,
    included_running_minutes: 89302,
    included_gb_hours: 1500,
    price_millicents: 9900000,
    overage_millicents_per_gb_hour: 1000,
  },
];

const PREFLIGHT_VERDICTS: Record<string, unknown> = {
  green: {
    level: 'green',
    profile: {
      version: 'v1',
      framework: 'hono',
      framework_version: '4.6.3',
      package_manager: 'pnpm',
      start_command: 'pnpm run start',
      port: 3000,
      health_path: '/healthz',
      inferred: true,
    },
  },
  amber: {
    level: 'amber',
    profile: {
      version: 'v1',
      framework: 'express',
      package_manager: 'npm',
      start_command: 'npm run start',
      port: 3000,
      health_path: '/healthz',
      inferred: true,
    },
    findings: [
      {
        code: 'loopback_bind_possible',
        level: 'amber',
        title: 'Source may bind to localhost',
        detail:
          'The source references localhost or 127.0.0.1; bind to 0.0.0.0 for public API traffic.',
        remedy: 'Bind to 0.0.0.0 and read the port from $PORT, or traffic cannot reach the app.',
        sources: ['src/server.js', 'src/dev.js', 'test/helpers.js'],
      },
      {
        code: 'development_start_command',
        level: 'amber',
        title: 'Start command looks development-only',
        detail:
          'The inferred start script appears development-only; use a production server for predictable zero-config deploys.',
        remedy: 'Point `start` at a production server rather than a watch/dev process.',
        sources: ['package.json'],
      },
    ],
  },
  red: {
    level: 'red',
    profile: {
      version: 'v1',
      framework: 'oci',
      package_manager: 'container',
      port: 8080,
      health_path: '/healthz',
    },
    findings: [
      {
        code: 'container_command_deferred',
        level: 'green',
        title: 'Entrypoint comes from the image',
        detail:
          'The container entrypoint and health contract will be read from the image; source inference is intentionally conservative.',
        sources: ['Dockerfile'],
      },
      {
        code: 'durable_local_disk',
        level: 'red',
        title: 'Expects durable local disk',
        detail:
          'The Dockerfile declares a VOLUME. The Gregale root filesystem is ephemeral and host mounts are not supported, so anything written there is lost when the instance is parked or replaced.',
        remedy:
          'Move persistent state to object storage or a managed database, then remove the VOLUME.',
        sources: ['Dockerfile'],
      },
      {
        code: 'host_networking',
        level: 'red',
        title: 'Requires host networking',
        detail:
          'A compose service requests host networking. Each guest gets its own network namespace, which is what lets one snapshot restore as many instances.',
        remedy: 'Bind to 0.0.0.0 on $PORT and let the platform route to it.',
        sources: ['docker-compose.yml'],
      },
    ],
  },
};

route('GET', '/v1/preflight', ({ query }) => {
  const source = (query.get('source') ?? '').trim();
  if (!source)
    throw new Problem(
      422,
      'preflight_invalid_source',
      'Paste a public github.com repository URL, or owner/repo.'
    );

  const parsed = source
    .replace(/^https?:\/\//, '')
    .replace(/^(www\.)?github\.com\//, '')
    .replace(/\.git$/, '')
    .split('/')
    .filter(Boolean);
  if (parsed.length < 2 || !/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(parsed[0])) {
    throw new Problem(
      422,
      'preflight_invalid_source',
      'Paste a public github.com repository URL, or owner/repo.'
    );
  }
  const [owner, repo] = parsed;
  const key = `${owner}/${repo}`.toLowerCase();

  if (key.includes('private'))
    throw new Problem(
      404,
      'preflight_repo_not_found',
      'The repository does not exist, or it is private. Preflight only reads public repositories.'
    );
  if (key.includes('enormous') || key.includes('huge'))
    throw new Problem(
      422,
      'preflight_source_too_large',
      'The source exceeds the size preflight will inspect.'
    );
  if (key.includes('ratelimit'))
    throw new Problem(
      429,
      'preflight_rate_limited',
      'Wait a few minutes before checking another repository.'
    );
  if (key.includes('upstream'))
    throw new Problem(503, 'preflight_upstream_unavailable', 'Try again shortly.');

  let verdict = PREFLIGHT_VERDICTS.green;
  if (/volume|docker|compose|legacy|red/.test(key)) verdict = PREFLIGHT_VERDICTS.red;
  else if (/express|amber|localhost|dev/.test(key)) verdict = PREFLIGHT_VERDICTS.amber;

  // A commit is a stable function of the repository here, so a permalink
  // re-renders the same verdict the way the real endpoint does.
  const sha = Array.from(key)
    .reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 7)
    .toString(16)
    .padStart(8, '0')
    .repeat(5)
    .slice(0, 40);

  return {
    source: { owner, repo, ...(query.get('ref') ? { ref: query.get('ref') } : {}) },
    commit_sha: sha,
    verdict,
    plan_budgets: PREFLIGHT_PLAN_BUDGETS,
    checked_at: new Date().toISOString(),
  };
});

// --- Auth --------------------------------------------------------------------

const SESSION_COOKIE = 'faas_sid=mock-session; Path=/; HttpOnly; SameSite=Lax';
const CSRF_COOKIE = 'faas_csrf=mock-csrf; Path=/; SameSite=Lax';

const login: Handler = ({ body, res }) => {
  const email = String(body.email ?? '');
  const password = String(body.password ?? '');
  if (!email.includes('@'))
    throw new Problem(400, 'invalid_email', 'That does not look like an email address.');
  if (password.length < 12)
    throw new Problem(401, 'invalid_credentials', 'Email or password is incorrect.');
  res.setHeader('Set-Cookie', [SESSION_COOKIE, CSRF_COOKIE]);
  return { account_id: db.ACCOUNT_ID, plan: db.account.plan };
};
route('POST', '/login', login);
route('POST', '/signup', login);
route('POST', '/login/forgot', () => ({}));
// apid revokes the session only against a double-submitted `auth.logout`
// token (ADR-039 / ADR-140). Refusing here keeps a console that forgets the
// token from looking signed out in dev while apid would keep the session.
route('POST', '/v1/auth/logout', ({ body, res }) => {
  if (body.csrf_token !== 'mock-csrf')
    throw new Problem(
      400,
      'csrf_mismatch',
      "the form's csrf_token does not match the bound action"
    );
  res.setHeader('Set-Cookie', ['faas_sid=; Path=/; Max-Age=0', 'faas_csrf=; Path=/; Max-Age=0']);
  return NO_CONTENT;
});

route('GET', '/v1/account', () => ({ ...db.account, app_count: db.apps.length }));
const SLO_WINDOWS = new Set(['1h', '24h', '7d']);
// Keep analytics screenshots stable without aging unrelated lifecycle fixtures.
const ANALYTICS_NOW = Date.parse('2026-09-05T13:00:00.123Z');
const analyticsIso = (msAgo: number) => new Date(ANALYTICS_NOW - msAgo).toISOString();

function sloWindow(query: URLSearchParams) {
  const window = query.get('window') ?? '24h';
  if (!SLO_WINDOWS.has(window))
    throw new Problem(400, 'validation_failed', `unknown SLO window "${window}".`);
  return window as '1h' | '24h' | '7d';
}

function accountSlo(
  window: ReturnType<typeof sloWindow>
): components['schemas']['AccountSLOResponse'] {
  return {
    window,
    source: 'prometheus',
    as_of: analyticsIso(0),
    request_duration: { p50_ms: 22.1, p95_ms: 91, p99_ms: 410 },
    error_rate_pct: 0.55,
    cold_boot_rate_pct: 4.2,
    instance_hours: 12,
    gb_hours: 3,
    wake_queue_p95_ms: null,
    wake_queue_sample_status: 'unavailable',
    requests_total: 12000,
    throttled_total: 23,
  };
}

function appSlo(
  a: db.App,
  window: ReturnType<typeof sloWindow>
): components['schemas']['AppSLOResponse'] {
  return {
    app_id: a.id,
    app_slug: a.slug,
    window,
    source: 'prometheus',
    as_of: analyticsIso(0),
    request_duration: { p50_ms: 14.2, p95_ms: 87, p99_ms: 312.5 },
    error_rate_pct: 0.41,
    cold_boot_rate_pct: 3.1,
    instance_hours: 0,
    gb_hours: 0,
    wake_queue_p95_ms: null,
    wake_queue_sample_status: 'unavailable',
    requests_total: 4321,
    throttled_total: 0,
  };
}

route('GET', '/v1/account/slo', ({ query }) => accountSlo(sloWindow(query)));
route('PATCH', '/v1/account/plan', ({ body }) => {
  const plan = String(body.plan ?? '') as typeof db.account.plan;
  if (!['free', 'hobby', 'pro', 'scale'].includes(plan)) throw new Problem(400, 'invalid_plan');
  db.account.plan = plan;
  Object.assign(db.account.limits, TRIGGER_CAPABILITIES_BY_PLAN[plan], { plan });
  return db.account;
});

route('GET', '/v1/auth/sessions', () => ({ sessions: db.sessions }));
route('DELETE', '/v1/auth/sessions/{id}', ({ params }) => {
  const i = db.sessions.findIndex((s) => s.id === params.id);
  if (i < 0) throw new Problem(404, 'session_not_found');
  if (db.sessions[i].current_session) throw new Problem(409, 'cannot_revoke_current_session');
  db.sessions.splice(i, 1);
  return NO_CONTENT;
});
route('POST', '/v1/auth/sessions/revoke_all', () => {
  const others = db.sessions.filter((s) => !s.current_session).length;
  db.sessions.splice(0, db.sessions.length, ...db.sessions.filter((s) => s.current_session));
  return { revoked: others };
});

// --- Apps --------------------------------------------------------------------

// Deleted apps wait out their grace window here, keyed by ID like apid's
// tombstones (faas pkg/apid/apprecovery/handlers.go). `GET /v1/deleted-apps`
// lists them; restore goes by exact ID, or by slug through the legacy route.
type DeletedRecord = {
  app: db.App;
  deletedAt: number | null;
  expiresAt: number | null;
  purgeStarted?: boolean;
};
const deletedApps = new Map<string, DeletedRecord>();
const GRACE_MS = 7 * 86400e3; // AppDeleteGraceDays, faas pkg/api/limits.go:2416

function seedDeleted(slug: string, deletedAgoMs: number, extra: Partial<DeletedRecord> = {}) {
  const deletedAt = db.NOW - deletedAgoMs;
  const app: db.App = {
    ...db.apps[0],
    id: db.id(),
    slug,
    status: 'deleted',
    url: `https://${slug}.gregale.app`,
    canonical_url: `https://${slug}.gregale.app`,
  };
  deletedApps.set(app.id, { app, deletedAt, expiresAt: deletedAt + GRACE_MS, ...extra });
}
// Independent records; no live seeded app is deleted to make them. One reuses
// an active app's name, so its restore answers `conflict`.
if (!db.EMPTY) {
  seedDeleted('checkout-preview', 2 * 3600e3);
  seedDeleted('api-gateway', 2 * 86400e3);
  seedDeleted('old-webhooks', 6 * 86400e3 + 20 * 3600e3);
  seedDeleted('legacy-cron', 9 * 86400e3);
  seedDeleted('nightly-report', 8 * 86400e3, { purgeStarted: true });
}

function deletedSummary(record: DeletedRecord, now: number): S_['DeletedAppSummary'] {
  const blocker = record.purgeStarted
    ? 'purge_started'
    : record.deletedAt === null || record.expiresAt === null
      ? 'metadata_unavailable'
      : record.expiresAt <= now
        ? 'grace_expired'
        : '';
  return {
    account_id: db.account.id,
    id: record.app.id,
    slug: record.app.slug,
    deleted_at: record.deletedAt === null ? null : new Date(record.deletedAt).toISOString(),
    delete_grace_until: record.expiresAt === null ? null : new Date(record.expiresAt).toISOString(),
    restore_eligible: blocker === '',
    restore_blocker: blocker,
    evaluated_at: new Date(now).toISOString(),
  };
}

function restoreDeleted(record: DeletedRecord) {
  const now = Date.now();
  if (!deletedSummary(record, now).restore_eligible)
    throw new Problem(409, 'app_not_restorable', 'the deletion grace window has ended.');
  const current = db.appBySlug(record.app.slug);
  if (current && current.id !== record.app.id)
    throw new Problem(409, 'conflict', "the retained app's slug belongs to an active app.");
  if ((process.env.MOCK_PLAN ?? db.account.plan) === 'free' && db.apps.length >= 1)
    throw new Problem(
      403,
      'plan_limit_apps',
      `free plan allows 1 deployed app(s); you have ${db.apps.length}.`
    );
  record.app.status = db.deployments.some((deployment) => deployment.app_id === record.app.id)
    ? 'active'
    : 'undeployed';
  db.apps.push(record.app);
  deletedApps.delete(record.app.id);
  return record.app;
}

route('GET', '/v1/deleted-apps', ({ query }) => {
  for (const [key] of query)
    if ((key !== 'limit' && key !== 'cursor') || query.getAll(key).length !== 1)
      throw new Problem(400, 'validation_failed', 'only one limit and cursor are supported.');
  const limit = query.has('limit') ? Number(query.get('limit')) : 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50)
    throw new Problem(400, 'validation_failed', 'limit must be 1..50');
  const at = (r: DeletedRecord) => r.deletedAt ?? 0;
  let before: { at: number; id: string } | null = null;
  const cursor = query.get('cursor');
  if (cursor) {
    try {
      before = JSON.parse(Buffer.from(cursor, 'base64url').toString());
      if (!before || !Number.isFinite(before.at) || typeof before.id !== 'string')
        throw new Error();
    } catch {
      throw new Problem(
        400,
        'validation_failed',
        "invalid deleted-app cursor; restart this account's inventory"
      );
    }
  }
  const rows = [...deletedApps.values()]
    .sort((a, b) => at(b) - at(a) || b.app.id.localeCompare(a.app.id))
    .filter((r) => !before || at(r) < before.at || (at(r) === before.at && r.app.id < before.id));
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const now = Date.now();
  return {
    account_id: db.account.id,
    apps: page.map((r) => deletedSummary(r, now)),
    evaluated_at: new Date(now).toISOString(),
    ...(rows.length > limit && last
      ? {
          next_cursor: Buffer.from(JSON.stringify({ at: at(last), id: last.app.id })).toString(
            'base64url'
          ),
        }
      : {}),
  };
});
function deletedRecord(id: string) {
  const record = deletedApps.get(id);
  if (!record) throw new Problem(404, 'not_found', 'no such deleted app');
  return record;
}
route('GET', '/v1/deleted-apps/{id}', ({ params }) =>
  deletedSummary(deletedRecord(params.id), Date.now())
);
route('POST', '/v1/deleted-apps/{id}/restore', ({ params, body }) => {
  if (body && Object.keys(body).length > 0)
    throw new Problem(400, 'validation_failed', 'restore accepts no fields; use an empty body');
  return restoreDeleted(deletedRecord(params.id));
});

function app(slug: string) {
  const found = db.appBySlug(slug);
  if (!found) throw new Problem(404, 'app_not_found', `No app named "${slug}".`);
  return found;
}

/** A blank deployment row for `a`; `startDeployment` sets its t=0 status. */
function newDeployment(a: db.App, kind: string): db.Deployment {
  return {
    id: db.id(),
    app_id: a.id,
    build_id: null,
    image_digest: `sha256:${db.id()}${db.id()}`,
    kind,
    status: 'pending',
    created_at: new Date().toISOString(),
    traffic_percent: 0,
    scan: null,
  };
}

/**
 * A deployment that builds from source, with its build row, on the timed
 * lifecycle in `deploy-lifecycle.ts`. `MOCK_BUILD_FAIL=1` (read per request,
 * so it can be flipped in a test) makes the build fail installing dependencies.
 */
function startSourceDeployment(
  a: db.App,
  kind: 'github' | 'tarball',
  source: string,
  extra: Partial<db.Deployment> = {}
): db.Deployment {
  const deployment: db.Deployment = { ...newDeployment(a, kind), ...extra, build_id: db.id() };
  const build: db.Build = {
    id: deployment.build_id!,
    deployment_id: deployment.id,
    kind: kind === 'github' ? 'railpack' : 'tarball',
    source_bytes: 1_843_200,
    status: 'queued',
    enqueued_at: deployment.created_at,
  };
  db.deployments.unshift(deployment);
  db.builds.unshift(build);
  startDeployment({
    deployment,
    app: a,
    build,
    fail: process.env.MOCK_BUILD_FAIL === '1',
    now: Date.now(),
    source,
  });
  return deployment;
}

route('GET', '/v1/apps', () => db.apps);
route('GET', '/v1/apps/metrics', ({ query }) => {
  const range = query.get('range') ?? '24h';
  return {
    range,
    source: 'prometheus',
    as_of: db.iso(0),
    apps: Object.fromEntries(db.apps.map((a) => [a.slug, db.metricsFor(a, range)])),
  };
});
const imageAppReceipts = new Map<string, { body: string; app: db.App; at: number }>();
const imageDeployReceipts = new Map<string, db.Deployment>();
const workerImageReads = new Map<string, number>();
/**
 * Shared by `POST /v1/apps` and `POST /v1/orgs/{slug}/apps`: the request body
 * is the same CreateAppRequest, and only the attribution differs.
 */
function createMockApp(body: Record<string, unknown>, req: IncomingMessage) {
  const key = String(req.headers['idempotency-key'] ?? '');
  const receipt = key && imageAppReceipts.get(key);
  if (receipt && Date.now() - receipt.at < 24 * 60 * 60 * 1000) {
    if (receipt.body !== JSON.stringify(body)) throw new Problem(409, 'idempotency_conflict');
    return status(201, receipt.app);
  }
  const worker = body.execution_mode === 'worker';
  const plan = process.env.MOCK_PLAN ?? db.account.plan;
  if (worker && plan === 'free') throw new Problem(403, 'plan_worker_pools_not_allowed');
  const restartPolicy = String(body.restart_policy ?? 'always');
  if (worker) {
    const limit =
      plan === 'hobby'
        ? { deadline: 30, retries: 5 }
        : plan === 'pro'
          ? { deadline: 60, retries: 10 }
          : { deadline: 120, retries: 20 };
    const deadline = Number(body.startup_deadline_s ?? 0);
    const retries = Number(body.max_retries ?? 0);
    if (
      !Number.isInteger(deadline) ||
      deadline < 0 ||
      deadline > limit.deadline ||
      !Number.isInteger(retries) ||
      retries < 0 ||
      retries > limit.retries ||
      !['always', 'on-failure', 'unless-stopped', 'no'].includes(restartPolicy)
    )
      throw new Problem(422, 'invalid_lifecycle_configuration');
  }
  const slug = String(body.slug ?? '').trim();
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug))
    throw new Problem(400, 'invalid_slug', 'Slugs are lowercase letters, digits, and dashes.');
  if (db.appBySlug(slug) || [...deletedApps.values()].some((r) => r.app.slug === slug))
    throw new Problem(409, 'app_exists', `"${slug}" already exists.`);
  const created: db.App = {
    ...db.apps[0],
    id: db.id(),
    slug,
    type: (body.type as db.App['type']) ?? 'function',
    runtime: (body.runtime as db.App['runtime']) ?? 'node24',
    ram_mb: Number(body.ram_mb ?? 256),
    min_instances: 0,
    status: 'active',
    // The seeded apps' per-VM bound, which an empty workspace has no row to lend.
    concurrency_per_vm: 5,
    release_policy: 'safe',
    release_probe_paths: undefined,
    function_concurrency: undefined,
    ...(worker
      ? {
          workload_class: undefined,
          manifest: {
            entrypoint: ['/worker'],
            execution_mode: 'worker' as const,
            restart_policy: restartPolicy as db.App['manifest']['restart_policy'],
            startup_deadline_s: Number(body.startup_deadline_s ?? 0),
            max_retries: Number(body.max_retries ?? 0),
            head_wakes: false,
            crawler_policy: 'wake' as const,
          },
        }
      : {}),
    visibility: body.visibility === 'internal' ? 'internal' : 'public',
    url: body.visibility === 'internal' ? '' : db.appUrlFor(slug),
    service_bindings: Array.isArray(body.service_binding_targets)
      ? body.service_binding_targets
          .filter((value): value is string => typeof value === 'string')
          .map((service) => ({
            service,
            binding: `GREGALE_SERVICE_${service.toUpperCase().replace(/-/g, '_')}_URL`,
          }))
      : [],
    service_binding_policy: body.service_binding_policy === 'declared' ? 'declared' : 'account',
    service_binding_transport: body.service_binding_transport === 'https' ? 'https' : 'http',
    ...(Array.isArray(body.allowed_service_callers)
      ? { allowed_service_callers: body.allowed_service_callers as string[] }
      : {}),
    ...(body.allowed_service_call_scopes && typeof body.allowed_service_call_scopes === 'object'
      ? {
          allowed_service_call_scopes:
            body.allowed_service_call_scopes as db.App['allowed_service_call_scopes'],
        }
      : {}),
  };
  // Newest first in a workspace inventory, like apid.
  Object.assign(created, { created_at: new Date().toISOString() });
  db.apps.push(created);
  if (key) imageAppReceipts.set(key, { body: JSON.stringify(body), app: created, at: Date.now() });
  return status(201, created);
}
route('POST', '/v1/apps', ({ body, req }) => createMockApp(body, req));
route('POST', '/v1/apps/{slug}/deployments', ({ params, body, req }) => {
  const a = app(params.slug);
  // A source upload (a function written in New app) builds like any tarball.
  if (String(req.headers['content-type'] ?? '').startsWith('multipart/form-data')) {
    if (a.type !== 'function')
      throw new Problem(422, 'invalid_app_type', 'This mock builds uploads for functions only.');
    return status(202, startSourceDeployment(a, 'tarball', `${a.slug} (uploaded handler)`));
  }
  if (a.type !== 'app')
    throw new Problem(422, 'invalid_app_type', 'Image deployment requires an app.');
  if (typeof body.image !== 'string' || !isDigestPinnedImage(body.image))
    throw new Problem(400, 'image_not_digest_pinned', 'Use a digest-pinned image.');
  const key = `${a.id}:${String(req.headers['idempotency-key'] ?? '')}`;
  const prior = imageDeployReceipts.get(key);
  if (prior && !['failed', 'cancelled', 'superseded'].includes(prior.status))
    return status(202, prior);
  const deployment: db.Deployment = {
    id: db.id(),
    app_id: a.id,
    image_digest: body.image.slice(body.image.indexOf('@')),
    kind: 'image',
    status: 'imaging',
    build_id: null,
    created_at: new Date().toISOString(),
  };
  db.deployments.unshift(deployment);
  // Worker images keep their read-count characterization in GET /v1/deployments/{id}.
  if (a.manifest?.execution_mode !== 'worker')
    startDeployment({ deployment, app: a, now: Date.now() });
  imageDeployReceipts.set(key, deployment);
  return status(202, deployment);
});
// A sync invoke answers at once with what a small JSON handler would return.
route('POST', '/v1/apps/{slug}/invoke', ({ params, body }) => {
  const a = app(params.slug);
  const method = typeof body.method === 'string' ? body.method : 'POST';
  const path = typeof body.path === 'string' ? body.path : '/';
  return { id: db.id(), status: 'completed', result: { ok: true, app: a.slug, method, path } };
});
const imageRegistryMetadata = new Map<
  string,
  components['schemas']['AppRegistryCredentialResponse'][]
>();
route('GET', '/v1/apps/{slug}/registry-credentials', ({ params }) => {
  const a = app(params.slug);
  const credentials = imageRegistryMetadata.get(a.id) ?? [];
  return { credentials, quota_max: 20, count: credentials.length };
});
route('PUT', '/v1/apps/{slug}/registry-credentials', ({ params, body }) => {
  const a = app(params.slug);
  if (
    typeof body.registry !== 'string' ||
    typeof body.username !== 'string' ||
    typeof body.password !== 'string' ||
    !body.password
  )
    throw new Problem(422, 'invalid_registry_credentials');
  let parsed: URL;
  try {
    parsed = new URL(body.registry);
  } catch {
    throw new Problem(422, 'invalid_registry');
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  )
    throw new Problem(422, 'invalid_registry');
  const metadata = {
    registry: parsed.host,
    username: body.username,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const rows = imageRegistryMetadata.get(a.id) ?? [];
  imageRegistryMetadata.set(a.id, [
    ...rows.filter((item) => item.registry !== metadata.registry),
    metadata,
  ]);
  return metadata;
});
route('GET', '/v1/apps/{slug}', ({ params }) => app(params.slug));
route('GET', '/v1/apps/{slug}/bindings', ({ params, query }) => {
  const a = app(params.slug);
  const partial = a.slug === 'billing-recon';
  return {
    app: a.slug,
    ...(query.get('scope') ? { scope: query.get('scope') } : {}),
    generated_at: new Date().toISOString(),
    complete: !partial,
    bindings: (a.service_bindings ?? []).map((binding) => ({
      type: 'service',
      name: binding.service,
      binding: binding.binding,
      scope: 'app',
      access: a.service_binding_policy ?? 'account',
      state: 'configured',
      runtime_status: 'not_observed',
      verification_status: 'unknown',
      http_url: `http://${binding.service}.svc.gregale:10081`,
      https_url: `https://${binding.service}.internal`,
      transport: a.service_binding_transport ?? 'http',
    })),
    ...(partial
      ? {
          issues: [
            {
              type: 'postgres',
              code: 'partial_read',
              severity: 'warning',
              message: 'Managed PostgreSQL inventory could not be read.',
            },
          ],
        }
      : {}),
  };
});
route('GET', '/v1/apps/{slug}/service-wake-ahead', ({ params }) => readWakeAhead(app(params.slug)));
route('PUT', '/v1/apps/{slug}/service-wake-ahead', ({ params, body }) => {
  const a = app(params.slug);
  // The failing app models the setting store being down (ErrCapacity).
  if (a.slug === 'billing-recon')
    throw new Problem(503, 'capacity_unavailable', 'service wake-ahead');
  const out = writeWakeAhead(a, body.enabled);
  if (!out)
    throw new Problem(
      400,
      'validation_failed',
      'body must be {"enabled": true} or {"enabled": false}'
    );
  return out;
});
route('GET', '/v1/apps/{slug}/policy/status', ({ params }) =>
  mockRuntimePolicy(app(params.slug).id)
);
route('DELETE', '/v1/apps/{slug}', ({ params }) => {
  const a = app(params.slug);
  // Active reads hide tombstones; the restore API retains the same app identity.
  const deletedAt = Date.now();
  deletedApps.set(a.id, { app: a, deletedAt, expiresAt: deletedAt + GRACE_MS });
  db.apps.splice(db.apps.indexOf(a), 1);
  return NO_CONTENT;
});
route('POST', '/v1/apps/{slug}/wake', ({ params }) => {
  db.setScenario(app(params.slug), 'healthy');
  return NO_CONTENT;
});
route('POST', '/v1/apps/{slug}/park', ({ params }) => {
  db.setScenario(app(params.slug), 'parked');
  return NO_CONTENT;
});
/**
 * release_policy, release_probe_paths and function_concurrency, validated
 * the way apid does before anything is written: the lifecycle check answers
 * 400 validation_failed (faas pkg/apid/apidserver/lifecycle.go:61), and the
 * capability gate refuses `safe` and probe paths while progressive rollouts
 * are off (faas pkg/productcap/catalog.json:4279).
 */
function applyReleaseSettings(a: db.App, body: Record<string, unknown>) {
  const policy = body.release_policy;
  const paths = body.release_probe_paths;
  const concurrency = body.function_concurrency;
  if (policy != null && !['safe', 'fast', 'immediate'].includes(String(policy)))
    throw new Problem(400, 'validation_failed', 'release_policy must be safe, fast or immediate.');
  if (Array.isArray(paths)) {
    if (paths.length > 3)
      throw new Problem(400, 'validation_failed', 'release_probe_paths: at most 3 paths.');
    const bad = paths.find(
      (p) => typeof p !== 'string' || !p.startsWith('/') || p.length > 240 || /[?#*\\{}\s]/.test(p)
    );
    if (bad !== undefined)
      throw new Problem(
        400,
        'validation_failed',
        `release_probe_paths: ${JSON.stringify(bad)} must be a concrete absolute path.`
      );
    if (new Set(paths).size !== paths.length)
      throw new Problem(400, 'validation_failed', 'release_probe_paths: a path is listed twice.');
  }
  const bound = a.concurrency_per_vm;
  if (
    concurrency != null &&
    (!Number.isInteger(concurrency) || Number(concurrency) < 0 || Number(concurrency) > bound)
  )
    throw new Problem(
      400,
      'validation_failed',
      `function_concurrency must be between 0 and ${bound}.`
    );
  const rolloutsOff = (process.env.MOCK_UNAVAILABLE_CAPABILITIES ?? '')
    .split(',')
    .includes('progressive-rollouts');
  if (
    rolloutsOff &&
    ((policy === 'safe' && a.release_policy !== 'safe') ||
      (Array.isArray(paths) && paths.length > 0))
  )
    throw new Problem(
      403,
      'capability_not_released',
      'Progressive rollouts and rollback is not released to this account.'
    );
  if (policy != null) a.release_policy = policy as db.App['release_policy'];
  if (Array.isArray(paths)) {
    if (paths.length) a.release_probe_paths = paths as string[];
    else delete a.release_probe_paths;
  }
  if (concurrency != null) {
    if (Number(concurrency) > 0) a.function_concurrency = Number(concurrency);
    else delete a.function_concurrency;
  }
}
const PATCHABLE = [
  'ram_mb',
  'idle_timeout_s',
  'max_concurrency',
  'min_instances',
  'egress_allowlist',
  'autoscale_target_rps',
  'autoscale_target_cpu_pct',
  'streaming_enabled',
  'websocket_enabled',
  'route_metrics_enabled',
  'maintenance_mode',
  'warm_snapshot_enabled',
  'eviction_priority',
] as const;
route('PATCH', '/v1/apps/{slug}', ({ params, body }) => {
  const a = app(params.slug);
  const policyFields = [
    'allowed_service_callers',
    'allowed_service_call_scopes',
    'service_binding_targets',
    'service_binding_policy',
    'service_binding_transport',
  ];
  if (
    policyFields.some((key) => key in body && body[key] !== null) &&
    (Boolean(a.preview_of_slug) ||
      projects.some((project) => project.workloads.some((workload) => workload.slug === a.slug)))
  )
    throw new Problem(
      409,
      'service_policy_source_managed',
      'Edit this service policy in the project source.'
    );
  applyReleaseSettings(a, body);
  for (const k of PATCHABLE)
    if (k in body && body[k] !== null) (a as Record<string, unknown>)[k] = body[k];
  if (body.visibility === 'internal' || body.visibility === 'public') {
    a.visibility = body.visibility;
    a.url = body.visibility === 'internal' ? '' : db.appUrlFor(a.slug);
  }
  if ('allowed_service_callers' in body) {
    if (body.allowed_service_callers === null) delete a.allowed_service_callers;
    else if (Array.isArray(body.allowed_service_callers))
      a.allowed_service_callers = body.allowed_service_callers as string[];
  }
  if ('allowed_service_call_scopes' in body) {
    if (body.allowed_service_call_scopes === null) delete a.allowed_service_call_scopes;
    else if (
      body.allowed_service_call_scopes &&
      typeof body.allowed_service_call_scopes === 'object'
    )
      a.allowed_service_call_scopes =
        body.allowed_service_call_scopes as db.App['allowed_service_call_scopes'];
  }
  if (Array.isArray(body.service_binding_targets))
    a.service_bindings = body.service_binding_targets
      .filter((value): value is string => typeof value === 'string')
      .map((service) => ({
        service,
        binding: `GREGALE_SERVICE_${service.toUpperCase().replace(/-/g, '_')}_URL`,
      }));
  if (body.service_binding_policy === 'account' || body.service_binding_policy === 'declared')
    a.service_binding_policy = body.service_binding_policy;
  if (body.service_binding_transport === 'http' || body.service_binding_transport === 'https')
    a.service_binding_transport = body.service_binding_transport;
  // Deliberately mixed evidence in the dev fixture; mutation acceptance is not convergence.
  advancePolicy(a.id, ['request_policy', 'egress_allowlist', 'cpu_limit', 'scheduler_scaling']);
  return a;
});
route('POST', '/v1/apps/{slug}/rename', ({ params, body }) => {
  const a = app(params.slug);
  const next = String(body.new_slug ?? '').trim();
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(next))
    throw new Problem(400, 'invalid_slug', 'Slugs are lowercase letters, digits, and dashes.');
  if (db.appBySlug(next)) throw new Problem(409, 'app_exists', `"${next}" already exists.`);
  db.renameApp(a, next);
  return a;
});
route('POST', '/v1/apps/{slug}/deployments/source-ref', ({ params, body }) => {
  const a = app(params.slug);
  if (!body.repo || !body.ref)
    throw new Problem(400, 'missing_field', 'repo and ref are required.');
  return status(
    202,
    startSourceDeployment(a, 'github', `${String(body.repo)}@${String(body.ref)}`)
  );
});
route('POST', '/v1/apps/{slug}/rollback', ({ params, body }) => {
  // Plain rollback (handlers_ext.go:2376): restore the named release, or the
  // newest superseded one, and answer 202 with its rollback_operation.
  const a = app(params.slug);
  const rows = db.deployments.filter((d) => d.app_id === a.id);
  const ref = typeof body.target_deployment_id === 'string' ? body.target_deployment_id.trim() : '';
  const target = ref
    ? rows.find((d) => d.id === ref || `v${d.revision}` === ref)
    : rows.find((d) => d.status === 'superseded');
  if (ref && !target)
    throw new Problem(404, 'rollback_target_not_found', `no rollback-eligible deployment "${ref}"`);
  if (!target) throw new Problem(409, 'no_rollback_target', 'Nothing to roll back to.');
  if (target.status === 'live' && (target.traffic_percent ?? 0) > 0)
    throw new Problem(
      409,
      'rollback_target_already_live',
      `deployment "${ref}" is already the current live deployment`
    );
  if (target.status !== 'superseded' && target.status !== 'live')
    throw new Problem(
      409,
      'rollback_target_ineligible',
      `deployment "${ref}" has status "${target.status}"; only a superseded or zero-traffic live deployment can be rolled back`
    );
  // The oldest seeded release of the first app ran release commands since
  // it last served, so its rollback is refused until acknowledged (ADR-1448).
  const newer = rows.filter((d) => Date.parse(d.created_at) > Date.parse(target.created_at));
  if (a.slug === db.apps[0].slug && newer.length >= 3 && body.acknowledge_releases !== true)
    throw new Problem(
      409,
      'rollback_crosses_release',
      'This rollback crosses release commands that ran after its target last served.',
      {
        crossed_releases: newer.slice(-2).map((d) => ({
          deployment_id: d.id,
          ...(d.revision ? { revision: d.revision } : {}),
          status: 'succeeded',
          started_at: d.created_at,
        })),
      }
    );
  const current = rows.find(
    (d) => d.status === 'live' && (d.traffic_percent ?? 0) > 0 && d.scope === target.scope
  );
  const rollback_operation = deploymentDetail.startRollback(a.id, target, current);
  return status(202, { ...target, rollback_operation });
});
route('GET', '/v1/apps/{slug}/rollbacks/{operation}', ({ params }) => {
  app(params.slug);
  const op = deploymentDetail.readRollback(db.deployments, params.operation);
  if (!op) throw new Problem(404, 'not_found', 'No such rollback operation for this app.');
  return op;
});
route('GET', '/v1/apps/{slug}/deployments/{id}/summary', ({ params }) => {
  const a = app(params.slug);
  const rows = db.deployments.filter((d) => d.app_id === a.id);
  const d = rows.find((x) => x.id === params.id);
  if (!d) throw new Problem(404, 'not_found', 'no such deployment');
  const previous =
    rows
      .filter((x) => Date.parse(x.created_at) < Date.parse(d.created_at))
      .sort((x, y) => Date.parse(y.created_at) - Date.parse(x.created_at))[0] ?? null;
  const target = rows.find((x) => x.status === 'superseded');
  return {
    deployment: d,
    previous,
    changes:
      previous && previous.min_instances !== d.min_instances
        ? [
            {
              field: 'min_instances' as const,
              before: previous.min_instances ?? 0,
              after: d.min_instances ?? 0,
            },
          ]
        : [],
    ...(target
      ? {
          rollback_target_id: target.id,
          ...(target.revision ? { rollback_target_revision: target.revision } : {}),
        }
      : {}),
  } satisfies components['schemas']['DeploymentSummaryResponse'];
});
route('GET', '/v1/apps/{slug}/metrics', ({ params, query }) =>
  db.metricsFor(app(params.slug), query.get('range') ?? '24h')
);
route('GET', '/v1/apps/{slug}/slo', ({ params, query }) =>
  appSlo(app(params.slug), sloWindow(query))
);
route('GET', '/v1/apps/{slug}/routes', ({ params }) => db.routesFor(app(params.slug)));

// Per-app config
const listOf = <T>(map: Map<string, T[]>, slug: string) => map.get(app(slug).slug) ?? [];

route('GET', '/v1/apps/{slug}/secrets', ({ params }) => {
  const secrets = listOf(db.secrets, params.slug);
  return { secrets, quota_max: 64, count: secrets.length };
});
route('PUT', '/v1/apps/{slug}/secrets/{key}', ({ params, query }) => {
  const list = listOf(db.secrets, params.slug);
  const existing = list.find((s) => s.key === params.key);
  const now = db.iso(0);
  const before = configState(params.slug, 'default');
  const receipt = () =>
    recordConfigChange(params.slug, 'default', 'secret.set', params.key, before, query);
  if (existing) {
    // A new value is a new delivery version; the mock delivers it at once.
    existing.updated_at = now;
    existing.delivery_version += 1;
    existing.delivered_version = existing.delivery_version;
    existing.delivery_status = 'delivered';
    return { ...existing, config_change: receipt() };
  }
  const created: (typeof list)[number] = {
    key: params.key,
    scope: 'default',
    secret_class: 'persistent',
    kid: db.id().slice(0, 8),
    delivery_version: 1,
    delivered_version: 1,
    delivery_status: 'delivered',
    created_at: now,
    updated_at: now,
  };
  list.push(created);
  db.secrets.set(params.slug, list);
  return { ...created, config_change: receipt() };
});
route('DELETE', '/v1/apps/{slug}/secrets/{key}', ({ params, query }) => {
  const list = listOf(db.secrets, params.slug);
  const i = list.findIndex((s) => s.key === params.key);
  if (i < 0) throw new Problem(404, 'secret_not_found');
  const before = configState(params.slug, 'default');
  list.splice(i, 1);
  recordConfigChange(params.slug, 'default', 'secret.delete', params.key, before, query);
  return NO_CONTENT;
});

// Dev-only plaintext values belong to env, never the sealed-secret fixtures.
const envValues = new Map<string, string>();
const envValueKey = (slug: string, scope: string, key: string) =>
  `${db.appBySlug(slug)?.id ?? slug}/${scope}/${key}`;
for (const [slug, rows] of db.env)
  for (const row of rows)
    envValues.set(
      envValueKey(slug, row.scope, row.key),
      row.key === 'LOG_LEVEL' ? 'info' : row.key === 'NODE_ENV' ? 'production' : 'mock-value'
    );
const envScope = (query: URLSearchParams) => {
  const scope = query.get('scope') || 'default';
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(scope)) throw new Problem(400, 'env_scope_invalid');
  return scope;
};

// --- Config history and guard (faas ADR-1451) ---------------------------------

/** The scope's variables and secret versions, as a revision records them. */
function configState(slug: string, scope: string): configHistory.ConfigState {
  const variables: Record<string, string> = {};
  for (const row of listOf(db.env, slug))
    if (row.scope === scope)
      variables[row.key] = envValues.get(envValueKey(slug, scope, row.key)) ?? '';
  const secret_versions: Record<string, number> = {};
  for (const row of listOf(db.secrets, slug))
    if (row.scope === scope) secret_versions[row.key] = row.delivery_version;
  return { variables, secret_versions };
}
/** A guard opens only when asked (`?guard=false` opts out) and the app has a live deployment. */
function recordConfigChange(
  slug: string,
  scope: string,
  source: Parameters<typeof configHistory.recordChange>[0]['source'],
  key: string | undefined,
  before: configHistory.ConfigState,
  query: URLSearchParams,
  restored?: number
) {
  const a = app(slug);
  const live = db.deployments.some((d) => d.app_id === a.id && d.status === 'live');
  return configHistory.recordChange({
    slug: a.slug,
    scope,
    source,
    key,
    actor: db.account.email,
    before,
    after: configState(slug, scope),
    guard: query.get('guard') !== 'false' && live,
    restored,
  });
}
db.apps.forEach((a, i) =>
  configHistory.seedHistory(a.slug, configState(a.slug, 'default'), {
    watching: i === 0,
    iso: db.iso,
  })
);
const revisionLimit = (query: URLSearchParams) => {
  const raw = query.get('limit');
  if (raw == null) return 20;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 100)
    throw new Problem(400, 'validation_failed', 'limit must be between 1 and 100');
  return n;
};
route('GET', '/v1/apps/{slug}/config/revisions', ({ params, query }) =>
  configHistory.listRevisions(app(params.slug).slug, envScope(query), revisionLimit(query))
);
route('GET', '/v1/apps/{slug}/config/revisions/{revision}', ({ params, query }) => {
  const scope = envScope(query);
  const n = Number(params.revision);
  if (!Number.isInteger(n) || n < 1)
    throw new Problem(400, 'validation_failed', 'revision must be a positive integer');
  const found = configHistory.getRevision(app(params.slug).slug, scope, n);
  if (!found)
    throw new Problem(
      404,
      'config_revision_not_found',
      `Scope "${scope}" has no config revision ${n}.`
    );
  return found;
});
route('GET', '/v1/apps/{slug}/config/guard', ({ params, query }) => {
  const scope = envScope(query);
  const guard = configHistory.latestGuard(app(params.slug).slug, scope);
  if (!guard)
    throw new Problem(
      404,
      'config_guard_not_found',
      `No config change in scope "${scope}" has been guarded.`
    );
  return guard;
});
route('POST', '/v1/apps/{slug}/config/rollback', ({ params, body, query }) => {
  const n = Number(body.revision);
  if (!Number.isInteger(n) || n < 1)
    throw new Problem(400, 'validation_failed', 'body must name a positive revision');
  const scope = envScope(query);
  const slug = app(params.slug).slug;
  const target = configHistory.getRevision(slug, scope, n);
  if (!target)
    throw new Problem(
      404,
      'config_revision_not_found',
      `Scope "${scope}" has no config revision ${n}.`
    );
  const before = configState(slug, scope);
  const { set, deleted } = configHistory.variablesToward(target.variables, before.variables);
  const out: components['schemas']['ConfigRollbackResponse'] = {
    restored_revision: n,
    set,
    deleted,
    secrets_not_restored: configHistory.secretsDiffering(
      target.secret_versions,
      before.secret_versions
    ),
  };
  if (set.length === 0 && deleted.length === 0) return out;
  const list = listOf(db.env, slug);
  const now = db.iso(0);
  for (const key of set) {
    envValues.set(envValueKey(slug, scope, key), target.variables[key]);
    const row = list.find((r) => r.key === key && r.scope === scope);
    if (row) row.updated_at = now;
    else list.push({ key, scope, created_at: now, updated_at: now });
  }
  for (const key of deleted) {
    const i = list.findIndex((r) => r.key === key && r.scope === scope);
    if (i >= 0) list.splice(i, 1);
    envValues.delete(envValueKey(slug, scope, key));
  }
  db.env.set(slug, list);
  out.change = recordConfigChange(slug, scope, 'config.rollback', undefined, before, query, n);
  return out;
});
route('GET', '/v1/apps/{slug}/env', ({ params, query }) => {
  const all = listOf(db.env, params.slug);
  if (query.get('scope') === '__all__')
    return {
      env: [],
      env_by_scope: all.reduce<Record<string, typeof all>>((groups, row) => {
        (groups[row.scope] ??= []).push(row);
        return groups;
      }, {}),
      quota_max: 128,
      count: all.length,
    };
  const scope = envScope(query);
  return { env: all.filter((row) => row.scope === scope), quota_max: 128, count: all.length };
});
route('PUT', '/v1/apps/{slug}/env/{key}', ({ params, body, query }) => {
  const scope = envScope(query);
  if (!/^[A-Z][A-Z0-9_]*$/.test(params.key) || params.key.length > 128)
    throw new Problem(400, 'env_var_invalid_key');
  const list = listOf(db.env, params.slug);
  const existing = list.find((entry) => entry.key === params.key && entry.scope === scope);
  const now = db.iso(0);
  if (!existing && list.length >= 128) throw new Problem(403, 'plan_limit_env_vars');
  const before = configState(params.slug, scope);
  envValues.set(envValueKey(params.slug, scope, params.key), String(body.value ?? ''));
  const receipt = () =>
    recordConfigChange(params.slug, scope, 'env.set', params.key, before, query);
  if (existing) {
    existing.updated_at = now;
    return { ...existing, config_change: receipt() };
  }
  const created = { key: params.key, scope, created_at: now, updated_at: now };
  list.push(created);
  db.env.set(params.slug, list);
  return { ...created, config_change: receipt() };
});
route('DELETE', '/v1/apps/{slug}/env/{key}', ({ params, query }) => {
  const scope = envScope(query);
  const list = listOf(db.env, params.slug);
  const index = list.findIndex((entry) => entry.key === params.key && entry.scope === scope);
  if (index < 0) throw new Problem(404, 'env_not_found');
  const before = configState(params.slug, scope);
  list.splice(index, 1);
  envValues.delete(envValueKey(params.slug, scope, params.key));
  recordConfigChange(params.slug, scope, 'env.delete', params.key, before, query);
  return NO_CONTENT;
});
route('GET', '/v1/apps/{slug}/upstreams', ({ params }) => {
  const upstreams = listOf(db.upstreams, params.slug);
  return { upstreams, quota_max: 16, count: upstreams.length };
});
route('PUT', '/v1/apps/{slug}/upstreams', ({ params, body }) => {
  app(params.slug);
  const host = String(body.host ?? '').trim();
  if (!body.kind || !host || !body.port)
    throw new Problem(400, 'missing_field', 'kind, host, and port are required.');
  const list = listOf(db.upstreams, params.slug);
  const up: (typeof list)[number] = {
    id: db.id(),
    source: 'explicit',
    kind: body.kind as (typeof list)[number]['kind'],
    host_redacted_hash: db.id().slice(0, 16),
    host_last4: host.slice(-4),
    port: Number(body.port),
    scope: body.scope ? String(body.scope) : undefined,
    created_at: db.iso(0),
    last_seen_at: db.iso(0),
  };
  list.push(up);
  db.upstreams.set(params.slug, list);
  return status(201, up);
});
route('DELETE', '/v1/apps/{slug}/upstreams/{id}', ({ params }) => {
  const list = listOf(db.upstreams, params.slug);
  const i = list.findIndex((u) => u.id === params.id);
  if (i < 0) throw new Problem(404, 'upstream_not_found');
  list.splice(i, 1);
  return NO_CONTENT;
});
const alertPresets = [
  {
    id: 'preset-error-rate',
    name: 'error_rate_2pct',
    display_name: 'Error rate exceeds 2%',
    description: 'Fires when the rolling 15-minute error rate exceeds 2%.',
    category: 'reliability',
    metric: 'error_rate_pct',
    comparison: 'gt',
    threshold: 2,
    window_spec: '15m',
    default_cooldown_minutes: 15,
    minimum_plan: 'hobby',
    enabled_in_catalog: true,
  },
  {
    id: 'preset-latency',
    name: 'latency_p99_1s',
    display_name: 'p99 latency over 1s',
    description: 'Fires when the 99th percentile stays above one second for an hour.',
    category: 'availability',
    metric: 'latency_p99_ms',
    comparison: 'gt',
    threshold: 1000,
    window_spec: '1h',
    default_cooldown_minutes: 30,
    minimum_plan: 'pro',
    enabled_in_catalog: true,
  },
  {
    id: 'preset-cold-starts',
    name: 'cold_start_50pct',
    display_name: 'Cold starts over 50%',
    description: 'Most requests are waking the app; consider a warm instance.',
    category: 'cost',
    metric: 'cold_start_pct',
    comparison: 'gt',
    threshold: 50,
    window_spec: '6h',
    default_cooldown_minutes: 60,
    minimum_plan: 'free',
    enabled_in_catalog: true,
  },
];

route('GET', '/v1/alert-presets', () => alertPresets);

route('POST', '/v1/apps/{slug}/alert-presets/{name}/enable', ({ params, body }) => {
  const preset = alertPresets.find((p) => p.name === params.name);
  if (!preset) throw new Problem(404, 'preset_not_found');
  // The account is on hobby in the mock, so a pro preset shows the plan gate.
  if (preset.minimum_plan === 'pro' || preset.minimum_plan === 'scale') {
    throw new Problem(402, 'plan_required', `This preset needs the ${preset.minimum_plan} plan.`);
  }
  const a = app(params.slug);
  const list = listOf(db.alerts, params.slug);
  const rule: (typeof list)[number] = {
    id: db.id(),
    app_id: a.id,
    name: preset.display_name,
    enabled: body.enabled !== false,
    metric: preset.metric as (typeof list)[number]['metric'],
    comparison: preset.comparison as (typeof list)[number]['comparison'],
    threshold: preset.threshold,
    window_spec: preset.window_spec as (typeof list)[number]['window_spec'],
    webhook_url: String(body.webhook_url ?? ''),
    webhook_secret_sealed_masked: '***',
    cooldown_minutes: preset.default_cooldown_minutes,
    action: 'webhook',
    state: 'ok',
    created_at: db.iso(0),
    updated_at: db.iso(0),
  };
  list.push(rule);
  db.alerts.set(params.slug, list);
  return status(201, rule);
});

route('POST', '/v1/apps/{slug}/alert-presets/{name}/test', ({ params }) => {
  const preset = alertPresets.find((p) => p.name === params.name);
  if (!preset) throw new Problem(404, 'preset_not_found');
  const exists = listOf(db.alerts, params.slug).some((r) => r.name === preset.display_name);
  if (!exists) throw new Problem(404, 'not_found', 'This preset is not enabled on the app.');
  return { status: 'sent', is_test: true };
});

route('GET', '/v1/apps/{slug}/alerts', ({ params }) => listOf(db.alerts, params.slug));
route('POST', '/v1/apps/{slug}/alerts', ({ params, body }) => {
  const a = app(params.slug);
  if (!body.name || !body.metric || !body.webhook_url)
    throw new Problem(400, 'missing_field', 'name, metric, and webhook_url are required.');
  const list = listOf(db.alerts, params.slug);
  const rule: (typeof list)[number] = {
    id: db.id(),
    app_id: a.id,
    name: String(body.name),
    enabled: body.enabled !== false,
    metric: body.metric as (typeof list)[number]['metric'],
    comparison: (body.comparison ?? 'gt') as (typeof list)[number]['comparison'],
    threshold: Number(body.threshold ?? 0),
    window_spec: (body.window_spec ?? '15m') as (typeof list)[number]['window_spec'],
    webhook_url: String(body.webhook_url),
    webhook_secret_sealed_masked: '***',
    cooldown_minutes: Number(body.cooldown_minutes ?? 30),
    action: (body.action ?? 'webhook') as (typeof list)[number]['action'],
    state: 'ok',
    created_at: db.iso(0),
    updated_at: db.iso(0),
  };
  list.push(rule);
  db.alerts.set(params.slug, list);
  return status(201, rule);
});
// Deliveries: one delivered, one failed with a real reason, and one test row
// that only appears when include_test is set — so both branches of the toggle
// are visible without a live webhook.
route('GET', '/v1/apps/{slug}/alerts/{id}/deliveries', ({ params, query }) => {
  const rule = listOf(db.alerts, params.slug).find((r) => r.id === params.id);
  if (!rule) throw new Problem(404, 'alert_not_found');
  const base = {
    rule_id: rule.id,
    account_id: 'acct-1',
    app_id: rule.app_id,
    observed_value: 12.5,
  };
  const rows = [
    {
      ...base,
      id: db.id(),
      idempotency_key: `${rule.id}:1`,
      status: 'delivered',
      attempt_count: 1,
      last_status_code: 200,
      fired_at: new Date(Date.now() - 3600_000).toISOString(),
      delivered_at: new Date(Date.now() - 3599_000).toISOString(),
      is_test: false,
    },
    {
      ...base,
      id: db.id(),
      idempotency_key: `${rule.id}:2`,
      status: 'failed',
      attempt_count: 3,
      last_status_code: 502,
      last_error: 'upstream refused the connection',
      observed_value: 31.2,
      fired_at: new Date(Date.now() - 7200_000).toISOString(),
      is_test: false,
    },
    {
      ...base,
      id: db.id(),
      idempotency_key: `${db.id()}:test`,
      status: 'delivered',
      attempt_count: 1,
      last_status_code: 200,
      fired_at: new Date(Date.now() - 600_000).toISOString(),
      delivered_at: new Date(Date.now() - 599_000).toISOString(),
      is_test: true,
    },
  ];
  return query.get('include_test') === 'true' ? rows : rows.filter((r) => !r.is_test);
});

route('PATCH', '/v1/apps/{slug}/alerts/{id}', ({ params, body }) => {
  const rule = listOf(db.alerts, params.slug).find((r) => r.id === params.id);
  if (!rule) throw new Problem(404, 'alert_rule_not_found');
  for (const k of [
    'name',
    'enabled',
    'metric',
    'comparison',
    'threshold',
    'window_spec',
    'webhook_url',
    'cooldown_minutes',
  ] as const)
    if (k in body && body[k] != null) (rule as Record<string, unknown>)[k] = body[k];
  rule.updated_at = db.iso(0);
  return rule;
});
route('POST', '/v1/apps/{slug}/alerts/{id}/rotate-secret', ({ params }) => {
  const rule = listOf(db.alerts, params.slug).find((r) => r.id === params.id);
  if (!rule) throw new Problem(404, 'alert_rule_not_found');
  rule.updated_at = db.iso(0);
  return { rotated_at: rule.updated_at, webhook_secret_sealed_masked: '***' };
});
route('DELETE', '/v1/apps/{slug}/alerts/{id}', ({ params }) => {
  const list = listOf(db.alerts, params.slug);
  const i = list.findIndex((r) => r.id === params.id);
  if (i < 0) throw new Problem(404, 'alert_rule_not_found');
  list.splice(i, 1);
  return NO_CONTENT;
});
// Traffic mirroring (ADR-124 / ADR-125). MOCK_PLAN=free reproduces the
// create-time plan gate; the list is never gated, as in apid.
// Pro allows one mirror rule per app, Scale three.
const mirrorQuota = () => (db.account.plan === 'scale' ? 3 : 1);
const MIRROR_WINDOW_SECONDS: Record<string, number> = { '1h': 3600, '24h': 86400, '7d': 604800 };

function mirrorRule(slug: string, id: string) {
  const rule = listOf(db.mirrorRules, slug).find((r) => r.id === id);
  if (!rule) throw new Problem(404, 'not_found', 'no such mirror rule');
  return rule;
}

route('GET', '/v1/apps/{slug}/mirrors', ({ params }) => {
  const rules = listOf(db.mirrorRules, params.slug);
  return { rules, count: rules.length };
});
route('POST', '/v1/apps/{slug}/mirrors', ({ params, body }) => {
  const a = app(params.slug);
  if (process.env.MOCK_PLAN === 'free')
    throw new Problem(
      403,
      'plan_mirror_not_allowed',
      'traffic mirroring needs the Pro or Scale plan.'
    );
  const list = listOf(db.mirrorRules, a.slug);
  const source = String(body.source_deployment_id ?? '');
  const mirror = String(body.mirror_deployment_id ?? '');
  const percent = Number(body.percent);
  if (!Number.isInteger(percent) || percent < 0 || percent > 100)
    throw new Problem(422, 'invalid_mirror_percent', 'percent must be in [0, 100].');
  if (source === mirror)
    throw new Problem(422, 'mirror_source_target_same', 'source and mirror must differ.');
  const s = db.deployments.find((d) => d.id === source);
  const m = db.deployments.find((d) => d.id === mirror);
  if (!s || !m) throw new Problem(404, 'not_found', 'no such deployment');
  if (s.app_id !== a.id || m.app_id !== a.id)
    throw new Problem(422, 'mirror_cross_app_mismatch', 'both deployments must belong to the app.');
  if (s.status !== 'live' || m.status !== 'live')
    throw new Problem(409, 'mirror_deployment_not_live', 'both deployments must be live.');
  if (list.length >= mirrorQuota())
    throw new Problem(
      422,
      'mirror_rule_quota_exceeded',
      `at most ${mirrorQuota()} mirror rules per app on the ${db.account.plan} plan.`
    );
  const rule: (typeof list)[number] = {
    id: db.id(),
    account_id: db.ACCOUNT_ID,
    app_id: a.id,
    source_deployment_id: source,
    mirror_deployment_id: mirror,
    percent,
    enabled: true,
    include_body: body.include_body === true,
    allow_unsafe_methods: body.allow_unsafe_methods === true,
    redact_headers: Array.isArray(body.redact_headers) ? body.redact_headers.map(String) : [],
    always_stripped_headers: ['Authorization', 'Cookie'],
    created_at: db.iso(0),
    updated_at: db.iso(0),
  };
  list.push(rule);
  db.mirrorRules.set(a.slug, list);
  return status(201, rule);
});
route('GET', '/v1/apps/{slug}/mirrors/{id}', ({ params }) => mirrorRule(params.slug, params.id));
route('PATCH', '/v1/apps/{slug}/mirrors/{id}', ({ params, body }) => {
  const rule = mirrorRule(params.slug, params.id);
  if (body.percent !== undefined) {
    const percent = Number(body.percent);
    if (!Number.isInteger(percent) || percent < 0 || percent > 100)
      throw new Problem(422, 'invalid_mirror_percent', 'percent must be in [0, 100].');
    rule.percent = percent;
  }
  if (typeof body.enabled === 'boolean') rule.enabled = body.enabled;
  if (typeof body.include_body === 'boolean') rule.include_body = body.include_body;
  if (Array.isArray(body.redact_headers)) rule.redact_headers = body.redact_headers.map(String);
  rule.updated_at = db.iso(0);
  return rule;
});
route('DELETE', '/v1/apps/{slug}/mirrors/{id}', ({ params }) => {
  const list = listOf(db.mirrorRules, params.slug);
  const i = list.findIndex((r) => r.id === params.id);
  if (i < 0) throw new Problem(404, 'not_found', 'no such mirror rule');
  list.splice(i, 1);
  return NO_CONTENT;
});
route('GET', '/v1/apps/{slug}/mirrors/{id}/summary', ({ params, query }) => {
  const rule = mirrorRule(params.slug, params.id);
  const window = query.get('window') ?? '1h';
  const seconds = MIRROR_WINDOW_SECONDS[window];
  if (!seconds) throw new Problem(422, 'invalid_mirror_window', 'window must be 1h, 24h or 7d.');
  // Deterministic drift proportional to the window and the mirrored share,
  // so switching windows visibly changes the counts.
  const total = rule.enabled ? Math.round((seconds / 3600) * rule.percent * 4.2) : 0;
  return {
    total_invocations: total,
    status_diff_count: Math.round(total * 0.012),
    schema_diff_count: Math.round(total * 0.004),
    body_diff_count: rule.include_body ? Math.round(total * 0.03) : 0,
    mean_latency_diff_ms: total === 0 ? 0 : 12,
    p99_latency_diff_ms: total === 0 ? 0 : -8,
    crash_count: Math.round(total * 0.0005),
    window_seconds: seconds,
  };
});

// Tenant surfaces (ADR-100). MOCK_PLAN=free reproduces the 402 gate, which
// apid applies to every route in the family, the list included.
const TENANT_SURFACE_QUOTA = 5;
const TENANT_HOSTNAME_QUOTA = 20;

function gateTenantSurfaces() {
  if (process.env.MOCK_PLAN === 'free')
    throw new Problem(
      402,
      'tenant_surfaces_not_allowed',
      'tenant surfaces need the Pro or Scale plan.'
    );
}

function tenantSurface(slug: string, id: string) {
  const surface = listOf(db.tenantSurfaces, slug).find((s) => s.id === id);
  if (!surface) throw new Problem(404, 'not_found', 'no such tenant surface');
  return surface;
}

function tenantHostnameTaken(hostname: string) {
  for (const surfaces of db.tenantSurfaces.values())
    for (const s of surfaces) if (s.hostnames.some((h) => h.hostname === hostname)) return true;
  return false;
}

function newTenantHostname(hostname: string) {
  const token = `gregale-verify-${db.id().slice(0, 12)}`;
  return {
    hostname,
    challenge_token: token,
    verified: false,
    verified_at: null,
    last_error: null,
    txt_record: `_gregale-challenge.${hostname} TXT "${token}"`,
  };
}

function canonicalHostname(value: unknown) {
  const hostname = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(hostname))
    throw new Problem(400, 'validation_failed', `"${hostname}" is not a hostname.`);
  if (tenantHostnameTaken(hostname))
    throw new Problem(
      409,
      'tenant_hostname_already_claimed',
      `${hostname} is already claimed by a surface.`
    );
  return hostname;
}

route('GET', '/v1/apps/{slug}/tenant-surfaces', ({ params }) => {
  gateTenantSurfaces();
  return { surfaces: listOf(db.tenantSurfaces, params.slug) };
});
route('POST', '/v1/apps/{slug}/tenant-surfaces', ({ params, body }) => {
  gateTenantSurfaces();
  const a = app(params.slug);
  const list = listOf(db.tenantSurfaces, a.slug);
  const name = String(body.name ?? '').trim();
  if (!name) throw new Problem(400, 'validation_failed', 'name is required.');
  if (body.cert_kind !== undefined && body.cert_kind !== 'per_host_san')
    throw new Problem(400, 'tenant_surface_cert_kind_invalid', 'cert_kind must be per_host_san.');
  if (list.length >= TENANT_SURFACE_QUOTA)
    throw new Problem(
      403,
      'tenant_surface_quota',
      `at most ${TENANT_SURFACE_QUOTA} tenant surfaces per app on this plan.`
    );
  const seeds = Array.isArray(body.hostnames) ? body.hostnames.map(canonicalHostname) : [];
  const surface: (typeof list)[number] = {
    id: db.id(),
    account_id: db.ACCOUNT_ID,
    app_id: a.id,
    name,
    cert_kind: 'per_host_san',
    status: 'pending',
    cert_state: seeds.length ? 'pending' : 'none',
    cert_last_error: null,
    created_at: db.iso(0),
    updated_at: db.iso(0),
    hostnames: seeds.map(newTenantHostname),
  };
  list.push(surface);
  db.tenantSurfaces.set(a.slug, list);
  return status(202, surface);
});
route('GET', '/v1/apps/{slug}/tenant-surfaces/{id}', ({ params }) => {
  gateTenantSurfaces();
  return tenantSurface(params.slug, params.id);
});
route('DELETE', '/v1/apps/{slug}/tenant-surfaces/{id}', ({ params }) => {
  gateTenantSurfaces();
  const list = listOf(db.tenantSurfaces, params.slug);
  const i = list.findIndex((s) => s.id === params.id);
  if (i < 0) throw new Problem(404, 'not_found', 'no such tenant surface');
  list.splice(i, 1);
  return NO_CONTENT;
});
route('POST', '/v1/apps/{slug}/tenant-surfaces/{id}/hostnames', ({ params, body }) => {
  gateTenantSurfaces();
  const surface = tenantSurface(params.slug, params.id);
  if (surface.hostnames.length >= TENANT_HOSTNAME_QUOTA)
    throw new Problem(
      403,
      'tenant_hostname_quota',
      `at most ${TENANT_HOSTNAME_QUOTA} hostnames per surface on this plan.`
    );
  const h = newTenantHostname(canonicalHostname(body.hostname));
  surface.hostnames.push(h);
  if (surface.cert_state === 'none') surface.cert_state = 'pending';
  surface.updated_at = db.iso(0);
  return status(202, h);
});
route('DELETE', '/v1/apps/{slug}/tenant-surfaces/{id}/hostnames/{hostname}', ({ params }) => {
  gateTenantSurfaces();
  const surface = tenantSurface(params.slug, params.id);
  const i = surface.hostnames.findIndex((h) => h.hostname === params.hostname.toLowerCase());
  if (i < 0) throw new Problem(404, 'not_found', 'no such hostname on this surface');
  surface.hostnames.splice(i, 1);
  surface.updated_at = db.iso(0);
  return NO_CONTENT;
});

// OpenAPI import (ADR-126). Limits are abuse caps, not plan tiers; the
// per-deployment discovery doc (ADR-122) is the paid-plan surface.
const OPENAPI_MAX_ENDPOINTS = 50;
const OPENAPI_MAX_BYTES = 256 * 1024;
const OPENAPI_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

function validateOpenAPIDoc(body: Record<string, unknown>) {
  if (Object.keys(body).length === 0) throw new Problem(400, 'empty_body', 'Body is zero bytes.');
  const bytes = Buffer.byteLength(JSON.stringify(body));
  if (bytes > OPENAPI_MAX_BYTES)
    throw new Problem(
      413,
      'openapi_import_too_large',
      `Document is ${bytes} bytes; the cap is 256 KiB.`
    );
  const version = body.openapi;
  const info = body.info;
  const paths = body.paths;
  if (
    typeof version !== 'string' ||
    !/^3\.[01]\.\d+$/.test(version) ||
    typeof info !== 'object' ||
    info === null ||
    typeof paths !== 'object' ||
    paths === null
  )
    throw new Problem(
      422,
      'openapi_import_invalid',
      'An OpenAPI 3.0 or 3.1 document needs openapi, info and paths.'
    );
  const endpoints: { path: string; methods: string[] }[] = [];
  for (const [path, item] of Object.entries(paths as Record<string, unknown>)) {
    const methods =
      typeof item === 'object' && item !== null
        ? Object.keys(item).filter((k) => OPENAPI_METHODS.includes(k))
        : [];
    endpoints.push({ path, methods });
  }
  const count = endpoints.reduce((n, e) => n + e.methods.length, 0);
  if (count > OPENAPI_MAX_ENDPOINTS)
    throw new Problem(
      422,
      'openapi_import_too_many_endpoints',
      `${count} endpoints; the cap is ${OPENAPI_MAX_ENDPOINTS}.`
    );
  return { version, endpoints, count, bytes };
}

route('GET', '/v1/apps/{slug}/openapi', ({ params, query, res }) => {
  const a = app(params.slug);
  const source = query.get('source') ?? 'manual_import';
  if (source === 'dry_run')
    throw new Problem(405, 'dry_run_requires_post', 'dry-run is POST-only.');
  if (source !== 'manual_import' && source !== 'auto')
    throw new Problem(400, 'invalid_source', 'source must be manual_import or auto.');
  const doc = db.appOpenAPIDocs.get(a.slug);
  if (source === 'manual_import') {
    if (!doc) throw new Problem(404, 'not_found', 'No imported OpenAPI document for this app.');
    res.setHeader('X-OpenAPI-Doc-Source', 'manual_import');
    return doc;
  }
  // auto: the import merged with the observed routes and the edge rules.
  const rules = db.edgeRules.filter((r) => r.app_id === a.id);
  const merged: Record<string, unknown> = doc
    ? structuredClone(doc)
    : { openapi: '3.1.0', info: { title: a.slug, version: 'auto' }, paths: {} };
  const paths = merged.paths as Record<string, Record<string, unknown>>;
  for (const r of rules) {
    const item = (paths[r.match_path] ??= {});
    const existing = Array.isArray(item['x-faas-edge-rules']) ? item['x-faas-edge-rules'] : [];
    item['x-faas-edge-rules'] = [...existing, { id: r.id, kind: r.kind, priority: r.priority }];
  }
  res.setHeader('X-OpenAPI-Doc-Source', doc ? 'auto' : 'empty: no_import_no_rules');
  res.setHeader('X-Faas-Cache', 'miss');
  res.setHeader('X-OpenAPI-Doc-Annotations-Count', String(rules.length));
  return merged;
});
route('GET', '/v1/apps/{slug}/openapi/preview', ({ params }) => {
  const a = app(params.slug);
  return mockOpenAPIPreview(
    a.id,
    db.appOpenAPIDocs.get(a.slug),
    db.routesFor(a).routes,
    db.edgeRules.filter((rule) => rule.app_id === a.id)
  );
});
route('POST', '/v1/apps/{slug}/openapi', ({ params, body }) => {
  const a = app(params.slug);
  const { version, count, bytes } = validateOpenAPIDoc(body);
  db.appOpenAPIDocs.set(a.slug, body);
  return {
    app_id: a.id,
    source: 'manual_import',
    openapi_version: version,
    endpoint_count: count,
    byte_size: bytes,
    captured_at: db.iso(0),
    updated_at: db.iso(0),
  };
});
route('DELETE', '/v1/apps/{slug}/openapi', ({ params }) => {
  db.appOpenAPIDocs.delete(app(params.slug).slug);
  return NO_CONTENT;
});
route('POST', '/v1/apps/{slug}/openapi/dry-run', ({ params, body }) => {
  const a = app(params.slug);
  const { version, endpoints, count } = validateOpenAPIDoc(body);
  const covered = new Set(
    db.edgeRules.filter((r) => r.app_id === a.id && r.kind === 'validate').map((r) => r.match_path)
  );
  const suggestions = endpoints
    .filter((e) => e.methods.length > 0 && !covered.has(e.path))
    .map((e) => ({
      path: e.path,
      methods: e.methods,
      kind: 'validate',
      action: {
        schema: { type: 'object' },
        content_types: ['application/json'],
        validate_mode: 'observe',
      },
    }));
  return { suggestions, openapi_version: version, endpoint_count: count };
});
route('GET', '/v1/apps/{slug}/deployments/{deployment}/openapi', ({ params, res }) => {
  const a = app(params.slug);
  if (db.account.plan === 'free' || process.env.MOCK_PLAN === 'free')
    throw new Problem(
      402,
      'openapi_docs_not_allowed',
      'endpoint discovery needs the Hobby plan or higher.'
    );
  const d = db.deployments.find((x) => x.id === params.deployment && x.app_id === a.id);
  const doc = d && db.deploymentOpenAPIDocs.get(d.id);
  if (!doc) throw new Problem(404, 'not_found', 'No document captured for this deployment.');
  res.setHeader('X-OpenAPI-Doc-Source', 'cold_boot');
  res.setHeader('Cache-Control', 'private, max-age=300');
  return doc;
});

// Per-app singles: wake timeline, usage summary, env diff, static egress IP
// (ADR-119, Scale-only: MOCK_PLAN=scale unlocks it), streaming probe (ADR-102).
const staticEgressPins = new Map<string, { ip: string; set_at: string }>();
const WAKE_TRIGGERS = ['manual.api', 'http.request', 'cron.fired', 'queue.message'];
const WAKE_CLASSES = ['user', 'user', 'user', 'monitor', 'crawler'] as const;

route('GET', '/v1/apps/{slug}/wake-timeline', ({ params }) => {
  const a = app(params.slug);
  if (process.env.MOCK_PLAN === 'free')
    throw new Problem(
      402,
      'plan_per_app_metrics_not_allowed',
      'the free plan does not include per-app metrics; upgrade to Hobby or above.'
    );
  const now = Date.now();
  const rows = Array.from({ length: 12 }, (_, i) => {
    const tier = i % 5 === 0 ? 'init' : i % 7 === 0 ? 'cold_boot_fallback' : 'warm';
    const queued = i % 4 === 0 ? 2 : 0;
    return {
      kind: 'wake.boot_started' as const,
      state: 'RUNNING',
      at: new Date(now - (i * 97 + 3) * 60_000).toISOString(),
      wake_id: db.id(),
      trigger: WAKE_TRIGGERS[i % WAKE_TRIGGERS.length],
      trigger_class: WAKE_CLASSES[i % WAKE_CLASSES.length],
      method: 'GET',
      tier,
      queued_count: queued,
      concurrency_at_admit: 1 + (i % 3),
      at_capacity: queued > 0,
      at_capacity_present: true,
      ready_in_ms: tier === 'warm' ? 180 + i * 7 : tier === 'init' ? 1240 + i * 30 : 2960,
    };
  });
  const histogram = (key: 'trigger' | 'trigger_class') =>
    rows.reduce<Record<string, number>>((acc, r) => {
      acc[r[key]] = (acc[r[key]] ?? 0) + 1;
      return acc;
    }, {});
  const atCapacity = rows.filter((r) => r.at_capacity).length;
  return {
    app: { app_id: a.id, slug: a.slug, status: a.status, url: a.url },
    wake_count_24h: rows.length,
    wake_count_with_meta: rows.length,
    at_capacity_count: atCapacity,
    at_capacity_pct: Math.round((atCapacity / rows.length) * 1000) / 10,
    trigger_histogram: histogram('trigger'),
    trigger_class_histogram: histogram('trigger_class'),
    rows,
    as_of: new Date(now).toISOString(),
  };
});

route('GET', '/v1/apps/{slug}/usage', ({ params }) => {
  const a = app(params.slug);
  if (process.env.MOCK_PLAN === 'free')
    throw new Problem(
      402,
      'plan_app_usage_summary_not_allowed',
      'the free plan does not include the per-app usage summary; upgrade to Hobby or above.'
    );
  const gbHours = Math.round(a.ram_mb * 0.0417 * 100) / 100;
  return {
    slug: a.slug,
    period_start: db.iso(30 * 24 * 3_600_000),
    period_end: db.iso(0),
    mb_seconds: Math.round(gbHours * 1024 * 3600),
    gb_hours: gbHours,
    requests: 8421 * (1 + (a.ram_mb % 7)),
    tx_bytes: 94_371_840 * (1 + (a.ram_mb % 3)),
    builder_seconds: 192.5,
    cold_boot_count: 14,
    plan_included_gb_hours: db.account.limits.included_gb_hours,
    overage_gb_hours: Math.max(0, gbHours - db.account.limits.included_gb_hours),
    source: 'usage_minutes',
    as_of: db.iso(0),
  };
});

route('GET', '/v1/apps/{slug}/env-diff', ({ params }) => {
  const a = app(params.slug);
  const scopes = ['production', 'preview'];
  const hash = (s: string) => {
    let h = 0;
    for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return h.toString(16).padStart(8, '0');
  };
  const rows = [
    ...listOf(db.env, a.slug).map((e, i) => ({
      key: e.key,
      kind: 'env' as const,
      cells: {
        // Env vars are plain configuration, so the diff carries their values;
        // the list endpoint does not return them, so dev values stand in.
        production: { present: true, value: `${e.key.toLowerCase()}-value` },
        preview:
          i % 3 === 2
            ? { present: false }
            : {
                present: true,
                value:
                  i % 3 === 1 ? `${e.key.toLowerCase()}-preview` : `${e.key.toLowerCase()}-value`,
              },
      },
    })),
    ...listOf(db.secrets, a.slug).map((s, i) => ({
      key: s.key,
      kind: 'secret' as const,
      cells: {
        production: { present: true, value_hash: hash(`${s.key}:prod`) },
        preview: { present: i % 2 === 0, value_hash: hash(`${s.key}:preview`) },
      },
    })),
  ];
  return { app_slug: a.slug, scopes, rows, generated_at: db.iso(0) };
});

const staticEgressAllowed = () => process.env.MOCK_PLAN === 'scale';
route('GET', '/v1/apps/{slug}/static-egress-ip', ({ params }) => {
  const a = app(params.slug);
  const pin = staticEgressPins.get(a.slug);
  return {
    ip: pin?.ip ?? null,
    set_at: pin?.set_at ?? null,
    plan_cap: staticEgressAllowed() ? 1 : 0,
    plan_allowed: staticEgressAllowed(),
  };
});
route('PUT', '/v1/apps/{slug}/static-egress-ip', ({ params, body }) => {
  const a = app(params.slug);
  if (!staticEgressAllowed())
    throw new Problem(
      402,
      'plan_static_egress_ip_not_allowed',
      'static egress IPs need the Scale plan.'
    );
  if (body.set === false || body.ip === '') {
    staticEgressPins.delete(a.slug);
    return { ip: null, set_at: null, plan_cap: 1, plan_allowed: true };
  }
  const ip = String(body.ip ?? '');
  const octets = ip.split('.').map(Number);
  if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255))
    throw new Problem(400, 'validation_failed', `"${ip}" is not an IPv4 address.`);
  if (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168) ||
    octets[0] === 169
  )
    throw new Problem(400, 'validation_failed', 'RFC1918 and link-local ranges cannot be pinned.');
  for (const [slug, pin] of staticEgressPins)
    if (slug !== a.slug && pin.ip === ip)
      throw new Problem(
        403,
        'plan_static_egress_ip_quota',
        `${ip} is already pinned by ${slug}; one app per IP.`
      );
  const pin = { ip, set_at: db.iso(0) };
  staticEgressPins.set(a.slug, pin);
  return { ...pin, plan_cap: 1, plan_allowed: true };
});
route('DELETE', '/v1/apps/{slug}/static-egress-ip', ({ params }) => {
  staticEgressPins.delete(app(params.slug).slug);
  return NO_CONTENT;
});

route('GET', '/v1/apps/{slug}/streaming-cap', ({ params }) => {
  const a = app(params.slug);
  const planAllowed = process.env.MOCK_PLAN !== 'free';
  const flag = a.streaming_enabled ?? false;
  const planCap = planAllowed ? 104_857_600 : 0;
  const status = !planAllowed
    ? 'plan-disallows'
    : !flag
      ? 'flag-disabled'
      : a.slug.includes('json')
        ? 'accept-json-downgrade'
        : 'streaming';
  return {
    app_id: a.id,
    status,
    effective_cap_bytes: status === 'streaming' ? planCap : 0,
    plan_cap_bytes: planCap,
    flag_enabled: flag,
    plan_allowed: planAllowed,
    cap_kind: status === 'streaming' ? 'plan' : 'none',
  };
});

// CORS presets (ADR-129), the template catalog, and preview teardown.
const CORS_PRESET_QUOTA = 10;
type CorsPresetRow = (typeof db.corsPresets)[number];

route('GET', '/v1/cors-presets', ({ query }) => {
  const appId = query.get('app_id');
  if (appId && !db.apps.some((a) => a.id === appId))
    throw new Problem(404, 'not_found', 'no such app');
  return { presets: appId ? db.corsPresets.filter((p) => p.app_id === appId) : db.corsPresets };
});
route('POST', '/v1/cors-presets', ({ body }) => {
  if (process.env.MOCK_PLAN === 'free')
    throw new Problem(
      402,
      'plan_cors_preset_not_allowed',
      'the free plan does not include CORS presets; upgrade to Hobby or above.'
    );
  const name = String(body.name ?? '').trim();
  const origins = Array.isArray(body.allow_origins) ? body.allow_origins.map(String) : [];
  const methods = Array.isArray(body.allow_methods) ? body.allow_methods.map(String) : [];
  const maxAge = Number(body.max_age_seconds);
  if (
    !name ||
    name.length > 64 ||
    origins.length === 0 ||
    methods.length === 0 ||
    !Number.isInteger(maxAge) ||
    maxAge < 0 ||
    maxAge > 86400
  )
    throw new Problem(
      422,
      'cors_preset_invalid',
      'name 1..64, at least one allow_origin and allow_method, max_age 0..86400.'
    );
  if (body.allow_credentials === true && origins.includes('*'))
    throw new Problem(
      422,
      'cors_wildcard_with_credentials',
      'allow_credentials cannot be combined with a wildcard origin.'
    );
  const appId = typeof body.app_id === 'string' && body.app_id ? body.app_id : null;
  if (appId && !db.apps.some((a) => a.id === appId))
    throw new Problem(404, 'cors_preset_app_not_found', 'no such app');
  if (db.corsPresets.length >= CORS_PRESET_QUOTA)
    throw new Problem(
      403,
      'plan_cors_preset_quota_reached',
      `at most ${CORS_PRESET_QUOTA} CORS presets on this plan.`
    );
  if (db.corsPresets.some((p) => p.name === name && (p.app_id ?? null) === appId))
    throw new Problem(
      409,
      'cors_preset_name_conflict',
      `a preset named "${name}" exists in this scope.`
    );
  const preset: CorsPresetRow = {
    id: db.id(),
    account_id: db.ACCOUNT_ID,
    app_id: appId,
    name,
    description: typeof body.description === 'string' ? body.description : undefined,
    allow_origins: origins,
    allow_methods: methods,
    allow_headers: Array.isArray(body.allow_headers) ? body.allow_headers.map(String) : [],
    expose_headers: Array.isArray(body.expose_headers) ? body.expose_headers.map(String) : [],
    allow_credentials: body.allow_credentials === true,
    max_age_seconds: maxAge,
    created_at: db.iso(0),
    updated_at: db.iso(0),
  };
  db.corsPresets.push(preset);
  return status(201, preset);
});
route('GET', '/v1/cors-presets/{id}', ({ params }) => {
  const preset = db.corsPresets.find((p) => p.id === params.id);
  if (!preset) throw new Problem(404, 'not_found', 'no such CORS preset');
  return preset;
});
route('PATCH', '/v1/cors-presets/{id}', ({ params, body }) => {
  const preset = db.corsPresets.find((p) => p.id === params.id);
  if (!preset) throw new Problem(404, 'not_found', 'no such CORS preset');
  if (Object.keys(body).length === 0)
    throw new Problem(422, 'cors_preset_update_requires_field', 'at least one field is required.');
  if (Array.isArray(body.allow_origins)) preset.allow_origins = body.allow_origins.map(String);
  if (Array.isArray(body.allow_methods)) preset.allow_methods = body.allow_methods.map(String);
  if (typeof body.allow_credentials === 'boolean')
    preset.allow_credentials = body.allow_credentials;
  if (typeof body.max_age_seconds === 'number') preset.max_age_seconds = body.max_age_seconds;
  if (preset.allow_credentials && preset.allow_origins.includes('*'))
    throw new Problem(422, 'cors_wildcard_with_credentials', 'credentials with a wildcard origin.');
  preset.updated_at = db.iso(0);
  return preset;
});
route('DELETE', '/v1/cors-presets/{id}', ({ params }) => {
  const i = db.corsPresets.findIndex((p) => p.id === params.id);
  if (i < 0) throw new Problem(404, 'not_found', 'no such CORS preset');
  db.corsPresets.splice(i, 1);
  return NO_CONTENT;
});

route('GET', '/v1/templates', () => db.templates);

route('POST', '/v1/preview/{slug}/destroy', ({ params }) => {
  const i = db.apps.findIndex((a) => a.slug === params.slug && /^pr-\d+-/.test(a.slug));
  if (i < 0)
    throw new Problem(
      404,
      'preview_not_found',
      'the slug does not identify a preview app; use DELETE /v1/apps/{slug} to destroy a production app'
    );
  db.apps.splice(i, 1);
  return NO_CONTENT;
});

// Request analytics, request evidence, app lifecycle, upstream history,
// rollout recovery and the tarball deploy.
type AnalyticsTimeseries = components['schemas']['RequestAnalyticsTimeseriesResponse'];
type AnalyticsGroupBy = NonNullable<AnalyticsTimeseries['group_by']>;
type AnalyticsMethod = NonNullable<AnalyticsTimeseries['method']>;

const ANALYTICS_WINDOW_HOURS: Record<string, number> = { '24h': 24, '3d': 72, '7d': 168 };
const ANALYTICS_GROUPS: Record<AnalyticsGroupBy, string[]> = {
  route: ['/orders', '/orders/{id}', '/health', '/search'],
  country: ['DE', 'TR', 'US', 'FR'],
  referrer_host: ['acme.example', 'news.example', '(direct)'],
  ua_family: ['Chrome', 'Safari', 'curl', 'Googlebot'],
  status: ['200', '404', '500'],
  consumer_id: [
    '3f6c2a1e-8b4d-4c7a-9e21-5d0f7b3a6c48',
    'a91d4e07-2c5b-4f8e-b3a6-7e14c9d02f5b',
    'c2e8f5b3-6a1d-4e9c-8f07-1b4d3a7e9c26',
  ],
};
const ANALYTICS_METHODS = new Set<AnalyticsMethod>([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
]);
const isAnalyticsGroupBy = (value: string): value is AnalyticsGroupBy =>
  Object.hasOwn(ANALYTICS_GROUPS, value);

function analyticsWindow(query: URLSearchParams) {
  const since = query.get('since') ?? '24h';
  const hours = ANALYTICS_WINDOW_HOURS[since];
  // Anything longer than a week is clamped, as the retention does upstream.
  return { since, hours: hours ?? 24, clamped: hours === undefined };
}

route('GET', '/v1/apps/{slug}/analytics', ({ params, query }) => {
  const a = app(params.slug);
  if (process.env.MOCK_PLAN === 'free')
    throw new Problem(
      402,
      'plan_per_app_metrics_not_allowed',
      'the free plan does not include per-app metrics; upgrade to Hobby or above.'
    );
  const { since, hours, clamped } = analyticsWindow(query);
  const groupBy = query.get('group_by') ?? 'route';
  if (!isAnalyticsGroupBy(groupBy))
    throw new Problem(400, 'validation_failed', `unknown group_by "${groupBy}".`);
  const values = ANALYTICS_GROUPS[groupBy];
  const requests = hours * 351;
  const errors = Math.round(requests * 0.0044);
  const group = (value: string, i: number) => {
    const share = [0.44, 0.3, 0.18, 0.08][i] ?? 0.05;
    const rq = Math.round(requests * share);
    const err = Math.round(errors * share);
    return {
      value,
      ...(groupBy === 'route' ? { method: (['GET', 'POST', 'GET', 'PUT'] as const)[i % 4] } : {}),
      requests: rq,
      error_requests: err,
      error_rate_pct: rq === 0 ? 0 : Math.round((err / rq) * 10000) / 100,
      cold_boots: Math.round(rq * 0.0017),
      p50_ms: 42 + i * 9,
      p95_ms: 180 + i * 40,
      p99_ms: 420 + i * 90,
    };
  };
  return {
    slug: a.slug,
    since,
    from: analyticsIso(hours * 3_600_000),
    until: analyticsIso(0),
    window_clamped: clamped,
    requests,
    error_requests: errors,
    error_rate_pct: Math.round((errors / requests) * 10000) / 100,
    cold_boots: Math.round(requests * 0.0017),
    p50_ms: 42,
    p95_ms: 180,
    p99_ms: 420,
    group_by: groupBy,
    groups: values.map(group),
    groups_limit: 50,
    groups_truncated: values.length > 3,
    routes: ANALYTICS_GROUPS.route.map(group),
    routes_limit: 50,
    routes_truncated: false,
    dependencies_truncated: false,
    as_of: analyticsIso(0),
  };
});

function analyticsTimeseries({ params, query }: Parameters<Handler>[0]): AnalyticsTimeseries {
  const a = app(params.slug);
  if (process.env.MOCK_PLAN === 'free')
    throw new Problem(
      402,
      'plan_per_app_metrics_not_allowed',
      'the free plan does not include per-app metrics; upgrade to Hobby or above.'
    );
  const { since, hours, clamped } = analyticsWindow(query);
  const now = ANALYTICS_NOW;
  const unfilteredPoints = Array.from({ length: hours }, (_, i) => {
    const hour = hours - 1 - i;
    // A diurnal shape, so the line is a shape rather than a flat run.
    const at = new Date(now - hour * 3_600_000);
    const wave = Math.sin((at.getUTCHours() / 24) * Math.PI * 2) * 0.4 + 1;
    const requests = Math.round(280 * wave);
    const errors =
      at.getUTCHours() === 3 ? Math.round(requests * 0.11) : Math.round(requests * 0.004);
    return {
      start: new Date(at.setMinutes(0, 0, 0)).toISOString(),
      requests,
      error_requests: errors,
      error_rate_pct: Math.round((errors / requests) * 10000) / 100,
      cold_boots: at.getUTCHours() % 6 === 0 ? 2 : 0,
      p50_ms: Math.round(42 * wave),
      p95_ms: Math.round(180 * wave),
      p99_ms: Math.round(420 * wave),
    };
  });
  const requestedRoute = query.get('route');
  const requestedMethod = query.get('method');
  let routeMethodFilter: { route: string; method: AnalyticsMethod } | undefined;
  if (requestedRoute !== null || requestedMethod !== null) {
    if (requestedRoute === null || requestedMethod === null)
      throw new Problem(400, 'validation_failed', 'route and method must be provided together.');
    if (!ANALYTICS_METHODS.has(requestedMethod as AnalyticsMethod))
      throw new Problem(400, 'validation_failed', `unknown method "${requestedMethod}".`);
    routeMethodFilter = { route: requestedRoute, method: requestedMethod as AnalyticsMethod };
  }
  const scale = (point: (typeof unfilteredPoints)[number], factor: number) => {
    const requests = Math.round(point.requests * factor);
    const errorRequests = Math.min(requests, Math.round(point.error_requests * factor));
    return {
      ...point,
      requests,
      error_requests: errorRequests,
      error_rate_pct: requests === 0 ? 0 : Math.round((errorRequests / requests) * 10000) / 100,
      cold_boots: Math.round(point.cold_boots * factor),
    };
  };
  const points = routeMethodFilter
    ? unfilteredPoints.map((point) => scale(point, 0.44))
    : unfilteredPoints;
  const requestedGroupBy = query.get('group_by');
  if (requestedGroupBy !== null && !isAnalyticsGroupBy(requestedGroupBy))
    throw new Problem(400, 'validation_failed', `unknown group_by "${requestedGroupBy}".`);
  const groupBy = requestedGroupBy ?? undefined;
  if (routeMethodFilter && groupBy !== undefined && groupBy !== 'route')
    throw new Problem(
      400,
      'validation_failed',
      'route and method filters require group_by=route or no group_by.'
    );
  const values = groupBy === undefined ? undefined : ANALYTICS_GROUPS[groupBy];
  const series = values?.map((value, i) => ({
    value,
    ...(groupBy === 'route' ? { method: (['GET', 'POST', 'GET', 'PUT'] as const)[i % 4] } : {}),
    points: points.map((point) => scale(point, [0.44, 0.3, 0.18, 0.08][i] ?? 0.05)),
  }));
  return {
    slug: a.slug,
    ...routeMethodFilter,
    since,
    from: points[0]?.start ?? analyticsIso(hours * 3_600_000),
    until: analyticsIso(0),
    window_clamped: clamped,
    bucket: '1h',
    points,
    ...(groupBy !== undefined ? { group_by: groupBy, series } : {}),
    as_of: analyticsIso(0),
  };
}

route('GET', '/v1/apps/{slug}/analytics/timeseries', analyticsTimeseries);

route('GET', '/v1/apps/{slug}/debug/requests/{req_id}', ({ params }) => {
  gateDebug();
  app(params.slug);
  if (!/^[0-9a-f]{8,}$/.test(params.req_id))
    throw new Problem(404, 'not_found', 'no telemetry for that request id');
  return {
    id: params.req_id,
    deployment_id: db.deployments[0].id,
    route: '/orders/{id}',
    method: 'GET',
    status: 500,
    latency_ms: 2400,
    count: 1,
    cold_boot: false,
    trace_id: db.id() + db.id(),
    received_at: db.iso(120_000),
  };
});

route('GET', '/v1/apps/{slug}/debug/requests/{req_id}/evidence', ({ params }) => {
  gateDebug();
  app(params.slug);
  if (!/^[0-9a-f]{8,}$/.test(params.req_id))
    throw new Problem(404, 'not_found', 'no telemetry for that request id');
  const traceId = db.id() + db.id();
  const spans = [
    {
      trace_id: traceId,
      span_id: db.id().slice(0, 16),
      name: 'GET /orders/{id}',
      kind: 'server',
      duration_nanos: 2_400_000_000,
      status: 'ERROR',
    },
    {
      trace_id: traceId,
      span_id: db.id().slice(0, 16),
      name: 'postgres.query',
      kind: 'client',
      duration_nanos: 2_180_000_000,
      status: 'OK',
      db_statement: 'SELECT * FROM orders WHERE id = $1',
    },
    {
      trace_id: traceId,
      span_id: db.id().slice(0, 16),
      name: 'redis.get',
      kind: 'client',
      duration_nanos: 3_400_000,
      status: 'OK',
    },
  ];
  return {
    request: {
      id: params.req_id,
      deployment_id: db.deployments[0].id,
      route: '/orders/{id}',
      method: 'GET',
      status: 500,
      latency_ms: 2400,
      count: 1,
      // Even-led request ids woke the app, so the debugger can open a wake.
      cold_boot: parseInt(params.req_id[0], 16) % 2 === 0,
      ...(parseInt(params.req_id[0], 16) % 2 === 0
        ? { wake_id: `wk-${params.req_id.slice(0, 12)}` }
        : {}),
      trace_id: traceId,
      received_at: db.iso(120_000),
    },
    regression: {
      deployment_id: db.deployments[0].id,
      route: '/orders/{id}',
      p95_ms: 1840,
      p95_base_ms: 260,
      affected_count: 412,
      regression_factor: '7.08',
      first_detected_at: db.iso(5_400_000),
      last_detected_at: db.iso(120_000),
    },
    spans,
    spans_truncated: false,
    explanation: {
      status: 'regression_detected',
      headline:
        'A database query on this route takes 7× longer than it did before the current deployment.',
      primary_span: spans[1],
    },
    generated_at: db.iso(0),
  };
});

route('DELETE', '/v1/apps/{slug}/cache', ({ params, query }) => {
  const a = app(params.slug);
  const path = query.get('path');
  const tag = query.get('tag');
  if (path !== null && tag !== null)
    throw new Problem(422, 'validation_failed', 'Path and tag are mutually exclusive.');
  if (path !== null && path !== '*' && !path.startsWith('/'))
    throw new Problem(422, 'validation_failed', 'a path glob starts with "/".');
  if (path !== null && new TextEncoder().encode(path).length > 1024)
    throw new Problem(422, 'validation_failed', 'a path glob is at most 1024 bytes.');
  if (tag !== null && (tag.length > 128 || !/^[A-Za-z0-9._:/-]+$/.test(tag)))
    throw new Problem(422, 'validation_failed', 'a cache tag is invalid.');
  advancePolicy(a.id, ['response_cache']);
  return NO_CONTENT;
});

const restarting = new Set<string>();
route('POST', '/v1/apps/{slug}/restart', ({ params }) => {
  const a = app(params.slug);
  if (restarting.has(a.slug))
    throw new Problem(409, 'conflict', 'a restart is already in flight for this app.');
  if (process.env.MOCK_SPEND_CAP === 'reached')
    throw new Problem(
      402,
      'admission_refused',
      "the account's spend cap is met; raise it to allow new wakes."
    );
  restarting.add(a.slug);
  setTimeout(() => restarting.delete(a.slug), 5_000);
  return status(202, { wake_id: db.id() });
});

route('POST', '/v1/apps/{slug}/restore', ({ params }) => {
  const deleted = [...deletedApps.values()].find((r) => r.app.slug === params.slug);
  if (!deleted) {
    app(params.slug);
    throw new Problem(409, 'app_not_restorable', 'the app is not pending deletion.');
  }
  return restoreDeleted(deleted);
});

// --- App observability: health, awake routes, dependency latency ---
type S_ = components['schemas'];
function healthFor(a: db.App): S_['AppHealthResponse'] {
  const scenario = db.scenarioOf(a);
  const status =
    scenario === 'failing' ? 'unhealthy' : scenario === 'deploying' ? 'degraded' : 'healthy';
  const phase = scenario === 'parked' ? 'idle' : scenario === 'deploying' ? 'deploying' : 'serving';
  const failing = scenario === 'failing';
  return {
    app_id: a.id,
    status,
    phase,
    summary: failing
      ? 'The latest deployment fails readiness; no healthy instance serves traffic.'
      : scenario === 'parked'
        ? 'Parked at zero instances; the next request wakes it.'
        : scenario === 'deploying'
          ? 'A new release is starting alongside the serving one.'
          : 'Serving normally.',
    scope: 'app',
    evaluated_at: db.iso(30_000),
    valid_for_seconds: 60,
    serving_deployment_ids: [],
    capacity: {
      known: true,
      required: scenario === 'parked' ? 0 : 1,
      ready: failing || scenario === 'parked' ? 0 : 1,
      starting: scenario === 'deploying' ? 1 : 0,
      unready: failing ? 1 : 0,
      unknown: 0,
    },
    checks: [
      {
        code: 'readiness',
        status: failing ? 'fail' : 'pass',
        detail: failing
          ? 'Readiness probe on :8080/health timed out after 30 s.'
          : 'Readiness probe passing.',
        ...(failing ? { action: 'logs' as const } : {}),
      },
      {
        code: 'requests',
        status: failing ? 'warning' : 'pass',
        detail: failing
          ? '7.1% of requests returned 5xx in the last 15 minutes.'
          : 'Error rate normal.',
      },
    ],
  };
}
route('GET', '/v1/apps/{slug}/health', ({ params }) => healthFor(app(params.slug)));
route('GET', '/v1/apps/{slug}/health/history', ({ params }) => {
  const a = app(params.slug);
  const now = healthFor(a);
  const entries: S_['AppHealthHistoryEntry'][] = [
    {
      id: 'h3',
      kind: 'transition',
      observed_at: db.iso(40 * 60_000),
      previous_status: 'healthy',
      assessment: now,
    },
    {
      id: 'h2',
      kind: 'gap',
      observed_at: db.iso(5 * 3600_000),
      assessment: { ...now, status: 'unknown' },
    },
    {
      id: 'h1',
      kind: 'baseline',
      observed_at: db.iso(26 * 3600_000),
      assessment: { ...now, status: 'healthy' },
    },
  ];
  return {
    app_id: a.id,
    scope: 'app',
    entries: db.scenarioOf(a) === 'healthy' ? entries.slice(1) : entries,
    collector_fresh: true,
    interval_seconds: 60,
  };
});
route('GET', '/v1/apps/{slug}/routes/awake', ({ params, query }) => {
  const a = app(params.slug);
  const since = query.get('since') ?? '168h';
  const windowSeconds = since.endsWith('d') ? Number(since.slice(0, -1)) * 86400 : 7 * 86400;
  const routes = [
    {
      method: 'GET',
      route: '/health',
      requests: 10_080,
      share: 0.62,
      wakes: 2,
      pattern: 'periodic',
      interval: 60,
    },
    {
      method: 'POST',
      route: '/v1/orders',
      requests: 4_210,
      share: 0.21,
      wakes: 31,
      pattern: 'bursty',
    },
    {
      method: 'GET',
      route: '/v1/orders/{id}',
      requests: 9_884,
      share: 0.12,
      wakes: 4,
      pattern: 'steady',
    },
  ];
  const gbPerShare = (a.ram_mb / 1024) * (windowSeconds / 3600);
  return {
    slug: a.slug,
    from: db.iso(windowSeconds * 1000),
    until: db.iso(0),
    idle_timeout_seconds: 60,
    window_seconds: windowSeconds,
    awake_seconds: Math.round(windowSeconds * 0.95),
    awake_share: 0.95,
    mb_seconds: Math.round(a.ram_mb * windowSeconds * 0.95),
    gb_hours: gbPerShare * 0.95,
    wakes: 37,
    unattributed_seconds: 0,
    other_routes_seconds: 0,
    routes_limit: 20,
    routes: routes.map((r) => ({
      method: r.method,
      route: r.route,
      requests: r.requests,
      wakes: r.wakes,
      awake_seconds: Math.round(windowSeconds * r.share),
      awake_share: r.share,
      gb_hours: gbPerShare * r.share,
      pattern: r.pattern,
      ...(r.interval ? { interval_seconds: r.interval } : {}),
      if_removed: {
        awake_seconds_saved: Math.round(windowSeconds * r.share * 0.8),
        gb_hours_saved: gbPerShare * r.share * 0.8,
        wakes_change: r.pattern === 'periodic' ? 140 : 3,
      },
      ...(r.pattern === 'periodic'
        ? {
            suggestion: {
              kind: 'exclude_from_idle',
              message:
                'An uptime probe keeps the app awake. Point it at a route your edge answers, or exclude it from the idle timer.',
            },
          }
        : {}),
    })),
  };
});
route('GET', '/v1/apps/{slug}/debug/dependencies', ({ params, query }) => {
  const a = app(params.slug);
  const dep = (
    type: string,
    name: string,
    calls: number,
    errors: number,
    p95: number,
    base: number
  ): S_['DebugDependencyLatencyItem'] => ({
    type: type as S_['DebugDependencyLatencyItem']['type'],
    kind: name.split(' ')[0].replace(/[^a-z0-9]/g, ''),
    name,
    calls,
    error_calls: errors,
    error_rate_pct: (errors / calls) * 100,
    p50_ms: Math.round(p95 * 0.4),
    p95_ms: p95,
    p99_ms: Math.round(p95 * 1.6),
    baseline_p95_ms: base,
    current_p95_ms: p95,
    p95_delta_ms: p95 - base,
    regression: p95 > base * 1.5,
    failure_regression: false,
  });
  return {
    app_id: a.id,
    since: query.get('since') ?? '24h',
    window_start: db.iso(86400_000),
    window_end: db.iso(0),
    retention_clamped: false,
    complete: true,
    truncated: false,
    telemetry_rows: 4_200,
    represented_requests: 18_400,
    span_samples: 9_100,
    dependencies: [
      dep('app_dependency', 'postgres orders', 12_400, 3, 412, 140),
      dep('app_dependency', 'api.stripe.com', 2_100, 12, 380, 360),
      dep('managed_binding', 'redis sessions', 30_200, 0, 4, 3),
    ],
    edges: [],
  };
});

// --- Prewarm intents ---
const prewarms = new Map<string, components['schemas']['PrewarmIntentResponse'][]>();
route('GET', '/v1/apps/{slug}/prewarms', ({ params }) => {
  app(params.slug);
  return prewarms.get(params.slug) ?? [];
});
route('POST', '/v1/apps/{slug}/prewarm', ({ params, body }) => {
  const a = app(params.slug);
  const count = Number(body.count);
  const wakeAt = Date.parse(String(body.wake_at ?? ''));
  const expiresAt = Date.parse(String(body.expires_at ?? ''));
  if (!Number.isInteger(count) || count < 1)
    throw new Problem(400, 'validation_failed', 'count must be a positive integer.');
  if (Number.isNaN(wakeAt) || Number.isNaN(expiresAt) || expiresAt <= wakeAt)
    throw new Problem(400, 'validation_failed', 'expires_at must be after wake_at.');
  const intent: components['schemas']['PrewarmIntentResponse'] = {
    id: db.id(),
    app_id: a.id,
    count,
    wake_at: new Date(wakeAt).toISOString(),
    expires_at: new Date(expiresAt).toISOString(),
    trigger: 'calendar',
    status: 'pending',
    created_at: db.iso(0),
  };
  prewarms.set(a.slug, [...(prewarms.get(a.slug) ?? []), intent]);
  return status(202, intent);
});
route('DELETE', '/v1/apps/{slug}/prewarms/{id}', ({ params }) => {
  const intent = prewarms.get(params.slug)?.find((p) => p.id === params.id);
  if (!intent) throw new Problem(404, 'prewarm_not_found');
  intent.status = 'cancelled';
  return NO_CONTENT;
});
// --- Log drains ---
function drainOf(slug: string, id: string) {
  app(slug);
  const drain = logDrainMock.drains.get(slug)?.find((d) => d.id === id);
  if (!drain) throw new Problem(404, 'log_drain_not_found');
  return drain;
}
route('GET', '/v1/apps/{slug}/log-drains', ({ params }) => {
  app(params.slug);
  return logDrainMock.drains.get(params.slug) ?? [];
});
route('POST', '/v1/apps/{slug}/log-drains', ({ params, body }) => {
  const a = app(params.slug);
  const url = String(body.target_url ?? '');
  if (!/^https?:\/\//.test(url))
    throw new Problem(400, 'validation_failed', 'target_url must be an http(s) URL.');
  const drain: components['schemas']['AppLogDrainResponse'] = {
    id: db.id(),
    app_id: a.id,
    account_id: db.ACCOUNT_ID,
    kind: body.kind === 'otlp' ? 'otlp' : 'http_json',
    target_url: url,
    auth_header_masked: body.auth_header ? '***' : '',
    enabled: body.enabled !== false,
    created_at: db.iso(0),
    updated_at: db.iso(0),
  };
  logDrainMock.drains.set(a.slug, [...(logDrainMock.drains.get(a.slug) ?? []), drain]);
  return status(201, drain);
});
route('GET', '/v1/apps/{slug}/log-drains/{id}', ({ params }) => drainOf(params.slug, params.id));
route('PATCH', '/v1/apps/{slug}/log-drains/{id}', ({ params, body }) => {
  const drain = drainOf(params.slug, params.id);
  if (typeof body.enabled === 'boolean') drain.enabled = body.enabled;
  if (typeof body.target_url === 'string') drain.target_url = body.target_url;
  if (body.kind === 'otlp' || body.kind === 'http_json') drain.kind = body.kind;
  if (typeof body.auth_header === 'string')
    drain.auth_header_masked = body.auth_header ? '***' : '';
  drain.updated_at = db.iso(0);
  return drain;
});
route('DELETE', '/v1/apps/{slug}/log-drains/{id}', ({ params }) => {
  drainOf(params.slug, params.id);
  logDrainMock.drains.set(
    params.slug,
    (logDrainMock.drains.get(params.slug) ?? []).filter((d) => d.id !== params.id)
  );
  return NO_CONTENT;
});
route('GET', '/v1/apps/{slug}/log-drains/{id}/health', ({ params }) =>
  logDrainMock.healthFor(drainOf(params.slug, params.id))
);
route('GET', '/v1/apps/{slug}/log-drains/{id}/analytics', ({ params, query }) =>
  logDrainMock.analyticsFor(drainOf(params.slug, params.id), query.get('window') ?? '24h')
);
// --- Canary route health: candidate vs stable per critical route ---
function routeHealthFor(a: db.App, deploymentId: string): S_['RouteHealthReport'] {
  const deployment = db.deployments.find((d) => d.id === deploymentId);
  const stable = db.deployments.find(
    (d) => d.app_id === a.id && d.id !== deploymentId && d.status === 'superseded'
  );
  const counts = (requests: number, errors: number, p95: number) => ({
    requests,
    server_errors: errors,
    error_rate: requests ? errors / requests : 0,
    p95_latency_ms: p95,
  });
  const route = (
    method: string,
    path: string,
    canaryErrors: number,
    delta: number
  ): S_['RouteHealthFinding'] => ({
    method,
    path,
    status: canaryErrors > 3 ? 'regressed' : 'healthy',
    reason:
      canaryErrors > 3
        ? 'Candidate 5xx rate exceeds stable by more than the allowed margin.'
        : 'Within the error and latency budget.',
    check_latency: true,
    windows: [
      {
        start: db.iso(120_000),
        end: db.iso(60_000),
        candidate: counts(180, canaryErrors, 120 + delta),
        stable: counts(1620, 2, 120),
        status: canaryErrors > 3 ? 'regressed' : 'healthy',
        reason: '',
        latency_delta_ms: delta,
        latency_factor: (120 + delta) / 120,
      },
    ],
  });
  return {
    app_id: a.id,
    deployment_id: deploymentId,
    candidate_commit_sha: 'a1b2c3d',
    stable_deployment_id: stable?.id ?? '',
    stable_commit_sha: stable ? 'e4f5a6b' : '',
    canary_step: deployment?.canary_step ?? 1,
    mode: 'enforce',
    on_regression: 'hold',
    revision: 3,
    checked_at: db.iso(20_000),
    coverage: 'observed_only',
    status: 'healthy',
    reason: 'Every critical route met its budget in both windows.',
    minimum_requests: 50,
    routes: [route('POST', '/v1/orders', 1, 8), route('GET', '/v1/orders/{id}', 0, -3)],
  };
}
route('GET', '/v1/apps/{slug}/route-health/deployments/{deployment}', ({ params }) =>
  routeHealthFor(app(params.slug), params.deployment)
);
route('GET', '/v1/apps/{slug}/route-health/deployments/{deployment}/history', ({ params }) => {
  const a = app(params.slug);
  const report = routeHealthFor(a, params.deployment);
  const decision = (
    status: S_['RouteHealthDecision']['status'],
    reason: string
  ): S_['RouteHealthDecision'] => ({
    mode: 'enforce',
    on_regression: 'hold',
    revision: 3,
    deployment_id: params.deployment,
    stable_deployment_id: report.stable_deployment_id,
    status,
    reason,
    checked_at: db.iso(25 * 60_000),
  });
  return {
    app_id: a.id,
    deployment_id: params.deployment,
    entries: [
      {
        version: 1,
        id: 'rh-2',
        checked_at: db.iso(20 * 60_000),
        source: 'worker',
        traffic_percent: 1,
        requested_traffic_percent: 10,
        policy: {
          version: 1,
          windows: 2,
          window_seconds: 60,
          ingestion_lag_seconds: 15,
          minimum_requests: 50,
          minimum_errors: 3,
          error_rate_floor: 0.01,
          error_rate_delta: 0.01,
          error_rate_factor: 2,
          minimum_latency_requests: 50,
          latency_quantile: 0.95,
          latency_factor: 1.5,
          latency_delta_ms: 100,
          comparison_epsilon: 0.0001,
        },
        decision: decision('allowed', 'Both windows healthy at 1%; advancing to 10%.'),
        report,
      },
    ],
  } satisfies S_['RouteHealthHistoryPage'];
});

route('GET', '/v1/apps/{slug}/upstreams/history', ({ params, query }) => {
  const a = app(params.slug);
  const bucket = query.get('bucket') ?? '5m';
  const minutes: Record<string, number> = { '1m': 1, '5m': 5, '1h': 60, '6h': 360, '24h': 1440 };
  const step = minutes[bucket];
  if (!step) throw new Problem(400, 'validation_failed', `unsupported bucket "${bucket}".`);
  const count = Math.min(48, Math.round(1440 / step));
  return listOf(db.upstreams, a.slug).map((u, index) => ({
    host_redacted_hash: u.host_redacted_hash,
    kind: u.kind,
    port: u.port,
    scope: u.scope ?? undefined,
    region: 'fra',
    buckets: Array.from({ length: count }, (_, i) => {
      const gap = index === 1 && i > count - 6;
      const drift = index === 0 && i > count - 10 ? 2.4 : 1;
      return {
        sampled_at: db.iso((count - 1 - i) * step * 60_000),
        p50_ms: gap ? null : Math.round((4 + index * 3) * drift),
        p95_ms: gap ? null : Math.round((11 + index * 7) * drift),
        sample_count: gap ? 1 : 12,
      };
    }),
  }));
});

route('POST', '/v1/apps/{slug}/rollouts/recover', ({ params, body }) => {
  const a = app(params.slug);
  if (process.env.MOCK_PLAN === 'free')
    throw new Problem(
      403,
      'plan_traffic_split_not_allowed',
      'canary rollouts need the Pro or Scale plan.'
    );
  const action = String(body.action ?? '');
  if (!['advance', 'promote', 'abort'].includes(action))
    throw new Problem(400, 'validation_failed', 'action must be advance, promote or abort.');
  const d = db.deployments.find(
    (x) => x.app_id === a.id && (x.rollout_state === 'rolling_out' || x.rollout_state === 'pending')
  );
  if (!d) throw new Problem(409, 'rollout_state_invalid', 'no rollout is in flight for this app.');
  if (action === 'advance') {
    const startedAt = Date.parse(d.canary_step_started_at ?? d.created_at);
    if (Date.now() - startedAt < 30 * 60_000)
      throw new Problem(
        409,
        'rollout_not_stuck',
        'the rollout is still progressing; use promote instead to ship it now.'
      );
    d.canary_step = (d.canary_step ?? 0) + 1;
    d.canary_step_started_at = new Date().toISOString();
  } else if (action === 'promote') {
    d.canary_step = d.canary_total_steps ?? 1;
    d.rollout_state = 'complete';
    d.rollout_completed_at = new Date().toISOString();
    d.traffic_percent = 100;
  } else {
    d.rollout_state = 'aborted';
    d.rollout_aborted_at = new Date().toISOString();
  }
  return { deployment: d, audit_id: db.id() };
});

route('POST', '/v1/apps/{slug}/deployments/source-tarball', ({ params, req }) => {
  const a = app(params.slug);
  const type = String(req.headers['content-type'] ?? '');
  if (!type.startsWith('multipart/form-data'))
    throw new Problem(400, 'validation_failed', 'the body must be multipart/form-data.');
  return status(202, startSourceDeployment(a, 'tarball', `${a.slug} (uploaded archive)`));
});

// Resumable upload sessions (POST/PATCH/GET /v1/uploads, commit), the route
// the console deploys tarballs through. Bytes are counted, not kept.
const uploads = new Map<
  string,
  { slug: string; total: number; received: number; deployment?: unknown }
>();
const UPLOAD_CHUNK = 1_048_576;
const uploadExpiry = () => new Date(Date.now() + 3_600_000).toISOString();
function uploadSession(id: string) {
  const u = uploads.get(id);
  if (!u) throw new Problem(404, 'not_found', 'No such upload session.');
  return u;
}
route('POST', '/v1/uploads', ({ body }) => {
  const a = app(String(body.app_slug));
  const id = crypto.randomUUID();
  uploads.set(id, { slug: a.slug, total: Number(body.total_size), received: 0 });
  return status(201, {
    upload_id: id,
    chunk_size: UPLOAD_CHUNK,
    total_size: Number(body.total_size),
    expires_at: uploadExpiry(),
  });
});
route('GET', '/v1/uploads/{id}', ({ params }) => {
  const u = uploadSession(params.id);
  return {
    upload_id: params.id,
    app_slug: u.slug,
    chunk_size: UPLOAD_CHUNK,
    total_size: u.total,
    received_bytes: u.received,
    status: u.received >= u.total ? 'complete' : 'open',
    expires_at: uploadExpiry(),
  };
});
route('PATCH', '/v1/uploads/{id}', ({ params, req }) => {
  const u = uploadSession(params.id);
  if (Number(req.headers['upload-offset']) !== u.received)
    throw new Problem(
      409,
      'upload_session_offset_conflict',
      'Upload-Offset does not match the received bytes.'
    );
  // readBody has consumed the stream as text; the header carries the byte count.
  u.received += Number(req.headers['content-length'] ?? 0);
  return {};
});
route('POST', '/v1/uploads/{id}/commit', ({ params }) => {
  const u = uploadSession(params.id);
  if (u.deployment) return status(202, u.deployment);
  if (u.received < u.total) throw new Problem(409, 'conflict', 'The upload is incomplete.');
  const a = app(u.slug);
  u.deployment = startSourceDeployment(a, 'tarball', `${a.slug} (uploaded archive)`);
  return status(201, u.deployment);
});

route('GET', '/v1/account/object-storage-usage', () => ({
  usage: {
    observed_bytes: 41_237_899_264,
    capacity_bytes: 214_748_364_800,
    capacity_keys: 500_000,
    stored_byte_hours: 29_691_287_470_080,
    request_count: 184_221,
    egress_bytes: 8_912_345_600,
    cost_millicents: 412_800,
    authorizations: 9_412,
    fresh: true,
    period_start: db.iso(8 * 24 * 3_600_000),
  },
  policy: {
    max_account_bytes: 214_748_364_800,
    max_bucket_bytes: 107_374_182_400,
    max_account_keys: 500_000,
    max_monthly_cost_millicents: 5_000_000,
    max_monthly_requests: 5_000_000,
    max_monthly_egress_bytes: 1_099_511_627_776,
    max_monthly_authorizations: 250_000,
    max_report_age_seconds: 3600,
  },
  charges: {
    currency: 'USD',
    storage_millicents: 268_400,
    requests_millicents: 61_200,
    egress_millicents: 83_200,
    total_millicents: 412_800,
  },
}));

// Bucket access: API-key grants and S3 credentials.
const bucketGrants = new Map<
  string,
  {
    key_id: string;
    key_label: string;
    key_status: string;
    permission: string;
    created_at: string;
    updated_at: string;
  }[]
>();
const bucketS3 = new Map<
  string,
  {
    id: string;
    bucket_id: string;
    access_key_id: string;
    label: string;
    permission: string;
    status: string;
    created_at: string;
    last_used_at?: string;
    revoked_at?: string;
  }[]
>();

/**
 * The API declares `{bucket}` as the bucket's id, not its name. The mock
 * enforces the shape so passing a name fails here rather than in production.
 */
function bucketId(value: string) {
  if (!/^[0-9a-f]{32}$/.test(value))
    throw new Problem(404, 'not_found', `"${value}" is not a bucket id.`);
  return value;
}

function grantsFor(slug: string, bucket: string) {
  const key = `${slug}/${bucketId(bucket)}`;
  if (!bucketGrants.has(key)) {
    const first = db.keys[0];
    bucketGrants.set(
      key,
      first
        ? [
            {
              key_id: first.id,
              key_label: first.label ?? first.id.slice(0, 8),
              key_status: 'active',
              permission: 'read',
              created_at: db.iso(6 * 24 * 3_600_000),
              updated_at: db.iso(6 * 24 * 3_600_000),
            },
          ]
        : []
    );
  }
  return bucketGrants.get(key)!;
}

function s3For(slug: string, bucket: string) {
  const key = `${slug}/${bucketId(bucket)}`;
  if (!bucketS3.has(key)) bucketS3.set(key, []);
  return bucketS3.get(key)!;
}

route('GET', '/v1/apps/{slug}/buckets/{bucket}/access-grants', ({ params }) => ({
  items: grantsFor(app(params.slug).slug, params.bucket),
}));
route('PUT', '/v1/apps/{slug}/buckets/{bucket}/access-grants/{key}', ({ params, body }) => {
  const slug = app(params.slug).slug;
  const permission = String(body.permission ?? '');
  if (!['read', 'write', 'read_write'].includes(permission))
    throw new Problem(422, 'validation_failed', 'permission must be read, write or read_write.');
  const key = db.keys.find((k) => k.id === params.key);
  if (!key) throw new Problem(404, 'not_found', 'no such API key');
  const list = grantsFor(slug, params.bucket);
  const existing = list.find((g) => g.key_id === params.key);
  if (existing) {
    existing.permission = permission;
    existing.updated_at = db.iso(0);
    return existing;
  }
  const grant = {
    key_id: key.id,
    key_label: key.label ?? key.id.slice(0, 8),
    key_status: 'active',
    permission,
    created_at: db.iso(0),
    updated_at: db.iso(0),
  };
  list.push(grant);
  return grant;
});
route('DELETE', '/v1/apps/{slug}/buckets/{bucket}/access-grants/{key}', ({ params }) => {
  const list = grantsFor(app(params.slug).slug, params.bucket);
  const i = list.findIndex((g) => g.key_id === params.key);
  if (i < 0) throw new Problem(404, 'not_found', 'no grant for that key on this bucket');
  list.splice(i, 1);
  return NO_CONTENT;
});
route('GET', '/v1/apps/{slug}/buckets/{bucket}/s3-credentials', ({ params }) => ({
  items: s3For(app(params.slug).slug, params.bucket),
}));
route('POST', '/v1/apps/{slug}/buckets/{bucket}/s3-credentials', ({ params, body }) => {
  const slug = app(params.slug).slug;
  const label = String(body.label ?? '').trim();
  const permission = String(body.permission ?? '');
  if (!label) throw new Problem(422, 'validation_failed', 'a label is required.');
  if (!['read', 'write', 'read_write'].includes(permission))
    throw new Problem(422, 'validation_failed', 'permission must be read, write or read_write.');
  const list = s3For(slug, params.bucket);
  const credential = {
    id: db.id(),
    bucket_id: params.bucket,
    access_key_id: `GK${db.id().slice(0, 18).toUpperCase()}`,
    label,
    permission,
    status: 'active',
    created_at: db.iso(0),
  };
  list.push(credential);
  // The secret exists only in this response, as upstream.
  return status(201, {
    ...credential,
    secret_access_key: `${db.id()}${db.id()}`,
    endpoint: 'https://s3.gregale.dev',
    region: 'us-east-1',
    addressing_style: 'path',
  });
});
route('DELETE', '/v1/apps/{slug}/buckets/{bucket}/s3-credentials/{credential}', ({ params }) => {
  const list = s3For(app(params.slug).slug, params.bucket);
  const credential = list.find((c) => c.id === params.credential);
  if (!credential) throw new Problem(404, 'not_found', 'no such credential');
  credential.status = 'revoked';
  credential.revoked_at = db.iso(0);
  return NO_CONTENT;
});

// Object storage buckets. A seeded `assets` bucket on api-gateway carries
// objects, a runtime binding, versioning and lifecycle rules, so every part of
// the storage page has something real to show; MOCK_EMPTY starts with none.
const MOCK_S3_REGION = 'us-east-1';
/**
 * Where the mock's signed URLs point. The real ones name the storage host,
 * which a dev browser cannot reach without CORS; this path on the dev origin
 * stands in for it, so an upload or download actually round-trips.
 */
const MOCK_S3_OBJECT_PATH = '/mock-s3/object';
/** Bytes kept per uploaded object; larger uploads keep their size only. */
const MOCK_S3_KEEP_BYTES = 16 * 1024 ** 2;
const storageSignatures = new Map<
  string,
  {
    slug: string;
    bucketId: string;
    key: string;
    method: 'GET' | 'HEAD' | 'PUT';
    expiresAt: number;
    contentType: string;
  }
>();
const storageBytes = new Map<string, { bytes: Buffer; contentType: string }>();
const storageBuckets = new Map<string, S_['ObjectBucket'][]>();
const storageObjects = new Map<
  string,
  { key: string; size_bytes: number; last_modified: string }[]
>();
const storageBindings = new Map<string, S_['ObjectStorageComputeBinding'][]>();

function mockBindingPrefix(bucketName: string) {
  const raw = `GREGALE_S3_${bucketName.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`.replace(
    /_+$/,
    ''
  );
  return raw.length > 48 ? raw.slice(0, 48).replace(/_+$/, '') : raw;
}

function bucketsFor(slug: string) {
  if (!storageBuckets.has(slug)) {
    const seeded: S_['ObjectBucket'][] = [];
    if (!db.EMPTY && slug === 'api-gateway') {
      for (const [name, age] of [
        ['assets', 21],
        ['user-uploads', 9],
      ] as const) {
        const bucket = {
          id: hex(32),
          name,
          scope: 'default',
          region: MOCK_S3_REGION,
          state: 'ready' as const,
          public: false,
          created_at: db.iso(age * 24 * 3_600_000),
        };
        seeded.push(bucket);
        if (name === 'assets') seedAssets(slug, bucket.id);
      }
    }
    storageBuckets.set(slug, seeded);
  }
  return storageBuckets.get(slug)!;
}

function seedAssets(slug: string, bucket: string) {
  const files: [string, number, number][] = [
    ['fonts/familjen-grotesk.woff2', 48_212, 20],
    ['fonts/spline-sans-mono.woff2', 39_877, 20],
    ['images/hero.webp', 284_331, 6],
    ['images/logo.svg', 2_418, 19],
    ['images/og.png', 91_204, 6],
    ['manifest.json', 734, 2],
    ['robots.txt', 68, 19],
    ['tmp/import-2026-10-19.csv', 1_904_552, 1],
  ];
  storageObjects.set(
    `${slug}/${bucket}`,
    files.map(([key, size_bytes, days]) => ({
      key,
      size_bytes,
      last_modified: db.iso(days * 24 * 3_600_000),
    }))
  );
  const prefix = mockBindingPrefix('assets');
  const credential: S_['ObjectS3Credential'] = {
    id: hex(32),
    bucket_id: bucket,
    access_key_id: `GRGA${hex(16)
      .toUpperCase()
      .replace(/[^A-Z2-7]/g, 'A')}`,
    label: 'compute',
    permission: 'read',
    status: 'active',
    created_at: db.iso(14 * 24 * 3_600_000),
  };
  storageBindings.set(`${slug}/${bucket}`, [
    {
      id: hex(32),
      bucket_id: bucket,
      scope: 'default',
      prefix,
      credential,
      secret_keys: bindingSecretKeys(prefix),
      rotation_pending: false,
    },
  ]);
  s3For(slug, bucket).push({ ...credential });
  // A standalone key for an outside tool, so the map shows a write cable too.
  s3For(slug, bucket).push({
    id: hex(32),
    bucket_id: bucket,
    access_key_id: `GRGA${hex(16)
      .toUpperCase()
      .replace(/[^A-Z2-7]/g, 'B')}`,
    label: 'nightly-backup',
    permission: 'read_write',
    status: 'active',
    created_at: db.iso(8 * 24 * 3_600_000),
    last_used_at: db.iso(9 * 3_600_000),
  });
}

function bindingSecretKeys(prefix: string): S_['ObjectStorageComputeBindingSecretKeys'] {
  return {
    endpoint: `${prefix}_ENDPOINT`,
    region: `${prefix}_REGION`,
    bucket: `${prefix}_BUCKET`,
    access_key_id: `${prefix}_ACCESS_KEY_ID`,
    secret_access_key: `${prefix}_SECRET_ACCESS_KEY`,
    addressing_style: `${prefix}_ADDRESSING_STYLE`,
  };
}

function ownedBucket(slug: string, id: string) {
  const bucket = bucketsFor(slug).find((b) => b.id === bucketId(id));
  if (!bucket) throw new Problem(404, 'not_found', 'no such bucket');
  return bucket;
}

route('GET', '/v1/apps/{slug}/buckets', ({ params }) => ({
  items: bucketsFor(app(params.slug).slug),
  enabled: true,
  regions: [MOCK_S3_REGION],
  default_region: MOCK_S3_REGION,
  max_upload_bytes: 5 * 1024 ** 3,
  max_buckets_per_app: 10,
}));
route('POST', '/v1/apps/{slug}/buckets', ({ params, body }) => {
  const slug = app(params.slug).slug;
  const name = String(body.name ?? '');
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(name))
    throw new Problem(422, 'validation_failed', 'name must start with a letter: a-z, 0-9 and -.');
  const list = bucketsFor(slug);
  if (list.some((b) => b.name === name))
    throw new Problem(409, 'conflict', `a bucket named "${name}" already exists.`);
  const bucket = {
    id: hex(32),
    name,
    scope: String(body.scope ?? 'default'),
    region: String(body.region ?? MOCK_S3_REGION),
    state: 'ready' as const,
    public: false,
    created_at: db.iso(0),
  };
  list.push(bucket);
  return status(201, bucket);
});
route('DELETE', '/v1/apps/{slug}/buckets/{bucket}', ({ params }) => {
  const slug = app(params.slug).slug;
  const bucket = ownedBucket(slug, params.bucket);
  if ((storageObjects.get(`${slug}/${bucket.id}`) ?? []).length)
    throw new Problem(409, 'conflict', 'Only an empty bucket can be deleted.');
  storageBuckets.set(
    slug,
    bucketsFor(slug).filter((b) => b.id !== bucket.id)
  );
  return NO_CONTENT;
});
route('GET', '/v1/apps/{slug}/buckets/{bucket}/objects', ({ params, query }) => {
  const slug = app(params.slug).slug;
  const bucket = ownedBucket(slug, params.bucket);
  const prefix = query.get('prefix') ?? '';
  const limit = Math.min(1000, Number(query.get('limit') ?? 100) || 100);
  const start = Number(query.get('cursor') ?? 0) || 0;
  const all = (storageObjects.get(`${slug}/${bucket.id}`) ?? []).filter((o) =>
    o.key.startsWith(prefix)
  );
  const items = all.slice(start, start + limit);
  return {
    items,
    ...(start + limit < all.length ? { next_cursor: String(start + limit) } : {}),
  };
});
route('DELETE', '/v1/apps/{slug}/buckets/{bucket}/objects', ({ params, query }) => {
  const slug = app(params.slug).slug;
  const bucket = ownedBucket(slug, params.bucket);
  const key = query.get('key') ?? '';
  const list = storageObjects.get(`${slug}/${bucket.id}`) ?? [];
  storageObjects.set(
    `${slug}/${bucket.id}`,
    list.filter((o) => o.key !== key)
  );
  storageBytes.delete(`${slug}/${bucket.id}/${key}`);
  return NO_CONTENT;
});
route('POST', '/v1/apps/{slug}/buckets/{bucket}/signed-url', ({ params, body, req }) => {
  const slug = app(params.slug).slug;
  const bucket = ownedBucket(slug, params.bucket);
  const method = String(body.method ?? 'GET') as 'GET' | 'HEAD' | 'PUT';
  const key = String(body.key ?? '');
  if (!key) throw new Problem(422, 'validation_failed', 'key is required.');
  const expiresIn = Math.min(900, Number(body.expires_in ?? 300));
  const expiresAt = Date.now() + expiresIn * 1000;
  // Signing is a promise to accept bytes, not an upload: the object appears
  // when the PUT to this URL lands, as it would on the storage host.
  const signature = hex(32);
  storageSignatures.set(signature, {
    slug,
    bucketId: bucket.id,
    key,
    method,
    expiresAt,
    contentType: String(body.content_type ?? 'application/octet-stream'),
  });
  const url = new URL(MOCK_S3_OBJECT_PATH, `http://${req.headers.host ?? 'localhost'}`);
  url.searchParams.set('bucket', bucket.name);
  url.searchParams.set('key', key);
  url.searchParams.set('X-Amz-Signature', signature);
  return status(201, {
    url: url.toString(),
    method,
    headers: {},
    expires_at: new Date(expiresAt).toISOString(),
  });
});
// The storage host itself, as far as signed URLs reach it. S3 answers in XML.
function s3Refusal(res: ServerResponse, code: number, reason: string) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/xml');
  res.end(`<?xml version="1.0" encoding="UTF-8"?><Error><Code>${reason}</Code></Error>`);
}
function signedFor(query: URLSearchParams, method: 'GET' | 'PUT') {
  const signed = storageSignatures.get(query.get('X-Amz-Signature') ?? '');
  if (!signed || signed.method !== method || signed.expiresAt < Date.now()) return undefined;
  const exists = bucketsFor(signed.slug).some((b) => b.id === signed.bucketId);
  return exists ? signed : undefined;
}
route('PUT', '/mock-s3/object', async ({ query, req, res }) => {
  const signed = signedFor(query, 'PUT');
  if (!signed) return s3Refusal(res, 403, 'AccessDenied');
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const bytes = Buffer.concat(chunks);
  const where = `${signed.slug}/${signed.bucketId}`;
  const list = storageObjects.get(where) ?? [];
  storageObjects.set(where, [
    ...list.filter((o) => o.key !== signed.key),
    { key: signed.key, size_bytes: bytes.length, last_modified: db.iso(0) },
  ]);
  const contentType = String(req.headers['content-type'] ?? signed.contentType);
  if (bytes.length <= MOCK_S3_KEEP_BYTES)
    storageBytes.set(`${where}/${signed.key}`, { bytes, contentType });
  else storageBytes.delete(`${where}/${signed.key}`);
  res.statusCode = 200;
  res.setHeader('ETag', `"${createHash('md5').update(bytes).digest('hex')}"`);
  res.end();
});
route('GET', '/mock-s3/object', ({ query, res }) => {
  const signed = signedFor(query, 'GET');
  if (!signed) return s3Refusal(res, 403, 'AccessDenied');
  const where = `${signed.slug}/${signed.bucketId}`;
  const object = (storageObjects.get(where) ?? []).find((o) => o.key === signed.key);
  if (!object) return s3Refusal(res, 404, 'NoSuchKey');
  // Seeded objects, and uploads too large to keep, have no bytes here.
  const kept = storageBytes.get(`${where}/${signed.key}`);
  res.statusCode = 200;
  res.setHeader('Content-Type', kept?.contentType ?? 'text/plain; charset=utf-8');
  const name = signed.key.split('/').pop() || 'object';
  res.setHeader('Content-Disposition', `attachment; filename="${name.replace(/"/g, '')}"`);
  res.end(
    kept?.bytes ??
      `Placeholder from the dev mock: ${signed.key} is ${object.size_bytes} bytes, and its contents were never uploaded here.\n`
  );
});
route('GET', '/v1/apps/{slug}/buckets/{bucket}/compute-bindings', ({ params }) => {
  const slug = app(params.slug).slug;
  const bucket = ownedBucket(slug, params.bucket);
  return { items: storageBindings.get(`${slug}/${bucket.id}`) ?? [] };
});
route('POST', '/v1/apps/{slug}/buckets/{bucket}/compute-bindings', ({ params, body }) => {
  const slug = app(params.slug).slug;
  const bucket = ownedBucket(slug, params.bucket);
  const permission = String(body.permission ?? '') as S_['ObjectS3Credential']['permission'];
  if (!['read', 'write', 'read_write'].includes(permission))
    throw new Problem(422, 'validation_failed', 'permission must be read, write or read_write.');
  const prefix = body.prefix ? String(body.prefix) : mockBindingPrefix(bucket.name);
  if (!/^[A-Z][A-Z0-9_]{0,47}$/.test(prefix))
    throw new Problem(422, 'validation_failed', 'prefix must be UPPER_SNAKE_CASE, at most 48.');
  const list = storageBindings.get(`${slug}/${bucket.id}`) ?? [];
  if (list.some((b) => b.prefix === prefix))
    throw new Problem(409, 'conflict', `the app already has secrets named ${prefix}_*.`);
  const credential: S_['ObjectS3Credential'] = {
    id: hex(32),
    bucket_id: bucket.id,
    access_key_id: `GRGA${hex(16)
      .toUpperCase()
      .replace(/[^A-Z2-7]/g, 'A')}`,
    label: String(body.label ?? 'compute'),
    permission,
    status: 'active',
    created_at: db.iso(0),
  };
  const binding = {
    id: hex(32),
    bucket_id: bucket.id,
    scope: bucket.scope,
    prefix,
    credential,
    secret_keys: bindingSecretKeys(prefix),
    rotation_pending: false,
  };
  storageBindings.set(`${slug}/${bucket.id}`, [...list, binding]);
  s3For(slug, bucket.id).push({ ...credential });
  return status(201, binding);
});
route('DELETE', '/v1/apps/{slug}/buckets/{bucket}/compute-bindings/{binding}', ({ params }) => {
  const slug = app(params.slug).slug;
  const bucket = ownedBucket(slug, params.bucket);
  const list = storageBindings.get(`${slug}/${bucket.id}`) ?? [];
  const binding = list.find((b) => b.id === params.binding);
  if (!binding) throw new Problem(404, 'not_found', 'no such binding');
  storageBindings.set(
    `${slug}/${bucket.id}`,
    list.filter((b) => b.id !== binding.id)
  );
  const credential = s3For(slug, bucket.id).find((c) => c.id === binding.credential.id);
  if (credential) {
    credential.status = 'revoked';
    credential.revoked_at = db.iso(0);
  }
  return NO_CONTENT;
});
route(
  'POST',
  '/v1/apps/{slug}/buckets/{bucket}/compute-bindings/{binding}/rotate',
  ({ params }) => {
    const slug = app(params.slug).slug;
    const bucket = ownedBucket(slug, params.bucket);
    const binding = (storageBindings.get(`${slug}/${bucket.id}`) ?? []).find(
      (b) => b.id === params.binding
    );
    if (!binding) throw new Problem(404, 'not_found', 'no such binding');
    binding.rotation_pending = true;
    // The rolling refresh drains old instances; settle after a few seconds.
    setTimeout(() => {
      binding.rotation_pending = false;
    }, 6_000);
    return binding;
  }
);
route('GET', '/v1/apps/{slug}/buckets/{bucket}/versioning', ({ params }) => {
  const slug = app(params.slug).slug;
  const bucket = ownedBucket(slug, params.bucket);
  const on = bucket.name === 'assets';
  return {
    bucket_id: bucket.id,
    desired_status: on ? 'Enabled' : '',
    observed_status: on ? 'Enabled' : '',
    state: 'ready',
    revision: on ? 2 : 0,
    versions_required: on,
    updated_at: bucket.created_at,
  };
});
route('GET', '/v1/apps/{slug}/buckets/{bucket}/lifecycle', ({ params }) => {
  const slug = app(params.slug).slug;
  const bucket = ownedBucket(slug, params.bucket);
  return {
    bucket_id: bucket.id,
    revision: bucket.name === 'assets' ? 1 : 0,
    rules:
      bucket.name === 'assets'
        ? [
            {
              id: 'expire-tmp',
              status: 'Enabled',
              filter: { prefix: 'tmp/' },
              expiration: { days: 7 },
            },
            { id: 'abort-uploads', status: 'Enabled', abort_incomplete_multipart_days: 3 },
          ]
        : [],
    updated_at: bucket.created_at,
  };
});

// Managed PostgreSQL. Provisioning settles after a tick so the console's
// polling path is exercised; MOCK_PLAN=free reproduces the plan gate.
type PgRow = { id: string; state: string; updated_at: string } & Record<string, unknown>;
const pgDatabases: PgRow[] = [];
const pgBindings: PgRow[] = [];
const PG_QUOTA = 5;

function pgGate() {
  if (process.env.MOCK_PLAN === 'free')
    throw new Problem(
      403,
      'managed_postgres_not_in_plan',
      'plan "free": managed PostgreSQL is not included in this plan.'
    );
}

function pgSettle(row: PgRow): PgRow {
  // A row provisions for 4 seconds, then reports itself ready.
  if (row.state === 'provisioning' && Date.now() - Date.parse(row.updated_at) > 4000) {
    row.state = 'ready';
    row.updated_at = new Date().toISOString();
  } else if (row.state === 'deleting' && Date.now() - Date.parse(row.updated_at) > 4000) {
    row.state = 'deleted';
    row.updated_at = new Date().toISOString();
  }
  return row;
}

function pgDatabase(id: string) {
  const row = pgDatabases.find((d) => d.id === id);
  if (!row) throw new Problem(404, 'managed_postgres_not_found', 'no such database');
  return pgSettle(row);
}

route('GET', '/v1/postgres/databases', () => {
  pgGate();
  return {
    items: pgDatabases.map((d) => pgSettle(d as never)).filter((d) => d.state !== 'deleted'),
  };
});
route('POST', '/v1/postgres/databases', ({ body }) => {
  pgGate();
  const name = String(body.name ?? '').trim();
  if (!/^[a-z][a-z0-9-]{1,62}$/.test(name))
    throw new Problem(
      400,
      'managed_postgres_invalid',
      'a name starts with a letter and holds lower-case letters, digits and dashes.'
    );
  if (pgDatabases.some((d) => d.name === name && d.state !== 'deleted'))
    throw new Problem(409, 'managed_postgres_conflict', `a database named "${name}" exists.`);
  if (pgDatabases.filter((d) => d.state !== 'deleted').length >= PG_QUOTA)
    throw new Problem(
      403,
      'managed_postgres_quota_exceeded',
      `at most ${PG_QUOTA} managed databases on this plan.`
    );
  const major = Number(body.postgres_major);
  if (![15, 16, 17].includes(major))
    throw new Problem(422, 'managed_postgres_unsupported', `PostgreSQL ${major} is not offered.`);
  const now = new Date().toISOString();
  const database = {
    id: db.id(),
    name,
    region: String(body.region ?? 'fra'),
    postgres_major: major,
    service_class: String(body.service_class ?? 'development'),
    availability: String(body.availability ?? 'single_zone'),
    scale_to_zero: body.scale_to_zero !== false,
    storage_limit_bytes: Number(body.storage_limit_bytes ?? 10 * 1024 ** 3),
    restore_window_seconds: Number(body.restore_window_seconds ?? 7 * 24 * 3600),
    restore_source_database_id: null,
    restore_point_in_time: null,
    state: 'provisioning',
    last_error_code: null,
    created_at: now,
    updated_at: now,
  };
  pgDatabases.push(database);
  return status(201, database);
});
route('GET', '/v1/postgres/databases/{id}', ({ params }) => pgDatabase(params.id));
// A company's databases (faas org_postgres_routes.go): its own list, separate
// from the signed-in account's. acme-corp starts with one.
const orgPg = new Map<string, Record<string, unknown>[]>([
  [
    'acme-corp',
    [
      {
        id: 'pg-acme-ledger',
        name: 'acme-ledger',
        region: 'fra',
        postgres_major: 16,
        service_class: 'production',
        availability: 'single_zone',
        scale_to_zero: false,
        storage_limit_bytes: 20 * 1024 ** 3,
        restore_window_seconds: 7 * 24 * 3600,
        restore_source_database_id: null,
        restore_point_in_time: null,
        state: 'available',
        last_error_code: null,
        created_at: '2026-10-05T10:00:00Z',
        updated_at: '2026-10-05T10:00:00Z',
      },
    ],
  ],
]);
const orgDatabases = (org: string) => {
  requireOrgRole(org, ANY_MEMBER);
  if (!orgPg.has(org)) orgPg.set(org, []);
  return orgPg.get(org)!;
};
route('GET', '/v1/orgs/{organization}/postgres/databases', ({ params }) => {
  pgGate();
  return { items: orgDatabases(params.organization) };
});
route('POST', '/v1/orgs/{organization}/postgres/databases', ({ params, body }) => {
  pgGate();
  const list = orgDatabases(params.organization);
  const now = new Date().toISOString();
  const database = {
    id: db.id(),
    name: String(body.name ?? '').trim(),
    region: String(body.region ?? 'fra'),
    postgres_major: Number(body.postgres_major ?? 16),
    service_class: String(body.service_class ?? 'development'),
    availability: String(body.availability ?? 'single_zone'),
    scale_to_zero: body.scale_to_zero !== false,
    storage_limit_bytes: Number(body.storage_limit_bytes ?? 10 * 1024 ** 3),
    restore_window_seconds: Number(body.restore_window_seconds ?? 7 * 24 * 3600),
    restore_source_database_id: null,
    restore_point_in_time: null,
    state: 'available',
    last_error_code: null,
    created_at: now,
    updated_at: now,
  };
  list.push(database);
  return status(201, database);
});
route('GET', '/v1/orgs/{organization}/postgres/databases/{id}', ({ params }) => {
  const row = orgDatabases(params.organization).find((d) => d.id === params.id);
  if (!row) throw new Problem(404, 'managed_postgres_not_found', 'no such database');
  return row;
});
route('GET', '/v1/orgs/{organization}/postgres/databases/{id}/bindings', ({ params }) => {
  orgDatabases(params.organization);
  return { items: [] };
});
route('DELETE', '/v1/postgres/databases/{id}', ({ params }) => {
  const database = pgDatabase(params.id);
  database.state = 'deleting';
  database.updated_at = new Date().toISOString();
  for (const b of pgBindings.filter((x) => x.database_id === params.id)) b.state = 'deleting';
  return database;
});
route('POST', '/v1/postgres/databases/{id}/restore', ({ params, body }) => {
  const source = pgDatabase(params.id);
  const name = String(body.name ?? '').trim();
  if (!/^[a-z][a-z0-9-]{1,62}$/.test(name))
    throw new Problem(400, 'managed_postgres_invalid', 'the new database needs a valid name.');
  const at = Date.parse(String(body.point_in_time ?? ''));
  if (Number.isNaN(at))
    throw new Problem(
      400,
      'managed_postgres_invalid',
      'point_in_time must be an RFC3339 timestamp.'
    );
  const window = Number(source.restore_window_seconds) * 1000;
  if (Date.now() - at > window)
    throw new Problem(
      422,
      'managed_postgres_unsupported',
      'that point in time is older than the restore window.'
    );
  const now = new Date().toISOString();
  const restored = {
    ...source,
    id: db.id(),
    name,
    state: 'provisioning',
    restore_source_database_id: source.id,
    restore_point_in_time: new Date(at).toISOString(),
    created_at: now,
    updated_at: now,
  };
  pgDatabases.push(restored);
  return status(201, restored);
});
route('GET', '/v1/postgres/databases/{id}/bindings', ({ params }) => {
  pgDatabase(params.id);
  return {
    items: pgBindings
      .filter((b) => b.database_id === params.id)
      .map(pgSettle)
      .filter((b) => b.state !== 'deleted'),
  };
});
route('POST', '/v1/postgres/databases/{id}/bindings', ({ params, body }) => {
  const database = pgDatabase(params.id);
  if (database.state !== 'ready')
    throw new Problem(
      409,
      'managed_postgres_conflict',
      `the database is ${String(database.state)}; bind it once it is ready.`
    );
  const appId = String(body.app_id ?? '');
  if (!db.apps.some((a) => a.id === appId))
    throw new Problem(404, 'managed_postgres_not_found', 'no such app');
  const key = String(body.environment_key ?? '').trim();
  if (!/^[A-Z][A-Z0-9_]*$/.test(key))
    throw new Problem(
      400,
      'managed_postgres_invalid',
      'the secret name is upper-case letters, digits and underscores.'
    );
  const scope = String(body.scope ?? 'default');
  if (
    pgBindings.some(
      (b) =>
        b.database_id === params.id &&
        b.app_id === appId &&
        b.scope === scope &&
        b.state !== 'deleted'
    )
  )
    throw new Problem(409, 'managed_postgres_conflict', 'that app is already bound in this scope.');
  const now = new Date().toISOString();
  const binding = {
    id: db.id(),
    database_id: params.id,
    app_id: appId,
    scope,
    environment_key: key,
    access: String(body.access ?? 'read_write'),
    credential_generation: 1,
    state: 'provisioning',
    last_error_code: null,
    created_at: now,
    updated_at: now,
  };
  pgBindings.push(binding);
  return status(201, binding);
});
route('GET', '/v1/postgres/bindings/{id}', ({ params }) => {
  const binding = pgBindings.find((b) => b.id === params.id);
  if (!binding) throw new Problem(404, 'managed_postgres_not_found', 'no such binding');
  return pgSettle(binding);
});
route('DELETE', '/v1/postgres/bindings/{id}', ({ params }) => {
  const binding = pgBindings.find((b) => b.id === params.id);
  if (!binding) throw new Problem(404, 'managed_postgres_not_found', 'no such binding');
  binding.state = 'deleting';
  binding.updated_at = new Date().toISOString();
  return binding;
});

type MockInboundEndpoint = components['schemas']['InboundWebhookEndpointResponse'];
type MockWebhookBinding = components['schemas']['WebhookAutomationBindingResponse'];
const inboundEndpoints = new Map<string, MockInboundEndpoint[]>();
const webhookBindings = new Map<string, MockWebhookBinding>();
function inboundEndpoint(slug: string, id: string) {
  app(slug);
  const endpoint = (inboundEndpoints.get(slug) ?? []).find((item) => item.id === id);
  if (!endpoint) throw new Problem(404, 'inbound_webhook_not_found', 'No such endpoint.');
  return endpoint;
}
route('GET', '/v1/apps/{slug}/inbound-webhooks', ({ params }) => {
  app(params.slug);
  return inboundEndpoints.get(params.slug) ?? [];
});
route('POST', '/v1/apps/{slug}/inbound-webhooks', ({ params, body }) => {
  const owner = app(params.slug);
  const name = String(body.name ?? '');
  const path = String(body.delivery_path ?? '/');
  const secret = String(body.signing_secret ?? '');
  if (
    body.provider !== 'stripe' ||
    !/^[a-z][a-z0-9-]{0,62}$/.test(name) ||
    !path.startsWith('/') ||
    /[?#]/.test(path) ||
    !secret ||
    new TextEncoder().encode(secret).length > 256
  )
    throw new Problem(422, 'invalid_inbound_webhook', 'Invalid Stripe endpoint settings.');
  const list = inboundEndpoints.get(params.slug) ?? [];
  if (list.some((item) => item.name === name))
    throw new Problem(409, 'inbound_webhook_exists', 'An endpoint already uses that name.');
  const now = new Date().toISOString();
  const endpoint: MockInboundEndpoint = {
    id: db.id(),
    app_id: owner.id,
    account_id: db.ACCOUNT_ID,
    name,
    provider: 'stripe',
    delivery_path: path,
    enabled: body.enabled !== false,
    signing_secret_masked: '***',
    created_at: now,
    updated_at: now,
  };
  list.push(endpoint);
  inboundEndpoints.set(params.slug, list);
  // The opaque token is disclosed only on this one response, never stored in metadata.
  return status(201, {
    ...endpoint,
    endpoint_url: `https://hooks.example.test/stripe/${endpoint.id}/${randomBytes(18).toString('hex')}`,
  });
});
route('GET', '/v1/apps/{slug}/inbound-webhooks/{id}', ({ params }) =>
  inboundEndpoint(params.slug, params.id)
);
route('PATCH', '/v1/apps/{slug}/inbound-webhooks/{id}', ({ params, body }) => {
  const endpoint = inboundEndpoint(params.slug, params.id);
  if ('delivery_path' in body) {
    const path = String(body.delivery_path ?? '');
    if (!path.startsWith('/') || /[?#]/.test(path) || path.length > 256)
      throw new Problem(422, 'invalid_delivery_path');
    endpoint.delivery_path = path;
  }
  if ('signing_secret' in body && !String(body.signing_secret ?? ''))
    throw new Problem(422, 'invalid_signing_secret');
  if ('enabled' in body) endpoint.enabled = Boolean(body.enabled);
  endpoint.updated_at = new Date().toISOString();
  return endpoint;
});
route('DELETE', '/v1/apps/{slug}/inbound-webhooks/{id}', ({ params }) => {
  inboundEndpoint(params.slug, params.id);
  inboundEndpoints.set(
    params.slug,
    (inboundEndpoints.get(params.slug) ?? []).filter((item) => item.id !== params.id)
  );
  webhookBindings.delete(params.id);
  return NO_CONTENT;
});
route('GET', '/v1/apps/{slug}/inbound-webhooks/{id}/automation-binding', ({ params }) => {
  inboundEndpoint(params.slug, params.id);
  const binding = webhookBindings.get(params.id);
  if (!binding) throw new Problem(404, 'webhook_automation_binding_not_found');
  return binding;
});
route('PUT', '/v1/apps/{slug}/inbound-webhooks/{id}/automation-binding', ({ params, body }) => {
  inboundEndpoint(params.slug, params.id);
  const prior = webhookBindings.get(params.id);
  if ((prior?.version ?? 0) !== body.expected_version)
    throw new Problem(409, 'webhook_automation_binding_conflict', 'Refresh the binding.');
  const name = String(body.workflow_name ?? '');
  if (
    !body.take_over_delivery ||
    !automationMock.definitions
      .get(params.slug)
      ?.some((item) => item.name === name && item.published)
  )
    throw new Problem(422, 'automation_unpublished', 'Choose a published automation in this app.');
  const binding: MockWebhookBinding = {
    endpoint_id: params.id,
    workflow_name: name,
    event_type: String(body.event_type ?? ''),
    filter: (body.filter ?? {}) as Record<string, unknown>,
    version: (prior?.version ?? 0) + 1,
    updated_at: new Date().toISOString(),
  };
  webhookBindings.set(params.id, binding);
  return binding;
});
route('DELETE', '/v1/apps/{slug}/inbound-webhooks/{id}/automation-binding', ({ params, query }) => {
  inboundEndpoint(params.slug, params.id);
  const binding = webhookBindings.get(params.id);
  if (!binding) throw new Problem(404, 'webhook_automation_binding_not_found');
  if (binding.version !== Number(query.get('expected_version')))
    throw new Problem(409, 'webhook_automation_binding_conflict', 'Refresh the binding.');
  webhookBindings.delete(params.id);
  return NO_CONTENT;
});
route(
  'GET',
  '/v1/apps/{slug}/inbound-webhooks/{id}/automation-receipts/{event_id}',
  ({ params }) => {
    inboundEndpoint(params.slug, params.id);
    const binding = webhookBindings.get(params.id);
    if (
      !binding ||
      !['evt_mock_pending', 'evt_mock_duplicate', 'evt_mock_failed'].includes(params.event_id)
    )
      throw new Problem(404, 'webhook_automation_receipt_not_found');
    return {
      receipt_id: db.id(),
      endpoint_id: params.id,
      provider_event_id: params.event_id,
      workflow_name: binding.workflow_name,
      status: 'accepted' as const,
      duplicate: params.event_id === 'evt_mock_duplicate',
      accepted_at: new Date().toISOString(),
      event_source: `gregale.inbound.stripe.${params.id}`,
      routing_status:
        params.event_id === 'evt_mock_failed'
          ? ('failed' as const)
          : params.event_id === 'evt_mock_duplicate'
            ? ('enqueued' as const)
            : ('pending' as const),
    };
  }
);

route('GET', '/v1/apps/{slug}/webhooks', ({ params }) => listOf(db.webhooks, params.slug));

// --- Instrumented Issues -----------------------------------------------------

type MockIssue = components['schemas']['Issue'];
type MockToken = components['schemas']['IssueIngestToken'];
const mockIssues = new Map<string, MockIssue[]>();
const mockIssueTokens = new Map<string, MockToken[]>();
function issuesFor(slug: string) {
  const selected = app(slug);
  let items = mockIssues.get(slug);
  if (!items) {
    items = [
      {
        id: db.id(),
        app_id: selected.id,
        environment: 'application',
        fingerprint: 'payment-error',
        grouping_version: 1,
        title: 'PaymentError',
        state: 'open',
        first_seen_at: db.iso(48 * 3600_000),
        last_seen_at: db.iso(3600_000),
        event_count: 9,
        regression_count: 2,
        impact_24h: { identified_customers: 3, observed_events: 4, unattributed_events: 1 },
      },
      {
        id: db.id(),
        app_id: selected.id,
        environment: 'application',
        fingerprint: 'timeout-error',
        grouping_version: 1,
        title: 'TimeoutError',
        state: 'resolved',
        first_seen_at: db.iso(96 * 3600_000),
        last_seen_at: db.iso(48 * 3600_000),
        event_count: 2,
        regression_count: 0,
        impact_24h: { identified_customers: 0, observed_events: 0, unattributed_events: 0 },
      },
    ];
    mockIssues.set(slug, items);
  }
  return items;
}
function issueFor(slug: string, id: string) {
  const found = issuesFor(slug).find((item) => item.id === id);
  if (!found) throw new Problem(404, 'issue_not_found');
  return found;
}
route('GET', '/v1/apps/{slug}/issues', ({ params, query }) => {
  let items = issuesFor(params.slug).filter(
    (item) => !query.get('state') || item.state === query.get('state')
  );
  if (query.get('environment'))
    items = items.filter((item) => item.environment === query.get('environment'));
  if (query.get('assignee') === 'me')
    items = items.filter((item) => item.assignee_account_id === db.ACCOUNT_ID);
  if (query.get('assignee') === 'unassigned')
    items = items.filter((item) => !item.assignee_account_id);
  const minimum = Number(query.get('min_customers') ?? 0);
  items = items.filter((item) => (item.impact_24h?.identified_customers ?? 0) >= minimum);
  if (query.get('sort') === 'impact')
    items = [...items].sort(
      (a, b) =>
        (b.impact_24h?.identified_customers ?? 0) - (a.impact_24h?.identified_customers ?? 0)
    );
  const filters = query.toString().replace(/(?:^|&)cursor=[^&]*/, '');
  let offset = 0;
  if (query.get('cursor')) {
    try {
      const decoded = JSON.parse(Buffer.from(query.get('cursor')!, 'base64url').toString()) as {
        filters: string;
        offset: number;
      };
      if (decoded.filters !== filters) throw new Error('changed');
      offset = decoded.offset;
    } catch {
      throw new Problem(
        400,
        'invalid_issue_cursor',
        'Keep filters and ordering unchanged while paging.'
      );
    }
  }
  const page = items.slice(offset, offset + 1);
  return {
    items: page,
    next_cursor:
      offset + 1 < items.length
        ? Buffer.from(JSON.stringify({ filters, offset: offset + 1 })).toString('base64url')
        : undefined,
  };
});
route('GET', '/v1/apps/{slug}/issues/{issue_id}', ({ params, query }) => {
  const issue = issueFor(params.slug, params.issue_id);
  const deployment = db.deployments.find((item) => item.app_id === issue.app_id);
  if (!deployment) throw new Problem(404, 'deployment_not_found');
  const event = (older: boolean) => ({
    id: older ? 'mock-event-older' : 'mock-event-newer',
    event_id: db.id(),
    deployment_id: deployment.id,
    received_at: db.iso(older ? 3 * 3600_000 : 3600_000),
    occurred_at: db.iso(older ? 3 * 3600_000 : 3600_000),
    exception_type: issue.title,
    message: 'Sanitized mock exception',
    attribution: older ? 'unattributed' : 'verified',
  });
  const olderEvents = query.get('event_cursor') === 'mock-event-next';
  const olderReleases = query.get('release_cursor') === 'mock-release-next';
  const olderActivity = query.get('activity_cursor') === 'mock-activity-next';
  return {
    issue,
    impact: {
      window_start: db.iso(24 * 3600_000),
      window_end: db.iso(0),
      identified_customers: issue.impact_24h?.identified_customers ?? 0,
      observed_events: issue.impact_24h?.observed_events ?? 0,
      unattributed_events: issue.impact_24h?.unattributed_events ?? 0,
      coverage: 'retained_verified',
    },
    events: [event(olderEvents)],
    next_event_cursor: olderEvents ? undefined : 'mock-event-next',
    releases: [
      {
        deployment_id: deployment.id,
        event_count: olderReleases ? 1 : issue.event_count,
        first_seen_at: db.iso(48 * 3600_000),
        last_seen_at: db.iso(3600_000),
      },
    ],
    next_release_cursor: olderReleases ? undefined : 'mock-release-next',
    activity: [
      {
        id: olderActivity ? 'mock-action-older' : 'mock-action-newer',
        action: olderActivity ? 'reopened' : issue.state,
        created_at: db.iso(3600_000),
        details: {},
      },
    ],
    next_activity_cursor: olderActivity ? undefined : 'mock-activity-next',
  };
});
route('POST', '/v1/apps/{slug}/issues/{issue_id}/actions', ({ params, body }) => {
  const issue = issueFor(params.slug, params.issue_id);
  const action = String(body.action ?? '');
  if (action === 'assign')
    issue.assignee_account_id = body.assignee_account_id
      ? String(body.assignee_account_id)
      : undefined;
  else if (action === 'reopen') issue.state = 'open';
  else if (action === 'ignore') {
    if (!body.ignored_until || Date.parse(String(body.ignored_until)) <= Date.now())
      throw new Problem(422, 'invalid_ignore_deadline');
    issue.state = 'ignored';
    issue.ignored_until = String(body.ignored_until);
  } else if (action === 'resolve') {
    const deployment = db.deployments.find(
      (item) => item.id === body.fixed_deployment_id && item.app_id === issue.app_id
    );
    if (!deployment) throw new Problem(422, 'invalid_fix_deployment');
    issue.state = 'resolved';
    issue.fixed_deployment_id = deployment.id;
  } else throw new Problem(422, 'invalid_issue_action');
  return issue;
});
route('GET', '/v1/apps/{slug}/issue-ingest-tokens', ({ params }) => {
  app(params.slug);
  return {
    items: (mockIssueTokens.get(params.slug) ?? []).map(
      ({ token: _secret, ...metadata }) => metadata
    ),
  };
});
route('POST', '/v1/apps/{slug}/issue-ingest-tokens', ({ params, body, res }) => {
  const selected = app(params.slug);
  if ((process.env.MOCK_PLAN ?? db.account.plan) === 'free')
    throw new Problem(403, 'plan_not_entitled');
  const deployment = db.deployments.find(
    (item) => item.id === body.deployment_id && item.app_id === selected.id
  );
  if (
    !deployment ||
    body.environment !== 'application' ||
    !body.name ||
    !body.expires_at ||
    Date.parse(String(body.expires_at)) <= Date.now() ||
    Date.parse(String(body.expires_at)) > Date.now() + 90 * 24 * 3600_000
  )
    throw new Problem(422, 'invalid_issue_token_scope');
  const tokens = mockIssueTokens.get(params.slug) ?? [];
  if (
    tokens.filter((item) => !item.revoked_at && Date.parse(item.expires_at) > Date.now()).length >=
    5
  )
    throw new Problem(409, 'issue_quota_exceeded');
  const created: MockToken = {
    id: db.id(),
    app_id: selected.id,
    deployment_id: deployment.id,
    environment: 'application',
    name: String(body.name),
    expires_at: String(body.expires_at),
    token: `g_issue_${randomBytes(24).toString('base64url')}`,
  };
  tokens.unshift(created);
  mockIssueTokens.set(params.slug, tokens);
  res.setHeader('Cache-Control', 'no-store');
  return status(201, created);
});
route('DELETE', '/v1/apps/{slug}/issue-ingest-tokens/{token_id}', ({ params }) => {
  app(params.slug);
  const token = mockIssueTokens.get(params.slug)?.find((item) => item.id === params.token_id);
  if (!token) throw new Problem(404, 'issue_token_not_found');
  token.revoked_at = new Date().toISOString();
  return NO_CONTENT;
});
route('POST', '/v1/apps/{slug}/webhooks', ({ params, body }) => {
  const a = app(params.slug);
  const url = String(body.target_url ?? '');
  if (!/^https:\/\//.test(url))
    throw new Problem(400, 'invalid_target_url', 'Webhook targets must be https.');
  if (!body.webhook_secret) throw new Problem(400, 'missing_field', 'webhook_secret is required.');
  const list = listOf(db.webhooks, params.slug);
  const hook: (typeof list)[number] = {
    id: db.id(),
    app_id: a.id,
    account_id: db.ACCOUNT_ID,
    target_url: url,
    webhook_secret_sealed_masked: '***',
    event_filter: Array.isArray(body.event_filter)
      ? (body.event_filter as (typeof list)[number]['event_filter'])
      : [],
    retry_policy: (body.retry_policy ?? 'default') as (typeof list)[number]['retry_policy'],
    delivery_format: body.delivery_format === 'cloudevents' ? 'cloudevents' : 'json',
    enabled: body.enabled !== false,
    created_at: db.iso(0),
    updated_at: db.iso(0),
  };
  list.push(hook);
  db.webhooks.set(params.slug, list);
  db.deliveries.set(hook.id, []);
  return status(201, hook);
});
route('PATCH', '/v1/apps/{slug}/webhooks/{id}', ({ params, body }) => {
  const hook = listOf(db.webhooks, params.slug).find((w) => w.id === params.id);
  if (!hook) throw new Problem(404, 'webhook_not_found');
  for (const k of ['target_url', 'event_filter', 'retry_policy', 'enabled'] as const)
    if (k in body && body[k] != null) (hook as Record<string, unknown>)[k] = body[k];
  hook.updated_at = db.iso(0);
  return hook;
});
route('DELETE', '/v1/apps/{slug}/webhooks/{id}', ({ params }) => {
  const list = listOf(db.webhooks, params.slug);
  const i = list.findIndex((w) => w.id === params.id);
  if (i < 0) throw new Problem(404, 'webhook_not_found');
  list.splice(i, 1);
  return NO_CONTENT;
});
route('POST', '/v1/apps/{slug}/webhooks/{id}/rotate-secret', ({ params }) => {
  const hook = listOf(db.webhooks, params.slug).find((w) => w.id === params.id);
  if (!hook) throw new Problem(404, 'webhook_not_found');
  hook.updated_at = db.iso(0);
  return { rotated_at: hook.updated_at, webhook_secret_sealed_masked: '***' as const };
});
route('GET', '/v1/apps/{slug}/webhooks/{id}/deliveries', ({ params }) => {
  app(params.slug);
  return { deliveries: db.deliveries.get(params.id) ?? [] };
});
route('POST', '/v1/apps/{slug}/webhooks/{id}/deliveries/{did}/retry', ({ params }) => {
  const d = (db.deliveries.get(params.id) ?? []).find((x) => x.id === params.did);
  if (!d) throw new Problem(404, 'delivery_not_found');
  if (d.status !== 'dead' && d.status !== 'failed')
    throw new Problem(
      409,
      'delivery_not_retryable',
      'Only a failed or dead delivery can be retried.'
    );
  d.status = 'pending';
  d.next_attempt_at = db.iso(-5_000);
  d.updated_at = db.iso(0);
  return { delivery: d };
});

// Deployment lifecycle. Cancel refuses a live row the way the API does; retry
// answers with a new row so the console's "it appears as a new deployment"
// promise is visible in dev.
route('POST', '/v1/apps/{slug}/deployments/{id}/cancel', ({ params }) => {
  const d = db.deployments.find((x) => x.id === params.id);
  if (!d) throw new Problem(404, 'deployment_not_found');
  if (!['pending', 'building', 'imaging', 'snapshotting'].includes(d.status))
    throw new Problem(409, 'conflict', `Deployment is ${d.status} and cannot be cancelled.`);
  d.status = 'cancelled';
  return d;
});

route('POST', '/v1/deployments/{id}/retry', ({ params, body }) => {
  const d = db.deployments.find((x) => x.id === params.id);
  if (!d) throw new Problem(404, 'deployment_not_found');
  if (d.status !== 'failed')
    throw new Problem(409, 'conflict', 'Only failed deployments can be retried.');
  const stages = [
    'source_download',
    'dependency_restore',
    'image_build',
    'security_scan',
    'snapshot_prepare',
    'readiness',
  ];
  if (!stages.includes(String(body.from_stage ?? ''))) throw new Problem(400, 'invalid_from_stage');
  const a = db.apps.find((x) => x.id === d.app_id);
  if (!a) throw new Problem(404, 'app_not_found');
  const carried = { min_instances: d.min_instances, scope: d.scope };
  if (!d.build_id) {
    const copy: db.Deployment = {
      ...newDeployment(a, d.kind),
      ...carried,
      image_digest: d.image_digest,
      build_id: null,
    };
    db.deployments.unshift(copy);
    startDeployment({ deployment: copy, app: a, now: Date.now() });
    return copy;
  }
  const source = trackedDeployment(d.id)?.source ?? a.slug;
  return startSourceDeployment(a, d.kind === 'tarball' ? 'tarball' : 'github', source, carried);
});

// Deployment control (ADR-117 stages, ADR-122 canary + audit + preview URL,
// ADR-124 queue controls). MOCK_PLAN=free reproduces the plan gates.
const STAGE_ORDER = [
  'source_download',
  'dependency_restore',
  'image_build',
  'security_scan',
  'snapshot_prepare',
  'readiness',
] as const;
const STAGE_MS = [1800, 9400, 41000, 6200, 3100, 2500];
const PREVIEW_ALIVE = new Set(['pending', 'building', 'imaging', 'snapshotting', 'live']);
const CANARY_LADDER: Record<string, number[]> = {
  slow: [5, 10, 25, 50, 100],
  balanced: [10, 50, 100],
  aggressive: [25, 100],
  '1-10-50-100': [1, 10, 50, 100],
  none: [100],
};
const queueGated = process.env.MOCK_PLAN === 'free';

function gateQueueControls() {
  if (queueGated) {
    throw new Problem(
      402,
      'plan_reorder_disabled',
      "the free plan doesn't unlock deployment queue controls; upgrade to Hobby or higher."
    );
  }
}

function deploymentById(id: string) {
  const d = db.deployments.find((x) => x.id === id);
  if (!d) throw new Problem(404, 'not_found', 'no such deployment');
  return d;
}

route('GET', '/v1/deployments/{id}/diff', ({ params, query }) => {
  const d = deploymentById(params.id);
  const ref = query.get('against');
  const against = ref ? db.deployments.find((x) => x.id === ref) : undefined;
  if (ref && (!against || against.app_id !== d.app_id))
    throw new Problem(404, 'not_found', 'no such deployment of this app');
  if (against?.id === d.id)
    throw new Problem(422, 'validation_failed', 'compare a release with a different release');
  return {
    ...deploymentDetail.releaseDiff(db.deployments, d, against),
    app: db.slugById(d.app_id),
  };
});
route('GET', '/v1/deployments/{id}/runtime', ({ params }) => {
  const d = deploymentById(params.id);
  const a = db.apps.find((x) => x.id === d.app_id);
  return deploymentDetail.runtimeFor(a?.type ?? 'app', a?.runtime, d);
});
route('GET', '/v1/deployments/{id}/runtime/upgrade-preview', ({ params, query }) => {
  const d = deploymentById(params.id);
  const target = query.get('target') ?? '';
  if (!/^[0-9a-f]{64}$/.test(target))
    throw new Problem(422, 'validation_failed', 'target must be a runtime release ID');
  const a = db.apps.find((x) => x.id === d.app_id);
  const runtime = deploymentDetail.runtimeFor(a?.type ?? 'app', a?.runtime, d);
  const release = runtime.releases.find((r) => r.id === target);
  if (!release) throw new Problem(404, 'not_found', 'no such runtime release');
  return deploymentDetail.runtimePreview(runtime, release);
});
route('POST', '/v1/deployments/{id}/promote', ({ params }) => promote(params.id, false));
route('POST', '/v1/deployments/{id}/promote-with-application-ack', ({ params }) =>
  promote(params.id, true)
);
route('GET', '/v1/apps/{slug}/rollouts/{id}/observation', ({ params, query }) => {
  const a = app(params.slug);
  const selectors = [...query.keys()];
  if (selectors.length !== 1 || (query.has('scope') && query.get('scope') !== 'default'))
    throw new Problem(
      422,
      'validation_failed',
      'select exactly one telemetry environment or scope=default'
    );
  const d = db.deployments.find((x) => x.id === params.id && x.app_id === a.id);
  const scope = query.get('environment') ?? 'default';
  if (!d || (d.scope ?? 'default') !== scope)
    throw new Problem(404, 'not_found', 'no such deployment in selected environment');
  if (a.manifest?.execution_mode !== 'worker')
    throw new Problem(422, 'validation_failed', 'observation requires a worker deployment');
  return deploymentDetail.workerObservation(d);
});

/**
 * Binding-checked promotion (handlers_binding_promotion.go). The strict route
 * fails for the first app: its seeded orders database binding has no
 * application acknowledgement, which is what most real apps look like.
 */
function promote(id: string, strict: boolean) {
  const d = deploymentById(id);
  if (d.status !== 'live')
    throw new Problem(
      409,
      'conflict',
      'the app needs a live deployment with a materialized runtime image before it can run a task'
    );
  if (d.rollout_state === 'pending' || d.rollout_state === 'rolling_out')
    throw new Problem(
      409,
      'traffic_change_during_canary',
      'traffic cannot be changed directly while a canary rollout is pending or running; advance or recover the rollout, then retry.'
    );
  if (d.scheduled_release?.state === 'scheduled')
    throw new Problem(409, 'release_scheduled', 'this release waits for its scheduled start');
  const check = {
    app: db.slugById(d.app_id),
    scope: d.scope ?? 'default',
    deployment_id: d.id,
    checked_at: new Date().toISOString(),
    inventory_generated_at: new Date().toISOString(),
    max_verification_age: '10m',
    allow_unsupported: false,
    require_application_ack: strict,
    passed: true,
    coverage: 'complete',
    bindings: [],
    runtime: [],
    issues: [],
    blockers: [] as components['schemas']['BindingCheckFinding'][],
    warnings: [],
  };
  if (strict && d.app_id === db.apps[0].id) {
    check.passed = false;
    check.blockers.push({
      code: 'application_ack_missing',
      type: 'postgres',
      binding: 'orders-db',
      scope: check.scope,
      message: 'The candidate has not acknowledged applying the current secret version.',
    });
    throw new Problem(
      409,
      'bindings_check_failed',
      'Resolve the binding check blockers and verify this deployment before promoting.',
      { bindings_check: check }
    );
  }
  return {
    ...deploymentDetail.promoteDeployment(db.deployments, d),
    bindings_check: check,
  } satisfies components['schemas']['BindingPromotionResponse'];
}

route('GET', '/v1/deployments/{id}/stages', ({ params }) => {
  const d = deploymentById(params.id);
  const rec = trackedDeployment(d.id);
  if (rec && rec.written === d.status) return stagesAt(rec, Date.now());
  const started = Date.parse(d.created_at);
  const at = (i: number) => STAGE_MS.slice(0, i).reduce((sum, ms) => sum + ms, 0);
  const row = (i: number, stageStatus: 'completed' | 'failed', reason?: string) => ({
    name: STAGE_ORDER[i],
    started_at: new Date(started + at(i)).toISOString(),
    ended_at: new Date(started + at(i + 1)).toISOString(),
    duration_ms: STAGE_MS[i],
    status: stageStatus,
    ...(reason ? { reason } : {}),
  });
  if (d.status === 'pending') return { history: [] };
  if (d.status === 'building')
    return {
      current: 'image_build',
      current_started_at: new Date(started + at(2)).toISOString(),
      history: [row(0, 'completed'), row(1, 'completed')],
    };
  if (d.status === 'failed' || d.status === 'cancelled')
    return {
      history: [
        row(0, 'completed'),
        row(1, 'completed'),
        row(2, 'failed', d.error ?? 'build failed'),
      ],
    };
  return { history: STAGE_ORDER.map((_, i) => row(i, 'completed')) };
});

route('GET', '/v1/deployments/{id}/audit', ({ params, query }) => {
  const d = deploymentById(params.id);
  const limit = Math.min(500, Math.max(1, Number(query.get('limit') ?? 50) || 50));
  const items: Array<{ at: string; kind: string; actor: string; data?: unknown }> = [];
  if (d.canary_total_steps)
    items.push({
      at: d.canary_step_started_at ?? d.created_at,
      kind: 'deploy.traffic_changed',
      actor: 'canary',
      data: { step: d.canary_step, traffic_percent: d.traffic_percent },
    });
  if (d.status === 'live' || d.status === 'superseded')
    items.push({
      at: d.created_at,
      kind: 'deploy.traffic_changed',
      actor: 'system',
      data: { from: 0, to: d.traffic_percent ?? 100 },
    });
  items.push({ at: d.created_at, kind: 'deploy.created', actor: d.deployed_via ?? 'cli' });
  return { items: items.slice(0, limit), limit };
});

route('GET', '/v1/deployments/{id}/url', ({ params }) => {
  const d = deploymentById(params.id);
  const a = db.apps.find((x) => x.id === d.app_id);
  const siblings = db.deployments
    .filter((x) => x.app_id === d.app_id)
    .sort((x, y) => Date.parse(x.created_at) - Date.parse(y.created_at));
  const ordinal = siblings.findIndex((x) => x.id === d.id) + 1;
  const alive = PREVIEW_ALIVE.has(d.status);
  const host = alive && a ? `deploy-${ordinal}.${a.slug}.gregale.dev` : '';
  return {
    deployment_id: d.id,
    app_id: d.app_id,
    host,
    url: host ? `https://${host}` : '',
    alive,
    last_checked_at: new Date().toISOString(),
  };
});

route('POST', '/v1/deployments/{id}/canary/advance', ({ params, body }) => {
  if (queueGated)
    throw new Problem(
      403,
      'plan_traffic_split_not_allowed',
      'canary rollouts need the Pro or Scale plan.'
    );
  const d = deploymentById(params.id);
  const total = d.canary_total_steps ?? 0;
  const step = d.canary_step ?? 0;
  if (d.rollout_state !== 'rolling_out' || total === 0 || step >= total)
    throw new Problem(409, 'canary_step_conflict', 'deployment is not mid-rollout.');
  if (Number(body.expected_step) !== step)
    throw new Problem(
      409,
      'canary_step_conflict',
      `expected step ${step}, got ${String(body.expected_step)}.`
    );
  const ladder = CANARY_LADDER[d.canary_preset ?? 'balanced'] ?? CANARY_LADDER.balanced;
  const next = step + 1;
  d.canary_step = next;
  d.canary_step_started_at = new Date().toISOString();
  d.traffic_percent = ladder[Math.min(next, ladder.length) - 1] ?? 100;
  if (next >= total) {
    d.rollout_state = 'complete';
    d.rollout_completed_at = new Date().toISOString();
    d.traffic_percent = 100;
  }
  return { deployment: d, audit_id: db.id() };
});

route('POST', '/v1/deployments/{id}/reorder', ({ params, body }) => {
  gateQueueControls();
  const d = deploymentById(params.id);
  const priority = Number(body.priority);
  if (!Number.isInteger(priority))
    throw new Problem(400, 'validation_failed', 'body must be {"priority": <int in [0,1000]>}');
  if (d.status !== 'pending')
    throw new Problem(
      409,
      'deployment_reorder_not_pending',
      'deployment has left the pending queue.'
    );
  if (priority < 0 || priority > 1000)
    throw new Problem(422, 'deployment_reorder_priority_invalid', 'priority must be in [0,1000].');
  return { id: d.id, priority };
});

route('POST', '/v1/apps/{slug}/deployments/clear-obsolete', ({ params, body }) => {
  gateQueueControls();
  const a = app(params.slug);
  const olderThan =
    typeof body.older_than === 'string' && body.older_than ? body.older_than : '168h';
  const hours = /^(\d+)h$/.exec(olderThan);
  if (!hours)
    throw new Problem(
      400,
      'validation_failed',
      'older_than must be a Go duration in hours, e.g. 168h'
    );
  const cutoff = Date.now() - Number(hours[1]) * 3_600_000;
  const obsolete = new Set(['superseded', 'failed', 'cancelled']);
  let count = 0;
  for (let i = db.deployments.length - 1; i >= 0; i--) {
    const d = db.deployments[i];
    if (d.app_id === a.id && obsolete.has(d.status) && Date.parse(d.created_at) < cutoff) {
      db.deployments.splice(i, 1);
      count++;
    }
  }
  return { app_slug: a.slug, count, older_than: olderThan };
});

type MockQueueBinding = components['schemas']['QueueBindingResponse'];
const queueBindings = new Map<string, MockQueueBinding[]>();
const queueBindingReceipts = new Map<string, { body: string; binding: MockQueueBinding }>();
const queueNow = () => new Date().toISOString();

function workerBindings(a: db.App): MockQueueBinding[] {
  let rows = queueBindings.get(a.id);
  if (rows) return rows;
  rows =
    a.slug === 'search-indexer'
      ? [
          {
            id: db.id(),
            app_id: a.id,
            account_id: db.account.id,
            name: 'default',
            queue_name: 'orders',
            mode: 'push',
            workload_class: 'worker',
            enabled: true,
            max_concurrency: 2,
            created_at: db.iso(2 * 3_600_000),
            updated_at: db.iso(2 * 3_600_000),
          },
          {
            id: db.id(),
            app_id: a.id,
            account_id: db.account.id,
            name: 'exports',
            queue_name: 'exports',
            mode: 'pull',
            workload_class: 'worker',
            enabled: true,
            max_concurrency: 1,
            created_at: db.iso(3_600_000),
            updated_at: db.iso(3_600_000),
          },
          {
            id: db.id(),
            app_id: a.id,
            account_id: db.account.id,
            name: 'paused',
            queue_name: 'paused',
            mode: 'push',
            workload_class: 'worker',
            enabled: false,
            max_concurrency: 1,
            created_at: db.iso(3_600_000),
            updated_at: db.iso(3_600_000),
          },
        ]
      : [];
  queueBindings.set(a.id, rows);
  return rows;
}

function gateWorkerWrite(a: db.App) {
  if ((process.env.MOCK_PLAN ?? db.account.plan) === 'free')
    throw new Problem(
      403,
      'plan_worker_pools_not_allowed',
      'Worker pools require Hobby or higher.'
    );
  if (!['worker', 'job', 'http'].includes(a.workload_class ?? ''))
    throw new Problem(
      422,
      'workload_class_uncharacterized',
      'Deploy and characterize the workload first.'
    );
}

function mockBinding(a: db.App, id: string) {
  const found = workerBindings(a).find((row) => row.id === id);
  if (!found) throw new Problem(404, 'not_found', 'Queue binding not found.');
  return found;
}

route('GET', '/v1/apps/{slug}/queue-bindings', ({ params, query }) => {
  const a = app(params.slug);
  if (query.has('stage') || query.has('scope')) throw new Problem(400, 'invalid_scope');
  return workerBindings(a);
});
route('GET', '/v1/apps/{slug}/queue-bindings/{id}', ({ params }) =>
  mockBinding(app(params.slug), params.id)
);
route('GET', '/v1/apps/{slug}/queue-bindings/{id}/status', ({ params }) => {
  const row = mockBinding(app(params.slug), params.id);
  const pull = row.mode === 'pull';
  return {
    binding_id: row.id,
    name: row.name,
    queue_name: row.queue_name,
    mode: row.mode,
    workload_class: row.workload_class,
    enabled: row.enabled,
    consumer_state: pull ? 'external' : row.enabled ? 'active' : 'paused',
    consumer_liveness: pull ? 'external' : row.enabled ? 'stale' : 'not_observed',
    ...(pull ? {} : { last_poll_at: db.iso(2 * 60_000) }),
    lag_messages: pull ? null : row.enabled ? 4 : null,
    lag_age_seconds: pull ? null : row.enabled ? 90 : null,
    depth: row.name === 'default' ? 5 : 0,
    in_flight: row.name === 'default' ? 2 : 0,
    dead_letter: row.name === 'default' ? 1 : 0,
    generated_at: queueNow(),
  };
});
route('POST', '/v1/apps/{slug}/queue-bindings', ({ params, query, body, req }) => {
  const a = app(params.slug);
  if (query.has('stage') || query.has('scope')) throw new Problem(400, 'invalid_scope');
  gateWorkerWrite(a);
  const key = String(req.headers['idempotency-key'] ?? '');
  const receiptKey = `${a.id}:${key}`;
  const prior = key ? queueBindingReceipts.get(receiptKey) : undefined;
  if (prior) {
    if (prior.body !== JSON.stringify(body)) throw new Problem(409, 'idempotency_conflict');
    return status(201, prior.binding);
  }
  const name = String(body.name ?? '');
  const queueName = String(body.queue_name ?? '');
  const mode = body.mode;
  const workloadClass = body.workload_class;
  const maxConcurrency = Number(body.max_concurrency);
  if (
    !/^[a-z][a-z0-9-]{0,62}$/.test(name) ||
    !/^[a-z][a-z0-9-]{0,62}$/.test(queueName) ||
    !['pull', 'push'].includes(String(mode)) ||
    workloadClass !== a.workload_class ||
    (workloadClass === 'http' && mode === 'pull') ||
    !Number.isInteger(maxConcurrency) ||
    maxConcurrency < 1 ||
    maxConcurrency > 10000
  )
    throw new Problem(422, 'validation_failed', 'Invalid queue binding.');
  if (workerBindings(a).some((row) => row.name === name))
    throw new Problem(409, 'binding_conflict', 'Binding name already exists.');
  const row: MockQueueBinding = {
    id: db.id(),
    app_id: a.id,
    account_id: db.account.id,
    name,
    queue_name: queueName,
    mode: mode as MockQueueBinding['mode'],
    workload_class: workloadClass as MockQueueBinding['workload_class'],
    enabled: body.enabled !== false,
    max_concurrency: maxConcurrency,
    created_at: queueNow(),
    updated_at: queueNow(),
  };
  workerBindings(a).push(row);
  if (key) queueBindingReceipts.set(receiptKey, { body: JSON.stringify(body), binding: row });
  return status(201, row);
});
route('PATCH', '/v1/apps/{slug}/queue-bindings/{id}', ({ params, body }) => {
  const a = app(params.slug);
  gateWorkerWrite(a);
  const row = mockBinding(a, params.id);
  if (body.queue_name !== undefined) {
    const queueName = String(body.queue_name);
    if (!/^[a-z][a-z0-9-]{0,62}$/.test(queueName)) throw new Problem(422, 'validation_failed');
    row.queue_name = queueName;
  }
  if (body.mode !== undefined) {
    if (body.mode !== 'pull' && body.mode !== 'push') throw new Problem(422, 'validation_failed');
    row.mode = body.mode;
  }
  if (body.max_concurrency !== undefined) {
    const max = Number(body.max_concurrency);
    if (!Number.isInteger(max) || max < 1 || max > 10000)
      throw new Problem(422, 'validation_failed');
    row.max_concurrency = max;
  }
  if (body.enabled !== undefined) row.enabled = body.enabled === true;
  row.updated_at = queueNow();
  return row;
});
route('DELETE', '/v1/apps/{slug}/queue-bindings/{id}', ({ params }) => {
  const a = app(params.slug);
  gateWorkerWrite(a);
  const rows = workerBindings(a);
  const index = rows.findIndex((row) => row.id === params.id);
  if (index < 0) throw new Problem(404, 'not_found');
  rows.splice(index, 1);
  return NO_CONTENT;
});
route('PUT', '/v1/apps/{slug}/queue-workload', ({ params, body, query }) => {
  const a = app(params.slug);
  if (query.has('stage') || query.has('scope')) throw new Problem(400, 'invalid_scope');
  gateWorkerWrite(a);
  if (a.workload_class !== 'worker' && a.workload_class !== 'job')
    throw new Problem(422, 'workload_class_incompatible');
  const queueName = String(body.queue_name || 'default');
  const maxConcurrency = Number(body.max_concurrency || 1);
  const targetDepth = Number(body.target_depth || 10);
  if (
    !/^[a-z][a-z0-9-]{0,62}$/.test(queueName) ||
    !Number.isInteger(maxConcurrency) ||
    maxConcurrency < 1 ||
    maxConcurrency > 10000 ||
    !Number.isFinite(targetDepth) ||
    targetDepth <= 0
  )
    throw new Problem(422, 'validation_failed');
  const rows = workerBindings(a);
  const defaults = rows.filter((row) => row.name === 'default');
  if (defaults.length > 1) throw new Problem(409, 'binding_conflict');
  if (defaults[0] && defaults[0].queue_name !== queueName && body.force !== true)
    throw new Problem(409, 'binding_conflict', 'Default binding points at another queue.');
  const created = defaults.length === 0;
  const row: MockQueueBinding = defaults[0] ?? {
    id: db.id(),
    app_id: a.id,
    account_id: db.account.id,
    name: 'default',
    queue_name: queueName,
    mode: 'push',
    workload_class: a.workload_class,
    enabled: true,
    max_concurrency: maxConcurrency,
    created_at: queueNow(),
    updated_at: queueNow(),
  };
  row.queue_name = queueName;
  row.mode = 'push';
  row.enabled = true;
  row.max_concurrency = maxConcurrency;
  row.updated_at = queueNow();
  if (created) rows.push(row);
  a.scaling_policy = {
    min_instances: 0,
    target: { metric: 'queue_depth', value: targetDepth } as never,
  };
  return status(created ? 201 : 200, {
    app: a,
    binding: row,
    scaling_policy: a.scaling_policy,
    created,
  });
});

route('GET', '/v1/apps/{slug}/queues/state', ({ params }) => db.queueState(app(params.slug)));
route('GET', '/v1/apps/{slug}/queues/peek', ({ params }) => db.queuePeek(app(params.slug)));
route('GET', '/v1/apps/{slug}/queues/dead_letter', ({ params }) =>
  db.queueDeadLetter(app(params.slug))
);

// Replay resets the row in place. A second replay finds it already pending and
// 404s, matching the real contract the console's "already replayed" branch
// depends on.
const replayed = new Set<string>();

route('POST', '/v1/apps/{slug}/queues/dead_letter/{id}/replay', ({ params }) => {
  const key = `${params.slug}:${params.id}`;
  if (replayed.has(key)) throw new Problem(404, 'not_found', 'The row is already pending.');
  replayed.add(key);
  return NO_CONTENT;
});

// --- Logs (SSE) ---------------------------------------------------------------

route('GET', '/v1/apps/{slug}/instances', ({ params }) => {
  const a = app(params.slug);
  return db.instances.filter((i) => i.app_id === a.id);
});

route('GET', '/v1/apps/{slug}/logs', ({ params, query, req, res }) => {
  const a = app(params.slug);
  const grep = query.get('grep')?.toLowerCase() ?? '';
  const level = query.get('level') ?? '';
  const archive = query.get('archive') === '1';

  // Both archive gates answer before the stream opens, so they are ordinary
  // problem+json rather than SSE frames.
  if (archive) {
    const retention = db.ARCHIVE_RETENTION_DAYS[db.account.plan] ?? 0;
    if (retention === 0)
      throw new Problem(
        402,
        'plan_log_archive_not_allowed',
        'The free plan does not include log archive read-back; upgrade to Hobby or above to query historical logs from object storage.'
      );
    const instance = query.get('instance') ?? '';
    const date = query.get('date') ?? '';
    if (!instance || !date)
      throw new Problem(400, 'rule_invalid', 'archive=1 requires instance and date.');
    const ageDays = Math.floor((Date.now() - Date.parse(`${date}T00:00:00Z`)) / 86_400_000);
    if (ageDays < 0 || ageDays > retention)
      throw new Problem(
        403,
        'log_archive_retention_exceeded',
        `?date=${date} is outside the per-plan window of ${retention} days.`
      );
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(': mock log stream\n\n');

  const send = (event: string, data: string) => res.write(`event: ${event}\ndata: ${data}\n\n`);

  // The API validates `level` against a closed enum and short-circuits with an
  // SSE error frame rather than an HTTP status, because the stream has already
  // begun. The console renders that code.
  if (level && !['info', 'warn', 'error'].includes(level)) {
    send('error', 'invalid_level');
    res.end();
    return undefined;
  }

  // A parked app has nothing to say; the stream ends the way the real one does.
  if (db.scenarioOf(a) === 'parked') {
    send(
      'log',
      JSON.stringify({
        ts: new Date().toISOString(),
        level: 'info',
        instance_id: '',
        msg: 'instance parked — no live output',
      })
    );
    send('end', '');
    res.end();
    return undefined;
  }

  // Archive replays a stored day and ends with a reason; the SSE shape is the
  // same as live so one decoder handles both.
  if (archive) {
    const instance = query.get('instance')!;
    const date = query.get('date')!;
    const known = db.instances.some((i) => i.id === instance && i.app_id === a.id);
    if (!known) {
      send('end', 'archive_missing');
      res.end();
      return undefined;
    }
    const frames = db
      .archivedDay(instance, date)
      .filter(
        (f) => (!grep || f.msg.toLowerCase().includes(grep)) && (!level || f.level === level)
      );
    for (const frame of frames) send('log', JSON.stringify(frame));
    // Older days in this fixture were only partially shipped, which is the
    // case the degraded reason exists for.
    const ageDays = Math.floor((Date.now() - Date.parse(`${date}T00:00:00Z`)) / 86_400_000);
    send('end', ageDays > 3 ? 'archive_degraded' : 'archive_complete');
    res.end();
    return undefined;
  }

  let timer: NodeJS.Timeout | undefined;
  const tick = () => {
    const frame = db.logFrame(a);
    const matchesGrep = !grep || frame.msg.toLowerCase().includes(grep);
    const matchesLevel = !level || frame.level === level;
    if (matchesGrep && matchesLevel) send('log', JSON.stringify(frame));
    timer = setTimeout(tick, 250 + Math.random() * 900);
  };
  tick();
  req.on('close', () => clearTimeout(timer));
  return undefined; // the handler owns the response
});

// --- Account-wide lists --------------------------------------------------------

route('GET', '/v1/apps/{slug}/deployments', ({ params, query }) => {
  const selected = app(params.slug);
  const limit = Number(query.get('limit') ?? 50);
  const before = query.get('before');
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 200 ||
    (before && !Number.isFinite(Date.parse(before)))
  )
    throw new Problem(
      400,
      'validation_failed',
      'Use a limit from 1 to 200 and a valid before timestamp.'
    );
  const ordered = db.deployments
    .filter(
      (deployment) =>
        deployment.app_id === selected.id &&
        (!before || Date.parse(deployment.created_at) < Date.parse(before))
    )
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const items = ordered.slice(0, limit);
  return { items, next_before: ordered.length > limit ? items.at(-1)!.created_at : null };
});

route(
  'GET',
  '/v1/projects/{slug}/environments/{environment}/promotion-preview',
  ({ params, query }) => {
    const view = mockPromotionPreview(params.slug, params.environment, query.get('from') ?? '');
    if (!view)
      throw new Problem(
        404,
        'not_found',
        'Registered source and target environments are required.'
      );
    if (query.get('sync_config') && query.get('sync_config') !== 'false')
      throw new Problem(
        400,
        'validation_failed',
        'This fixture supports read-only target-scoped previews.'
      );
    return view;
  }
);
route('GET', '/v1/projects/{slug}/environments/{environment}/promotions', ({ params, query }) => {
  const rows = mockPromotionHistory(params.slug, params.environment);
  if (!rows) throw new Problem(404, 'not_found');
  if (query.get('before'))
    throw new Problem(400, 'validation_failed', 'No further fixture page exists.');
  const limit = Number(query.get('limit') ?? 50);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Problem(400, 'validation_failed');
  return {
    items: rows
      .filter(
        (row) =>
          (!query.get('from') || row.from_environment === query.get('from')) &&
          (!query.get('status') || row.status === query.get('status'))
      )
      .slice(0, limit),
  };
});
route(
  'GET',
  '/v1/projects/{slug}/environments/{environment}/promotions/{promotion}',
  ({ params }) => {
    const view = mockPromotionReceipt(params.slug, params.environment, params.promotion);
    if (!view) throw new Problem(404, 'not_found');
    return view;
  }
);
route(
  'GET',
  '/v1/projects/{slug}/environments/{environment}/approvals/{approval}',
  ({ params }) => {
    if (
      params.approval !== mockApprovalId ||
      !environmentInventory(params.slug)?.some((row) => row.slug === params.environment)
    )
      throw new Problem(404, 'not_found');
    return {
      approval_id: mockApprovalId,
      environment: params.environment,
      token_kind: 'promotion',
      status: 'expired',
      created_at: db.iso(30 * 60 * 60 * 1000),
      expires_at: db.iso(6 * 60 * 60 * 1000),
    } satisfies components['schemas']['ProjectEnvironmentApprovalStatusResponse'];
  }
);
route('GET', '/v1/deployments', ({ query }) => ({
  items: db.deployments.slice(0, Number(query.get('limit') ?? 50)),
  next_before: null,
}));
route('GET', '/v1/deployments/latest-by-app', () => {
  const appIDs = new Set(db.apps.map((app) => app.id));
  const seen = new Set<string>();
  const items = [...db.deployments]
    .filter((deployment) => appIDs.has(deployment.app_id))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id.localeCompare(a.id))
    .filter((deployment) => {
      if (seen.has(deployment.app_id)) return false;
      seen.add(deployment.app_id);
      return true;
    });
  return { items } satisfies components['schemas']['LatestDeploymentsByAppResponse'];
});
route('GET', '/v1/deployments/{id}', ({ params }) => {
  const d = db.deployments.find((x) => x.id === params.id);
  if (!d) throw new Problem(404, 'deployment_not_found');
  const workerApp = db.apps.find(
    (item) => item.id === d.app_id && item.manifest?.execution_mode === 'worker'
  );
  if (workerApp && d.kind === 'image' && d.status === 'imaging') {
    const reads = (workerImageReads.get(d.id) ?? 0) + 1;
    workerImageReads.set(d.id, reads);
    // The mock completes characterization after a second status read. A live
    // release permits binding setup; it is not evidence of consumer liveness.
    if (reads >= 2) {
      d.status = 'live';
      workerApp.workload_class = 'worker';
    }
  }
  return d;
});
route('GET', '/v1/builds', () => ({ items: db.builds }));
route('GET', '/v1/builds/{id}', ({ params }) => {
  const b = db.builds.find((x) => x.id === params.id);
  if (!b) throw new Problem(404, 'build_not_found');
  return b;
});
route('GET', '/v1/deployments/{id}/logs', ({ params, query, req, res }) => {
  const dep = db.deployments.find((d) => d.id === params.id);
  if (!dep) throw new Problem(404, 'deployment_not_found');
  const build = db.builds.find((b) => b.deployment_id === dep.id);
  const app = db.apps.find((a) => a.id === dep.app_id);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(': mock build log\n\n');
  const send = (event: string, data: string) => res.write(`event: ${event}\ndata: ${data}\n\n`);

  // A deployment created through the mock writes its output as it goes.
  const rec = trackedDeployment(dep.id);
  if (rec?.build) {
    const first = buildLogAt(rec, Date.now());
    const limit = Number(query.get('limit') ?? 0);
    for (const frame of limit > 0 ? first.frames.slice(-limit) : first.frames)
      send('log', JSON.stringify(frame));
    let sent = first.frames.length;
    const flush = () => {
      const { frames, done } = buildLogAt(rec, Date.now());
      for (const frame of frames.slice(sent)) send('log', JSON.stringify(frame));
      sent = frames.length;
      if (!done && rec.deployment.status !== 'cancelled') return false;
      send('end', '');
      res.end();
      return true;
    };
    if (flush()) return undefined;
    const poll = setInterval(() => flush() && clearInterval(poll), 400);
    req.on('close', () => clearInterval(poll));
    return undefined;
  }

  const lines = db.buildLog(
    app?.slug ?? 'app',
    build?.status ?? dep.status,
    dep.image_digest,
    build?.failure_class
  );
  const limit = Number(query.get('limit') ?? 0);
  const burst = limit > 0 ? lines.slice(-limit) : lines;
  for (const frame of burst) send('log', JSON.stringify(frame));

  // A finished build has nothing more to say; a running one keeps going and
  // ends when it lands, exactly like the real stream.
  if ((build?.status ?? dep.status) !== 'running' && dep.status !== 'building') {
    send('end', '');
    res.end();
    return undefined;
  }
  let step = 0;
  let timer: NodeJS.Timeout | undefined;
  const tick = () => {
    step += 1;
    send(
      'log',
      JSON.stringify({
        ts: new Date().toISOString(),
        level: 'info',
        instance_id: '',
        msg: `#${8 + step} building layer ${step}/4…`,
      })
    );
    if (step >= 4) {
      send(
        'log',
        JSON.stringify({
          ts: new Date().toISOString(),
          level: 'info',
          instance_id: '',
          msg: 'build succeeded',
        })
      );
      send('end', '');
      res.end();
      return;
    }
    timer = setTimeout(tick, 1200);
  };
  timer = setTimeout(tick, 1200);
  req.on('close', () => clearTimeout(timer));
  return undefined;
});

route('GET', '/v1/builds/{id}/sbom', ({ params, res }) => {
  const b = db.builds.find((x) => x.id === params.id);
  if (!b) throw new Problem(404, 'build_not_found');
  if (b.status !== 'succeeded')
    throw new Problem(409, 'sbom_not_ready', 'The SBOM is produced when the build succeeds.');
  res.setHeader('Content-Type', 'application/vnd.cyclonedx+json');
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: `urn:uuid:${b.id.slice(0, 8)}-0000-4000-8000-${b.id.slice(8, 20)}`,
    version: 1,
    metadata: {
      timestamp: b.finished_at,
      component: { type: 'application', name: 'app', version: b.id.slice(0, 7) },
    },
    components: [
      { type: 'library', name: 'express', version: '4.19.2', purl: 'pkg:npm/express@4.19.2' },
      { type: 'library', name: 'pg', version: '8.11.3', purl: 'pkg:npm/pg@8.11.3' },
      { type: 'library', name: 'ioredis', version: '5.3.2', purl: 'pkg:npm/ioredis@5.3.2' },
    ],
  };
});
route('GET', '/v1/deployments/{id}/scan', ({ params }) => {
  const d = db.deployments.find((x) => x.id === params.id);
  if (!d) throw new Problem(404, 'deployment_not_found');
  if (d.status === 'pending' || d.status === 'building')
    return {
      status: 'pending',
      severity_counts: { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 },
      vulnerabilities: [],
    };
  const failing = d.status === 'failed';
  const vulns = [
    {
      id: 'CVE-2024-27980',
      severity: 'HIGH',
      package: 'node',
      version: '24.1.0',
      fixed_in: '24.1.1',
      paths: ['/usr/local/bin/node'],
    },
    {
      id: 'CVE-2023-45857',
      severity: 'MEDIUM',
      package: 'axios',
      version: '1.5.1',
      fixed_in: '1.6.0',
      paths: ['/app/node_modules/axios'],
    },
    {
      id: 'GHSA-9wv6-86v2-598j',
      severity: 'LOW',
      package: 'path-to-regexp',
      version: '6.2.1',
      fixed_in: '6.3.0',
    },
  ].slice(0, failing ? 3 : 2);
  const counts = { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 };
  for (const v of vulns) counts[v.severity.toLowerCase() as keyof typeof counts]++;
  return {
    status: 'complete',
    scanned_at: d.created_at,
    scanner_version: 'grype 0.79.3',
    image_digest: d.image_digest,
    severity_counts: counts,
    vulnerabilities: vulns,
  };
});

route('GET', '/v1/domains', () => db.domains);
route('POST', '/v1/domains', ({ body }) => {
  const domain = String(body.domain ?? '')
    .toLowerCase()
    .trim();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) throw new Problem(400, 'invalid_domain');
  if (db.domains.some((d) => d.domain === domain)) throw new Problem(409, 'domain_exists');
  const a = db.appBySlug(String(body.app_slug ?? '')) ?? db.apps[0];
  const created = {
    domain,
    app_id: a.id,
    verified: false,
    challenge_token: db.id().slice(0, 24),
    txt_record: `_gregale-challenge.${domain} TXT "${db.id()}"`,
  };
  db.domains.push(created);
  return status(201, created);
});
route('DELETE', '/v1/domains/{domain}', ({ params }) => {
  const i = db.domains.findIndex((d) => d.domain === params.domain);
  if (i < 0) throw new Problem(404, 'domain_not_found');
  db.domains.splice(i, 1);
  return NO_CONTENT;
});

// Verify flips the row on the second press, so the console's "not verified
// yet" branch is reachable without waiting on real DNS. The attempt count
// lives beside the row rather than on it: the rows are schema-typed.
const verifyAttempts = new Map<string, number>();

route('POST', '/v1/domains/{domain}/verify', ({ params }) => {
  const d = db.domains.find((x) => x.domain === params.domain);
  if (!d) throw new Problem(404, 'domain_not_found');
  const n = (verifyAttempts.get(d.domain) ?? 0) + 1;
  verifyAttempts.set(d.domain, n);
  if (n > 1) {
    d.verified = true;
    d.verified_at = new Date().toISOString();
  }
  return d;
});

route('GET', '/v1/domains/{domain}/doctor', ({ params }) => {
  const d = db.domains.find((x) => x.domain === params.domain);
  if (!d) throw new Problem(404, 'domain_not_found');
  const ok = (name: string, detail: string) => ({
    name,
    status: 'ok',
    detail,
    checked_at: new Date().toISOString(),
  });
  return {
    domain: d.domain,
    app_id: d.app_id,
    stale: false,
    healthy: Boolean(d.verified),
    observed_at: new Date().toISOString(),
    checks: d.verified
      ? [
          ok('dns_record', 'CNAME resolves.'),
          ok('points_to_gregale', 'Points at edge.gregale.dev.'),
          ok('tls_certificate', 'Issued and valid.'),
          ok('caa_permits', 'No CAA record restricts issuance.'),
          ok('ipv6_conflict', 'No conflicting AAAA record.'),
        ]
      : [
          {
            name: 'dns_record',
            status: 'fail',
            detail: 'No CNAME found for this hostname.',
            observed: 'NXDOMAIN',
            remediation: `Set CNAME ${d.domain} -> edge.gregale.dev`,
            checked_at: new Date().toISOString(),
          },
          { name: 'points_to_gregale', status: 'pending', detail: 'Waiting on the DNS record.' },
          { name: 'tls_certificate', status: 'pending', detail: 'Issued once DNS resolves.' },
          ok('caa_permits', 'No CAA record restricts issuance.'),
          { name: 'ipv6_conflict', status: 'na', detail: 'No AAAA record published.' },
        ],
  };
});

// --- Debugger (ADR-127) -----------------------------------------------------
// MOCK_PLAN=free reproduces the plan gate, which is the branch that decides
// whether the page reads as broken or as "not on your plan".
const debugGated = process.env.MOCK_PLAN === 'free';

function gateDebug() {
  if (debugGated) {
    throw new Problem(
      402,
      'plan_feature_gated',
      "the free plan doesn't unlock debugger; upgrade to Hobby or higher to use event-driven features."
    );
  }
}

const DEBUG_ROUTES = ['/orders/{id}', '/health', '/webhooks/stripe', '/search'];

route('GET', '/v1/apps/{slug}/debug/requests', ({ query }) => {
  gateDebug();
  const asked = query.get('since') || '1h';
  // The server clamps to the plan's retention; 72h comes back as 24h so the
  // console's "capped" notice is reachable.
  const since = asked === '72h' ? '24h' : asked;
  const requests = Array.from({ length: 18 }, (_, i) => ({
    id: db.id(),
    deployment_id: db.deployments[i % db.deployments.length].id,
    route: DEBUG_ROUTES[i % DEBUG_ROUTES.length],
    method: (['GET', 'POST', 'GET', 'PUT'] as const)[i % 4],
    status: i % 7 === 0 ? 500 : i % 5 === 0 ? 404 : 200,
    latency_ms: i % 7 === 0 ? 2400 : 40 + i * 11,
    cold_boot: i % 6 === 0,
    trace_id: db.id() + db.id(),
    received_at: db.iso(i * 120_000),
  }));
  return { since, requests };
});

route('GET', '/v1/apps/{slug}/debug/regressions', ({ query }) => {
  gateDebug();
  return {
    since: query.get('since') || '24h',
    regressions: [
      {
        deployment_id: db.deployments[0].id,
        route: '/orders/{id}',
        p95_ms: 1840,
        p95_base_ms: 260,
        affected_count: 412,
        regression_factor: '7.08',
        first_detected_at: db.iso(5_400_000),
        last_detected_at: db.iso(120_000),
      },
      {
        deployment_id: db.deployments[0].id,
        route: '/search',
        p95_ms: 390,
        p95_base_ms: 300,
        affected_count: 27,
        regression_factor: '1.30',
        first_detected_at: db.iso(9_000_000),
        last_detected_at: db.iso(600_000),
      },
    ],
  };
});

route('POST', '/v1/apps/{slug}/debug/compare', ({ body }) => {
  gateDebug();
  if (!body.source || !body.mirror) throw new Problem(400, 'validation_failed');
  return {
    source: String(body.source),
    mirror: String(body.mirror),
    // The last route has traffic on one side only — the API does not
    // synthesise the missing percentiles, and neither should the console.
    routes: [
      {
        route: '/orders/{id}',
        source_p50_ms: 120,
        source_p95_ms: 260,
        source_p99_ms: 410,
        source_count: 5120,
        mirror_p50_ms: 640,
        mirror_p95_ms: 1840,
        mirror_p99_ms: 2600,
        mirror_count: 4980,
      },
      {
        route: '/health',
        source_p50_ms: 4,
        source_p95_ms: 9,
        source_p99_ms: 14,
        source_count: 20400,
        mirror_p50_ms: 4,
        mirror_p95_ms: 9,
        mirror_p99_ms: 15,
        mirror_count: 20110,
      },
      {
        route: '/search',
        source_p50_ms: 210,
        source_p95_ms: 480,
        source_p99_ms: 700,
        source_count: 880,
        mirror_p50_ms: 150,
        mirror_p95_ms: 300,
        mirror_p99_ms: 460,
        mirror_count: 910,
      },
      {
        route: '/webhooks/stripe',
        source_p50_ms: 88,
        source_p95_ms: 140,
        source_p99_ms: 190,
        source_count: 310,
        mirror_p50_ms: null,
        mirror_p95_ms: null,
        mirror_p99_ms: null,
        mirror_count: null,
      },
    ],
  };
});

// --- Jobs (spec 14.A) -------------------------------------------------------
// MOCK_PLAN=free reproduces the 402 jobs_not_allowed gate. Run and task states
// cover the whole enum so every badge and every empty state is reachable.
function gateJobs() {
  if (process.env.MOCK_PLAN === 'free') {
    throw new Problem(
      402,
      'jobs_not_allowed',
      'the free plan does not include jobs; upgrade to Hobby or above to run batch / one-shot workloads.'
    );
  }
}

const jobSeed = [
  { name: 'nightly-export', kind: 'batch', status: 'active', tasks: 24 },
  { name: 'reindex-search', kind: 'recurring', status: 'active', tasks: 8 },
  { name: 'legacy-backfill', kind: 'batch', status: 'paused', tasks: 120 },
];

const jobs = jobSeed.map((j) => ({
  id: db.id(),
  account_id: 'acct-1',
  name: j.name,
  kind: j.kind,
  image_ref: `registry.gregale.dev/acme/${j.name}:v3`,
  command: ['node', 'scripts/run.js'],
  ram_mb: 2048,
  task_timeout_sec: 1800,
  max_parallelism: 25,
  retry_max: 5,
  status: j.status,
  created_at: db.iso(86_400_000),
  updated_at: db.iso(3_600_000),
}));

const RUN_STATES = ['running', 'succeeded', 'failed', 'cancelled', 'queued', 'dead_letter'];
const TASK_STATES = ['succeeded', 'failed', 'timeout', 'oom', 'cancelled', 'claimed', 'queued'];

function runsFor(name: string) {
  const job = jobs.find((j) => j.name === name);
  const tasks = jobSeed.find((j) => j.name === name)?.tasks ?? 8;
  return RUN_STATES.map((state, i) => ({
    id: db.id(),
    job_id: job?.id ?? db.id(),
    account_id: 'acct-1',
    trigger_kind: (['manual', 'scheduled', 'triggered'] as const)[i % 3],
    tasks,
    parallelism: 25,
    retry_max: 5,
    task_timeout_sec: 1800,
    aggregate_status: state,
    tasks_succeeded: state === 'succeeded' ? tasks : Math.floor(tasks / 2),
    tasks_failed: state === 'failed' || state === 'dead_letter' ? 3 : 0,
    tasks_cancelled: state === 'cancelled' ? 2 : 0,
    created_at: db.iso(i * 3_600_000),
    updated_at: db.iso(i * 3_500_000),
  }));
}

const runCache = new Map<string, ReturnType<typeof runsFor>>();
const runsOf = (name: string) => {
  if (!runCache.has(name)) runCache.set(name, runsFor(name));
  return runCache.get(name)!;
};

route('GET', '/v1/jobs', () => {
  gateJobs();
  return { jobs, limit: 50, offset: 0, next_offset: -1, total: jobs.length };
});

route('POST', '/v1/jobs', ({ body }) => {
  gateJobs();
  const name = typeof body.name === 'string' ? body.name : '';
  const image = typeof body.image_ref === 'string' ? body.image_ref.trim() : '';
  const kind = body.kind ?? 'batch';
  const command = body.command;
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(name))
    throw new Problem(
      400,
      'validation_failed',
      'Use a lowercase workload name of 3–40 characters.'
    );
  if (!image || !['batch', 'recurring'].includes(String(kind)))
    throw new Problem(
      400,
      'validation_failed',
      'A container image and valid workload kind are required.'
    );
  if (
    !Array.isArray(command) ||
    command.length > 64 ||
    !command.every((arg) => typeof arg === 'string')
  )
    throw new Problem(400, 'validation_failed', 'Command must be an array of at most 64 strings.');
  if (jobs.some((job) => job.name === name))
    throw new Problem(409, 'validation_failed', `Workload name "${name}" is already in use.`);
  // Keep the dev fixture aligned with apid's plan defaults and ceilings.
  const tier = process.env.MOCK_PLAN === 'hobby' ? 0 : process.env.MOCK_PLAN === 'scale' ? 2 : 1;
  const caps = {
    ram_mb: [512, 2048, 4096][tier],
    task_timeout_sec: [300, 1800, 3600][tier],
    max_parallelism: [10, 25, 50][tier],
    retry_max: [3, 5, 10][tier],
  };
  const resources = { ...caps };
  for (const key of Object.keys(caps) as (keyof typeof caps)[]) {
    const value = body[key];
    if (value === undefined || value === 0) continue;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
      throw new Problem(400, 'validation_failed', `${key} must be a positive integer.`);
    if (value > caps[key])
      throw new Problem(
        402,
        'job_quota_exceeded',
        `${key} exceeds this plan's limit of ${caps[key]}.`
      );
    resources[key] = value;
  }
  if (jobs.length >= [5, 25, 100][tier])
    throw new Problem(402, 'job_quota_exceeded', 'Your plan has reached its workload limit.');
  const job = {
    id: db.id(),
    account_id: 'acct-1',
    name,
    kind: String(kind),
    image_ref: image,
    command: command as string[],
    ...resources,
    status: 'active',
    created_at: db.iso(0),
    updated_at: db.iso(0),
  };
  jobs.unshift(job);
  runCache.set(name, []);
  return status(201, job);
});

route('GET', '/v1/jobs/{name}', ({ params }) => {
  gateJobs();
  const j = jobs.find((x) => x.name === params.name);
  if (!j) throw new Problem(404, 'job_not_found');
  return j;
});

route('GET', '/v1/jobs/{name}', ({ params }) => {
  gateJobs();
  const job = jobs.find((j) => j.name === params.name);
  if (!job) throw new Problem(404, 'job_not_found', 'no such job');
  return job;
});
route('GET', '/v1/jobs/{name}/runs/{id}', ({ params }) => {
  gateJobs();
  const job = jobs.find((j) => j.name === params.name);
  if (!job) throw new Problem(404, 'job_not_found', 'no such job');
  const run = runsOf(job.name).find((r) => r.id === params.id);
  if (!run) throw new Problem(404, 'job_run_not_found', 'no such run');
  return run;
});
route('GET', '/v1/jobs/{name}/runs', ({ params }) => {
  gateJobs();
  if (!jobs.some((j) => j.name === params.name)) throw new Problem(404, 'job_not_found');
  const runs = runsOf(params.name);
  return { runs, limit: 50, offset: 0, next_offset: -1, total: runs.length };
});

route('GET', '/v1/jobs/{name}/runs/{id}/tasks', ({ params }) => {
  gateJobs();
  const run = runsOf(params.name).find((r) => r.id === params.id);
  if (!run) throw new Problem(404, 'job_run_not_found');
  const tasks = Array.from({ length: Math.min(run.tasks, 12) }, (_, i) => ({
    run_id: run.id,
    task_index: i,
    status: TASK_STATES[i % TASK_STATES.length],
    attempt: i % 3 === 0 ? 2 : 1,
    instance_id: db.id(),
    started_at: db.iso(600_000),
    finished_at: db.iso(300_000),
  }));
  return { tasks, limit: 50, offset: 0, next_offset: -1, total: tasks.length };
});

route('GET', '/v1/jobs/{name}/runs/{id}/tasks/{idx}/logs', ({ params }) => {
  gateJobs();
  const idx = Number(params.idx);
  // Task 1 is truncated so the console's "log was cut" notice is reachable.
  const truncated = idx === 1;
  return {
    task_status: TASK_STATES[idx % TASK_STATES.length],
    log_content: Array.from(
      { length: truncated ? 12 : 6 },
      (_, n) => `[task ${idx}] step ${n + 1} complete`
    ).join('\n'),
    truncated,
    max_bytes: 65536,
  };
});

route('POST', '/v1/jobs/{name}/runs/{id}/cancel', ({ params }) => {
  gateJobs();
  const run = runsOf(params.name).find((r) => r.id === params.id);
  if (!run) throw new Problem(404, 'job_run_not_found');
  if (run.aggregate_status !== 'running' && run.aggregate_status !== 'queued') {
    throw new Problem(409, 'job_run_not_cancellable', 'The run has already finished.');
  }
  run.aggregate_status = 'cancelled';
  return { run, cancelled_at: new Date().toISOString() };
});

// --- Triggers ---------------------------------------------------------------
// Six kinds so every pill renders, one paused, and a spread of record states
// and dead-letter reasons so each filter has something to find.
const triggerSeed = [
  { kind: 'cron', slug: 'nightly-report', enabled: true, config: { schedule: '0 3 * * *' } },
  {
    kind: 'kafka',
    slug: 'orders',
    enabled: true,
    config: { brokers: ['broker-1:9092'], topic: 'orders.v1', group: 'faas-orders' },
  },
  {
    kind: 'nats',
    slug: 'billing-events',
    enabled: false,
    config: { url: 'nats://nats:4222', stream: 'BILLING', subject: 'billing.>', durable: 'faas' },
  },
  {
    kind: 'redis_streams',
    slug: 'sessions',
    enabled: true,
    config: { addr: 'redis:6379', stream: 'sessions', group: 'faas' },
  },
  {
    kind: 'sqs_compat',
    slug: 'inbound-mail',
    enabled: true,
    config: { queue_url: 'http://sqs.local/q/mail', long_poll_secs: 20 },
  },
  { kind: 'queue', slug: 'delayed-tasks', enabled: true, config: { mode: 'delayed_task' } },
];

// Typed as the API's read shape so a created trigger can join the seeded ones
// without a cast fighting the literal types inferred from the seed.
// An empty workspace (MOCK_EMPTY=1) has no apps to attach a trigger to.
const triggers: Record<string, unknown>[] = (db.EMPTY ? [] : triggerSeed).map((t, i) => ({
  id: db.id(),
  account_id: 'acct-1',
  app_id: db.apps[i % db.apps.length].id,
  kind: t.kind,
  slug: t.slug,
  enabled: t.enabled,
  config: t.config,
  batch_size_max: t.kind === 'cron' ? 1 : 64,
  batch_window_ms: t.kind === 'cron' ? 0 : 1000,
  max_attempts: t.kind === 'cron' ? 1 : 5,
  payload_max_bytes: t.kind === 'cron' ? 1024 : 6 * 1024 * 1024,
  broker_poison_strategy: 'commit',
  created_at: db.iso(0),
  updated_at: db.iso(0),
}));

const RECORD_STATES = ['pending', 'claimed', 'succeeded', 'retry', 'dead_letter'];
const DLQ_REASONS = ['max_attempts', 'poison_record', 'broker_error', 'rate_limited'];

route('GET', '/v1/triggers', ({ query }) => {
  const kind = query.get('kind');
  return triggers.filter((t) => !kind || t.kind === kind);
});

route('GET', '/v1/triggers/{id}', ({ params }) => {
  const t = triggers.find((x) => x.id === params.id);
  if (!t) throw new Problem(404, 'trigger_not_found');
  return t;
});

// Create and delete mirror the server's per-kind validation: `kind=cron` is
// refused outright (POST /v1/crons owns those), every broker kind needs a slug
// and a config, and the config is checked field by field the way
// pkg/gregalemanifest does it.
const TRIGGER_KINDS = ['kafka', 'nats', 'redis_streams', 'sqs_compat', 'queue'];

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

function redactTriggerConfig(
  kind: string,
  input: Record<string, unknown>,
  previous: Record<string, unknown> = {}
) {
  if (kind !== 'kafka') return structuredClone(input);
  const config = structuredClone(input);
  const oldSasl = object(previous.sasl);
  const sasl = object(config.sasl);
  if (Object.keys(sasl).length > 0) {
    const passwordSet = typeof sasl.password === 'string' || oldSasl.password_set === true;
    delete sasl.password;
    delete sasl.password_sealed;
    delete sasl.password_set;
    if (passwordSet) sasl.password_set = true;
    config.sasl = sasl;
  }
  const oldTLS = object(previous.tls);
  const tls = object(config.tls);
  if (Object.keys(tls).length > 0) {
    const clientKeySet = typeof tls.client_key === 'string' || oldTLS.client_key_set === true;
    delete tls.client_key;
    delete tls.client_key_sealed;
    delete tls.client_key_set;
    if (clientKeySet) tls.client_key_set = true;
    config.tls = tls;
  }
  return config;
}

function enforceTriggerCaps(body: Record<string, unknown>, kind: string, appId: string) {
  const caps = db.account.limits;
  if (!caps.triggers_allowed) {
    throw new Problem(402, FREE_TRIGGER_ERROR_CODE, 'triggers need the Hobby plan or higher.');
  }
  if (!caps.trigger_kinds.includes(kind as never)) {
    throw new Problem(403, 'trigger_kind_not_allowed', `${kind} is not included on this plan.`);
  }
  const accountCount = triggers.filter((trigger) => trigger.kind !== 'cron').length;
  const appCount = triggers.filter(
    (trigger) => trigger.kind !== 'cron' && trigger.app_id === appId
  ).length;
  if (accountCount >= caps.trigger_limit_per_account || appCount >= caps.trigger_limit_per_app) {
    throw new Problem(403, 'plan_trigger_quota', 'the trigger count reached the plan limit.');
  }
  const checks: Array<[string, number]> = [
    ['batch_size_max', caps.trigger_batch_size_max],
    ['batch_window_ms', caps.trigger_batch_window_max_ms],
    ['max_attempts', caps.trigger_max_attempts_max],
    ['payload_max_bytes', caps.trigger_payload_max_bytes],
  ];
  for (const [field, maximum] of checks) {
    if (body[field] !== undefined && Number(body[field]) > maximum) {
      throw new Problem(
        403,
        field === 'batch_window_ms' ? 'trigger_batch_window_too_large' : 'plan_trigger_quota',
        `${field} exceeds the plan maximum of ${maximum}.`
      );
    }
  }
  const tls = object(object(body.config).tls);
  if (tls.skip_verify === true && !caps.trigger_tls_skip_verify_allowed) {
    throw new Problem(
      403,
      'trigger_tls_skip_verify_not_allowed',
      'TLS verification cannot be skipped on this plan.'
    );
  }
}

function validateTriggerConfig(kind: string, c: Record<string, unknown>) {
  const str = (k: string) => (typeof c[k] === 'string' ? (c[k] as string) : '');
  const fail = (detail: string) => {
    throw new Problem(422, 'trigger_invalid_config', detail);
  };
  if (kind === 'kafka') {
    if (!Array.isArray(c.brokers) || c.brokers.length === 0)
      fail('kafka config requires non-empty brokers');
    if (!str('topic')) fail('kafka config requires non-empty topic');
    if (!str('group')) fail('kafka config requires non-empty group');
    const sasl = object(c.sasl);
    if (
      Object.keys(sasl).length > 0 &&
      !KAFKA_SASL_MECHANISMS.includes(String(sasl.mechanism) as never)
    ) {
      fail('kafka sasl mechanism is not supported');
    }
    const tls = object(c.tls);
    const hasCert = typeof tls.client_cert === 'string' && tls.client_cert.length > 0;
    const hasKey =
      (typeof tls.client_key === 'string' && tls.client_key.length > 0) ||
      tls.client_key_set === true;
    if (hasCert !== hasKey) fail('kafka mTLS requires both client_cert and client_key');
  }
  if (kind === 'nats') {
    if (!/^(nats|tls):\/\/[^/\s]+/.test(str('url')))
      fail(`nats url must be nats:// or tls:// with a host (got "${str('url')}")`);
    if (!str('stream')) fail('nats config requires non-empty stream');
    if (!str('subject')) fail('nats config requires non-empty subject');
    if (!str('durable')) fail('nats config requires non-empty durable');
  }
  if (kind === 'redis_streams') {
    if (!str('addr')) fail('redis_streams config requires non-empty addr');
    if (!str('stream')) fail('redis_streams config requires non-empty stream');
    if (!str('group')) fail('redis_streams config requires non-empty group');
  }
  if (kind === 'sqs_compat') {
    if (!/^https?:\/\/[^/\s]+/.test(str('queue_url')))
      fail(
        `sqs_compat queue_url must be http:// or https:// with a host (got "${str('queue_url')}")`
      );
    const poll = c.long_poll_secs;
    if (typeof poll === 'number' && (poll < 1 || poll > 20))
      fail(`sqs_compat long_poll_secs=${poll} out of range [1, 20]`);
  }
  if (kind === 'queue' && !['queue', 'delayed_task'].includes(str('mode')))
    fail(`queue config mode "${str('mode')}" not in {queue, delayed_task}`);
}

route('POST', '/v1/triggers', ({ body }) => {
  const kind = String(body.kind ?? '');
  if (kind === 'cron')
    throw new Problem(
      400,
      'trigger_immutable',
      'kind=cron not supported on POST /v1/triggers — use POST /v1/crons'
    );
  if (!TRIGGER_KINDS.includes(kind))
    throw new Problem(
      400,
      'validation_failed',
      'unknown kind: must be one of cron|kafka|nats|redis_streams|sqs_compat|queue'
    );
  const slug = String(body.slug ?? '').trim();
  if (!slug) throw new Problem(400, 'validation_failed', 'slug is required for non-cron triggers');
  const config = (body.config ?? {}) as Record<string, unknown>;
  if (Object.keys(config).length === 0)
    throw new Problem(400, 'validation_failed', 'config is required for non-cron triggers');
  const appId = String(body.app_id ?? '');
  if (!db.apps.some((a) => a.id === appId)) throw new Problem(404, 'app_not_found', 'no such app');
  if (triggers.some((x) => x.slug === slug && x.app_id === appId))
    throw new Problem(409, 'conflict', `a trigger named "${slug}" exists on this app`);
  enforceTriggerCaps(body, kind, appId);
  validateTriggerConfig(kind, config);
  const defaults = triggerDefaultsFor(db.account.plan);
  const trigger = {
    id: db.id(),
    account_id: db.ACCOUNT_ID,
    app_id: appId,
    kind,
    slug,
    enabled: body.enabled !== false,
    config: redactTriggerConfig(kind, config),
    batch_size_max: Number(body.batch_size_max ?? defaults.batch_size_max),
    batch_window_ms: Number(body.batch_window_ms ?? defaults.batch_window_ms),
    max_attempts: Number(body.max_attempts ?? defaults.max_attempts),
    payload_max_bytes: Number(body.payload_max_bytes ?? defaults.payload_max_bytes),
    broker_poison_strategy: String(body.broker_poison_strategy ?? 'commit'),
    created_at: db.iso(0),
    updated_at: db.iso(0),
  };
  triggers.unshift(trigger);
  return status(201, trigger);
});

route('PATCH', '/v1/triggers/{id}', ({ params, body }) => {
  const trigger = triggers.find((item) => item.id === params.id);
  if (!trigger) throw new Problem(404, 'trigger_not_found', 'no such trigger');
  const kind = String(trigger.kind);
  const appId = String(trigger.app_id);
  // The existing row does not count as a new quota entry during update.
  const capsBody = { ...body, config: body.config ?? trigger.config };
  const limits = db.account.limits;
  for (const [field, maximum] of [
    ['batch_size_max', limits.trigger_batch_size_max],
    ['batch_window_ms', limits.trigger_batch_window_max_ms],
    ['max_attempts', limits.trigger_max_attempts_max],
    ['payload_max_bytes', limits.trigger_payload_max_bytes],
  ] as const) {
    if (body[field] !== undefined && Number(body[field]) > maximum) {
      throw new Problem(
        403,
        field === 'batch_window_ms' ? 'trigger_batch_window_too_large' : 'plan_trigger_quota'
      );
    }
  }
  const config = object(capsBody.config);
  const tls = object(config.tls);
  if (tls.skip_verify === true && !limits.trigger_tls_skip_verify_allowed) {
    throw new Problem(403, 'trigger_tls_skip_verify_not_allowed');
  }
  validateTriggerConfig(kind, config);
  if (body.config !== undefined) {
    trigger.config = redactTriggerConfig(kind, object(body.config), object(trigger.config));
  }
  for (const field of [
    'enabled',
    'batch_size_max',
    'batch_window_ms',
    'max_attempts',
    'payload_max_bytes',
    'broker_poison_strategy',
    'filter_criteria',
  ]) {
    if (body[field] !== undefined) trigger[field] = body[field];
  }
  trigger.updated_at = db.iso(0);
  void appId;
  return trigger;
});

route('DELETE', '/v1/triggers/{id}', ({ params }) => {
  const i = triggers.findIndex((x) => x.id === params.id);
  if (i < 0) throw new Problem(404, 'trigger_not_found', 'no such trigger');
  triggers.splice(i, 1);
  return NO_CONTENT;
});

route('POST', '/v1/triggers/{id}/pause', ({ params }) => {
  const t = triggers.find((x) => x.id === params.id);
  if (!t) throw new Problem(404, 'trigger_not_found');
  t.enabled = false;
  return NO_CONTENT;
});

route('POST', '/v1/triggers/{id}/resume', ({ params }) => {
  const t = triggers.find((x) => x.id === params.id);
  if (!t) throw new Problem(404, 'trigger_not_found');
  t.enabled = true;
  return NO_CONTENT;
});

route('GET', '/v1/triggers/{id}/metrics', ({ params }) => ({
  trigger_id: params.id,
  pending_count: 4,
  claimed_count: 1,
  succeeded_count: 1284,
  retry_count: 3,
  dead_letter_count: 2,
}));

route('GET', '/v1/triggers/{id}/records', ({ params, query }) => {
  const want = query.get('state');
  const records = RECORD_STATES.flatMap((state, i) =>
    Array.from({ length: state === 'succeeded' ? 3 : 1 }, (_, n) => ({
      id: db.id(),
      trigger_id: params.id,
      item_identifier: `orders.v1@${4200 + i * 10 + n}`,
      payload: JSON.stringify({ order: 1000 + i, total_cents: 4200 + i }),
      headers: JSON.stringify({ 'content-type': 'application/json' }),
      metadata: JSON.stringify({ delivery_count: state === 'retry' ? 3 : 1 }),
      state,
      attempts: state === 'retry' ? 3 : state === 'dead_letter' ? 10 : 1,
      next_fire_at: db.iso(0),
      received_at: db.iso(i * 900_000),
      last_error: state === 'retry' || state === 'dead_letter' ? 'handler returned 500' : undefined,
      last_dispatched_at: state === 'pending' ? undefined : db.iso(i * 800_000),
    }))
  );
  return { records: records.filter((r) => !want || r.state === want) };
});

route('GET', '/v1/triggers/{id}/dlq', ({ params, query }) => {
  const want = query.get('reason');
  const records = DLQ_REASONS.map((reason, i) => ({
    record_id: db.id(),
    trigger_id: params.id,
    reason,
    routed_to: reason === 'poison_record' ? 'drop' : 'manual_retry',
    detail:
      reason === 'broker_error'
        ? { broker: 'broker-1:9092', error: 'connection reset by peer' }
        : { attempts: 10, last_status: 500 },
    created_at: db.iso(i * 3_600_000),
  }));
  return { records: records.filter((r) => !want || r.reason === want) };
});

// Retry mirrors the real contract: only a record in retry or dead_letter can
// be re-driven, everything else answers 409 trigger_dlq_retry_failed. The
// console decides from the record's state, so this is the backstop for the
// dead-letter list, where the state is implied rather than shown.
const retriedRecords = new Set<string>();

route('POST', '/v1/triggers/{id}/records/{rid}/retry', ({ params }) => {
  if (retriedRecords.has(params.rid)) {
    throw new Problem(
      409,
      'trigger_dlq_retry_failed',
      'Record state was not retry or dead_letter.'
    );
  }
  retriedRecords.add(params.rid);
  return NO_CONTENT;
});

route('POST', '/v1/triggers/{id}/records/{rid}/drop', () => NO_CONTENT);

route('GET', '/v1/crons', () => db.crons);
route('POST', '/v1/crons', ({ body }) => {
  const a = db.apps.find((x) => x.id === body.app_id);
  if (!a) throw new Problem(404, 'app_not_found', 'No app with that id.');
  const schedule = String(body.schedule ?? '').trim();
  if (schedule.split(/\s+/).length !== 5)
    throw new Problem(
      400,
      'invalid_schedule',
      'A schedule has five fields: minute hour day month weekday.'
    );
  const cron = {
    id: db.id(),
    app_id: a.id,
    kind: 'http' as const,
    schedule,
    path: String(body.path ?? '/'),
    enabled: body.enabled !== false,
    timezone: String(body.timezone ?? 'UTC'),
    skip_if_running: body.skip_if_running === true,
    created_at: db.iso(0),
    last_fired_at: null,
  };
  db.crons.push(cron);
  db.cronRuns.set(cron.id, []);
  return status(201, cron);
});
route('PATCH', '/v1/crons/{id}', ({ params, body }) => {
  const c = db.crons.find((x) => x.id === params.id);
  if (!c) throw new Problem(404, 'cron_not_found');
  if (typeof body.schedule === 'string') c.schedule = body.schedule;
  if (typeof body.path === 'string') c.path = body.path;
  if (typeof body.enabled === 'boolean') c.enabled = body.enabled;
  return c;
});
route('GET', '/v1/crons/{id}/runs', ({ params }) => {
  if (!db.crons.some((x) => x.id === params.id)) throw new Problem(404, 'cron_not_found');
  return { runs: db.cronRuns.get(params.id) ?? [] };
});
// Occurrences page newest-first by occurrence id, 50 by default and 1-200
// allowed, as handlers_schedule_occurrences.go does.
route('GET', '/v1/crons/{id}/occurrences', ({ params, query }) => {
  if (!db.crons.some((x) => x.id === params.id))
    throw new Problem(404, 'not_found', 'no such cron');
  const raw = query.get('limit');
  const limit = raw === null ? 50 : Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200)
    throw new Problem(400, 'validation_failed', 'limit must be an integer between 1 and 200');
  const rows = db.cronOccurrences.get(params.id) ?? [];
  const before = query.get('before') ?? '';
  const start = before ? rows.findIndex((o) => o.id === before) + 1 : 0;
  const page = before && start === 0 ? [] : rows.slice(start, start + limit);
  return {
    occurrences: page,
    limit,
    ...(before ? { before } : {}),
    ...(page.length === limit ? { next_before: page[page.length - 1].id } : {}),
  };
});
// Cancel a command-cron run. HTTP crons, unknown runs and another cron's runs
// share one 404; app tasks off answers 501 (handlers_cron_run_cancel.go).
// MOCK_UNAVAILABLE_CAPABILITIES=app-tasks turns them off.
route('POST', '/v1/crons/{id}/runs/{run_id}/cancel', ({ params }) => {
  if ((process.env.MOCK_UNAVAILABLE_CAPABILITIES ?? '').split(',').includes('app-tasks'))
    throw new Problem(
      501,
      'not_implemented',
      'deployment-attached app tasks are not enabled on this control-plane host'
    );
  const cron = db.crons.find((x) => x.id === params.id);
  const task = db.cronTasks.get(params.run_id);
  const run = db.cronRuns.get(params.id)?.find((r) => r.task_id === params.run_id);
  if (!cron || cron.kind !== 'command' || !task || !run)
    throw new Problem(404, 'not_found', 'no such cron run');
  const now = db.iso(0);
  if (task.status === 'queued') {
    Object.assign(task, { status: 'cancelled', finished_at: now, updated_at: now });
  } else if (task.status === 'restoring' || task.status === 'running') {
    task.cancel_requested_at ??= now;
    task.updated_at = now;
  }
  const answer = { ...task };
  // The worker stops a running task promptly; the next read shows it settled.
  if (task.status === 'running' || task.status === 'restoring') {
    Object.assign(task, { status: 'cancelled', finished_at: now });
  }
  if (task.status === 'cancelled') {
    Object.assign(run, {
      outcome: 'cancelled',
      completed_at: now,
      duration_ms: Date.parse(now) - Date.parse(run.started_at),
    });
    const occurrence = db.cronOccurrences
      .get(params.id)
      ?.find((o) => o.app_task_id === params.run_id);
    if (occurrence) Object.assign(occurrence, { status: 'cancelled', finished_at: now });
  }
  return status(202, answer);
});
route('DELETE', '/v1/crons/{id}', ({ params }) => {
  const i = db.crons.findIndex((c) => c.id === params.id);
  if (i < 0) throw new Problem(404, 'cron_not_found');
  db.crons.splice(i, 1);
  return NO_CONTENT;
});
route('POST', '/v1/crons/{id}/run', ({ params }) => {
  const c = db.crons.find((x) => x.id === params.id);
  if (!c) throw new Problem(404, 'cron_not_found');
  c.last_fired_at = db.iso(0);
  return status(202, { request_id: db.id(), cron_id: c.id, status: 'pending' });
});

route('GET', '/v1/keys', () => db.keys.map(({ plaintext: _omit, ...k }) => k));
route('POST', '/v1/keys', ({ body }) => {
  const created: (typeof db.keys)[number] = {
    id: db.id(),
    org_id: db.ORG_ID,
    prefix: `grg_live_${db.id().slice(0, 4)}`,
    label: String(body.label ?? 'Untitled key'),
    scopes: (Array.isArray(body.scopes)
      ? body.scopes
      : ['apps:read']) as (typeof db.keys)[number]['scopes'],
    last_used_at: null,
    created_at: db.iso(0),
    status: 'active',
  };
  db.keys.push(created);
  return status(201, { ...created, plaintext: `${created.prefix}_${db.id()}` });
});
route('DELETE', '/v1/keys/{id}', ({ params }) => {
  const i = db.keys.findIndex((k) => k.id === params.id);
  if (i < 0) throw new Problem(404, 'key_not_found');
  db.keys.splice(i, 1);
  return NO_CONTENT;
});
route('POST', '/v1/keys/{id}/rotate', ({ params }) => {
  const old = db.keys.find((k) => k.id === params.id);
  if (!old) throw new Problem(404, 'key_not_found');
  old.status = 'grace';
  old.expires_at = db.iso(-24 * 3_600_000);
  const key: (typeof db.keys)[number] = {
    ...old,
    id: db.id(),
    prefix: `grg_live_${db.id().slice(0, 4)}`,
    status: 'active',
    expires_at: null,
    created_at: db.iso(0),
    rotated_from_id: old.id,
  };
  db.keys.push(key);
  return {
    key,
    key_plaintext: `${key.prefix}_${db.id()}`,
    old_key_id: old.id,
    old_key_expires_at: old.expires_at,
  };
});

route('GET', '/v1/edge-rules', () => db.edgeRules);
route('GET', '/v1/apps/{slug}/edge-rules', ({ params }) => {
  const a = app(params.slug);
  return db.edgeRules.filter((r) => r.app_id === a.id);
});

/** jwt and ip are paid; geo is allowed on free with a tighter quota. */
const PAID_KINDS = new Set(['jwt', 'ip', 'cache']);
const QUOTA_PER_APP = 12;
const FREE_GEO_QUOTA = 2;

route('POST', '/v1/apps/{slug}/edge-rules', ({ params, body }) => {
  const a = app(params.slug);
  const kind = String(body.kind ?? '');
  if (!kind) throw new Problem(400, 'rule_invalid', 'A kind is required.');

  if (PAID_KINDS.has(kind) && db.account.plan === 'free')
    throw new Problem(402, 'plan_edge_rule_kind_not_allowed', `${kind} rules need a paid plan.`);

  const onApp = db.edgeRules.filter((r) => r.app_id === a.id);
  if (onApp.length >= QUOTA_PER_APP)
    throw new Problem(
      402,
      'plan_limit_edge_rules',
      `This app is at its limit of ${QUOTA_PER_APP} edge rules.`
    );
  if (
    kind === 'geo' &&
    db.account.plan === 'free' &&
    onApp.filter((r) => r.kind === 'geo').length >= FREE_GEO_QUOTA
  )
    throw new Problem(
      402,
      'plan_limit_edge_rules',
      `Free plans allow ${FREE_GEO_QUOTA} geo rules per app.`
    );

  // The API documents `edge_rule_conflict` for "duplicate or overlapping rule
  // state" without saying what overlaps. A same-priority, same-host, same-path
  // pair is the clearest case and is what this mock rejects, so the console's
  // 409 branch has something to render — the real predicate may be broader.
  if (
    onApp.some(
      (r) =>
        r.priority === Number(body.priority) &&
        r.match_host === String(body.match_host ?? '') &&
        r.match_path === String(body.match_path ?? '')
    )
  )
    throw new Problem(
      409,
      'edge_rule_conflict',
      'Another rule already has that priority for this host and path.'
    );

  const rule = {
    id: db.id(),
    account_id: db.ACCOUNT_ID,
    app_id: a.id,
    match_host: String(body.match_host ?? ''),
    match_path: String(body.match_path ?? '/*'),
    match_methods: Array.isArray(body.match_methods) ? (body.match_methods as string[]) : [],
    match_headers:
      body.match_headers && typeof body.match_headers === 'object'
        ? (body.match_headers as Record<string, string>)
        : {},
    priority: Number(body.priority ?? 100),
    enabled: body.enabled !== false,
    kind: kind as (typeof db.edgeRules)[number]['kind'],
    validate_mode: (body.validate_mode ??
      'block') as (typeof db.edgeRules)[number]['validate_mode'],
    action: body.action as (typeof db.edgeRules)[number]['action'],
    created_at: db.iso(0),
    updated_at: db.iso(0),
  };
  db.edgeRules.push(rule);
  return status(201, rule);
});

route('PATCH', '/v1/edge-rules/{id}', ({ params, body }) => {
  const rule = db.edgeRules.find((r) => r.id === params.id);
  if (!rule) throw new Problem(404, 'edge_rule_not_found');
  // Rotating kind would break the action union; the spec says recreate.
  if ('kind' in body && body.kind && body.kind !== rule.kind)
    throw new Problem(
      422,
      'rule_invalid',
      'Kind cannot be changed. Delete the rule and create a new one.'
    );
  for (const k of ['match_host', 'match_path', 'match_methods', 'priority', 'enabled'] as const)
    if (k in body && body[k] != null) (rule as Record<string, unknown>)[k] = body[k];
  // `action` replaces whole — there is no partial shape for it.
  if (body.action) rule.action = body.action as typeof rule.action;
  rule.updated_at = db.iso(0);
  return rule;
});

route('GET', '/v1/apps/{slug}/throttle-suggestions', ({ params, query }) => {
  const a = app(params.slug);
  const range = String(query.get('range') ?? '5m');
  if (!a.route_metrics_enabled)
    return {
      app_id: a.id,
      range,
      source: 'prometheus',
      as_of: db.iso(0),
      route_metrics_disabled: true,
      routes_collapsed: 0,
      plan_ceiling_rps: 500,
      plan_ceiling_burst: 1000,
      multiplier: 1.5,
      suggestions: [],
    };
  const routes = db
    .routesFor(a)
    .routes.filter((r) => !r.includes('*'))
    .slice(0, 5);
  return {
    app_id: a.id,
    range,
    source: 'prometheus',
    as_of: db.iso(0),
    route_metrics_disabled: false,
    routes_collapsed: 0,
    plan_ceiling_rps: 500,
    plan_ceiling_burst: 1000,
    multiplier: 1.5,
    suggestions: routes.map((route, i) => {
      const observed = Number((12 / (i + 1)).toFixed(1));
      const suggested = Math.min(500, Math.max(1, Math.ceil(observed * 1.5)));
      return {
        route,
        observed_rps: observed,
        suggested_rps: suggested,
        suggested_burst: Math.min(1000, suggested * 2),
      };
    }),
  };
});
route('DELETE', '/v1/edge-rules/{id}', ({ params }) => {
  const i = db.edgeRules.findIndex((r) => r.id === params.id);
  if (i < 0) throw new Problem(404, 'edge_rule_not_found');
  db.edgeRules.splice(i, 1);
  return NO_CONTENT;
});

route('GET', '/v1/invocations', ({ query }) => ({
  invocations: db.invocations.slice(0, Number(query.get('limit') ?? 50)),
}));
route('GET', '/v1/invocations/{id}', ({ params }) => {
  const inv = db.invocations.find((x) => x.id === params.id);
  if (!inv) throw new Problem(404, 'invocation_not_found');
  return inv;
});
route('POST', '/v1/invocations/{id}/replay', ({ params }) => {
  const inv = db.invocations.find((x) => x.id === params.id);
  if (!inv) throw new Problem(404, 'invocation_not_found');
  const replay = {
    ...inv,
    id: db.id(),
    source: 'replay' as const,
    state: 'pending' as const,
    created_at: db.iso(0),
    completed_at: null,
    last_error: null,
    attempts: 0,
  };
  db.invocations.unshift(replay);
  return status(202, { id: replay.id, status_url: `/v1/invocations/${replay.id}` });
});

route('GET', '/v1/instances', () => ({ instances: db.instances, next_before: null }));
route('GET', '/v1/audit-log', ({ query }) => {
  const limit = Number(query.get('limit') ?? 50);
  return { entries: db.audit.slice(0, limit), limit };
});

route('GET', '/v1/usage/summary', () => db.usage);
route('GET', '/v1/usage/storage', () => ({ items: db.storage }));
route('GET', '/v1/invoices', () => ({ items: db.invoices, next_before: null }));
route('GET', '/v1/billing/portal', () => db.billingPortal);

const orgMembers = new Map(
  db.orgs.map((org) => [
    org.slug,
    db.members
      .filter((member) => !org.personal || member.role === 'owner')
      .map((member) => ({ ...member })),
  ])
);
function mockOrg(slug: string) {
  const org = db.orgs.find((org) => org.slug === slug);
  if (!org) throw new Problem(404, 'org_not_found');
  return org;
}
function mockOrgMembers(slug: string) {
  mockOrg(slug);
  return orgMembers.get(slug) ?? [];
}
function requireOrgRole(slug: string, roles: string[], mutable = false) {
  const org = mockOrg(slug);
  if (mutable && org.personal) throw new Problem(409, 'org_personal_immutable');
  const role = mockOrgMembers(slug).find((member) => member.email === db.account.email)?.role;
  if (!role || !roles.includes(role)) throw new Problem(403, 'org_role_forbidden');
  return org;
}
// Company billing (faas org_billing_routes.go): status and usage for any
// member, invoices for owners and billing admins. MOCK_ORG_ROLE overrides the
// signed-in member's role, to see a refusal.
function requireOrgBillingRole(slug: string, roles: string[]) {
  const forced = process.env.MOCK_ORG_ROLE;
  if (forced && !roles.includes(forced)) throw new Problem(403, 'org_role_forbidden');
  return requireOrgRole(slug, forced ? [...roles, forced] : roles);
}
const ANY_MEMBER = ['owner', 'admin', 'developer', 'viewer', 'billing', 'member'];
route('GET', '/v1/orgs/{slug}/billing/status', ({ params }) => {
  requireOrgBillingRole(params.slug, ANY_MEMBER);
  return {
    mode: 'live',
    enabled: true,
    provider: 'stripe',
    plan: 'pro',
    account_status: 'active',
    customer_configured: true,
    subscription_configured: true,
    usage_reconciliation_enabled: true,
  };
});
route('GET', '/v1/orgs/{slug}/usage', ({ params }) => {
  requireOrgBillingRole(params.slug, ANY_MEMBER);
  return inventoryForOrg(params.slug).map((app, i) => ({
    app_id: app.id,
    mb_seconds: 3_686_400 * (i + 2),
    requests: 12_400 * (i + 1),
    included_gb_hours: 1000,
    cold_boots: 4 + i,
  }));
});
route('GET', '/v1/orgs/{slug}/invoices', ({ params }) => {
  requireOrgBillingRole(params.slug, ['owner', 'billing']);
  return {
    items: [
      {
        id: 'org-inv-1',
        number: 'ACME-0042',
        provider: 'stripe',
        provider_invoice_id: 'in_acme_0042',
        status: 'paid',
        period_start: '2026-09-01T00:00:00Z',
        period_end: '2026-09-30T23:59:59Z',
        subtotal_cents: 4900,
        tax_cents: 0,
        total_cents: 4900,
        amount_paid_cents: 4900,
        currency: 'usd',
        pdf_available: true,
        created_at: '2026-10-01T00:00:00Z',
      },
    ],
    next_before: null,
  };
});
route('GET', '/v1/orgs/{slug}/billing/portal', ({ params }) => {
  requireOrgBillingRole(params.slug, ['owner']);
  return { url: 'https://billing.example.test/portal/acme', payment_method: 'card' };
});

route('GET', '/v1/orgs', () => ({
  orgs: db.orgs
    .filter((org) => org.status !== 'deleted_pending')
    .sort((a, b) => a.slug.localeCompare(b.slug)),
}));

/** App slug → workspace slug, for apps created through `POST /v1/orgs/{slug}/apps`. */
const appWorkspace = new Map<string, string>();
function inventoryForOrg(slug: string) {
  const org = requireOrgRole(slug, ['owner', 'admin', 'developer', 'viewer', 'billing']);
  return db.apps.filter((app) => {
    const attributed = appWorkspace.get(app.slug);
    if (attributed) return attributed === slug;
    return org.personal
      ? app.slug !== 'search-indexer'
      : slug === 'acme-corp' && app.slug === 'search-indexer';
  });
}
const createdAt = (app: db.App) =>
  (app as { created_at?: string }).created_at ?? new Date(Date.UTC(2026, 8, 1)).toISOString();
route('GET', '/v1/orgs/{slug}/apps', ({ params }) => ({
  apps: inventoryForOrg(params.slug)
    .map((app) => ({
      id: app.id,
      slug: app.slug,
      type: app.type,
      runtime: app.runtime,
      status: app.status,
      created_at: createdAt(app),
    }))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)),
}));
route('POST', '/v1/orgs/{slug}/apps', ({ params, body, req }) => {
  requireOrgRole(params.slug, ['owner', 'admin', 'developer']);
  const result = createMockApp(body, req);
  appWorkspace.set((result.body as db.App).slug, params.slug);
  return result;
});
route('GET', '/v1/orgs/{slug}/activity', ({ params, query }) => {
  const apps = new Set(inventoryForOrg(params.slug).map((app) => app.id));
  const identity = (value: string) => value.replaceAll('-', '').toLowerCase();
  const appId = query.get('app_id');
  if (appId && !/^(?:[a-f\d]{32}|[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})$/i.test(appId))
    throw new Problem(400, 'validation_failed');
  const raw = query.get('before');
  if (raw && !/^activity:\d+$/.test(raw))
    throw new Problem(400, 'validation_failed', 'Invalid activity cursor.');
  const limit = Math.min(100, Math.max(1, Number(query.get('limit') ?? 50)));
  const offset = raw ? Number(raw.split(':')[1]) : 0;
  const rows = db.orgActivity
    .filter(
      (row) =>
        apps.has(row.app_id ?? '') &&
        (!appId || identity(row.app_id ?? '') === identity(appId)) &&
        (!query.get('kind_prefix') || row.kind.startsWith(query.get('kind_prefix')!)) &&
        (!query.get('actor_type') || row.actor.type === query.get('actor_type'))
    )
    .sort(
      (left, right) =>
        right.occurred_at.localeCompare(left.occurred_at) || Number(right.id) - Number(left.id)
    );
  return {
    items: rows.slice(offset, offset + limit),
    ...(rows.length > offset + limit ? { next_before: `activity:${offset + limit}` } : {}),
  };
});

route('POST', '/v1/orgs', ({ body }) => {
  const slug = String(body.slug ?? '');
  const name = String(body.name ?? '').trim();
  if (!/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(slug)) throw new Problem(422, 'org_slug_invalid');
  if (!name || name.length > 256) throw new Problem(400, 'validation_failed');
  if (db.orgs.some((org) => org.slug === slug)) throw new Problem(409, 'org_slug_taken');
  const org: (typeof db.orgs)[number] = {
    id: db.id(),
    slug,
    name,
    personal: false,
    plan: 'free',
    status: 'active',
    created_at: db.iso(0),
    updated_at: db.iso(0),
  };
  db.orgs.push(org);
  orgMembers.set(slug, [
    { ...db.members[0], email: db.account.email, role: 'owner', joined_at: db.iso(0) },
  ]);
  return status(201, org);
});
route('GET', '/v1/orgs/{slug}/members', ({ params }) => ({ members: mockOrgMembers(params.slug) }));
route('GET', '/v1/orgs/{slug}/invitations', ({ params }) => ({
  invitations: db.invitations.filter((invitation) => invitation.org_slug === params.slug),
}));
const invitationTokenHashes = new Map<string, string>();
route('POST', '/v1/orgs/{slug}/members', ({ params, body }) => {
  const org = requireOrgRole(params.slug, ['owner', 'admin'], true);
  const email = String(body.email ?? '')
    .trim()
    .toLowerCase();
  if (!email.includes('@'))
    throw new Problem(400, 'invalid_email', 'That does not look like an email address.');
  if (mockOrgMembers(params.slug).some((m) => m.email === email))
    throw new Problem(409, 'already_member', `${email} is already a member.`);
  const inv: (typeof db.invitations)[number] = {
    id: db.id(),
    org_id: org.id,
    org_slug: org.slug,
    email,
    role: (body.role ?? 'developer') as (typeof db.invitations)[number]['role'],
    status: 'pending',
    expires_at: db.iso(-7 * 24 * 3_600_000),
    created_at: db.iso(0),
  };
  db.invitations.unshift(inv);
  // The plaintext token is returned exactly once, like a minted API key.
  const plaintext = randomBytes(32);
  invitationTokenHashes.set(inv.id, createHash('sha256').update(plaintext).digest('hex'));
  return status(201, { ...inv, token: plaintext.toString('base64url') });
});
route('PATCH', '/v1/orgs/{slug}/members/{user_id}', ({ params, body }) => {
  requireOrgRole(params.slug, ['owner']);
  const m = mockOrgMembers(params.slug).find((x) => x.account_id === params.user_id);
  if (!m) throw new Problem(404, 'member_not_found');
  if (m.role === 'owner')
    throw new Problem(409, 'cannot_change_owner_role', 'Transfer ownership instead.');
  m.role = body.role as typeof m.role;
  return m;
});
route('DELETE', '/v1/orgs/{slug}/members/{user_id}', ({ params }) => {
  requireOrgRole(params.slug, ['owner']);
  const members = mockOrgMembers(params.slug);
  const i = members.findIndex((x) => x.account_id === params.user_id);
  if (i < 0) throw new Problem(404, 'member_not_found');
  if (members[i].role === 'owner')
    throw new Problem(409, 'cannot_remove_owner', 'Transfer ownership first.');
  members.splice(i, 1);
  return NO_CONTENT;
});
route('DELETE', '/v1/orgs/{slug}/invitations/{invitation_id}', ({ params }) => {
  requireOrgRole(params.slug, ['owner', 'admin']);
  const inv = db.invitations.find(
    (x) => x.id === params.invitation_id && x.org_slug === params.slug
  );
  if (!inv || inv.status !== 'pending' || Date.parse(inv.expires_at) <= Date.now())
    throw new Problem(410, 'org_invitation_invalid');
  inv.status = 'revoked';
  return NO_CONTENT;
});

const hex = (n: number) =>
  Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');

// --- GitHub installation repos + app binding ---
function requireGitHub() {
  if (!db.account.github_install_id)
    throw new Problem(403, 'github_login_required', 'Connect GitHub before choosing a repository.');
}
// The native form post apid answers with a redirect to GitHub. The mock grants
// the installation and redirects to where GitHub's callback would land.
route('POST', '/dashboard/install/connect', ({ body, req, res }) => {
  if (body.csrf_token !== 'mock-csrf') {
    res.setHeader('Location', CONNECT_FORBIDDEN);
    return status(303, '');
  }
  db.account.github_install_id = MOCK_INSTALL_ID;
  res.setHeader(
    'Location',
    connectReturnTarget(body.return_to, req.headers.referer, req.headers.host)
  );
  return status(303, '');
});
const INSTALL_REPOS = [
  { id: 1001, full_name: 'acme-corp/storefront', default_branch: 'main', private: true },
  { id: 1002, full_name: 'acme-corp/checkout', default_branch: 'main', private: true },
  { id: 1003, full_name: 'acme-corp/webhook-router', default_branch: 'master', private: false },
  { id: 1004, full_name: 'acme-corp/nightly-etl', default_branch: 'main', private: true },
];
route('POST', '/v1/install/repos/list', () => {
  requireGitHub();
  const seeded = [...INSTALL_REPOS];
  // MOCK_REPOS=<n> pads the installation to n repositories across a few
  // owners, to see the New app repository list as a large account sees it.
  const total = Number(process.env.MOCK_REPOS ?? 0);
  const owners = ['acme-corp', 'acme-labs', 'design-ops'];
  const words = ['billing', 'search', 'auth', 'media', 'events', 'catalog', 'inbox', 'ledger'];
  for (let i = seeded.length; i < total; i++)
    seeded.push({
      id: 2000 + i,
      full_name: `${owners[i % owners.length]}/${words[i % words.length]}-${['api', 'worker', 'web', 'cron'][i % 4]}-${i}`,
      default_branch: i % 5 ? 'main' : 'develop',
      private: i % 3 !== 0,
    });
  return seeded;
});

// Per-app bindings and the installation's reconcile record, as
// handlers_github_connection.go projects them. Health is the installation's,
// so it is shared by every app. Binding a repository the installation cannot
// see succeeds here (apid would check first) so a sync can show a detach.
type GitHubStatus = S_['GitHubInstallStatus'];
const githubBindings = new Map<
  string,
  {
    repo: string;
    branch: string;
    id: string;
    linkedAt: string;
    activity?: GitHubStatus['activity'];
  }
>();
const githubInstall = { reconciledAt: db.iso(12 * 60_000), repoCount: 4, detached: 0 };
const GITHUB_MANAGE_CSRF = 'mock-github-manage';
if (!db.EMPTY) {
  const sha = '9f2c4e1a7b3d5f60718293a4b5c6d7e8f9012345';
  githubBindings.set('api-gateway', {
    repo: 'acme-corp/storefront',
    branch: 'main',
    id: 'bind-api-gateway-acme-corp/storefront',
    linkedAt: db.iso(6 * 86_400_000),
    activity: {
      webhook_deliveries: [
        {
          event_type: 'push',
          status: 'succeeded',
          commit_sha: sha,
          received_at: db.iso(41 * 60_000),
          processed_at: db.iso(41 * 60_000),
          updated_at: db.iso(41 * 60_000),
        },
      ],
      check_updates: [
        {
          deployment_id: db.id(),
          status: 'succeeded',
          commit_sha: sha,
          processed_at: db.iso(38 * 60_000),
          updated_at: db.iso(38 * 60_000),
        },
        {
          deployment_id: db.id(),
          status: 'dead',
          commit_sha: 'c71e0b9d2a4f6e8013579bdf2468ace013579bdf',
          processed_at: null,
          updated_at: db.iso(26 * 3_600_000),
        },
      ],
    },
  });
  githubBindings.set('webhook-router', {
    repo: 'acme-corp/webhook-router',
    branch: 'master',
    id: 'bind-webhook-router-acme-corp/webhook-router',
    linkedAt: db.iso(20 * 86_400_000),
  });
}
function githubStatus(slug: string): GitHubStatus {
  const installId = db.account.github_install_id;
  if (!installId)
    return {
      state: 'not_installed',
      health: 'not_connected',
      connected: false,
      last_reconcile_repository_count: 0,
      last_reconcile_detached_count: 0,
    };
  const install = {
    installation_id: Number(installId),
    github_login: 'acme-corp',
    default_branch: 'main',
    health: 'healthy' as const,
    last_reconciled_at: githubInstall.reconciledAt,
    last_reconcile_repository_count: githubInstall.repoCount,
    last_reconcile_detached_count: githubInstall.detached,
  };
  const binding = githubBindings.get(slug);
  if (!binding) return { state: 'installed', connected: false, ...install };
  return {
    state: 'bound',
    connected: true,
    ...install,
    repo_full_name: binding.repo,
    production_branch: binding.branch,
    binding_id: binding.id,
    linked_at: binding.linkedAt,
    activity: binding.activity ?? { webhook_deliveries: [], check_updates: [] },
  };
}
function requireGitHubManageCSRF(body: Record<string, unknown>) {
  if (body.csrf_token !== GITHUB_MANAGE_CSRF)
    throw new Problem(400, 'validation_failed', 'please reload the page and try again');
}
// GET /install and GET /install/bind are one handler in apid (server.go:5065-5066).
const githubStatusRead: Handler = ({ params, res }) => {
  app(params.slug);
  res.setHeader(
    'Set-Cookie',
    `faas_csrf_github_install=${GITHUB_MANAGE_CSRF}; Path=/; HttpOnly; SameSite=Lax`
  );
  return { ...githubStatus(params.slug), csrf_token: GITHUB_MANAGE_CSRF };
};
route('GET', '/v1/apps/{slug}/install', githubStatusRead);
route('GET', '/v1/apps/{slug}/install/bind', githubStatusRead);
route('POST', '/v1/apps/{slug}/install/sync', ({ params, body }) => {
  requireGitHubManageCSRF(body);
  app(params.slug);
  const binding = githubBindings.get(params.slug);
  if (!binding)
    throw new Problem(409, 'github_not_bound', 'bind a repository before requesting a sync');
  if (!db.account.github_install_id)
    throw new Problem(409, 'github_install_not_found', 'reconnect GitHub before syncing this app');
  const found = INSTALL_REPOS.some(
    (repo) => repo.full_name.toLowerCase() === binding.repo.toLowerCase()
  );
  if (!found) githubBindings.delete(params.slug);
  const syncedAt = new Date().toISOString();
  Object.assign(githubInstall, {
    reconciledAt: syncedAt,
    repoCount: INSTALL_REPOS.length,
    detached: found ? 0 : 1,
  });
  return {
    ...githubStatus(params.slug),
    sync_result: {
      detached: !found,
      remote_repository_count: INSTALL_REPOS.length,
      synced_at: syncedAt,
    },
  };
});
route('DELETE', '/v1/apps/{slug}/install/bind', ({ params, body }) => {
  requireGitHubManageCSRF(body);
  app(params.slug);
  // Idempotent, like githubd UnbindAppRepo: no binding is not an error.
  githubBindings.delete(params.slug);
  return githubStatus(params.slug);
});
route('POST', '/v1/apps/{slug}/install/bind', async ({ params, body }) => {
  requireGitHub();
  const repo = String(body.repo_full_name ?? '');
  const branch = String(body.production_branch ?? 'main');
  const binding = {
    repo,
    branch,
    id: `bind-${params.slug}-${repo}`,
    linkedAt: new Date().toISOString(),
  };
  githubBindings.set(params.slug, binding);
  return { binding_id: binding.id, repo_full_name: repo, production_branch: branch };
});

// --- Organisations, org keys, invitations ---
route('GET', '/v1/orgs/{slug}', ({ params }) => mockOrg(params.slug));
route('PATCH', '/v1/orgs/{slug}', ({ params, body }) => {
  const org = requireOrgRole(
    params.slug,
    body.plan == null ? ['owner', 'billing'] : ['owner'],
    true
  );
  if (body.name != null) {
    const name = String(body.name).trim();
    if (!name || name.length > 256) throw new Problem(400, 'validation_failed');
    org.name = name;
  }
  if (body.plan != null) {
    if (!['free', 'hobby', 'pro', 'scale'].includes(String(body.plan)))
      throw new Problem(400, 'validation_failed');
    org.plan = body.plan as typeof org.plan;
  }
  org.updated_at = db.iso(0);
  return org;
});
route('DELETE', '/v1/orgs/{slug}', ({ params }) => {
  const org = requireOrgRole(params.slug, ['owner'], true);
  org.status = 'deleted_pending';
  org.updated_at = db.iso(0);
  return NO_CONTENT;
});
route('GET', '/v1/orgs/{slug}/seat_usage', ({ params }) => {
  const { plan } = mockOrg(params.slug);
  // Plan.OrgMembersMax (ADR-061): Free is personal-only; paid tiers use the member ladder.
  const limits = { free: 0, hobby: 10, pro: 50, scale: 200 };
  return { used: mockOrgMembers(params.slug).length, limit: limits[plan] ?? 0, plan };
});
route('POST', '/v1/orgs/{slug}/transfer_ownership', ({ params, body }) => {
  const org = requireOrgRole(params.slug, ['owner']);
  const members = mockOrgMembers(params.slug);
  const target = members.find((member) => member.account_id === body.new_owner_account_id);
  if (!target) throw new Problem(404, 'not_found');
  if (target.role === 'owner') throw new Problem(409, 'org_last_owner');
  const owner = members.find((member) => member.role === 'owner')!;
  owner.role = 'admin';
  target.role = 'owner';
  org.updated_at = db.iso(0);
  return org;
});
const orgKeys: Record<string, unknown>[] = [
  {
    id: hex(32),
    org_id: hex(32),
    prefix: 'gk_org_a1b2',
    label: 'ci-deploy',
    scopes: ['deploy:write', 'apps:read'],
    last_used_at: db.iso(5),
    created_at: db.iso(90 * 24),
    expires_at: null,
    status: 'active',
    revoked_at: null,
    rotated_from_id: null,
  },
];
route('GET', '/v1/orgs/{slug}/keys', () => ({ keys: orgKeys }));
route('POST', '/v1/orgs/{slug}/keys', async ({ body }) => {
  const key = {
    id: hex(32),
    org_id: hex(32),
    prefix: `gk_org_${hex(4)}`,
    label: String(body.label ?? ''),
    scopes: body.scopes ?? [],
    last_used_at: null,
    created_at: new Date().toISOString(),
    expires_at: null,
    status: 'active',
    revoked_at: null,
    rotated_from_id: null,
    plaintext: `gk_org_${hex(28)}`,
  };
  orgKeys.unshift(key);
  return status(201, key);
});
route('DELETE', '/v1/orgs/{slug}/keys/{id}', ({ params }) => {
  const i = orgKeys.findIndex((k) => k.id === params.id);
  if (i >= 0) orgKeys.splice(i, 1);
  return {};
});
route('POST', '/v1/orgs/{slug}/keys/{id}/rotate', ({ params }) => ({
  key: orgKeys[0],
  key_plaintext: `gk_org_${hex(28)}`,
  old_key_id: params.id,
  old_key_expires_at: new Date(Date.now() + 7 * 86400e3).toISOString(),
}));
route('GET', '/v1/invitations/{token}', ({ params }) => ({
  id: hex(32),
  org_id: hex(32),
  org_slug: 'acme-corp',
  email: 'new-teammate@acme-corp.dev',
  role: 'developer',
  status: params.token === 'used' ? 'accepted' : 'pending',
  expires_at: new Date(Date.now() + 6 * 86400e3).toISOString(),
  created_at: db.iso(24),
}));
route('POST', '/v1/invitations/{token}/accept', () => ({
  account_id: hex(32),
  email: 'new-teammate@acme-corp.dev',
  role: 'developer',
  joined_at: new Date().toISOString(),
}));
// The real route double-submits a purpose-bound token (ADR-140): the
// console mints it from /v1/auth/csrf and posts it back as `csrf_token`.
// The mock keeps that shape so a wizard that forgets the token fails here
// the same way it would against apid, with a 400 rather than a 302.
const MOCK_CSRF_ACTIONS = new Set([
  'auth.logout',
  'auth.session.revoke',
  'auth.sessions.revoke_all',
  'mfa_confirm',
  'mfa_recover',
  'mfa_disable',
  'set_password',
  'connect_github',
  'bind_app_to_repo',
]);
route('GET', '/v1/auth/csrf', ({ query, res }) => {
  const action = query.get('action') ?? '';
  if (!MOCK_CSRF_ACTIONS.has(action))
    throw new Problem(
      400,
      'validation_failed',
      'the requested action is not available to browser clients'
    );
  res.setHeader(
    'Set-Cookie',
    action === 'connect_github'
      ? 'faas_csrf_github_connect=mock-csrf; Path=/; HttpOnly; SameSite=Lax'
      : CSRF_COOKIE
  );
  return { csrf_token: 'mock-csrf' };
});
// ADR-140 cohorts. The real server decides the proof from the account; the
// mock keeps just enough state to show each branch on demand.
const mockAuth = {
  password: process.env.MOCK_HAS_PASSWORD === '1' ? 'mock-current-password' : null,
  mfaEnrolled: process.env.MOCK_MFA === '1',
  mfaRequired: process.env.MOCK_MFA === 'required',
  steppedUpAt: 0,
};
const STEP_UP_TTL_MS = 5 * 60_000;

route('POST', '/v1/account/mfa/verify', ({ body }) => {
  if (!/^\d{6}$/.test(String(body.totp ?? '')))
    throw new Problem(401, 'mfa_invalid_code', 'the TOTP code did not match');
  mockAuth.steppedUpAt = Date.now();
  return { account_id: db.ACCOUNT_ID, mfa_pending: false };
});
route('POST', '/v1/account/mfa/enroll', () => ({
  otpauth_url: 'otpauth://totp/Gregale:design@gregale.dev?secret=JBSWY3DPEHPK3PXP&issuer=Gregale',
  secret: 'JBSWY3DPEHPK3PXP',
  qr_code_png_base64:
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  recovery_codes: [
    'MOCKRECOV1',
    'MOCKRECOV2',
    'MOCKRECOV3',
    'MOCKRECOV4',
    'MOCKRECOV5',
    'MOCKRECOV6',
    'MOCKRECOV7',
    'MOCKRECOV8',
    'MOCKRECOV9',
    'MOCKRECOV0',
  ],
}));
route('POST', '/v1/account/mfa/confirm', ({ body }) => {
  if (!/^\d{6}$/.test(String(body.totp ?? '')))
    throw new Problem(401, 'mfa_invalid_code', 'the TOTP code did not match');
  mockAuth.mfaEnrolled = true;
  mockAuth.mfaRequired = false;
  mockAuth.steppedUpAt = Date.now();
  return {};
});
route('POST', '/dashboard/account/set-password', ({ body, res }) => {
  if (body.csrf_token !== 'mock-csrf')
    throw new Problem(400, 'validation_failed', 'Invalid CSRF token');
  const next = String(body.password ?? '');
  if (next.length < 12)
    throw new Problem(400, 'password_too_weak', 'Password must be at least 12 characters.');
  const fresh = Date.now() - mockAuth.steppedUpAt < STEP_UP_TTL_MS;
  if (!fresh) {
    if (mockAuth.mfaRequired && !mockAuth.mfaEnrolled)
      throw new Problem(403, 'mfa_required', 'enable two-factor authentication to continue');
    if (mockAuth.mfaEnrolled)
      throw new Problem(403, 'step_up_required', 'verify your authenticator first');
    if (mockAuth.password !== null && body.current_password !== mockAuth.password)
      throw new Problem(401, 'invalid_credentials', 'Email or password is incorrect.');
  }
  mockAuth.password = next;
  res.setHeader('location', '/dashboard/account');
  return status(302, '');
});

// --- Per-app deploy tokens --------------------------------------------------
// apid (handlers_deploy_tokens.go): deploy:write only, plaintext once on create
// and rotate, rotation revokes the predecessor with no grace window, and
// minting needs a step-up from the last 5 minutes on a session cookie. The
// mock shares the set-password step-up stamp, so verifying once covers both.
type DeployTokenRow = components['schemas']['DeployTokenResponse'];
const deployTokens = new Map<string, DeployTokenRow[]>();
const DEPLOY_TOKEN_DAY = 86_400_000;
function deployTokenRows(a: db.App): DeployTokenRow[] {
  let rows = deployTokens.get(a.id);
  if (rows) return rows;
  const at = (days: number) => new Date(Date.now() + days * DEPLOY_TOKEN_DAY).toISOString();
  const row = (fields: Partial<DeployTokenRow>): DeployTokenRow => ({
    id: randomUUID(),
    app_id: a.id,
    prefix: 'fp_deploy_',
    scopes: ['deploy:write'],
    status: 'active',
    created_at: at(-30),
    expires_at: at(60),
    ...fields,
  });
  // The first app has history; the rest start empty, as a new app would.
  if (a.slug === db.apps[0]?.slug) {
    const old = row({
      label: 'github-actions',
      status: 'revoked',
      created_at: at(-120),
      expires_at: at(-30),
      last_used_at: at(-41),
      revoked_at: at(-40),
    });
    rows = [
      row({
        label: 'github-actions',
        created_at: at(-40),
        expires_at: at(50),
        last_used_at: at(-0.1),
        rotated_from_id: old.id,
      }),
      row({ label: 'buildkite-nightly', created_at: at(-84), expires_at: at(6) }),
      old,
    ];
  } else rows = [];
  deployTokens.set(a.id, rows);
  return rows;
}
function requireMintStepUp() {
  if (mockAuth.mfaRequired && !mockAuth.mfaEnrolled)
    throw new Problem(403, 'mfa_required', 'enable two-factor authentication to continue');
  if (Date.now() - mockAuth.steppedUpAt >= STEP_UP_TTL_MS)
    throw new Problem(
      403,
      'step_up_required',
      'step-up MFA required for this action: complete /v1/account/mfa/verify to refresh'
    );
}
function deployTokenExpiry(raw: unknown): string {
  if (raw === undefined || raw === '')
    return new Date(Date.now() + 90 * DEPLOY_TOKEN_DAY).toISOString();
  const ms = Date.parse(String(raw));
  if (Number.isNaN(ms) || ms <= Date.now())
    throw new Problem(400, 'validation_failed', 'expires_at must be a future RFC3339 timestamp');
  if (ms > Date.now() + 365 * DEPLOY_TOKEN_DAY)
    throw new Problem(
      400,
      'validation_failed',
      'expires_at cannot be more than 365 days in the future'
    );
  return new Date(ms).toISOString();
}
function deployTokenLabel(raw: unknown): string | undefined {
  const label = typeof raw === 'string' ? raw : '';
  if (label.length > 100)
    throw new Problem(400, 'validation_failed', 'label must be at most 100 characters');
  return label || undefined;
}
const deployTokenPlaintext = () => `fp_deploy_${randomBytes(32).toString('hex')}`;
route('GET', '/v1/apps/{slug}/deploy-tokens', ({ params }) => ({
  tokens: [...deployTokenRows(app(params.slug))].sort((x, y) =>
    y.created_at.localeCompare(x.created_at)
  ),
}));
route('POST', '/v1/apps/{slug}/deploy-tokens', ({ params, body }) => {
  const rows = deployTokenRows(app(params.slug));
  requireMintStepUp();
  const label = deployTokenLabel(body.label);
  const token: DeployTokenRow = {
    id: randomUUID(),
    app_id: app(params.slug).id,
    prefix: 'fp_deploy_',
    scopes: ['deploy:write'],
    status: 'active',
    created_at: new Date().toISOString(),
    expires_at: deployTokenExpiry(body.expires_at),
    ...(label ? { label } : {}),
  };
  rows.push(token);
  return status(201, { ...token, plaintext: deployTokenPlaintext() });
});
route('DELETE', '/v1/apps/{slug}/deploy-tokens/{id}', ({ params }) => {
  const token = deployTokenRows(app(params.slug)).find((t) => t.id === params.id);
  if (!token) throw new Problem(404, 'not_found', 'no such deploy token');
  token.status = 'revoked';
  token.revoked_at ??= new Date().toISOString();
  return NO_CONTENT;
});
route('POST', '/v1/apps/{slug}/deploy-tokens/{id}/rotate', ({ params, body }) => {
  const rows = deployTokenRows(app(params.slug));
  requireMintStepUp();
  const old = rows.find((t) => t.id === params.id);
  if (!old || old.status === 'revoked') throw new Problem(404, 'not_found', 'no such deploy token');
  if (Date.parse(old.expires_at) <= Date.now())
    throw new Problem(
      401,
      'api_key_expired',
      'the bearer key has expired; rotate it and use the new plaintext'
    );
  const label = deployTokenLabel(body.label) ?? old.label;
  const next: DeployTokenRow = {
    ...old,
    id: randomUUID(),
    status: 'active',
    created_at: new Date().toISOString(),
    expires_at: deployTokenExpiry(body.expires_at),
    rotated_from_id: old.id,
    last_used_at: undefined,
    revoked_at: undefined,
    ...(label ? { label } : {}),
  };
  old.status = 'revoked';
  old.revoked_at = new Date().toISOString();
  rows.push(next);
  return status(201, {
    token: next,
    token_plaintext: deployTokenPlaintext(),
    old_token_id: old.id,
    old_token_expires_at: old.expires_at,
  });
});

// --- Billing & account controls ---
// MOCK_BILLING=disabled models FAAS_BILLING_MODE=disabled: status reports it,
// and provider operations answer 501 (faas pkg/billing/mode.go).
const billingOff = () => process.env.MOCK_BILLING === 'disabled';
route('GET', '/v1/billing/status', () => ({
  mode: billingOff() ? 'disabled' : 'live',
  enabled: !billingOff(),
  provider: 'stripe',
  plan: db.account.plan,
  account_status: db.account.status,
  customer_configured: true,
  subscription_configured: db.account.plan !== 'free',
  // Stripe lacks CapUsageReconcile (faas pkg/billing/provider.go:722).
  usage_reconciliation_enabled: false,
}));
// apid trims each field, treats empty as clear, and caps UTF-8 bytes
// (handlers_billing_identity.go). The route sits behind a five-minute step-up.
const BILLING_FIELDS = { business_name: 256, billing_address: 1000, tax_id: 128 } as const;
route('PATCH', '/v1/account/billing', ({ body }) => {
  const present = Object.keys(BILLING_FIELDS).filter((k) => typeof body[k] === 'string');
  if (present.length === 0)
    throw new Problem(400, 'validation_failed', 'at least one billing field is required');
  if (Date.now() - mockAuth.steppedUpAt >= STEP_UP_TTL_MS) {
    if (mockAuth.mfaRequired && !mockAuth.mfaEnrolled)
      throw new Problem(403, 'mfa_required', 'enable two-factor authentication to continue');
    if (mockAuth.mfaEnrolled)
      throw new Problem(403, 'step_up_required', 'verify your authenticator first');
  }
  const next: Record<string, string> = {};
  for (const key of present) {
    const value = String(body[key]).trim();
    const max = BILLING_FIELDS[key as keyof typeof BILLING_FIELDS];
    if (Buffer.byteLength(value, 'utf8') > max)
      throw new Problem(
        400,
        'validation_failed',
        `${key} must be valid UTF-8 and at most ${max} bytes`
      );
    next[key] = value;
  }
  const record = db.account as Record<string, unknown>;
  for (const [key, value] of Object.entries(next)) {
    if (value) record[key] = value;
    else delete record[key];
  }
  return { ...db.account, app_count: db.apps.length };
});
// The provider's history: the seeded invoices plus four older documents the
// console has never stored, so the first backfill imports something.
const providerInvoiceHistory: S_['Invoice'][] = [
  ...db.invoices.map((i) => ({ ...i })),
  ...Array.from({ length: 4 }, (_, k) => {
    const end = new Date(db.NOW);
    end.setUTCDate(1);
    end.setUTCMonth(end.getUTCMonth() - (db.invoices.length + k));
    const start = new Date(end);
    start.setUTCMonth(start.getUTCMonth() - 1);
    const n = 1042 - db.invoices.length - k;
    return {
      id: crypto.randomUUID(),
      provider: 'stripe' as const,
      provider_invoice_id: `in_mockhistory${String(k).padStart(4, '0')}`,
      number: `GRG-${end.getUTCFullYear()}${String(end.getUTCMonth() + 1).padStart(2, '0')}-${String(n).padStart(4, '0')}`,
      status: 'paid' as const,
      period_start: start.toISOString(),
      period_end: end.toISOString(),
      subtotal_cents: 4900,
      tax_cents: 931,
      total_cents: 5831,
      amount_paid_cents: 5831,
      currency: 'eur' as const,
      pdf_available: true,
      created_at: end.toISOString(),
    };
  }),
];
route('POST', '/v1/invoices/backfill', ({ query }) => {
  const keys = [...query.keys()];
  const limitRaw = query.get('limit');
  const limit = limitRaw === null ? 25 : Number(limitRaw);
  if (
    keys.some((k) => k !== 'cursor' && k !== 'limit') ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 25
  )
    throw new Problem(
      400,
      'validation_failed',
      'Provide only an optional cursor and page limit; the request has no body.'
    );
  if (billingOff())
    throw new Problem(
      501,
      'not_implemented',
      'The active billing provider does not support invoice history discovery.'
    );
  const cursor = query.get('cursor');
  const offset = cursor ? Number(cursor.replace(/^mock-history-/, '')) : 0;
  if (!Number.isInteger(offset) || offset < 0)
    throw new Problem(
      400,
      'validation_failed',
      'The cursor is malformed or belongs to another provider customer.'
    );
  const page = providerInvoiceHistory.slice(offset, offset + limit);
  let imported = 0;
  for (const doc of page) {
    if (db.invoices.some((i) => i.provider_invoice_id === doc.provider_invoice_id)) continue;
    db.invoices.push({ ...doc });
    imported++;
  }
  const end = offset + page.length;
  const hasMore = end < providerInvoiceHistory.length;
  return {
    provider: 'stripe',
    scanned: page.length,
    imported,
    skipped: page.length - imported,
    has_more: hasMore,
    ...(hasMore ? { next_cursor: `mock-history-${end}` } : {}),
  };
});
let overageCapCents: number | null = 2000;
// apid audits every cap change (old/new cents, "null" for no cap) and, at most
// once a day, the cap being reached (pkg/sched/overage.go).
const overageEvents: components['schemas']['AuditEventResponse'][] = [
  {
    id: '2001',
    at: new Date(Date.now() - 9 * 86400e3).toISOString(),
    actor: 'design@gregale.dev',
    kind: 'overage.cap_changed',
    subject: db.account.id,
    severity: 'info',
    data: { old_cents: 'null', new_cents: 2000, actor: 'self' },
  },
];
route('GET', '/v1/account/overage-cap', () => ({ overage_cap_cents: overageCapCents }));
route('POST', '/v1/account/overage-cap', ({ body }) => {
  const cap = body.overage_cap_cents ?? null;
  if (cap !== null && (typeof cap !== 'number' || !Number.isSafeInteger(cap) || cap < 0))
    throw new Problem(400, 'validation_failed', 'Cap must be non-negative integer cents or null.');
  overageEvents.unshift({
    id: String(2002 + overageEvents.length),
    at: new Date().toISOString(),
    actor: 'design@gregale.dev',
    kind: 'overage.cap_changed',
    subject: db.account.id,
    severity: 'info',
    data: { old_cents: overageCapCents ?? 'null', new_cents: cap ?? 'null', actor: 'self' },
  });
  overageCapCents = cap;
  return { ...db.account, app_count: db.apps.length };
});
route('GET', '/v1/billing/forecast', () => {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const meter = (name: string, projected?: number, reason?: string) => ({
    meter: name,
    coverage: {
      complete: !reason,
      fresh: true,
      expected_minutes: 1440,
      complete_minutes: reason ? 900 : 1440,
      unpriced_quantity: 0,
      non_billable_quantity: 0,
      reasons: reason ? [reason] : [],
    },
    accrued: {
      meter: name,
      quantity: 0,
      included_quantity: 0,
      net_millicents: 0,
      allowance_method: 'monthly',
      contracts: [],
    },
    forecast: {
      method: 'linear_daily',
      available: projected !== undefined,
      ...(reason ? { reason } : {}),
      account_id: db.account.id,
      period_start: start.toISOString(),
      period_end: end.toISOString(),
      complete_through: now.toISOString(),
      price_version: 'v1',
      meter: name,
      currency: 'EUR',
      ...(projected !== undefined
        ? { projected_quantity: 0, projected_net_millicents: projected }
        : {}),
    },
    price_contracts: [],
  });
  return {
    period_start: start.toISOString(),
    period_end: end.toISOString(),
    as_of: now.toISOString(),
    currency: 'EUR',
    meters: [
      meter('gb_hours', 1_480_000),
      meter('egress_gb', undefined, 'egress has less than 7 days of complete history'),
    ],
    bill_estimate_available: false,
    missing_bill_components: ['egress_gb', 'tax'],
  };
});
// The dev mock answers JSON for every format; apid serves ZIP/CSV/JSON.
route('GET', '/v1/billing/focus', ({ query }) => {
  const month = query.get('month') ?? '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    throw new Problem(400, 'validation_failed', 'month must be YYYY-MM.');
  return {
    focus_version: '1.4',
    dataset: 'invoice_detail',
    month,
    partial: true,
    invoices_included: 1,
    invoices_excluded_draft_or_void: 0,
  };
});
route('POST', '/v1/billing/cancel', () => ({
  cancel_scheduled: true,
  effective_at: new Date(Date.now() + 19 * 86400e3).toISOString(),
}));
route('POST', '/v1/billing/retry', () => ({
  attempt_id: `att_${hex(8)}`,
  provider_ref_id: `txn_${hex(8)}`,
  status: 'submitted',
  next_billing_at: new Date(Date.now() + 30 * 86400e3).toISOString(),
}));
route('GET', '/v1/account/export', () => ({
  exported_at: new Date().toISOString(),
  account: db.account,
  apps: db.apps,
  deployments: db.deployments,
  builds: db.builds,
  instances: db.instances,
  usage: [],
  domains: db.domains,
  crons: db.crons,
  api_keys: db.keys ?? [],
}));
route('DELETE', '/v1/account', () => {
  db.account.status = 'deleted_pending';
  const scheduledAt = new Date().toISOString();
  return {
    status: 'deleted_pending',
    scheduled_at: scheduledAt,
    restore_until: new Date(Date.now() + 30 * 86400e3).toISOString(),
  };
});
route('POST', '/v1/account/restore', () => {
  db.account.status = 'active';
  return { ...db.account, app_count: db.apps.length };
});
let graceDays: number | null = 7;
route('GET', '/v1/account/keys/grace_window_days', () => ({ days: graceDays, plan_default: 7 }));
route('PATCH', '/v1/account/keys/grace_window_days', async ({ body }) => {
  if ('days' in body) graceDays = body.days === null ? null : Number(body.days);
  return { days: graceDays, plan_default: 7 };
});
let egressExtra = 0;
route('GET', '/v1/account/egress_allowlist_extra', () => ({
  extra: egressExtra,
  plan_cap: 8,
  max_extra: 32,
}));
route('PATCH', '/v1/account/egress_allowlist_extra', async ({ body }) => {
  egressExtra = Number(body.extra ?? egressExtra);
  return { extra: egressExtra, plan_cap: 8, max_extra: 32 };
});
route('GET', '/v1/usage', () =>
  db.apps.slice(0, 6).map((a, i) => ({
    app_id: a.id,
    mb_seconds: Math.round((i + 1) * 3.7e8),
    requests: Math.round((6 - i) * 140_000),
    included_gb_hours: 2000,
    cpu_usec: Math.round((i + 1) * 9e9),
    tx_bytes: Math.round((i + 1) * 4.1e9),
    net_tx_bytes: Math.round((i + 1) * 1.2e9),
    net_rx_bytes: Math.round((i + 1) * 0.8e9),
    cold_boots: (i + 1) * 12,
  }))
);

// --- Supply chain & secrets hygiene ---
const trustedSigners = new Map<
  string,
  { name: string; public_key_pem: string; added_at: string; added_by: string }[]
>();
route('PATCH', '/v1/apps/{slug}/security', async ({ params, body }) => {
  const a = db.apps.find((x) => x.slug === params.slug);
  if (a) (a as unknown as Record<string, unknown>).require_signed = Boolean(body.require_signed);
  return { require_signed: Boolean(body.require_signed) };
});
route('GET', '/v1/apps/{slug}/trusted_signers', ({ params }) => ({
  signers: trustedSigners.get(params.slug) ?? [
    {
      name: 'release-ci',
      public_key_pem: '-----BEGIN PUBLIC KEY-----…',
      added_at: new Date(Date.now() - 12 * 86400e3).toISOString(),
      added_by: 'demo@acme-corp.dev',
    },
  ],
}));
route('PUT', '/v1/apps/{slug}/trusted_signers/{name}', async ({ params, body }) => {
  const list = trustedSigners.get(params.slug) ?? [
    {
      name: 'release-ci',
      public_key_pem: '-----BEGIN PUBLIC KEY-----…',
      added_at: new Date(Date.now() - 12 * 86400e3).toISOString(),
      added_by: 'demo@acme-corp.dev',
    },
  ];
  const entry = {
    name: params.name,
    public_key_pem: String(body.public_key_pem ?? ''),
    added_at: new Date().toISOString(),
    added_by: 'demo@acme-corp.dev',
  };
  trustedSigners.set(params.slug, [...list.filter((x) => x.name !== params.name), entry]);
  return entry;
});
route('DELETE', '/v1/apps/{slug}/trusted_signers/{name}', ({ params }) => {
  const list = trustedSigners.get(params.slug) ?? [];
  trustedSigners.set(
    params.slug,
    list.filter((x) => x.name !== params.name)
  );
  return {};
});
route('POST', '/v1/apps/{slug}/secrets/{key}/rotate', ({ params }) => ({
  key: params.key,
  rotated_at: new Date().toISOString(),
  kid: `kid_${hex(6)}`,
}));
route('GET', '/v1/secrets', () => ({
  secrets: db.apps.slice(0, 4).flatMap((a, i) => [
    {
      app_id: a.id,
      app_slug: a.slug,
      key: 'DATABASE_URL',
      ciphertext: '***',
      created_at: db.iso((30 + i) * 24),
      updated_at: db.iso((3 + i) * 24),
    },
    ...(i % 2 === 0
      ? [
          {
            app_id: a.id,
            app_slug: a.slug,
            key: 'STRIPE_KEY',
            ciphertext: '***',
            created_at: db.iso(60 * 24),
            updated_at: db.iso(45 * 24),
          },
        ]
      : []),
  ]),
  next_before: null,
}));

// --- Scheduling: delayed tasks (session-tracked) + cron fire-now state ---
const delayedTasks = new Map<string, { id: string; scheduled_at: string; state: string }>();
route('POST', '/v1/apps/{slug}/delayed-tasks', async ({ body }) => {
  const id = `dt_${hex(10)}`;
  const t = {
    id,
    scheduled_at: String(body.scheduled_at ?? new Date().toISOString()),
    state: 'pending',
  };
  delayedTasks.set(id, t);
  return t;
});
route('GET', '/v1/delayed-tasks/{id}', ({ params, res }) => {
  const t = delayedTasks.get(params.id);
  if (!t) {
    res.statusCode = 404;
    return { type: 'about:blank', title: 'not found', code: 'not_found' };
  }
  if (t.state === 'pending' && Date.parse(t.scheduled_at) < Date.now()) t.state = 'completed';
  return t;
});
route('DELETE', '/v1/delayed-tasks/{id}', ({ params }) => {
  const t = delayedTasks.get(params.id);
  if (t) t.state = 'cancelled';
  return {};
});
const fireRequests = new Map<string, number>();
route('GET', '/v1/cron-fire-now-requests/{request_id}', ({ params }) => {
  const started = fireRequests.get(params.request_id) ?? Date.now();
  fireRequests.set(params.request_id, started);
  const done = Date.now() - started > 4000;
  return {
    request_id: params.request_id,
    cron_id: db.crons[0]?.id ?? 'cron_1',
    status: done ? 'completed' : 'running',
    requested_at: new Date(started).toISOString(),
    finished_at: done ? new Date().toISOString() : null,
    invocation_id: done ? `inv_${hex(8)}` : null,
    error: '',
    account_id: db.account.id,
  };
});

// --- Observability: error groups, wake timelines, diff preview, build
// provenance, secret scan, auth audit events. ---
const ERR_FP = 'fp_5c1a9b2e77d34fa0';
route('GET', '/v1/apps/{slug}/errors/summary', ({ params }) => {
  const a = db.apps.find((x) => x.slug === params.slug);
  const failing = a !== undefined && db.scenarioOf(a) === 'failing';
  return {
    generated_at: new Date().toISOString(),
    app_id: a?.id ?? 'unknown',
    app_slug: params.slug,
    window_start: new Date(Date.now() - 24 * 3600e3).toISOString(),
    window_end: new Date().toISOString(),
    window_clamped: false,
    items: failing
      ? [
          {
            fingerprint: ERR_FP,
            error_class: 'TypeError',
            route: 'POST /v1/reconcile',
            http_status: 500,
            count: 412,
            request_count: 2001,
            first_seen_at: new Date(Date.now() - 5 * 3600e3).toISOString(),
            last_seen_at: new Date(Date.now() - 120e3).toISOString(),
            sample_message: "Cannot read properties of undefined (reading 'invoice_id')",
          },
          {
            fingerprint: 'fp_88d0c4a1b52e9f13',
            error_class: 'TimeoutError',
            route: 'GET /v1/reports/daily',
            http_status: 504,
            count: 37,
            request_count: 400,
            first_seen_at: new Date(Date.now() - 20 * 3600e3).toISOString(),
            last_seen_at: new Date(Date.now() - 3600e3).toISOString(),
            sample_message: 'upstream ledger did not answer within 10s',
          },
        ]
      : [],
    next_cursor: null,
    limit: 50,
  };
});
route('GET', '/v1/apps/{slug}/errors/{fingerprint}', ({ params }) => ({
  fingerprint: params.fingerprint,
  error_class: 'TypeError',
  route: 'POST /v1/reconcile',
  http_status: 500,
  requests: Array.from({ length: 6 }, (_, i) => ({
    request_id: `req_${hex(8)}`,
    received_at: new Date(Date.now() - (i + 1) * 900e3).toISOString(),
    route: 'POST /v1/reconcile',
    http_status: 500,
    error_class: 'TypeError',
    sample_message: "Cannot read properties of undefined (reading 'invoice_id')",
    deployment_id: db.deployments[0]?.id ?? null,
  })),
  next_cursor: null,
}));
route('GET', '/v1/apps/{slug}/errors/{fingerprint}/first', () => ({
  request_id: `req_${hex(8)}`,
  received_at: new Date(Date.now() - 5 * 3600e3).toISOString(),
  route: 'POST /v1/reconcile',
  http_status: 500,
  error_class: 'TypeError',
  sample_message:
    "Cannot read properties of undefined (reading 'invoice_id') at reconcile (/app/dist/worker.js:214:31)",
  deployment_id: db.deployments[0]?.id ?? null,
  headers_sample: {
    'content-type': 'application/json',
    'user-agent': 'stripe-webhooks/2.1',
    'x-request-id': hex(12),
  },
  redactions_applied: ['authorization', 'cookie'],
}));
// Canonical ADR-064 frames, one stable story per wake id: recent-wake rows
// carry random ids, and each must open the same scenario every time.
const WAKE_SCENARIOS = [
  'restore',
  'restore',
  'restore',
  'fetched',
  'cold_boot',
  'thaw',
  'fallback',
  'failed',
  'stalled',
] as const;
function wakeScenario(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return WAKE_SCENARIOS[h % WAKE_SCENARIOS.length];
}
function mockRestoreBreakdown(fetched: boolean) {
  return {
    lease_acquire_ms: 2,
    env_prepare_ms: 1,
    pre_network_ms: 0,
    setup_network_ms: 3,
    restore_gate_wait_ms: 0,
    chroot_ms: 4,
    materialize_mem_ms: 12,
    materialize_vmstate_ms: 2,
    resolve_images_ms: fetched ? 640 : 6,
    stage_drives_ms: 9,
    stage_pre_boot_files_ms: 7,
    stage_snapshot_ms: 3,
    helper_ms: 5,
    start_jailer_ms: 11,
    bind_tun_ms: 8,
    load_snapshot_ms: 142,
    resume_hook_ms: 14,
    wait_ready_ms: 40,
    total_ms: fetched ? 936 : 302,
    resolve_artifacts: [
      { artifact: 'kernel', source: 'cache_hit', duration_ms: 1, bytes: 12_000_000 },
      { artifact: 'base', source: 'backend_local', duration_ms: 2, bytes: 210_000_000 },
      fetched
        ? { artifact: 'main', source: 'materialized', duration_ms: 636, bytes: 480_000_000 }
        : { artifact: 'main', source: 'cache_hit', duration_ms: 3, bytes: 480_000_000 },
    ],
  };
}
route('GET', '/v1/apps/{slug}/wakes/{wake_id}/timeline', ({ params }) => {
  if (process.env.MOCK_PLAN === 'free')
    throw new Problem(
      402,
      'plan_per_app_metrics_not_allowed',
      'the free plan does not include per-app metrics; upgrade to Hobby or above.'
    );
  const a = app(params.slug);
  const scenario = wakeScenario(params.wake_id);
  const t0 = Date.now() - 3600e3;
  const frames: { dt: number; kind: string; actor: string; data: Record<string, unknown> }[] = [];
  const f = (dt: number, kind: string, actor: string, data: Record<string, unknown> = {}) =>
    frames.push({ dt, kind, actor, data: { wake_id: params.wake_id, app_id: a.id, ...data } });

  if (scenario === 'cold_boot') {
    f(0, 'wake.queue_accepted', 'schedd', { queue_wait_ms: 0 });
    f(3, 'wake.admitted', 'schedd');
    f(6, 'wake.boot_started', 'schedd', { method: 'cold_boot' });
    f(905, 'wake.cold_boot_breakdown', 'vmmd', {
      resolve_images_ms: 120,
      chroot_ms: 5,
      provision_ms: 40,
      stage_runtime_ms: 30,
      prepare_config_ms: 4,
      helper_ms: 6,
      start_jailer_ms: 12,
      bind_tun_ms: 9,
      cgroup_ms: 3,
      write_config_ms: 2,
      wait_ready_ms: 640,
      quota_restore_ms: 1,
      total_ms: 872,
      resolve_artifacts: [
        { artifact: 'base', source: 'direct', duration_ms: 120, bytes: 210_000_000 },
      ],
    });
    f(906, 'wake.readiness_200', 'vmmd', { probe_count: 9, elapsed_ms: 640 });
    f(914, 'wake.boot_completed', 'schedd', { method: 'cold_boot' });
    f(940, 'wake.proxy_first_byte', 'gatewayd', { latency_ms: 940, proxy_latency_ms: 4 });
  } else if (scenario === 'failed') {
    f(0, 'wake.queue_accepted', 'schedd', { queue_wait_ms: 0 });
    f(3, 'wake.admitted', 'schedd');
    f(6, 'wake.boot_started', 'schedd', { method: 'restore' });
    f(720, 'wake.boot_failed', 'schedd', { method: 'restore', reason: 'readiness_timeout' });
  } else if (scenario === 'stalled') {
    f(0, 'wake.queue_accepted', 'schedd', { queue_wait_ms: 12 });
    f(4, 'wake.admitted', 'schedd');
    f(8, 'wake.boot_started', 'schedd', { method: 'restore' });
    f(30_000, 'wake.stalled', 'schedd', { reason: 'watchdog_timeout' });
    f(30_001, 'state_transition', 'schedd', { from: 'BOOTING', to: 'FAILED' });
    f(30_002, 'wake.cold_boot_cpu', 'vmmd', { startup_cpu_millicores: 1000 });
  } else {
    const fetched = scenario === 'fetched';
    const bd = mockRestoreBreakdown(fetched);
    const ready = 9 + bd.total_ms - 20;
    f(0, 'wake.queue_accepted', 'schedd', { queue_wait_ms: 0 });
    f(4, 'wake.admitted', 'schedd');
    f(9, 'wake.boot_started', 'schedd', { method: 'restore' });
    f(ready - 1, 'wake.restore_breakdown', 'vmmd', bd);
    f(ready, 'wake.readiness_200', 'vmmd', { probe_count: 2, elapsed_ms: 40 });
    f(ready + 8, 'wake.boot_completed', 'schedd', {
      method: scenario === 'fallback' ? 'cold_boot' : 'restore',
      ...(scenario === 'fallback' ? { restore_fallback_reason: 'after_restore_failed' } : {}),
    });
    f(ready + 29, 'wake.proxy_first_byte', 'gatewayd', {
      latency_ms: ready + 29,
      proxy_latency_ms: 3,
      gateway_phases_ms: { route: 1, wake_wait: ready + 20 },
    });
    if (scenario === 'thaw') {
      for (const at of [600_000, 1_200_000]) {
        f(at, 'wake.thaw_breakdown', 'schedd', {
          wake_reads_ms: 1,
          thaw_reads_ms: 2,
          vmmd_thaw_ms: 20,
          publish_ms: 1,
          after_publish_ms: 2,
          total_ms: 26,
        });
        f(at + 30, 'wake.proxy_first_byte', 'gatewayd', { latency_ms: 30 });
      }
    }
  }

  return {
    wake_id: params.wake_id,
    app_id: a.id,
    events: frames.map(({ dt, kind, actor, data }) => ({
      at: new Date(t0 + dt).toISOString(),
      kind,
      actor,
      data,
    })),
    next_cursor: '',
    limit: 1000,
  };
});
route('POST', '/v1/apps/{slug}/diff', async ({ params, body }) => {
  const cfg = (body.app_config ?? {}) as Record<string, unknown>;
  const a = db.apps.find((x) => x.slug === params.slug);
  const changes = Object.entries(cfg).map(([field, after]) => ({
    field,
    kind: 'modify',
    before: String((a as Record<string, unknown> | undefined)?.[field] ?? '—'),
    after: String(Array.isArray(after) ? after.join(',') : after),
  }));
  return {
    slug: params.slug,
    plan: db.account.plan,
    blocking: false,
    diff: {
      slug: params.slug,
      plan: db.account.plan,
      changes,
      breaks:
        cfg.ram_mb && Number(cfg.ram_mb) < (a?.ram_mb ?? 0)
          ? ['Shrinking memory invalidates the warm snapshot; the next wake cold-boots.']
          : [],
    },
  };
});
route('GET', '/v1/builds/{id}/provenance', ({ params }) => ({
  id: `prov_${hex(6)}`,
  build_id: params.id,
  buildkit_version: 'v0.17.2',
  railpack_version: '0.9.4',
  base_digest: 'sha256:' + hex(16),
  source_sha256: hex(16),
  source_url: '',
  commit_sha: hex(20),
  plan: 'railpack-node',
  runner_digest: 'sha256:' + hex(16),
  builder_node_id: 'fra-metal-1',
  started_at: new Date(Date.now() - 7200e3).toISOString(),
  finished_at: new Date(Date.now() - 7100e3).toISOString(),
  sbom_storage_key: 'sbom/' + params.id,
  framework_version: '22.12.0',
}));
route('GET', '/v1/deployments/{id}/secret-scan', () => ({
  status: 'complete',
  scanned_at: new Date(Date.now() - 7000e3).toISOString(),
  image_digest: 'sha256:' + hex(16),
  findings: [],
  error: '',
}));
// Auth audit events (ADR-077 timeline). Generated once so `/{id}` can find
// the row the list showed; ids are bigint-as-string like the API's.
const AUTH_EVENTS = [
  {
    id: '1042',
    at: new Date(Date.now() - 600e3).toISOString(),
    actor: 'demo@acme-corp.dev',
    kind: 'session.signed_in',
    subject: 'google-oauth',
    severity: 'info',
    data: { method: 'google', ip: '203.0.113.9', user_agent: 'Mozilla/5.0' },
  },
  {
    id: '1041',
    at: new Date(Date.now() - 86400e3).toISOString(),
    actor: 'demo@acme-corp.dev',
    kind: 'api_key.minted',
    subject: 'ci-deploy',
    severity: 'info',
    data: { scopes: ['deploy:write', 'read'], key_prefix: 'gk_ci_' },
  },
  {
    id: '1040',
    at: new Date(Date.now() - 2 * 86400e3).toISOString(),
    actor: 'demo@acme-corp.dev',
    kind: 'login.failed_password',
    subject: '203.0.113.7',
    severity: 'warn',
    data: { attempts: 3, locked: false },
  },
];
route('GET', '/v1/audit-events', ({ query }) => {
  const prefix = query.get('kind_prefix') ?? '';
  const limit = Math.min(100, Math.max(1, Number(query.get('limit') ?? 50)));
  const events = [...overageEvents, ...AUTH_EVENTS]
    .filter((event) => event.kind.startsWith(prefix))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, limit);
  return { events, limit };
});
route('GET', '/v1/audit-events/{id}', ({ params }) => {
  if (!/^[0-9]+$/.test(params.id))
    throw new Problem(400, 'validation_failed', 'id must be a positive integer.');
  const event = AUTH_EVENTS.find((e) => e.id === params.id);
  if (!event) throw new Problem(404, 'not_found', 'no such audit event');
  return event;
});

// --- Project import (scan/apply). The dev mock cannot untar a real upload,
// so the scan answers a canned Kubernetes-flavoured plan and apply echoes
// the applied set; the fixture fleet itself stays static. ---
const MOCK_PLAN = {
  project_slug: 'acme-shop',
  scan_source: 'k8s',
  tier: 'workspace',
  workloads: [
    {
      name: 'storefront',
      root_dir: 'apps/storefront',
      command: ['node', 'server.js'],
      class: 'http',
      ports: [8080],
      env_keys: ['DATABASE_URL', 'STRIPE_KEY'],
      source: 'k8s: deployment.yaml',
      tier: 'workspace',
    },
    {
      name: 'checkout-api',
      root_dir: 'apps/checkout',
      command: ['/app/bin/server'],
      class: 'grpc',
      ports: [50051],
      env_keys: ['DATABASE_URL'],
      source: 'k8s: deployment.yaml',
      tier: 'workspace',
    },
    {
      name: 'nightly-report',
      root_dir: 'jobs/report',
      command: ['python', '-m', 'report'],
      class: 'job',
      schedule: '0 3 * * *',
      ports: [],
      source: 'k8s: cronjob.yaml',
      tier: 'workspace',
    },
  ],
  managed: [
    {
      name: 'postgres',
      kind: 'postgres',
      env_hint: 'DATABASE_URL',
      source: 'k8s: statefulset.yaml',
      image: 'postgres:16',
    },
    {
      name: 'redis',
      kind: 'redis',
      env_hint: 'REDIS_URL',
      source: 'k8s: deployment.yaml',
      image: 'redis:7',
    },
  ],
  crons: [{ workload_name: 'nightly-report', schedule: '0 3 * * *', path: '/', enabled: true }],
  warnings: ['Ingress annotations were ignored — routing is configured per app after apply.'],
  observed_apps: 3,
  observed_crons: 1,
  limit_apps: 25,
  limit_crons: 20,
  can_apply: true,
  plan_token: 'mock-plan-token',
};

route('POST', '/v1/projects/scan', () => MOCK_PLAN);

type PlanWorkload = components['schemas']['PlanWorkload'];

/**
 * What a scan of each installable repo (`/v1/install/repos/list`) finds, so
 * the new-app wizard's hints can be seen: storefront builds its own
 * Dockerfile, webhook-router and nightly-etl are single runtime services, and
 * checkout is a Compose repository with several services.
 */
const SOURCE_REF_SCANS: Record<
  string,
  { scan_source: components['schemas']['PlanResponse']['scan_source']; workloads: PlanWorkload[] }
> = {
  'acme-corp/storefront': {
    scan_source: 'single',
    workloads: [
      {
        name: 'storefront',
        root_dir: '',
        dockerfile: 'Dockerfile',
        command: [],
        class: 'http',
        ports: [8080],
        source: 'Dockerfile',
        tier: 'single',
      },
    ],
  },
  'acme-corp/webhook-router': {
    scan_source: 'procfile',
    workloads: [
      {
        name: 'web',
        root_dir: '',
        command: ['node', 'server.js'],
        class: 'http',
        ports: [],
        source: 'Procfile: web',
        tier: 'convention',
        detected_by: { detector: 'procfile', marker: 'Procfile', priority: 40 },
      },
    ],
  },
  'acme-corp/nightly-etl': {
    scan_source: 'single',
    workloads: [
      {
        name: 'nightly-etl',
        root_dir: '',
        command: ['python', '-m', 'etl'],
        class: 'http',
        ports: [8080],
        source: 'pyproject.toml',
        tier: 'single',
      },
    ],
  },
  'acme-corp/checkout': {
    scan_source: 'compose',
    workloads: ['api', 'worker', 'web'].map((name) => ({
      name,
      root_dir: name === 'web' ? 'frontend' : '',
      dockerfile: 'Dockerfile',
      command: name === 'worker' ? ['node', 'worker.js'] : [],
      class: name === 'worker' ? ('worker' as const) : ('http' as const),
      ports: name === 'worker' ? [] : [8080],
      source: `compose.yaml: ${name}`,
      tier: 'compose' as const,
      detected_by: { detector: 'compose' as const, marker: 'compose.yaml', priority: 80 },
    })),
  },
};

route('POST', '/v1/projects/scan/source-ref', async ({ body }) => {
  const repo = String(body.repo ?? '');
  const ref = String(body.ref ?? '');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || !ref)
    throw new Problem(400, 'validation_failed', 'repo and ref are required.');
  const scan = SOURCE_REF_SCANS[repo];
  if (!scan) throw new Problem(404, 'not_found', 'The installation cannot read that repository.');
  return {
    project_slug: String(body.project_slug ?? ''),
    repo_full_name: repo,
    scan_source: scan.scan_source,
    tier: db.account.plan,
    workloads: scan.workloads,
    managed: [],
    crons: [],
    observed_apps: db.apps.length,
    observed_crons: 0,
    limit_apps: 25,
    limit_crons: 20,
    can_apply: true,
    plan_token: `mock-source-ref-${hex(8)}`,
  } satisfies components['schemas']['PlanResponse'];
});
route('GET', '/v1/projects', () => projectSummaries());
// A company's projects (faas org_project_routes.go), including one a teammate
// created: GET /v1/projects lists only the signed-in account's own.
const teammateProject = {
  slug: 'acme-billing',
  workload_count: 1,
  created_at: '2026-10-02T09:00:00Z',
} as const;
route('GET', '/v1/orgs/{organization}/projects', ({ params }) => {
  const org = requireOrgRole(params.organization, ANY_MEMBER);
  if (org.personal) return projectSummaries();
  return params.organization === 'acme-corp'
    ? [{ ...projectSummaries()[0], ...teammateProject }]
    : [];
});
route('GET', '/v1/orgs/{organization}/projects/{slug}', ({ params }) => {
  requireOrgRole(params.organization, ANY_MEMBER);
  const found = projects.find((p) => p.slug === params.slug);
  if (found) return found;
  if (params.slug === teammateProject.slug && projects[0])
    return { ...projects[0], slug: teammateProject.slug, name: 'acme-billing' };
  throw new Problem(404, 'not_found', `project ${params.slug} not found`);
});
route('GET', '/v1/projects/{slug}', ({ params }) => {
  const project = projects.find((item) => item.slug === params.slug);
  if (!project) throw new Problem(404, 'not_found', 'Project not found.');
  return project;
});
route('GET', '/v1/projects/{slug}/environments', ({ params }) => {
  const items = environmentInventory(params.slug);
  if (!items) throw new Problem(404, 'not_found', 'Project not found.');
  return items;
});
route('GET', '/v1/projects/{slug}/environments/{environment}', ({ params }) => {
  const item = environmentInventory(params.slug)?.find((env) => env.slug === params.environment);
  if (!item) throw new Problem(404, 'not_found', 'Environment not found.');
  return item;
});
route('GET', '/v1/projects/{slug}/environments/{environment}/state', ({ params }) => {
  const item = environmentState(params.slug, params.environment);
  if (!item) throw new Problem(404, 'not_found', 'Environment not found.');
  return item;
});
function stageQueueTarget(params: Record<string, string>) {
  const environment = environmentInventory(params.slug)?.find(
    (item) => item.slug === params.environment
  );
  const project = projects.find((item) => item.slug === params.slug);
  if (
    !environment ||
    !project?.workloads.some((item) => item.slug === params.workload) ||
    !db.apps.some((item) => item.slug === params.workload)
  )
    throw new Problem(404, 'not_found', 'Stage workload not found in this project.');
  if (params.environment === 'production')
    throw new Problem(400, 'validation_failed', 'Use the app queue-bindings API for production.');
  return environment;
}
route(
  'GET',
  '/v1/projects/{slug}/environments/{environment}/workloads/{workload}/queue-bindings',
  ({ params, res }) => {
    stageQueueTarget(params);
    const record = getStageQueueRecord({
      project: params.slug,
      environment: params.environment,
      workload: params.workload,
    });
    if (record) return record;
    res.setHeader('X-Gregale-Workload-Revision', '0');
    throw new Problem(
      409,
      'environment_queue_collection_unavailable',
      'Initialize a complete stage binding list using workload revision 0.'
    );
  }
);
route(
  'PUT',
  '/v1/projects/{slug}/environments/{environment}/workloads/{workload}/queue-bindings',
  ({ params, body }) => {
    const environment = stageQueueTarget(params);
    if (environment.protected)
      throw new Problem(409, 'conflict', 'Protected stage settings require a project plan.');
    if (!Number.isSafeInteger(body.expected_revision) || !Array.isArray(body.bindings))
      throw new Problem(
        400,
        'validation_failed',
        'Expected revision and a complete bindings list are required.'
      );
    try {
      return putStageQueueRecord(
        { project: params.slug, environment: params.environment, workload: params.workload },
        body as components['schemas']['ReplaceProjectEnvironmentQueueBindingsRequest']
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid stage binding list.';
      throw new Problem(
        message.includes('revision') ? 409 : 400,
        message.includes('revision') ? 'conflict' : 'validation_failed',
        message
      );
    }
  }
);
route('GET', '/v1/projects/{slug}/environments/{environment}/diff', ({ params, query }) => {
  const source = query.get('from') ?? '';
  if (source === params.environment)
    throw new Problem(400, 'validation', 'Select a different source environment.');
  const item = environmentDiff(params.slug, source, params.environment);
  if (!item) throw new Problem(404, 'not_found', 'Environment not found.');
  return item;
});
route('GET', '/v1/preview/{slug}/environment', ({ params }) => {
  const item = previewSet(params.slug);
  if (!item) throw new Problem(404, 'preview_environment_not_found', 'No recorded preview set.');
  return item;
});
route('POST', '/v1/projects', () => ({
  ...MOCK_PLAN,
  project_id: 'proj_mock01',
  apps: MOCK_PLAN.workloads
    .filter((w) => !w.schedule)
    .map((w, i) => ({ slug: w.name, id: `app_import_${i}` })),
  builds: [],
}));

// --- Automations (dev only) ---------------------------------------------------

function mockAutomation(slug: string, name: string) {
  const item = automationMock.definitions.get(slug)?.find((item) => item.name === name);
  if (!item) throw new Problem(404, 'automation_not_found', 'Automation not found.');
  return item;
}
function assertAutomationVersion(
  item: components['schemas']['AutomationResponse'] | undefined,
  version: unknown
) {
  if ((item?.version ?? 0) !== version)
    throw new Problem(409, 'automation_version_conflict', 'Reload the current definition.');
}
route('GET', '/v1/apps/{slug}/automations', ({ params }) => ({
  app_slug: params.slug,
  runtime_enabled: process.env.MOCK_AUTOMATIONS_DISABLED !== '1',
  unavailable_reason:
    process.env.MOCK_AUTOMATIONS_DISABLED === '1' ? 'runtime_disabled' : undefined,
  max_definitions: 16,
  automations: automationMock.definitions.get(params.slug) ?? [],
}));
route('GET', '/v1/apps/{slug}/automations/{name}', ({ params }) =>
  mockAutomation(params.slug, params.name)
);
route('POST', '/v1/apps/{slug}/automations:validate', ({ body }) =>
  automationMock.validate(body.definition as components['schemas']['WorkflowSpec'])
);
route('POST', '/v1/apps/{slug}/automations:simulate', ({ body }) =>
  automationMock.simulate(body as components['schemas']['SimulateAutomationRequest'])
);
route('PUT', '/v1/apps/{slug}/automations/{name}', ({ params, body }) => {
  const list = automationMock.definitions.get(params.slug) ?? [];
  const previous = list.find((item) => item.name === params.name);
  assertAutomationVersion(previous, body.expected_version);
  const definition = body.definition as components['schemas']['WorkflowSpec'];
  if (!automationMock.validate(definition).valid)
    throw new Problem(422, 'automation_invalid', 'Definition is invalid.');
  const next: components['schemas']['AutomationResponse'] = {
    ...previous,
    name: params.name,
    version: (previous?.version ?? 0) + 1,
    source: previous?.source ?? 'draft',
    draft: definition,
    enabled: previous?.enabled ?? true,
    updated_at: new Date().toISOString(),
  };
  automationMock.definitions.set(params.slug, [
    ...list.filter((item) => item.name !== params.name),
    next,
  ]);
  return next;
});
route('POST', '/v1/apps/{slug}/automations/{name}/publish', ({ params, body }) => {
  const item = mockAutomation(params.slug, params.name);
  assertAutomationVersion(item, body.expected_version);
  item.version += 1;
  item.published_version = item.version;
  item.published = item.draft;
  item.source = 'dashboard';
  const key = `${params.slug}/${params.name}`;
  const list = automationMock.revisions.get(key) ?? [];
  list.unshift({
    version: item.version,
    definition: item.draft,
    definition_hash: 'c'.repeat(64),
    recorded_at: new Date().toISOString(),
    legacy_snapshot: false,
    published_by_account_id: db.account.id,
  });
  automationMock.revisions.set(key, list);
  return item;
});
route('PUT', '/v1/apps/{slug}/automations/{name}/enabled', ({ params, body }) => {
  const item = mockAutomation(params.slug, params.name);
  assertAutomationVersion(item, body.expected_version);
  item.enabled = Boolean(body.enabled);
  item.version += 1;
  return item;
});
route('DELETE', '/v1/apps/{slug}/automations/{name}', ({ params, query }) => {
  const item = mockAutomation(params.slug, params.name);
  assertAutomationVersion(item, Number(query.get('expected_version')));
  if (item.source === 'manifest')
    throw new Problem(
      409,
      'automation_ownership_conflict',
      'The app manifest owns this automation.'
    );
  const key = `${params.slug}/${params.name}`;
  const yaml = automationMock.manifest.get(key);
  if (yaml && query.get('restore_manifest') !== 'true')
    throw new Problem(
      409,
      'automation_ownership_conflict',
      'The app manifest also defines this automation. Confirm returning ownership to it.'
    );
  const rest = (automationMock.definitions.get(params.slug) ?? []).filter(
    (row) => row.name !== params.name
  );
  automationMock.definitions.set(
    params.slug,
    yaml
      ? [
          ...rest,
          {
            name: params.name,
            version: item.version + 1,
            source: 'manifest',
            draft: yaml,
            published: yaml,
            enabled: item.enabled,
            updated_at: new Date().toISOString(),
          },
        ]
      : rest
  );
  return NO_CONTENT;
});
route('GET', '/v1/apps/{slug}/automations/{name}/health', ({ params }) =>
  automationMock.health(params.slug, params.name)
);
route('GET', '/v1/apps/{slug}/automations/{name}/revisions', ({ params, query }) => {
  const list = automationMock.revisions.get(`${params.slug}/${params.name}`) ?? [];
  const offset = Number(query.get('offset') ?? 0);
  const limit = Number(query.get('limit') ?? 25);
  return { revisions: list.slice(offset, offset + limit), total: list.length, offset, limit };
});
route(
  'POST',
  '/v1/apps/{slug}/automations/{name}/revisions/{version}/restore',
  ({ params, body }) => {
    const item = mockAutomation(params.slug, params.name);
    assertAutomationVersion(item, body.expected_version);
    const revision = automationMock.revisions
      .get(`${params.slug}/${params.name}`)
      ?.find((row) => row.version === Number(params.version));
    if (!revision) throw new Problem(404, 'automation_revision_not_found');
    item.draft = revision.definition;
    item.version += 1;
    return item;
  }
);
route('GET', '/v1/apps/{slug}/workflows/runs', ({ params, query }) => {
  const list = (automationMock.runs.get(params.slug) ?? []).filter(
    (run) => !query.get('workflow_name') || run.workflow_name === query.get('workflow_name')
  );
  const offset = Number(query.get('offset') ?? 0);
  const limit = Number(query.get('limit') ?? 25);
  return { runs: list.slice(offset, offset + limit), total: list.length };
});
const automationRunKeys = new Map<string, components['schemas']['WorkflowRunResponse']>();
route('POST', '/v1/apps/{slug}/workflows/{name}/runs', ({ params, body, req }) => {
  const requestKey = `${params.slug}/${params.name}/${req.headers['idempotency-key']}`;
  const previous = automationRunKeys.get(requestKey);
  if (previous) return status(201, previous);
  const item = mockAutomation(params.slug, params.name);
  const now = new Date().toISOString();
  const run: components['schemas']['WorkflowRunResponse'] = {
    id: crypto.randomUUID(),
    app_id: app(params.slug).id,
    workflow_name: params.name,
    status: 'succeeded',
    created_at: now,
    updated_at: now,
    scheduled_for: now,
    started_at: now,
    finished_at: now,
    input: body,
    output: { ok: true },
  };
  const list = automationMock.runs.get(params.slug) ?? [];
  list.unshift(run);
  automationMock.runs.set(params.slug, list);
  automationMock.steps.set(
    run.id,
    item.draft.steps.map((step) => ({
      step_name: step.name,
      status: 'succeeded',
      attempt: 1,
      created_at: now,
      started_at: now,
      finished_at: now,
      input: body,
      output: { ok: true },
    }))
  );
  automationRunKeys.set(requestKey, run);
  return status(201, run);
});
route('GET', '/v1/workflows/runs/{id}', ({ params }) => {
  const run = [...automationMock.runs.values()].flat().find((run) => run.id === params.id);
  if (!run) throw new Problem(404, 'workflow_run_not_found');
  return run;
});
route('GET', '/v1/workflows/runs/{id}/steps', ({ params }) => ({
  steps: automationMock.steps.get(params.id) ?? [],
}));
route('GET', '/v1/workflows/runs/{id}/steps/{step}/attempts', ({ params }) => {
  const step = automationMock.steps.get(params.id)?.find((step) => step.step_name === params.step);
  return {
    attempts: step
      ? [
          {
            attempt: step.attempt,
            status: 'succeeded',
            http_status: 200,
            started_at: step.started_at,
            finished_at: step.finished_at,
          },
        ]
      : [],
  };
});

registerEventMocks(route, Problem, NO_CONTENT);

// --- Plumbing ------------------------------------------------------------------

// JSON for the `/v1` surface; form-encoded for apid's own dashboard posts
// (`/login`, `/dashboard/account/set-password`), which the console submits
// the way a browser form would.
function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk));
    req.on('end', () => {
      if (!raw) return resolve({});
      const type = String(req.headers['content-type'] ?? '');
      if (type.includes('application/x-www-form-urlencoded')) {
        return resolve(Object.fromEntries(new URLSearchParams(raw)));
      }
      try {
        resolve(JSON.parse(raw) as Record<string, unknown>);
      } catch {
        resolve({});
      }
    });
  });
}

function json(res: ServerResponse, code: number, body: unknown) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function problem(res: ServerResponse, p: Problem) {
  res.statusCode = p.status;
  res.setHeader('Content-Type', 'application/problem+json');
  res.end(
    JSON.stringify({
      type: 'about:blank',
      status: p.status,
      code: p.code,
      title: p.code.replace(/_/g, ' '),
      detail: p.detail,
      ...p.extra,
    })
  );
}

registerMonetizationMock({ route, Problem, status });

const MOCKED_PREFIXES = [
  '/v1/',
  '/status/slo.json',
  '/login',
  '/signup',
  '/dashboard/account/set-password',
  '/dashboard/install/connect',
];

/** What the installer needs from either Vite server; dev and preview both have it. */
type MockHost = { config: { logger: Logger }; middlewares: Connect.Server };

export function mockApi(): Plugin {
  const install = (server: MockHost) => {
    server.config.logger.info(
      `  ➜  mock api: serving /v1/* from mock/ — no backend needed${db.EMPTY ? ' (empty workspace)' : ''}`
    );
    server.middlewares.use((req, res, next) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const method = req.method ?? 'GET';
      // GET /login and /signup are this app's own pages; only the POSTs are the API's.
      const isApi =
        url.pathname.startsWith('/v1/') ||
        url.pathname === '/status/slo.json' ||
        url.pathname === MOCK_S3_OBJECT_PATH ||
        (method !== 'GET' &&
          MOCKED_PREFIXES.some((p) => url.pathname === p || url.pathname.startsWith(p + '/')));
      if (!isApi) return next();

      const match = routes.find((r) => r.method === method && r.pattern.test(url.pathname));
      if (!match) {
        server.config.logger.warn(`  mock api: no handler for ${method} ${url.pathname}`);
        return problem(
          res,
          new Problem(
            404,
            'not_mocked',
            `The mock API has no handler for ${method} ${url.pathname}.`
          )
        );
      }

      const values = url.pathname.match(match.pattern)!.slice(1).map(decodeURIComponent);
      const params = Object.fromEntries(match.keys.map((k, i) => [k, values[i]]));

      void (async () => {
        // The storage stand-in reads its own body: an upload is bytes, not JSON.
        const body =
          method === 'GET' || url.pathname === MOCK_S3_OBJECT_PATH ? {} : await readBody(req);
        await new Promise((r) => setTimeout(r, latency()));
        // Deployments created here move along their lifecycle as time passes.
        advanceDeployments(Date.now());
        try {
          const out = await match.handler({ params, query: url.searchParams, body, req, res });
          if (res.writableEnded || res.headersSent) return; // streaming handlers own the response
          if (out === NO_CONTENT) {
            res.statusCode = 204;
            res.end();
            return;
          }
          if (out && typeof out === 'object' && '__status' in out) {
            const s = out as { __status: number; body: unknown };
            return json(res, s.__status, s.body);
          }
          json(res, 200, out);
        } catch (err) {
          if (err instanceof Problem) return problem(res, err);
          server.config.logger.error(`  mock api: ${method} ${url.pathname} threw: ${String(err)}`);
          problem(res, new Problem(500, 'mock_error', String(err)));
        }
      })();
    });
  };
  return {
    name: 'gregale-mock-api',
    apply: 'serve',
    configureServer: install,
    // `vite preview` serves the built bundle; with the mock installed here too,
    // `npm run preview:mock` tours a real build under the production headers.
    configurePreviewServer: install,
  };
}
