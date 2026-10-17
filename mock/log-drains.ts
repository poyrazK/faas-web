import type { components } from '../src/lib/api/schema';
import * as db from './data';

type S = components['schemas'];

/** One delivering destination on the first app; every other app starts empty. */
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
        ]
      : [],
  ])
);

export function healthFor(drain: S['AppLogDrainResponse']): S['AppLogDrainHealthResponse'] {
  return {
    log_drain_id: drain.id,
    status: drain.enabled ? 'healthy' : 'inactive',
    active: drain.enabled,
    queue_depth: drain.enabled ? 12 : 0,
    queue_capacity: 10_000,
    pending_records: 12,
    pending_bytes: 8_400,
    pending_bytes_capacity: 8_388_608,
    dead_letter_total: 3,
    delivered_total: 182_403,
    failed_total: 41,
    dropped_total: 0,
    retries_total: 77,
    stream_reconnects_total: 2,
    gaps_total: 0,
    last_success_at: db.iso(20_000),
    last_failure_at: db.iso(5 * 3600_000),
    last_error: drain.enabled ? '' : 'Destination paused.',
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
