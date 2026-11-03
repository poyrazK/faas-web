import { randomBytes, randomUUID } from 'node:crypto';
import type { components } from '../src/lib/api/schema';
import * as db from './data';

type S = components['schemas'];
export type ReleaseWebhook = S['AccountReleaseWebhookResponse'];
type Delivery = S['AppWebhookDeliveryResponse'];
type Attempt = S['AppWebhookDeliveryAttemptResponse'];

const hex = () => randomBytes(16).toString('hex');
const RELEASE_EVENTS = [
  'deployment.live',
  'deployment.failed',
  'rollout.completed',
  'rollout.aborted',
];
const ACCOUNT_EVENTS = [...RELEASE_EVENTS, 'environment.gitops.changed'];

/** One seeded receiver with deliveries from several apps; MOCK_EMPTY=1 starts with none. */
export const receivers: ReleaseWebhook[] = db.EMPTY
  ? []
  : [
      {
        id: hex(),
        scope: 'account',
        account_id: db.ACCOUNT_ID,
        target_url: 'https://platform.example.com/gregale/releases',
        webhook_secret_sealed_masked: '***',
        event_filter: [
          'deployment.live',
          'deployment.failed',
          'rollout.completed',
          'rollout.aborted',
        ],
        retry_policy: 'default',
        delivery_format: 'cloudevents',
        enabled: true,
        created_at: db.iso(14 * 86_400_000),
        updated_at: db.iso(2 * 86_400_000),
      },
    ];

/** Deliveries per receiver id, newest first. */
export const receiverDeliveries = new Map<string, Delivery[]>(
  receivers.map((r) => [
    r.id,
    db.apps.slice(0, 4).flatMap((a, i) =>
      (
        ['succeeded', i === 1 ? 'dead' : 'succeeded', i === 2 ? 'failed' : 'succeeded'] as const
      ).map((status, j): Delivery => {
        const created = (i * 3 + j + 1) * 2 * 3_600_000;
        return {
          id: hex(),
          webhook_id: r.id,
          app_id: a.id,
          account_id: db.ACCOUNT_ID,
          event: RELEASE_EVENTS[(i + j) % RELEASE_EVENTS.length],
          attempt: status === 'dead' ? 7 : status === 'failed' ? 2 : 1,
          status,
          ...(status === 'succeeded'
            ? { last_response_code: 200, delivered_at: db.iso(created - 900) }
            : { last_response_code: 503, last_error: 'HTTP 503 from receiver' }),
          next_attempt_at: db.iso(status === 'failed' ? -10 * 60_000 : created),
          created_at: db.iso(created),
          updated_at: db.iso(created - 900),
        };
      })
    ),
  ])
);

/** The completed attempts a delivery's status implies, newest first. */
export function attemptsFor(d: Delivery): Attempt[] {
  const finished = d.status === 'pending' || d.status === 'in_flight' ? d.attempt - 1 : d.attempt;
  const start = Date.parse(d.created_at);
  return Array.from({ length: Math.max(0, finished) }, (_, i) => {
    const n = i + 1;
    const last = n === finished;
    const outcome: Attempt['outcome'] =
      last && d.status === 'succeeded'
        ? 'succeeded'
        : last && d.status === 'dead'
          ? 'dead'
          : 'retrying';
    const at = start + i * 120_000;
    return {
      id: randomUUID(),
      delivery_id: d.id,
      replay_generation: 0,
      attempt_number: n,
      outcome,
      response_code: outcome === 'succeeded' ? 200 : 503,
      ...(outcome === 'succeeded' ? {} : { error: 'HTTP 503 from receiver' }),
      started_at: new Date(at).toISOString(),
      finished_at: new Date(at + 340).toISOString(),
      duration_ms: 340,
      ...(outcome === 'retrying' ? { next_attempt_at: new Date(at + 120_000).toISOString() } : {}),
    };
  }).reverse();
}

/** Queue health from the deliveries, as apid computes it (handlers_webhooks.go:802-829). */
export function healthFor(
  webhookId: string,
  deliveries: Delivery[]
): S['AppWebhookDeliveryHealthResponse'] {
  const now = Date.now();
  const day = now - 86_400_000;
  const recent = deliveries.filter((d) => Date.parse(d.updated_at) >= day);
  const succeeded = recent.filter((d) => d.status === 'succeeded').length;
  const dead = recent.filter((d) => d.status === 'dead').length;
  const overdue = deliveries
    .filter(
      (d) =>
        (d.status === 'pending' || d.status === 'failed') && Date.parse(d.next_attempt_at) <= now
    )
    .map((d) => Date.parse(d.next_attempt_at))
    .sort((a, b) => a - b)[0];
  return {
    webhook_id: webhookId,
    snapshot_at: new Date(now).toISOString(),
    pending_count: deliveries.filter((d) => d.status === 'pending' || d.status === 'failed').length,
    in_flight_count: deliveries.filter((d) => d.status === 'in_flight').length,
    dead_count: deliveries.filter((d) => d.status === 'dead').length,
    receiver_state: 'ready',
    ...(overdue !== undefined
      ? {
          oldest_overdue_at: new Date(overdue).toISOString(),
          oldest_overdue_seconds: Math.round((now - overdue) / 1000),
        }
      : {}),
    recent_succeeded_count: succeeded,
    recent_dead_count: dead,
    ...(succeeded + dead > 0 ? { recent_success_rate: succeeded / (succeeded + dead) } : {}),
  };
}

export class ReceiverProblem extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    detail: string
  ) {
    super(detail);
  }
}

const invalid = (detail: string) => new ReceiverProblem(400, 'app_webhook_invalid', detail);

/** apid's checks on a receiver's events (handlers_account_release_webhooks.go:22-46). */
export function checkEvents(events: unknown): string[] {
  if (!Array.isArray(events) || events.length === 0 || events.length > ACCOUNT_EVENTS.length)
    throw invalid(`event_filter must contain 1–${ACCOUNT_EVENTS.length} account events`);
  const seen = new Set<string>();
  for (const e of events.map(String)) {
    if (!ACCOUNT_EVENTS.includes(e))
      throw invalid(`event "${e}" is not an account event; allowed: ${ACCOUNT_EVENTS.join(', ')}`);
    if (seen.has(e)) throw invalid(`event "${e}" is duplicated`);
    seen.add(e);
  }
  return [...seen];
}

export function createReceiver(body: Record<string, unknown>): ReleaseWebhook {
  const target = String(body.target_url ?? '');
  if (!/^https:\/\/[^/]+/.test(target)) throw invalid('target_url must be an https URL');
  const secret = String(body.webhook_secret ?? '');
  if (secret.length < 1 || secret.length > 256)
    throw invalid('webhook_secret must be 1 to 256 bytes');
  const events = checkEvents(body.event_filter);
  if (receivers.some((r) => r.target_url === target))
    throw invalid('an account release webhook already targets this URL');
  const now = new Date().toISOString();
  const receiver: ReleaseWebhook = {
    id: hex(),
    scope: 'account',
    account_id: db.ACCOUNT_ID,
    target_url: target,
    webhook_secret_sealed_masked: '***',
    event_filter: events as ReleaseWebhook['event_filter'],
    retry_policy: (body.retry_policy as ReleaseWebhook['retry_policy']) ?? 'default',
    delivery_format: (body.delivery_format as ReleaseWebhook['delivery_format']) ?? 'json',
    enabled: body.enabled !== false,
    created_at: now,
    updated_at: now,
  };
  receivers.push(receiver);
  receiverDeliveries.set(receiver.id, []);
  return receiver;
}
