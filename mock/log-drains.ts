import type { components } from '../src/lib/api/schema';
import * as db from './data';

type S = components['schemas'];
type Kind = S['AppLogDrainResponse']['kind'];

/** Per-app caps by plan (faas pkg/api/limits.go: LogDrainPerApp). Free has none. */
export const PER_APP: Record<string, number> = { free: 0, hobby: 3, pro: 10, scale: 25 };

const DATADOG_INTAKES = [
  'datadoghq.com',
  'us3.datadoghq.com',
  'us5.datadoghq.com',
  'datadoghq.eu',
  'ap1.datadoghq.com',
].map((domain) => `https://http-intake.logs.${domain}/api/v2/logs`);

/**
 * apid's checks on a drain's effective state, as `app_log_drain_invalid`
 * reasons (faas handlers_log_drains.go:20-108): a known kind, an http(s) URL,
 * one "Name: value" header, and for datadog a Datadog intake with a
 * DD-API-KEY header (required on create and when switching to datadog).
 */
export function invalidDrain(
  kind: unknown,
  url: unknown,
  header: unknown,
  requireKey: boolean
): string | undefined {
  if (kind !== 'http_json' && kind !== 'otlp' && kind !== 'datadog')
    return `kind ${JSON.stringify(kind)} is not supported; allowed: http_json, otlp, datadog`;
  if (typeof url !== 'string' || !/^https?:\/\/[^/@\s]+/.test(url))
    return 'target_url must be a valid http(s) URL without userinfo';
  if (typeof header === 'string' && header !== '') {
    const [name, value, ...rest] = header.split(':');
    if (rest.length || !name.trim() || !value?.trim())
      return 'auth_header must be one non-empty Name: value pair within the size limit';
  }
  if (kind !== 'datadog') return undefined;
  if (!DATADOG_INTAKES.includes(url))
    return 'a datadog drain must target a Datadog logs intake for one of the sites ap1, eu1, us1, us3, us5';
  const keyed = typeof header === 'string' && /^\s*DD-API-KEY\s*:\s*\S/i.test(header);
  if (typeof header === 'string' ? !keyed : requireKey)
    return 'a datadog drain requires auth_header "DD-API-KEY: <api key>"';
  return undefined;
}

export const isKind = (kind: unknown): kind is Kind =>
  kind === 'http_json' || kind === 'otlp' || kind === 'datadog';

/** Two destinations on the first app, one of them a degraded Datadog drain; every other app starts empty. */
export const drains = new Map<string, S['AppLogDrainResponse'][]>(
  db.apps.map((a, i): [string, S['AppLogDrainResponse'][]] => [
    a.slug,
    i === 0
      ? [
          {
            id: db.id(),
            app_id: a.id,
            account_id: db.ACCOUNT_ID,
            kind: 'http_json',
            target_url: 'https://logs.example.com/ingest',
            auth_header_masked: '***',
            enabled: true,
            created_at: db.iso(9 * 86400_000),
            updated_at: db.iso(2 * 86400_000),
          },
          {
            id: db.id(),
            app_id: a.id,
            account_id: db.ACCOUNT_ID,
            kind: 'datadog',
            target_url: 'https://http-intake.logs.datadoghq.eu/api/v2/logs',
            auth_header_masked: '***',
            enabled: true,
            created_at: db.iso(3 * 86400_000),
            updated_at: db.iso(3 * 86400_000),
          },
        ]
      : [],
  ])
);

export function healthFor(drain: S['AppLogDrainResponse']): S['AppLogDrainHealthResponse'] {
  // The Datadog drain shows the degraded state: refused batches, a backlog
  // and one of the sanitized summaries apid exposes (pkg/api/logdrains.go).
  const degraded = drain.enabled && drain.kind === 'datadog';
  return {
    log_drain_id: drain.id,
    status: !drain.enabled ? 'inactive' : degraded ? 'degraded' : 'healthy',
    active: drain.enabled,
    queue_depth: !drain.enabled ? 0 : degraded ? 1_840 : 12,
    queue_capacity: 10_000,
    pending_records: !drain.enabled ? 0 : degraded ? 1_840 : 12,
    pending_bytes: degraded ? 1_288_000 : 8_400,
    pending_bytes_capacity: 8_388_608,
    dead_letter_total: degraded ? 96 : 3,
    ...(drain.enabled ? { oldest_pending_at: db.iso(degraded ? 11 * 60_000 : 4_000) } : {}),
    delivered_total: degraded ? 48_210 : 182_403,
    failed_total: degraded ? 1_312 : 41,
    dropped_total: 0,
    retries_total: degraded ? 2_604 : 77,
    stream_reconnects_total: 2,
    gaps_total: 0,
    last_success_at: db.iso(degraded ? 11 * 60_000 : 20_000),
    last_failure_at: db.iso(degraded ? 40_000 : 5 * 3600_000),
    last_error: degraded ? 'endpoint returned an unsuccessful HTTP status' : '',
    updated_at: db.iso(20_000),
  };
}

export function analyticsFor(
  drain: S['AppLogDrainResponse'],
  window: string
): S['AppLogDrainAnalyticsResponse'] {
  const hours = window === '1h' ? 1 : window === '7d' ? 168 : window === '30d' ? 720 : 24;
  // apid's buckets are always hourly.
  const count = hours;
  const step = 3600_000;
  const buckets = Array.from({ length: Math.max(2, count) }, (_, i) => {
    const delivered = 600 + Math.round(400 * Math.sin(i / 3) ** 2);
    const failed = i % 11 === 5 ? 18 : 0;
    return {
      start: db.iso((count - i) * step),
      delivered,
      failed,
      dropped: 0,
      retries: failed ? 6 : 0,
      dead_letters: 0,
      pending_records: 0,
      pending_bytes: 0,
      success_rate: delivered / (delivered + failed),
      average_latency_ms: 140 + (i % 5) * 12,
    };
  });
  const delivered = buckets.reduce((s, b) => s + b.delivered, 0);
  const failed = buckets.reduce((s, b) => s + b.failed, 0);
  return {
    log_drain_id: drain.id,
    window: window as S['AppLogDrainAnalyticsResponse']['window'],
    bucket_interval: '1h',
    from: buckets[0].start,
    to: db.iso(0),
    buckets,
    summary: {
      delivered,
      failed,
      dropped: 0,
      retries: buckets.reduce((s, b) => s + b.retries, 0),
      dead_letters: 0,
      success_rate: delivered / (delivered + failed),
      average_latency_ms: 160,
    },
  };
}
