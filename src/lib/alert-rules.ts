import type { components } from './api/schema';

/**
 * What an alert rule may say, decided the way apid decides it, so the form
 * refuses a bad rule before the round trip rather than after.
 *
 * Every bound here cites its source in faas: pkg/api/alerts.go (closed sets,
 * baselines, per-metric windows), handlers_alerts.go validateAlertRuleBody
 * (destination, secret, cooldown), handlers_alerts_slo.go,
 * handlers_alerts_synthetic.go, logsearch/alert.go, and
 * pkg/api/notification_channels.go plus pkg/alertchannels for channels.
 */

type CreateRule = components['schemas']['CreateAlertRuleRequest'];
export type AlertMetric = CreateRule['metric'];
export type AlertComparison = CreateRule['comparison'];
export type AlertWindow = CreateRule['window_spec'];
export type FailureSource = NonNullable<CreateRule['failure_source']>;
export type ChannelKind = components['schemas']['CreateNotificationChannelRequest']['kind'];
export type PagerDutyRegion = 'us' | 'eu';

/** Which extra field a metric needs to name what it watches. */
type Target = 'failure_source' | 'slo' | 'synthetic' | 'log_query' | 'custom_metric';

export interface MetricSpec {
  value: AlertMetric;
  label: string;
  group: string;
  /** The catalog capability apid checks for this metric (alertMetricCapabilities). */
  capability?: string;
  target?: Target;
}

export const WINDOWS: AlertWindow[] = ['5m', '15m', '1h', '6h', '24h', '7d', '15d'];
/** CustomMetric/LogSearch/RouteAlertWindowSpecs: a day at most. */
const DAY_WINDOWS: AlertWindow[] = ['5m', '15m', '1h', '6h', '24h'];

/**
 * The app metrics a rule can watch from this form. Metrics that need a
 * selector the form does not offer (event subscriptions, edge rules, MCP
 * scopes) and operator-only tripwires are left to the CLI and presets.
 */
export const ALERT_METRICS: MetricSpec[] = [
  { value: 'error_rate_pct', label: 'Error rate (%)', group: 'Requests' },
  { value: 'latency_p50_ms', label: 'Latency p50 (ms)', group: 'Requests' },
  { value: 'latency_p95_ms', label: 'Latency p95 (ms)', group: 'Requests' },
  { value: 'latency_p99_ms', label: 'Latency p99 (ms)', group: 'Requests' },
  { value: 'request_count', label: 'Requests', group: 'Requests' },
  { value: 'cold_start_pct', label: 'Cold starts (%)', group: 'Requests' },
  { value: 'cold_wake_rate_pct', label: 'Cold wakes (%)', group: 'Requests' },
  {
    value: 'failed_invocations',
    label: 'Failed invocations',
    group: 'Requests',
    target: 'failure_source',
  },
  { value: 'new_error_fingerprint', label: 'New error fingerprints', group: 'Requests' },
  { value: 'api_up', label: 'API up (1 = up)', group: 'Availability' },
  { value: 'deployment_failed', label: 'Failed deployments', group: 'Availability' },
  { value: 'cert_expiry_seconds', label: 'Certificate expiry (s)', group: 'Availability' },
  { value: 'cert_issuance_failed', label: 'Certificate issuance failures', group: 'Availability' },
  {
    value: 'route_monitor_incidents',
    label: 'Route monitor incidents',
    group: 'Availability',
    capability: 'production-route-monitoring',
  },
  {
    value: 'route_health_holds',
    label: 'Canaries held by route health',
    group: 'Availability',
    capability: 'route-health-canary-guard',
  },
  {
    value: 'slo_budget_burn',
    label: 'SLO budget burn rate',
    group: 'SLOs and checks',
    capability: 'custom-slos',
    target: 'slo',
  },
  {
    value: 'slo_budget_remaining_pct',
    label: 'SLO budget remaining (%)',
    group: 'SLOs and checks',
    capability: 'custom-slos',
    target: 'slo',
  },
  {
    value: 'synthetic_check_consecutive_failures',
    label: 'Synthetic check failures in a row',
    group: 'SLOs and checks',
    capability: 'synthetic-checks',
    target: 'synthetic',
  },
  {
    value: 'synthetic_check_latency_p95_ms',
    label: 'Synthetic check p95 (ms)',
    group: 'SLOs and checks',
    capability: 'synthetic-checks',
    target: 'synthetic',
  },
  { value: 'log_error_lines', label: 'Error log lines', group: 'Logs' },
  { value: 'log_warn_lines', label: 'Warning log lines', group: 'Logs' },
  {
    value: 'log_search_matches',
    label: 'Log search matches',
    group: 'Logs',
    capability: 'log-search',
    target: 'log_query',
  },
  { value: 'queue_depth', label: 'Requests held while waking', group: 'Queues' },
  { value: 'queue_backlog', label: 'Queue backlog', group: 'Queues' },
  { value: 'queue_oldest_age_seconds', label: 'Oldest queued message (s)', group: 'Queues' },
  { value: 'daily_cost_cents', label: 'Daily cost (cents)', group: 'Cost' },
  {
    value: 'custom_metric',
    label: 'Custom metric',
    group: 'Cost',
    capability: 'custom-metric-history',
    target: 'custom_metric',
  },
];

export function metricSpec(metric: string): MetricSpec | undefined {
  return ALERT_METRICS.find((m) => m.value === metric);
}

export function windowsFor(metric: string): AlertWindow[] {
  const day =
    metric === 'custom_metric' ||
    metric === 'log_search_matches' ||
    metric === 'route_monitor_incidents' ||
    metric === 'route_health_holds';
  return day ? DAY_WINDOWS : WINDOWS;
}

/** AnomalyAlertMetrics (ADR-744); below_baseline is request_count only. */
const BASELINE_METRICS = [
  'error_rate_pct',
  'latency_p95_ms',
  'latency_p99_ms',
  'cold_start_pct',
  'request_count',
];

export function comparisonsFor(metric: string, baselines: boolean): AlertComparison[] {
  const out: AlertComparison[] = ['gt', 'gte', 'lt', 'lte'];
  if (!baselines || !BASELINE_METRICS.includes(metric)) return out;
  out.push('above_baseline');
  if (metric === 'request_count') out.push('below_baseline');
  return out;
}

export const COMPARISON_LABEL: Record<string, string> = {
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  above_baseline: '× usual',
  below_baseline: '× usual (below)',
};

export const FAILURE_SOURCES: FailureSource[] = [
  'any',
  'cron',
  'queue',
  'delayed_task',
  'async_invoke',
  'inbound_webhook',
];

export const MAX_CHANNELS_PER_RULE = 5; // pkg/api/limits.go MaxChannelsPerAlertRule
const NAME_MAX_CHARS = 64; // AlertRuleNameMaxChars
const SECRET_MAX_BYTES = 256; // AlertRuleWebhookSecretMaxBytes
const LOG_QUERY_KEYS = [
  'source',
  'level',
  'status',
  'route',
  'deployment_id',
  'request_id',
  'trace_id',
  'q',
];
const CUSTOM_METRIC_NAME = /^[a-z][a-z0-9_]{0,62}$/;

export interface RuleDraft {
  name: string;
  metric: AlertMetric;
  comparison: AlertComparison;
  threshold: string;
  window: AlertWindow;
  cooldown: string;
  failureSource: FailureSource;
  sloId: string;
  syntheticCheckId: string;
  logQuery: string;
  customMetricName: string;
  webhookUrl: string;
  webhookSecret: string;
  channelIds: string[];
}

export const EMPTY_RULE_DRAFT: RuleDraft = {
  name: '',
  metric: 'error_rate_pct',
  comparison: 'gt',
  threshold: '5',
  window: '15m',
  cooldown: '30',
  failureSource: 'any',
  sloId: '',
  syntheticCheckId: '',
  logQuery: '',
  customMetricName: '',
  webhookUrl: '',
  webhookSecret: '',
  channelIds: [],
};

export type RuleField =
  | 'name'
  | 'threshold'
  | 'window'
  | 'cooldown'
  | 'sloId'
  | 'syntheticCheckId'
  | 'logQuery'
  | 'customMetricName'
  | 'webhookUrl'
  | 'secret'
  | 'channels';

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname);
  } catch {
    return false;
  }
}

/** Why apid would refuse this log_query, or null (state.CanonicalLogQuery). */
export function logQueryProblem(query: string): string | null {
  const params = new URLSearchParams(query.trim());
  const seen = new Set<string>();
  let filters = 0;
  for (const [key, value] of params) {
    if (!LOG_QUERY_KEYS.includes(key))
      return `“${key}” is not a log search filter; use ${LOG_QUERY_KEYS.join(', ')}.`;
    if (seen.has(key)) return `Use the “${key}” filter once.`;
    seen.add(key);
    if (value.trim()) filters++;
  }
  return filters ? null : 'Enter at least one log search filter, such as level=error&q=timeout.';
}

/** Per-field problems; an empty object means apid should accept the rule. */
export function ruleDraftErrors(d: RuleDraft): Partial<Record<RuleField, string>> {
  const e: Partial<Record<RuleField, string>> = {};
  const name = d.name.trim();
  if (!name) e.name = 'Enter a name for this rule.';
  else if (Array.from(name).length > NAME_MAX_CHARS)
    e.name = `Keep the name to ${NAME_MAX_CHARS} characters.`;

  const threshold = Number(d.threshold);
  if (d.threshold.trim() === '' || !Number.isFinite(threshold))
    e.threshold = 'Enter a numeric threshold.';
  else if (d.comparison === 'above_baseline' && (threshold < 1.5 || threshold > 20))
    e.threshold = 'Above the usual value takes a multiplier from 1.5 to 20.';
  else if (d.comparison === 'below_baseline' && (threshold < 0.05 || threshold > 0.67))
    e.threshold = 'Below the usual value takes a fraction from 0.05 to 0.67.';

  if (!windowsFor(d.metric).includes(d.window))
    e.window = `This metric takes windows up to ${windowsFor(d.metric).at(-1)}.`;

  const cooldown = Number(d.cooldown);
  if (!Number.isInteger(cooldown) || cooldown < 5 || cooldown > 1440)
    e.cooldown = 'Enter whole minutes from 5 to 1440.';

  const target = metricSpec(d.metric)?.target;
  if (target === 'slo' && !d.sloId) e.sloId = 'Choose the SLO this rule watches.';
  if (target === 'synthetic' && !d.syntheticCheckId)
    e.syntheticCheckId = 'Choose the synthetic check this rule watches.';
  if (target === 'log_query') {
    const problem = logQueryProblem(d.logQuery);
    if (problem) e.logQuery = problem;
  }
  if (target === 'custom_metric' && !CUSTOM_METRIC_NAME.test(d.customMetricName))
    e.customMetricName =
      'Use the pushed metric name: lowercase letters, digits and underscores, starting with a letter.';

  const url = d.webhookUrl.trim();
  if (url || d.webhookSecret) {
    if (!isHttpsUrl(url)) e.webhookUrl = 'Enter a complete HTTPS webhook URL.';
    const bytes = new TextEncoder().encode(d.webhookSecret).length;
    if (bytes < 1 || bytes > SECRET_MAX_BYTES)
      e.secret = 'Enter a webhook secret of no more than 256 bytes.';
  } else if (d.channelIds.length === 0) {
    e.webhookUrl = 'Enter a webhook or choose a channel to deliver to.';
  }
  if (d.channelIds.length > MAX_CHANNELS_PER_RULE)
    e.channels = `A rule delivers to at most ${MAX_CHANNELS_PER_RULE} channels.`;
  return e;
}

/** The create body, carrying only the fields this metric and destination use. */
export function ruleDraftBody(d: RuleDraft): CreateRule {
  const target = metricSpec(d.metric)?.target;
  const url = d.webhookUrl.trim();
  return {
    name: d.name.trim(),
    metric: d.metric,
    comparison: d.comparison,
    threshold: Number(d.threshold),
    window_spec: d.window,
    cooldown_minutes: Number(d.cooldown),
    action: 'webhook',
    ...(target === 'failure_source' ? { failure_source: d.failureSource } : {}),
    ...(target === 'slo' ? { slo_id: d.sloId } : {}),
    ...(target === 'synthetic' ? { synthetic_check_id: d.syntheticCheckId } : {}),
    ...(target === 'log_query' ? { log_query: d.logQuery.trim() } : {}),
    ...(target === 'custom_metric' ? { custom_metric_name: d.customMetricName } : {}),
    ...(url ? { webhook_url: url, webhook_secret: d.webhookSecret } : {}),
    ...(d.channelIds.length ? { channel_ids: d.channelIds } : {}),
  } as CreateRule;
}

export interface ChannelDraft {
  name: string;
  kind: ChannelKind;
  slackUrl: string;
  routingKey: string;
  region: PagerDutyRegion;
  email: string;
}

const CHANNEL_NAME = /^[a-z][a-z0-9_-]{0,62}$/;
const SLACK_PATH = /^\/services\/[A-Za-z0-9]+\/[A-Za-z0-9]+\/[A-Za-z0-9]+$/;
const ROUTING_KEY = /^[A-Za-z0-9]{32}$/;

function isSlackWebhook(raw: string): boolean {
  try {
    const u = new URL(raw);
    return (
      u.protocol === 'https:' &&
      u.host === 'hooks.slack.com' &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      SLACK_PATH.test(u.pathname)
    );
  } catch {
    return false;
  }
}

export type ChannelField = 'name' | 'slackUrl' | 'routingKey' | 'email';

export function channelDraftErrors(
  d: ChannelDraft,
  accountEmail: string | undefined
): Partial<Record<ChannelField, string>> {
  const e: Partial<Record<ChannelField, string>> = {};
  if (!CHANNEL_NAME.test(d.name))
    e.name = 'Use lowercase letters, digits, - and _, starting with a letter (up to 63).';
  if (d.kind === 'slack' && !isSlackWebhook(d.slackUrl.trim()))
    e.slackUrl = 'Paste a Slack incoming webhook: https://hooks.slack.com/services/…';
  if (d.kind === 'pagerduty' && !ROUTING_KEY.test(d.routingKey.trim()))
    e.routingKey = 'Paste the 32-character Events API v2 integration key.';
  if (
    d.kind === 'email' &&
    (!accountEmail || d.email.trim().toLowerCase() !== accountEmail.toLowerCase())
  )
    e.email = "Email channels can only send to your account's own address for now.";
  return e;
}

export function channelDraftBody(
  d: ChannelDraft
): components['schemas']['CreateNotificationChannelRequest'] {
  if (d.kind === 'slack')
    return { name: d.name, kind: d.kind, slack_webhook_url: d.slackUrl.trim() };
  if (d.kind === 'pagerduty')
    return {
      name: d.name,
      kind: d.kind,
      pagerduty_routing_key: d.routingKey.trim(),
      pagerduty_region: d.region,
    };
  return { name: d.name, kind: d.kind, email: d.email.trim() };
}
