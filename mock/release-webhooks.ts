import type { components } from '../src/lib/api/schema';
import * as db from './data';

type S = components['schemas'];
type Delivery = S['AppWebhookDeliveryResponse'];
type Receiver = S['AccountReleaseWebhookResponse'];

/**
 * The account release vocabulary (faas pkg/api/webhooks.go:141-144). An empty
 * filter is refused: account receivers never take "every event".
 */
export const RELEASE_EVENTS = [
  'deployment.live',
  'deployment.failed',
  'rollout.completed',
  'rollout.aborted',
  'environment.gitops.changed',
] as const;

/** Total outbound subscriptions per account, app and release alike (limits.go WebhookPerAccount). */
export const PER_ACCOUNT: Record<string, number> = { free: 0, hobby: 10, pro: 30, scale: 100 };

/** apid's checks as `app_webhook_invalid` reasons (handlers_account_release_webhooks.go:19-46, 128-165). */
export function invalidReceiver(
  body: Record<string, unknown>,
  partial: boolean
): string | undefined {
  const url = body.target_url;
  if (!partial || url !== undefined) {
    if (typeof url !== 'string' || !url) return 'target_url is required';
    if (!/^https?:\/\//.test(url)) return 'target_url must start with http:// or https://';
    if (url.length < 8 || url.length > 2048)
      return `target_url length ${url.length} out of bounds [8, 2048]`;
  }
  const events = body.event_filter;
  if (!partial || events !== undefined) {
    if (!Array.isArray(events) || events.length === 0 || events.length > RELEASE_EVENTS.length)
      return `event_filter must contain 1–${RELEASE_EVENTS.length} account events`;
    for (const [i, event] of events.entries()) {
      if (!(RELEASE_EVENTS as readonly unknown[]).includes(event))
        return `event ${JSON.stringify(event)} is not an account event; allowed: ${RELEASE_EVENTS.join(', ')}`;
      if (events.indexOf(event) !== i) return `event ${JSON.stringify(event)} is duplicated`;
    }
  }
  const policy = body.retry_policy;
  if (policy !== undefined && !['default', 'aggressive', 'none'].includes(String(policy)))
    return `retry_policy ${JSON.stringify(policy)} is not in the closed vocabulary; allowed: default, aggressive, none`;
  const format = body.delivery_format;
  if (format !== undefined && format !== 'json' && format !== 'cloudevents')
    return `delivery_format ${JSON.stringify(format)} is not in the closed vocabulary; allowed: json, cloudevents`;
  const secret = body.webhook_secret;
  if (!partial || secret !== undefined) {
    if (typeof secret !== 'string' || !secret) return 'webhook_secret is required';
    if (secret.length > 256) return `webhook_secret length ${secret.length} exceeds max 256`;
  }
  return undefined;
}

/** Receivers whose target answered 429/503 with Retry-After (dispatcher.go:763-769). */
export const cooldowns = new Map<string, string>();

function receiver(url: string, events: Receiver['event_filter'], ageDays: number): Receiver {
  return {
    id: db.id(),
    scope: 'account',
    account_id: db.ACCOUNT_ID,
    target_url: url,
    webhook_secret_sealed_masked: '***',
    event_filter: events,
    retry_policy: 'default',
    delivery_format: url.includes('cloudevents') ? 'cloudevents' : 'json',
    enabled: true,
    created_at: db.iso(ageDays * 86400_000),
    updated_at: db.iso(ageDays * 86400_000),
  };
}

/**
 * Two receivers: a healthy release dashboard and an incident bridge that is
 * cooling down after a 503, with a dead delivery to re-send.
 */
export const receivers: Receiver[] = db.EMPTY
  ? []
  : [
      receiver(
        'https://platform.example.com/gregale/releases',
        ['deployment.live', 'deployment.failed', 'rollout.completed', 'rollout.aborted'],
        21
      ),
      receiver('https://incidents.example.com/cloudevents/gregale', ['deployment.failed'], 6),
    ];

type Seed = Pick<Delivery, 'status' | 'attempt'> & Partial<Delivery>;

/** Adds deliveries to a webhook's history, newest first, in the order given. */
export function seedDeliveries(webhookId: string, seeds: Seed[]): Delivery[] {
  const app = db.apps[0];
  const made = seeds.map((seed, i): Delivery => {
    const age = (i + 1) * 47 * 60_000;
    return {
      id: db.id(),
      webhook_id: webhookId,
      ...(app ? { app_id: app.id } : {}),
      account_id: db.ACCOUNT_ID,
      event: 'deployment.live',
      payload: { deployment_id: db.id(), status: 'live' },
      next_attempt_at: db.iso(age - 30_000),
      created_at: db.iso(age),
      updated_at: db.iso(age - 30_000),
      ...(seed.status === 'succeeded'
        ? { delivered_at: db.iso(age - 900), last_response_code: 200 }
        : {}),
      ...(seed.status === 'dead' ? { last_error: 'HTTP 503', last_response_code: 503 } : {}),
      ...seed,
    };
  });
  db.deliveries.set(webhookId, [...made, ...(db.deliveries.get(webhookId) ?? [])]);
  return made;
}

if (!db.EMPTY) {
  const [dashboard, incidents] = receivers;
  const apps = db.apps.slice(0, 3);
  const rows = (hook: Receiver, seeds: Seed[]) =>
    seedDeliveries(hook.id, seeds).forEach((d, i) => {
      const a = apps[i % apps.length];
      if (a) d.app_id = a.id;
      d.event = hook.event_filter[i % hook.event_filter.length];
    });
  rows(dashboard, [
    { status: 'succeeded', attempt: 1 },
    { status: 'succeeded', attempt: 2 },
    { status: 'succeeded', attempt: 1 },
    { status: 'succeeded', attempt: 1 },
  ]);
  rows(incidents, [
    { status: 'pending', attempt: 2, last_error: 'HTTP 503', last_response_code: 503 },
    { status: 'dead', attempt: 7 },
    { status: 'succeeded', attempt: 1 },
  ]);
  cooldowns.set(incidents.id, db.iso(-4 * 60_000));
}

/** Delivery queue health over the last 24 hours (memstore_app_webhooks.go:737-800). */
export function healthFor(webhookId: string): S['AppWebhookDeliveryHealthResponse'] {
  const list = db.deliveries.get(webhookId) ?? [];
  const now = Date.now();
  const day = now - 86400_000;
  const count = (status: Delivery['status']) => list.filter((d) => d.status === status).length;
  const recentSucceeded = list.filter(
    (d) => d.status === 'succeeded' && d.delivered_at && Date.parse(d.delivered_at) >= day
  ).length;
  const recentDead = list.filter(
    (d) => d.status === 'dead' && Date.parse(d.updated_at) >= day
  ).length;
  const until = cooldowns.get(webhookId);
  const cooling = until !== undefined && Date.parse(until) > now;
  const overdue = cooling
    ? undefined
    : list
        .filter((d) => d.status === 'pending' && Date.parse(d.next_attempt_at) <= now)
        .map((d) => d.next_attempt_at)
        .sort()[0];
  const terminal = recentSucceeded + recentDead;
  return {
    webhook_id: webhookId,
    snapshot_at: new Date(now).toISOString(),
    pending_count: count('pending'),
    in_flight_count: count('in_flight'),
    dead_count: count('dead'),
    receiver_state: cooling ? 'cooling_down' : 'ready',
    ...(cooling ? { receiver_cooldown_until: until } : {}),
    ...(overdue
      ? {
          oldest_overdue_at: overdue,
          oldest_overdue_seconds: Math.max(0, Math.round((now - Date.parse(overdue)) / 1000)),
        }
      : {}),
    recent_succeeded_count: recentSucceeded,
    recent_dead_count: recentDead,
    ...(terminal ? { recent_success_rate: recentSucceeded / terminal } : {}),
  };
}

/** Back-off ladder for retry_policy=default (pkg/webhook/dispatcher.go:112-119). */
const LADDER_MS = [30, 120, 600, 1200, 3600, 21600].map((s) => s * 1000);

/**
 * Completed attempts, newest first. A delivery's attempt count says how many
 * ran; the last one carries its terminal outcome (handlers_webhooks.go:831-875).
 */
export function attemptsFor(delivery: Delivery): S['AppWebhookDeliveryAttemptListResponse'] {
  const runs = delivery.status === 'in_flight' ? delivery.attempt - 1 : delivery.attempt;
  const started = Date.parse(delivery.created_at);
  const attempts = Array.from({ length: Math.max(0, runs) }, (_, i) => {
    const n = i + 1;
    const last = n === runs;
    const outcome =
      last && delivery.status === 'succeeded'
        ? 'succeeded'
        : last && delivery.status === 'dead'
          ? 'dead'
          : 'retrying';
    const at = started + LADDER_MS.slice(0, i).reduce((sum, ms) => sum + ms, 0);
    const duration = outcome === 'succeeded' ? 180 + n * 7 : n % 3 === 0 ? 10_000 : 320 + n * 11;
    return {
      id: `${delivery.id.slice(0, 8)}-0000-4000-8000-${String(n).padStart(12, '0')}`,
      delivery_id: delivery.id,
      replay_generation: 0,
      attempt_number: n,
      outcome,
      response_code: outcome === 'succeeded' ? 200 : duration === 10_000 ? 0 : 503,
      ...(outcome === 'succeeded'
        ? {}
        : { error: duration === 10_000 ? 'timeout after 10s' : 'HTTP 503' }),
      started_at: new Date(at).toISOString(),
      finished_at: new Date(at + duration).toISOString(),
      duration_ms: duration,
      ...(outcome === 'retrying' && LADDER_MS[i] !== undefined
        ? { next_attempt_at: new Date(at + duration + LADDER_MS[i]).toISOString() }
        : {}),
    } satisfies S['AppWebhookDeliveryAttemptResponse'];
  });
  return { attempts: attempts.reverse() };
}
