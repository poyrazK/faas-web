import type { components } from '@/lib/api/schema';

/**
 * The alert metrics the console offers, and what each one asks of a rule.
 *
 * apid accepts about ninety metrics (faas pkg/api/alerts.go:107-208). The ones
 * here are those an app rule can be written for from this form: each needs at
 * most one extra selector, and that selector is one this form can fill. Event
 * consumer, workflow, MCP and edge-rule metrics are created from their own
 * surfaces or the CLI, because they name a subscription, an environment or an
 * edge rule; a rule on one of them still renders, by its raw metric name.
 *
 * Typed by the spec, so a metric renamed or dropped upstream stops compiling.
 */
export type AlertMetric = components['schemas']['CreateAlertRuleRequest']['metric'];
export type AlertComparison = components['schemas']['CreateAlertRuleRequest']['comparison'];
export type AlertWindow = components['schemas']['CreateAlertRuleRequest']['window_spec'];
export type FailureSource = NonNullable<
  components['schemas']['CreateAlertRuleRequest']['failure_source']
>;

/** The extra field a metric needs, mirroring apid's xor checks. */
export type MetricTarget = 'failure_source' | 'slo' | 'synthetic_check' | 'log_query' | 'custom';

export interface MetricSpec {
  value: AlertMetric;
  label: string;
  group: string;
  /** What the threshold is measured in, shown next to the field. */
  unit: string;
  target?: MetricTarget;
  /**
   * The catalog capability the metric needs beyond alerts' own; apid refuses
   * the rule while it is off (handlers_alerts.go:854, alerts.go:258-268).
   */
  capability?: string;
  /** Windows apid accepts for this metric, when not all of them. */
  windows?: readonly AlertWindow[];
  /** apid ignores window_spec for this metric (slo_*, consecutive failures). */
  ignoresWindow?: boolean;
  /** Baseline comparisons apid accepts (alerts.go:295-316). */
  baseline?: 'above' | 'above-and-below';
}

export const ALL_WINDOWS = [
  '5m',
  '15m',
  '1h',
  '6h',
  '24h',
  '7d',
  '15d',
] as const satisfies readonly AlertWindow[];
/** custom_metric, log_search_matches and route alerts stop at a day (alerts.go:216,225,693). */
const UP_TO_A_DAY = ['5m', '15m', '1h', '6h', '24h'] as const satisfies readonly AlertWindow[];

export const FAILURE_SOURCES = [
  'any',
  'cron',
  'queue',
  'delayed_task',
  'async_invoke',
  'inbound_webhook',
] as const satisfies readonly FailureSource[];

export const METRICS: readonly MetricSpec[] = [
  { value: 'error_rate_pct', label: 'Error rate', group: 'Requests', unit: '%', baseline: 'above' },
  { value: 'latency_p50_ms', label: 'Latency p50', group: 'Requests', unit: 'ms' },
  {
    value: 'latency_p95_ms',
    label: 'Latency p95',
    group: 'Requests',
    unit: 'ms',
    baseline: 'above',
  },
  {
    value: 'latency_p99_ms',
    label: 'Latency p99',
    group: 'Requests',
    unit: 'ms',
    baseline: 'above',
  },
  {
    value: 'request_count',
    label: 'Requests',
    group: 'Requests',
    unit: 'requests',
    baseline: 'above-and-below',
  },
  { value: 'api_up', label: 'API up', group: 'Requests', unit: '1 up, 0 down' },
  {
    value: 'cold_start_pct',
    label: 'Cold starts',
    group: 'Requests',
    unit: '%',
    baseline: 'above',
  },
  { value: 'cold_wake_rate_pct', label: 'Cold wakes', group: 'Requests', unit: '%' },
  {
    value: 'queue_depth',
    label: 'Requests held while waking',
    group: 'Requests',
    unit: 'requests',
  },
  {
    value: 'failed_invocations',
    label: 'Failed invocations',
    group: 'Failures',
    unit: 'invocations',
    target: 'failure_source',
  },
  { value: 'deployment_failed', label: 'Failed deployments', group: 'Failures', unit: 'deploys' },
  { value: 'new_error_fingerprint', label: 'New error groups', group: 'Failures', unit: 'groups' },
  {
    value: 'cert_expiry_seconds',
    label: 'Certificate expires in',
    group: 'Failures',
    unit: 'seconds',
  },
  {
    value: 'cert_issuance_failed',
    label: 'Certificate issuance failures',
    group: 'Failures',
    unit: 'failures',
  },
  { value: 'log_error_lines', label: 'Error log lines', group: 'Logs', unit: 'lines' },
  { value: 'log_warn_lines', label: 'Warning log lines', group: 'Logs', unit: 'lines' },
  {
    value: 'log_search_matches',
    label: 'Log search matches',
    group: 'Logs',
    unit: 'events',
    target: 'log_query',
    capability: 'log-search',
    windows: UP_TO_A_DAY,
  },
  { value: 'queue_backlog', label: 'Queue backlog', group: 'Queues', unit: 'messages' },
  {
    value: 'queue_oldest_age_seconds',
    label: 'Oldest queued message',
    group: 'Queues',
    unit: 'seconds',
  },
  {
    value: 'slo_budget_burn',
    label: 'SLO budget burn rate',
    group: 'SLOs and checks',
    unit: '× budget',
    target: 'slo',
    capability: 'custom-slos',
    ignoresWindow: true,
  },
  {
    value: 'slo_budget_remaining_pct',
    label: 'SLO budget remaining',
    group: 'SLOs and checks',
    unit: '%',
    target: 'slo',
    capability: 'custom-slos',
    ignoresWindow: true,
  },
  {
    value: 'synthetic_check_consecutive_failures',
    label: 'Check failures in a row',
    group: 'SLOs and checks',
    unit: 'runs',
    target: 'synthetic_check',
    capability: 'synthetic-checks',
    ignoresWindow: true,
  },
  {
    value: 'synthetic_check_latency_p95_ms',
    label: 'Check latency p95',
    group: 'SLOs and checks',
    unit: 'ms',
    target: 'synthetic_check',
    capability: 'synthetic-checks',
  },
  { value: 'pre_auth_pressure', label: 'Pre-auth limit pressure', group: 'Edge', unit: 'requests' },
  { value: 'edge_rejections', label: 'Edge rejections', group: 'Edge', unit: 'requests' },
  {
    value: 'edge_validation_failures',
    label: 'Validation failures',
    group: 'Edge',
    unit: 'requests',
  },
  { value: 'edge_waf_detections', label: 'WAF detections', group: 'Edge', unit: 'detections' },
  {
    value: 'route_monitor_incidents',
    label: 'Route monitor incidents',
    group: 'Routes',
    unit: 'incidents',
    capability: 'production-route-monitoring',
    windows: UP_TO_A_DAY,
  },
  {
    value: 'route_health_holds',
    label: 'Canaries held by route health',
    group: 'Routes',
    unit: 'canaries',
    capability: 'route-health-canary-guard',
    windows: UP_TO_A_DAY,
  },
  {
    value: 'custom_metric',
    label: 'Custom metric',
    group: 'Custom',
    unit: 'value',
    target: 'custom',
    capability: 'custom-metric-history',
    windows: UP_TO_A_DAY,
  },
];

const BY_VALUE = new Map<string, MetricSpec>(METRICS.map((m) => [m.value, m]));

export function metricSpec(metric: string): MetricSpec | undefined {
  return BY_VALUE.get(metric);
}

/** A metric's label, or its raw name for one this form does not offer. */
export function metricLabel(metric: string): string {
  return BY_VALUE.get(metric)?.label ?? metric;
}

/**
 * The metrics this account can write a rule for: a metric whose capability is
 * off would be refused (`capability_not_released`), so it is not offered.
 */
export function availableMetrics(isOn: (capability: string) => boolean): MetricSpec[] {
  return METRICS.filter((m) => !m.capability || isOn(m.capability));
}

export function windowsFor(metric: string): readonly AlertWindow[] {
  return BY_VALUE.get(metric)?.windows ?? ALL_WINDOWS;
}

export const COMPARISON_SYMBOL: Record<string, string> = {
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  above_baseline: '× usual, above',
  below_baseline: '× usual, below',
};

/**
 * The comparisons apid accepts for a metric. Baselines need the anomaly-alerts
 * flag (handlers_alerts.go:865) and are refused for other metrics.
 */
export function comparisonsFor(metric: string, baselines: boolean): AlertComparison[] {
  const fixed: AlertComparison[] = ['gt', 'gte', 'lt', 'lte'];
  const baseline = baselines ? BY_VALUE.get(metric)?.baseline : undefined;
  if (baseline === 'above-and-below') return [...fixed, 'above_baseline', 'below_baseline'];
  if (baseline === 'above') return [...fixed, 'above_baseline'];
  return fixed;
}

export function isBaseline(comparison: string): boolean {
  return comparison === 'above_baseline' || comparison === 'below_baseline';
}

/** The multiplier range for a baseline comparison (ADR-744, alerts.go:303-313). */
export function baselineRange(comparison: string): { min: number; max: number } | undefined {
  if (comparison === 'above_baseline') return { min: 1.5, max: 20 };
  if (comparison === 'below_baseline') return { min: 0.05, max: 0.67 };
  return undefined;
}

/** "Error rate > 5 %" or "Requests 0.3× usual, below", for a table cell. */
export function describeCondition(rule: {
  metric: string;
  comparison: string;
  threshold: number;
}): string {
  const label = metricLabel(rule.metric);
  if (isBaseline(rule.comparison))
    return `${label} ${rule.threshold}${COMPARISON_SYMBOL[rule.comparison]}`;
  const unit = BY_VALUE.get(rule.metric)?.unit;
  const suffix = unit === '%' ? '%' : unit === 'ms' ? ' ms' : unit === 'seconds' ? ' s' : '';
  return `${label} ${COMPARISON_SYMBOL[rule.comparison] ?? rule.comparison} ${rule.threshold}${suffix}`;
}
