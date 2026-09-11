import type { DebugRequestEvidence } from '@/lib/api/queries';

/** Deliberate allowlist: no free-form explanation, span names, SQL or raw object spreads. */
export function safeDebugBundle(slug: string, data: DebugRequestEvidence, buildId?: string | null) {
  const text = (value?: string | null) => value?.slice(0, 256) ?? null;
  const request = data.request;
  const regression = data.regression;
  return JSON.stringify(
    {
      app: text(slug),
      build_id: text(buildId),
      request: {
        id: text(request.id),
        deployment_id: text(request.deployment_id),
        route: text(request.route),
        method: text(request.method),
        status: request.status,
        latency_ms: request.latency_ms,
        count: request.count,
        cold_boot: request.cold_boot,
        trace_id: text(request.trace_id),
        received_at: text(request.received_at),
      },
      explanation_status:
        data.explanation.status === 'regression_detected' ? 'regression_detected' : 'unobserved',
      blamed_span_id: text(data.explanation.primary_span?.span_id),
      spans: data.spans.slice(0, 100).map((span) => ({
        span_id: text(span.span_id),
        trace_id: text(span.trace_id),
        parent_span_id: text(span.parent_span_id),
        duration_nanos: span.duration_nanos,
        status: ['OK', 'ERROR', 'UNSET'].includes(span.status ?? '') ? span.status : null,
      })),
      spans_truncated: data.spans_truncated || data.spans.length > 100,
      regression: regression
        ? {
            deployment_id: text(regression.deployment_id),
            route: text(regression.route),
            p95_ms: regression.p95_ms,
            p95_base_ms: regression.p95_base_ms,
            affected_count: regression.affected_count,
            regression_factor: text(regression.regression_factor),
            first_detected_at: text(regression.first_detected_at),
            last_detected_at: text(regression.last_detected_at),
          }
        : null,
      generated_at: text(data.generated_at),
    },
    null,
    2
  );
}

export function suggestedDebugChecks(data: DebugRequestEvidence): string[] {
  const checks: string[] = [];
  if (data.request.status >= 500 && data.request.status < 600)
    checks.push(
      'Suggested check: HTTP 5xx was recorded; inspect app logs around the request timestamp.'
    );
  else if (data.request.status === 429)
    checks.push(
      'Suggested check: HTTP 429 was recorded; inspect configured rate limits and app logs.'
    );
  else if (data.request.status === 401 || data.request.status === 403)
    checks.push(
      'Suggested check: HTTP 401 / 403 was recorded; review route authentication and access settings.'
    );
  else if (data.request.status >= 400 && data.request.status < 500)
    checks.push(
      'Suggested check: HTTP 4xx was recorded; review the route and method against its configuration.'
    );
  if (data.spans.some((span) => span.status === 'ERROR'))
    checks.push(
      'Suggested check: a span explicitly reports ERROR; inspect that span and related app logs.'
    );
  if (data.request.cold_boot === true)
    checks.push(
      'Suggested check: a cold boot was recorded; inspect app wake evidence if a wake ID is available.'
    );
  if (data.regression)
    checks.push(
      'Suggested check: a regression is linked; compare its baseline and current metrics.'
    );
  return checks;
}
