import { randomUUID } from 'node:crypto';
import type { components } from '../src/lib/api/schema';
import * as db from './data';

type S = components['schemas'];

/*
 * The debugger routes the console reads beyond the request list, answered the
 * way apid answers them (faas ADR-127, docs/debug-status.md):
 *
 * - regressions carry a stored triage state; the list hides resolved ones and
 *   live dismissals, the review shows the exact versioned record, and a checked
 *   action refuses a stale version with 409 `regression_changed`;
 * - status, coverage and running are evidence summaries over a window;
 * - export is a metadata-only NDJSON or CSV file with apid's headers;
 * - replay needs an enabled mirror rule, which only `api-gateway` has here, so
 *   every other app shows the 409 `debug_replay_unsupported` recovery.
 */

const ROUTES = ['/orders/{id}', '/health', '/webhooks/stripe', '/search'];

interface Triage {
  state: S['DebugRegressionItem']['state'];
  version: string;
  acknowledged_at?: string;
  dismissed_until?: string;
  resolved_at?: string;
}
const triage = new Map<string, Triage>();
const keyOf = (deploymentId: string, route: string) => `${deploymentId}|${route}`;

function triageOf(deploymentId: string, route: string): Triage {
  const key = keyOf(deploymentId, route);
  let row = triage.get(key);
  if (!row) {
    row = { state: 'active', version: randomUUID() };
    triage.set(key, row);
  }
  // A dismissal that has run out reads as active again, as apid's list does.
  if (
    row.state === 'dismissed' &&
    row.dismissed_until &&
    Date.parse(row.dismissed_until) <= Date.now()
  )
    row = { ...row, state: 'active' };
  return row;
}

function seededRegressions(a: db.App): S['DebugRegressionItem'][] {
  const dep = db.deployments.find((d) => d.app_id === a.id) ?? db.deployments[0];
  const base: Omit<S['DebugRegressionItem'], 'state'>[] = [
    {
      deployment_id: dep.id,
      route: '/orders/{id}',
      kind: 'latency',
      p95_ms: 1840,
      p95_base_ms: 260,
      affected_count: 412,
      regression_factor: '7.08',
      first_detected_at: db.iso(5_400_000),
      last_detected_at: db.iso(120_000),
      suspected_dependency: {
        type: 'managed_binding',
        kind: 'postgres',
        name: 'orders-db',
        p95_base_ms: 40,
        p95_ms: 1610,
        regression_factor: 40.25,
        reason: 'latency',
        query: 'SELECT * FROM orders WHERE id = $1',
      },
    },
    {
      deployment_id: dep.id,
      route: '/webhooks/stripe',
      kind: 'errors',
      p95_ms: 310,
      p95_base_ms: 300,
      affected_count: 38,
      regression_factor: '1.00',
      error_rate_pct: 12.4,
      error_rate_base_pct: 0.2,
      error_count: 38,
      first_detected_at: db.iso(9_000_000),
      last_detected_at: db.iso(600_000),
    },
  ];
  return base.map((r) => {
    const t = triageOf(r.deployment_id, r.route);
    return {
      ...r,
      state: t.state,
      ...(t.acknowledged_at ? { acknowledged_at: t.acknowledged_at } : {}),
      ...(t.dismissed_until ? { dismissed_until: t.dismissed_until } : {}),
      ...(t.resolved_at ? { resolved_at: t.resolved_at } : {}),
    };
  });
}

/** GET .../debug/regressions: resolved rows and live dismissals stay out of the list. */
export function regressionsFor(a: db.App, since: string): S['DebugRegressionsResponse'] {
  return {
    since,
    regressions: seededRegressions(a).filter(
      (r) =>
        r.state !== 'resolved' &&
        !(
          r.state === 'dismissed' &&
          r.dismissed_until &&
          Date.parse(r.dismissed_until) > Date.now()
        )
    ),
  };
}

/** GET .../debug/regressions/review, or null for an unknown observation. */
export function reviewFor(
  a: db.App,
  deploymentId: string,
  route: string
): S['DebugRegressionReview'] | null {
  const r = seededRegressions(a).find((x) => x.deployment_id === deploymentId && x.route === route);
  if (!r) return null;
  const t = triageOf(deploymentId, route);
  return {
    app_id: a.id,
    deployment_id: deploymentId,
    route,
    version: t.version,
    state: r.state,
    first_detected_at: r.first_detected_at,
    last_detected_at: r.last_detected_at,
    ...(t.acknowledged_at ? { acknowledged_at: t.acknowledged_at } : {}),
    ...(t.dismissed_until ? { dismissed_until: t.dismissed_until } : {}),
    ...(t.resolved_at ? { resolved_at: t.resolved_at } : {}),
  };
}

type ActionResult =
  | { ok: true; body: S['DebugRegressionActionResponse'] }
  | { ok: false; status: number; code: string; detail: string };

/** POST .../debug/regressions/actions with apid's checks (regressiontriage/action.go). */
export function applyAction(a: db.App, body: Record<string, unknown>): ActionResult {
  const deploymentId = String(body.deployment_id ?? '');
  const route = String(body.route ?? '');
  const action = String(body.action ?? '');
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!['acknowledge', 'dismiss', 'resolve', 'reopen'].includes(action))
    return {
      ok: false,
      status: 400,
      code: 'validation_failed',
      detail: 'action must be acknowledge, dismiss, resolve, or reopen',
    };
  if (!body.expected_app_id || !body.expected_version || !reason)
    return {
      ok: false,
      status: 400,
      code: 'validation_failed',
      detail: 'checked actions require expected_app_id, expected_version and reason',
    };
  if (reason.length > 280)
    return {
      ok: false,
      status: 400,
      code: 'validation_failed',
      detail: 'reason must be valid UTF-8 and at most 280 characters',
    };
  const current = reviewFor(a, deploymentId, route);
  if (!current || body.expected_app_id !== a.id || body.expected_version !== current.version)
    return {
      ok: false,
      status: 409,
      code: 'regression_changed',
      detail: 'observation changed or disappeared; review again',
    };
  const now = new Date().toISOString();
  const next: Triage = { state: 'active', version: randomUUID() };
  if (action === 'acknowledge')
    Object.assign(next, { state: 'acknowledged', acknowledged_at: now });
  if (action === 'resolve') Object.assign(next, { state: 'resolved', resolved_at: now });
  if (action === 'dismiss') {
    const until =
      typeof body.dismissed_until === 'string'
        ? Date.parse(body.dismissed_until)
        : Date.now() + 24 * 3600_000;
    if (!Number.isFinite(until) || until <= Date.now() || until > Date.now() + 30 * 24 * 3600_000)
      return {
        ok: false,
        status: 400,
        code: 'validation_failed',
        detail: 'dismissed_until must be in the future and no more than 30 days away',
      };
    Object.assign(next, { state: 'dismissed', dismissed_until: new Date(until).toISOString() });
  }
  triage.set(keyOf(deploymentId, route), next);
  const regression = seededRegressions(a).find(
    (x) => x.deployment_id === deploymentId && x.route === route
  )!;
  return { ok: true, body: { regression, review: reviewFor(a, deploymentId, route)! } };
}

/** GET .../debug/status: the verdict follows the app's seeded scenario. */
export function statusFor(a: db.App, since: string): S['DebugStatusResponse'] {
  const scenario = db.scenarioOf(a);
  const dep =
    db.deployments.find((d) => d.app_id === a.id && d.status === 'live') ??
    db.deployments.find((d) => d.app_id === a.id);
  const failing = scenario === 'failing';
  const parked = scenario === 'parked';
  const regressions = regressionsFor(a, since).regressions;
  const requests = parked ? 0 : failing ? 212 : 1240;
  // An open error regression's failures are server errors in this window
  // too, so the health figure and the regression list agree.
  const errors = failing
    ? 31
    : regressions.filter((r) => r.kind === 'errors').reduce((n, r) => n + (r.error_count ?? 0), 0);
  const failures: S['DebugTelemetryRequestItem'][] = failing
    ? [0, 1, 2].map((i) => ({
        id: db.id(),
        deployment_id: dep?.id,
        route: ROUTES[i % ROUTES.length],
        method: 'GET',
        status: 500,
        latency_ms: 900 + i * 40,
        count: 1,
        cold_boot: false,
        received_at: db.iso((i + 1) * 90_000),
      }))
    : [];
  return {
    verdict: failing ? 'failing' : parked ? 'idle' : regressions.length ? 'degraded' : 'healthy',
    headline: failing
      ? `${errors} of ${requests} requests (14.6%) ended in a server error in the last ${since}.`
      : parked
        ? `No requests in the last ${since}.`
        : regressions.length
          ? `${regressions.length} regressions are open on the serving release.`
          : `${requests} requests served with no server errors in the last ${since}.`,
    since,
    window_start: db.iso(3600_000),
    window_end: new Date().toISOString(),
    health: { requests, server_errors: errors, p95_ms: parked ? 0 : failing ? 1840 : 182 },
    deployments: dep
      ? [
          {
            id: dep.id,
            traffic_percent: 100,
            created_at: dep.created_at,
            ...(dep.commit_sha ? { commit_sha: dep.commit_sha } : {}),
          },
        ]
      : [],
    regressions: regressions.slice(0, 5),
    regressions_total: regressions.length,
    recent_failures: failures,
    ...(failing
      ? {
          oom_kills: [
            {
              at: db.iso(25 * 60_000),
              deployment_id: dep?.id ?? db.id(),
              peak_mb: 600,
              plan_mb: 512,
              deployment_failed: false,
            },
          ],
          oom_kills_total: 1,
          oom_fix:
            '• upgrade from a 512 MB plan to a plan with at least 608 MB of RAM\n• trim in-memory state (caches, buffers, large request bodies held in memory)',
        }
      : {}),
    tracing_enabled: !failing,
    generated_at: new Date().toISOString(),
  };
}

const signal = (requests: number, of: number): S['DebugCoverageSignal'] => ({
  rows: Math.round(requests / 3),
  requests,
  rate_pct: of ? Math.round((requests / of) * 1000) / 10 : 0,
});

/** GET .../debug/coverage. */
export function coverageFor(a: db.App, since: string): S['DebugCoverageResponse'] {
  const parked = db.scenarioOf(a) === 'parked';
  const total = parked ? 0 : 12_480;
  return {
    app_id: a.id,
    since,
    window_start: db.iso(24 * 3600_000),
    window_end: new Date().toISOString(),
    plan_retention_days: 7,
    telemetry_rows: parked ? 0 : 3_210,
    represented_requests: total,
    error_requests: parked ? 0 : 86,
    trace_linked: signal(Math.round(total * 0.92), total),
    span_evidence: signal(Math.round(total * 0.41), total),
    wake_evidence: signal(Math.round(total * 0.03), total),
    guest_evidence: signal(Math.round(total * 0.18), total),
    ...(parked
      ? {}
      : { oldest_telemetry_at: db.iso(23 * 3600_000), latest_telemetry_at: db.iso(40_000) }),
  };
}

/** GET .../debug/running. */
export function runningFor(a: db.App, since: string): S['DebugRunningResponse'] {
  const parked = db.scenarioOf(a) === 'parked';
  const config: S['DebugRunningConfig'] = {
    configured_min_instances: a.min_instances ?? 0,
    effective_min_instances: a.min_instances ?? 0,
    idle_timeout_seconds: 300,
  };
  const current: S['DebugRunningCause'][] = parked
    ? [
        {
          code: 'no_blocker_observed',
          summary: 'Nothing held the app; it parked at the idle timeout.',
          instance_count: 0,
        },
      ]
    : [
        {
          code: 'request_activity',
          summary: 'Requests kept arriving within the idle timeout.',
          instance_count: 1,
          last_activity_at: db.iso(20_000),
          idle_deadline: new Date(Date.now() + 280_000).toISOString(),
          request: {
            telemetry_id: randomUUID(),
            deployment_id: db.deployments.find((d) => d.app_id === a.id)?.id ?? randomUUID(),
            route: '/health',
            method: 'GET',
            received_at: db.iso(20_000),
            count: 3,
            match_delta_ms: 120,
          },
        },
        ...((a.min_instances ?? 0) > 0
          ? [
              {
                code: 'min_instances' as const,
                summary: `A minimum of ${a.min_instances} warm instance is configured.`,
                instance_count: a.min_instances ?? 0,
              },
            ]
          : []),
      ];
  return {
    app_id: a.id,
    since,
    window_start: db.iso(24 * 3600_000),
    window_end: new Date().toISOString(),
    retention_clamped: false,
    current,
    current_observed_at: db.iso(15_000),
    config,
    history: Array.from({ length: 4 }, (_, i) => ({
      observed_at: db.iso((i + 1) * 3600_000),
      running_instances: parked ? 0 : 1,
      configured_min_instances: config.configured_min_instances,
      effective_min_instances: config.effective_min_instances,
      idle_timeout_seconds: 300,
      degraded: i === 2,
      causes: current,
    })),
    history_truncated: false,
  };
}

/** GET .../debug/requests/export: metadata-only rows in apid's two encodings. */
export function exportFor(a: db.App, format: string): string {
  const rows = Array.from({ length: 12 }, (_, i) => ({
    id: randomUUID(),
    received_at: db.iso(i * 300_000),
    method: i % 3 ? 'GET' : 'POST',
    route: ROUTES[i % ROUTES.length],
    status: i % 5 === 0 ? 500 : 200,
    latency_ms: 40 + i * 13,
    cold_boot: i % 6 === 0,
    count: 1,
    deployment_id: db.deployments.find((d) => d.app_id === a.id)?.id ?? '',
  }));
  if (format === 'csv') {
    const cols = Object.keys(rows[0]) as (keyof (typeof rows)[number])[];
    return (
      [cols.join(','), ...rows.map((r) => cols.map((c) => String(r[c])).join(','))].join('\n') +
      '\n'
    );
  }
  return rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
}

/** Only api-gateway has an enabled mirror rule in the mock. */
export function replayFor(a: db.App): S['DebugReplayResponse'] | null {
  if (a.slug !== 'api-gateway') return null;
  const dep = db.deployments.find((d) => d.app_id === a.id);
  return {
    mirror_invocation_id: randomUUID(),
    status: 'queued',
    source_deployment_id: dep?.id ?? null,
    mirror_deployment_id: randomUUID(),
  };
}
