import type { components } from '../src/lib/api/schema';
import * as db from './data';

type S = components['schemas'];
type Evidence = S['DebugRequestEvidenceResponse'];
type Span = S['DebugTelemetrySpan'];

/*
 * The request evidence and replay the dev mock answers beyond the row and
 * spans (faas ADR-127; handlers_debug_evidence.go, handlers_debug_telemetry.go
 * :2540-2716): a request that woke the app, timed spans, the edge-to-billing
 * stages with billing still missing, the critical path, dependency groups and
 * their split by deployment, the request's own log lines, and rules-based
 * findings. Replay picks an enabled mirror rule of the serving deployment,
 * the one asked for when one is, and refuses otherwise.
 */

/** The deployment a mocked request was served by: the first app's mirror source, so replay has a target. */
export function evidenceDeployment(app: db.App): string {
  const rule = db.mirrorRules.get(app.slug)?.find((r) => r.enabled);
  return (
    rule?.source_deployment_id ??
    db.deployments.find((d) => d.app_id === app.id)?.id ??
    db.deployments[0].id
  );
}

/** Start and end times for spans laid out the way the request ran. */
export function timeSpans(spans: Span[], receivedAt: string): Span[] {
  const start = Date.parse(receivedAt);
  // The server span covers the request; children start in sequence inside it.
  let cursor = start + 40;
  return spans.map((span, i) => {
    const ms = Math.round(span.duration_nanos / 1_000_000);
    const from = i === 0 ? start : cursor;
    if (i > 0) cursor = from + ms + 5;
    return {
      ...span,
      ...(i > 0 ? { parent_span_id: spans[0].span_id } : {}),
      start_time: new Date(from).toISOString(),
      end_time: new Date(from + ms).toISOString(),
      ...(span.name === 'postgres.query'
        ? {
            dependency_type: 'app_dependency' as const,
            dependency_kind: 'postgres',
            dependency_name: 'SELECT orders',
          }
        : {}),
    };
  });
}

export function evidenceExtras(
  app: db.App,
  reqId: string,
  spans: Span[],
  receivedAt: string,
  woke: boolean
): Pick<
  Evidence,
  | 'timeline'
  | 'correlation'
  | 'critical_path'
  | 'dependency_latency'
  | 'dependency_latency_truncated'
  | 'dependency_comparison'
  | 'logs'
  | 'logs_truncated'
> & { request: Partial<Evidence['request']>; explanation: Partial<Evidence['explanation']> } {
  const at = (offset: number) => new Date(Date.parse(receivedAt) + offset).toISOString();
  const db_ = spans.find((s) => s.name === 'postgres.query');
  const previous = db.deployments.find(
    (d) => d.app_id === app.id && d.id !== evidenceDeployment(app)
  );
  return {
    request: {
      request_id: reqId,
      instance_id: `inst-${reqId.slice(0, 12)}`,
      node_id: 'node-1',
      commit_sha:
        db.deployments.find((d) => d.id === evidenceDeployment(app))?.commit_sha ?? undefined,
      guest: {
        runtime: 'node22',
        duration_ms: 2310,
        outcome: 'http_error',
        error_class: 'http_5xx',
      },
    },
    timeline: [
      {
        at: at(0),
        phase: 'request',
        kind: 'received',
        summary: 'GET /orders/{id} reached the gateway',
      },
      ...(woke
        ? [
            {
              at: at(2),
              phase: 'wake' as const,
              kind: 'restore',
              actor: 'schedd',
              summary: 'Restored an instance from its snapshot',
              duration_ms: 38,
            },
          ]
        : []),
      { at: at(45), phase: 'guest', kind: 'handler_start', summary: 'The handler started' },
      {
        at: at(2400),
        phase: 'error',
        kind: 'http_5xx',
        summary: 'The app answered 500',
        status: 500,
      },
      {
        at: at(2400),
        phase: 'regression',
        kind: 'matched',
        summary: 'Matched the open latency regression on /orders/{id}',
        approximate: true,
      },
    ],
    correlation: {
      complete: false,
      stages: [
        {
          phase: 'edge',
          status: 'observed',
          started_at: at(0),
          completed_at: at(2),
          duration_ms: 2,
          evidence_count: 1,
        },
        { phase: 'queue', status: 'not_applicable', reason: 'served without queueing' },
        woke
          ? { phase: 'wake', status: 'observed', duration_ms: 38, evidence_count: 2 }
          : { phase: 'wake', status: 'not_applicable', reason: 'a warm instance served it' },
        { phase: 'guest', status: 'observed', duration_ms: 2310, evidence_count: 3 },
        {
          phase: 'downstream',
          status: 'partial',
          duration_ms: 2183,
          evidence_count: 2,
          reason: 'one span lacked a parent link',
        },
        {
          phase: 'billing',
          status: 'missing',
          reason: 'usage for this minute is not rolled up yet',
        },
      ],
    },
    ...(db_
      ? {
          critical_path: {
            duration_ms: 2400,
            complete: true,
            span_count: 2,
            slowest_span_id: db_.span_id,
            slowest_span_name: db_.name,
            slowest_exclusive_ms: 2180,
            spans: spans.slice(0, 2).map((s, i) => ({
              span_id: s.span_id,
              ...(i > 0 ? { parent_span_id: spans[0].span_id } : {}),
              name: s.name,
              kind: s.kind,
              start_time: s.start_time!,
              end_time: s.end_time!,
              duration_ms: Math.round(s.duration_nanos / 1_000_000),
              exclusive_ms: i === 0 ? 220 : 2180,
            })),
          },
        }
      : {}),
    dependency_latency: [
      {
        type: 'app_dependency',
        kind: 'postgres',
        name: 'SELECT orders',
        calls: 1,
        errors: 0,
        total_duration_ms: 2180,
        max_duration_ms: 2180,
      },
      {
        type: 'app_dependency',
        kind: 'redis',
        name: 'GET',
        calls: 1,
        errors: 0,
        total_duration_ms: 3,
        max_duration_ms: 3,
      },
    ],
    dependency_latency_truncated: false,
    ...(previous
      ? {
          dependency_comparison: {
            current_deployment_id: evidenceDeployment(app),
            previous_deployment_id: previous.id,
            route: '/orders/{id}',
            truncated: false,
            dependencies: [
              {
                type: 'app_dependency',
                kind: 'postgres',
                name: 'SELECT orders',
                calls: 412,
                error_calls: 0,
                error_rate_pct: 0,
                p50_ms: 1200,
                p95_ms: 1610,
                p99_ms: 2180,
                baseline_p95_ms: 40,
                current_p95_ms: 1610,
                p95_delta_ms: 1570,
                regression_factor: 40.25,
                regression: true,
                failure_regression: false,
              },
            ],
          },
        }
      : {}),
    logs: [
      {
        occurred_at: at(60),
        source: 'runtime',
        level: 'info',
        stream: 'stdout',
        message: 'loading order 4211',
      },
      {
        occurred_at: at(2390),
        source: 'runtime',
        level: 'error',
        stream: 'stderr',
        message: 'query exceeded 2s budget; answering 500',
      },
    ],
    logs_truncated: false,
    explanation: {
      diagnosis: 'dependency_regression',
      confidence: 'high',
      generated_by: 'rules-v1',
      findings: [
        {
          code: 'dependency_latency_regression',
          title: 'The orders query is 40× slower than on the previous release',
          detail: 'p95 of SELECT orders rose from 40 ms to 1610 ms across 412 calls.',
          confidence: 'high',
        },
      ],
      recommendations: [
        { action: 'inspect_query', detail: 'Check the orders query plan and its indexes.' },
        { action: 'compare_release', detail: 'Compare this release with the previous one.' },
      ],
      evidence_refs: [{ kind: 'dependency', label: 'p95 now', value: '1610 ms' }],
    },
  };
}

/** The enabled mirror rule a replay would use, as selectDebugReplayMirrorRule picks it. */
export function replayTarget(
  app: db.App,
  requested: string
): { rule: S['MirrorRuleResponse'] } | { problem: string } {
  const source = evidenceDeployment(app);
  const rule = (db.mirrorRules.get(app.slug) ?? []).find(
    (r) =>
      r.enabled &&
      r.source_deployment_id === source &&
      (!requested || r.mirror_deployment_id === requested)
  );
  if (rule) return { rule };
  return {
    problem: requested
      ? "the requested mirror deployment is not an enabled target for the request's serving deployment"
      : "the request's serving deployment has no enabled mirror rule; enable a mirror rule for that deployment before replaying",
  };
}
