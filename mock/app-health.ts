import type { components } from '../src/lib/api/schema';
import * as db from './data';

type S = components['schemas'];

/**
 * GET /v1/apps/{slug}/health and /health/history as apid answers them
 * (faas pkg/apphealth, docs/app-health.md): a 120-second assessment of the
 * default scope, request evidence only on Hobby+ (`request_plan_restricted`
 * on Free), counts only when `requests.known`, and history newest first in
 * pages whose `next_cursor` is the next `before`.
 *
 * The seeded scenario picks the story: a failing app has no ready replica and
 * an older release still serving, a parked one is idle at zero, a deploying
 * one is starting a new release alongside the serving one.
 */

const POLICY: S['AppHealthRequestPolicy'] = {
  minimum_requests: 50,
  minimum_server_errors: 5,
  warning_error_rate_pct: 5,
  unhealthy_error_rate_pct: 25,
};

const VALID_FOR_SECONDS = 120;

export function healthFor(a: db.App, plan: string): S['AppHealthResponse'] {
  const scenario = db.scenarioOf(a);
  const releases = db.deployments.filter((d) => d.app_id === a.id);
  const latest = releases[0];
  // A failed latest release does not erase an older one that still serves.
  const serving =
    releases.find((d) => d.status === 'live') ??
    (scenario === 'failing' ? releases.find((d) => d.status !== 'failed') : undefined);
  const failing = scenario === 'failing';
  const parked = scenario === 'parked';
  const deploying = scenario === 'deploying';
  const metricsAllowed = plan !== 'free';
  const servingIds = serving ? [serving.id] : [];
  const instance = db.instances.find((i) => i.app_id === a.id);

  const requests: S['AppHealthRequests'] = {
    known: metricsAllowed && !parked && servingIds.length > 0,
    coverage: 'serving_deployments',
    window_seconds: 300,
    deployment_ids: servingIds,
    request_count: !metricsAllowed || parked ? 0 : failing ? 212 : 1_240,
    server_errors: !metricsAllowed || parked ? 0 : failing ? 31 : 0,
    error_rate_pct: !metricsAllowed || parked ? 0 : failing ? 14.62 : 0,
    policy: POLICY,
  };
  const requestCheck: S['AppHealthCheck'] = !metricsAllowed
    ? {
        code: 'requests',
        status: 'unknown',
        reason: 'request_plan_restricted',
        detail:
          'Request telemetry is unavailable on this plan; structural checks remain available.',
      }
    : parked
      ? {
          code: 'requests',
          status: 'not_applicable',
          reason: 'requests_unexercised',
          detail:
            'No requests were observed in the last 5 minutes; request success is unexercised.',
          action: 'metrics',
        }
      : failing
        ? {
            code: 'requests',
            status: 'warning',
            reason: 'request_error_rate_elevated',
            detail: '31 of 212 requests (14.62%) returned a server error in the last 5 minutes.',
            action: 'errors',
          }
        : {
            code: 'requests',
            status: 'pass',
            reason: 'requests_observed',
            detail: 'No server errors among 1,240 requests in the last 5 minutes.',
            action: 'metrics',
          };

  const checks: S['AppHealthCheck'][] = [
    {
      code: 'deployment',
      status: serving ? 'pass' : 'fail',
      detail: serving ? 'A release is serving traffic.' : 'No release is serving traffic.',
      action: 'deployments',
      ...(serving ? { deployment_id: serving.id } : {}),
    },
  ];
  if (failing && latest)
    checks.push({
      code: 'latest_deployment',
      status: 'warning',
      detail: 'The latest release failed; the previous release keeps serving.',
      action: 'deployments',
      deployment_id: latest.id,
    });
  checks.push(
    parked
      ? {
          code: 'readiness',
          status: 'not_applicable',
          detail: 'No warm replica is required; the app is idle at zero and wakes on request.',
        }
      : failing
        ? {
            code: 'readiness',
            status: 'fail',
            reason: 'capacity_below_target',
            detail: 'No required replica is ready.',
            action: 'logs',
            findings: [
              {
                reason: 'required_probe_unready',
                status: 'fail',
                detail: 'The primary app readiness probe reports not ready.',
                deployment_id: serving?.id ?? latest?.id ?? '',
                instance_id: instance?.id ?? db.id(),
                source: 'primary_app',
                observed_at: db.iso(4 * 60_000),
              },
              {
                reason: 'node_heartbeat_stale',
                status: 'unknown',
                detail: 'The node has not reported a heartbeat recently.',
                deployment_id: serving?.id ?? latest?.id ?? '',
                instance_id: instance?.id ?? db.id(),
                source: 'node',
                observed_at: db.iso(6 * 60_000),
              },
            ],
          }
        : {
            code: 'readiness',
            status: 'pass',
            detail: deploying
              ? 'The serving release is ready; the new release is still starting.'
              : 'Every required replica is ready.',
          },
    requestCheck
  );

  return {
    app_id: a.id,
    status: failing
      ? 'unhealthy'
      : deploying
        ? 'degraded'
        : metricsAllowed || parked
          ? 'healthy'
          : 'unknown',
    phase: parked ? 'idle' : deploying ? 'deploying' : 'serving',
    summary: failing
      ? 'No required replica is ready, and server errors are elevated.'
      : parked
        ? 'Idle at zero replicas; the next request wakes it.'
        : deploying
          ? 'A new release is starting alongside the serving one.'
          : metricsAllowed
            ? 'Available, and current evidence shows no health issues.'
            : 'Replicas are ready; request health is unconfirmed on this plan.',
    scope: 'default',
    evaluated_at: new Date().toISOString(),
    valid_for_seconds: VALID_FOR_SECONDS,
    ...(requests.known ? { metrics_as_of: new Date(Date.now() - 20_000).toISOString() } : {}),
    serving_deployment_ids: servingIds,
    ...(latest ? { latest_deployment_id: latest.id } : {}),
    capacity: {
      known: true,
      required: parked ? 0 : 2,
      ready: failing || parked ? 0 : 2,
      starting: deploying ? 1 : 0,
      unready: failing ? 2 : 0,
      unknown: 0,
    },
    checks,
    requests,
  };
}

/** Thirty retained observations, so the console has more than one page to read. */
export function historyFor(
  a: db.App,
  plan: string,
  limit: number,
  before: string | null
): S['AppHealthHistoryPage'] | null {
  const now = healthFor(a, plan);
  const statuses = ['healthy', 'degraded', 'healthy', 'unknown', 'healthy', 'unhealthy'] as const;
  const all: S['AppHealthHistoryEntry'][] = Array.from({ length: 30 }, (_, i) => {
    const kind =
      i === 29 ? 'baseline' : statuses[i % statuses.length] === 'unknown' ? 'gap' : 'transition';
    const status = i === 0 ? now.status : statuses[i % statuses.length];
    const previous = statuses[(i + 1) % statuses.length];
    const observed = db.iso((i * 3 + 1) * 3600_000);
    return {
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      kind,
      observed_at: observed,
      ...(kind === 'transition' ? { previous_status: previous } : {}),
      assessment: { ...now, status: kind === 'gap' ? 'unknown' : status, evaluated_at: observed },
    };
  });
  const start = before ? all.findIndex((e) => e.id === before) + 1 : 0;
  // A cursor apid no longer retains is a 404, not an empty page.
  if (before && start === 0) return null;
  const entries = all.slice(start, start + limit);
  const last = entries.at(-1);
  return {
    app_id: a.id,
    scope: 'default',
    entries,
    ...(start + limit < all.length && last ? { next_cursor: last.id } : {}),
    latest: now,
    collector_fresh: true,
    interval_seconds: 30,
  };
}
