import { createHash, randomUUID } from 'node:crypto';
import type { components } from '../src/lib/api/schema';
import { account, apps, EMPTY } from './data';

/**
 * Dev-mock answers for the Events and Integrations pages: the `events` and
 * `outbound` tags. Registered from `plugin.ts` with one call so the two areas
 * can evolve without touching the shared plugin.
 *
 * The event router is modelled just far enough that every console state is
 * reachable: a settled receipt, a receipt held behind an open circuit, and a
 * publication that waits ~20 seconds before it routes. The backlog, storage,
 * and retention reads are all derived from the same receipt store, so a
 * publish shows up everywhere it should. Credentials are never stored — a PUT
 * only flips `credential_configured`.
 */

type S = components['schemas'];
interface MockCtx {
  params: Record<string, string>;
  query: URLSearchParams;
  body: Record<string, unknown>;
}
type Register = (method: string, template: string, handler: (ctx: MockCtx) => unknown) => void;
type ProblemCtor = new (status: number, code: string, detail?: string) => Error;

const SETTLE_MS = 20_000;
const iso = (ms: number) => new Date(ms).toISOString();
const now = () => Date.now();
const status = (code: number, body: unknown) => ({ __status: code, body });

/* --- Event router ------------------------------------------------------- */

interface Subscription {
  subscription_id: string;
  app: (typeof apps)[number];
  source: string;
  /** Exact type, or a `prefix.*` pattern. */
  type: string;
  filter: Record<string, unknown>;
  workflow_name?: string;
}

interface StoredRecipient {
  sub: Subscription;
  /** Forces a waiting reason until manually cleared; seeds the blocked state. */
  blocked?: S['EventBacklogRecipient']['waiting_reason'];
  failed?: string;
}

interface StoredEvent {
  source: string;
  id: string;
  client_event_id?: string;
  type: string;
  schemaversion?: string;
  data: unknown;
  accepted: number;
  recipients: StoredRecipient[];
}

const app = (slug: string) => apps.find((a) => a.slug === slug) ?? apps[0];

const subscriptions: Subscription[] = EMPTY
  ? []
  : [
      {
        subscription_id: '5f2b7c1e-1d0a-4c55-9d0e-6a1f1e0b3c01',
        app: app('webhook-router'),
        source: 'billing',
        type: 'invoice.paid',
        filter: {},
      },
      {
        subscription_id: '5f2b7c1e-1d0a-4c55-9d0e-6a1f1e0b3c02',
        app: app('billing-recon'),
        source: 'billing',
        type: 'invoice.*',
        filter: { currency: 'eur' },
      },
      {
        subscription_id: '5f2b7c1e-1d0a-4c55-9d0e-6a1f1e0b3c03',
        app: app('search-indexer'),
        source: 'catalog',
        type: 'product.updated',
        filter: {},
      },
      {
        subscription_id: '5f2b7c1e-1d0a-4c55-9d0e-6a1f1e0b3c04',
        app: app('nightly-etl'),
        source: 'billing',
        type: 'invoice.paid',
        filter: {},
        workflow_name: 'reconcile-ledger',
      },
    ];

function typeMatches(pattern: string, type: string) {
  return pattern.endsWith('.*') ? type.startsWith(pattern.slice(0, -1)) : pattern === type;
}

function filterMatches(filter: Record<string, unknown>, data: unknown) {
  if (!data || typeof data !== 'object') return Object.keys(filter).length === 0;
  const record = data as Record<string, unknown>;
  return Object.entries(filter).every(([key, value]) => record[key] === value);
}

function matchSubscriptions(source: string, type: string, data: unknown) {
  const candidates = subscriptions.filter((s) => s.source === source);
  const sample = (s: Subscription, reason: string): S['EventPreviewSubscription'] => ({
    app_slug: s.app.slug,
    subscription_id: s.subscription_id,
    source: s.source,
    type: s.type,
    filter: s.filter,
    reason,
    ...(s.workflow_name ? { workflow_name: s.workflow_name } : {}),
  });
  const matches: S['EventPreviewSubscription'][] = [];
  const nonMatches: S['EventPreviewSubscription'][] = [];
  let filterMismatch = 0;
  let other = 0;
  for (const s of candidates) {
    if (!typeMatches(s.type, type)) {
      other += 1;
      nonMatches.push(sample(s, 'pattern_mismatch'));
    } else if (!filterMatches(s.filter, data)) {
      filterMismatch += 1;
      nonMatches.push(sample(s, 'content_filter_mismatch'));
    } else matches.push(sample(s, 'would_deliver'));
  }
  return { candidates, matches, nonMatches, filterMismatch, other };
}

const events = new Map<string, StoredEvent>();
const eventKey = (source: string, id: string) => `${source}\u0000${id}`;

if (!EMPTY) {
  const t = now();
  const [webhook, recon, indexer, workflow] = subscriptions;
  const seed: StoredEvent[] = [
    {
      source: 'billing',
      id: 'inv_2026_10_0042',
      type: 'invoice.paid',
      data: { invoice: 'inv_2026_10_0042', amount: 4200, currency: 'eur' },
      accepted: t - 3 * 3_600_000,
      recipients: [{ sub: webhook }, { sub: recon }, { sub: workflow }],
    },
    {
      source: 'billing',
      id: 'inv_2026_10_0043',
      type: 'invoice.paid',
      data: { invoice: 'inv_2026_10_0043', amount: 990, currency: 'usd' },
      accepted: t - 52 * 60_000,
      recipients: [{ sub: webhook, failed: 'handler returned 500' }, { sub: workflow }],
    },
    {
      source: 'catalog',
      id: 'prod-8812-v14',
      type: 'product.updated',
      data: { sku: 'prod-8812', version: 14 },
      accepted: t - 18 * 60_000,
      recipients: [{ sub: indexer, blocked: 'circuit_open' }],
    },
    {
      source: 'catalog',
      id: 'prod-8813-v2',
      type: 'product.updated',
      data: { sku: 'prod-8813', version: 2 },
      accepted: t - 11 * 60_000,
      recipients: [{ sub: indexer, blocked: 'ordering_blocked' }],
    },
  ];
  for (const event of seed) events.set(eventKey(event.source, event.id), event);
}

/** Routing state at read time: blocked recipients wait; others settle after SETTLE_MS. */
function recipientState(event: StoredEvent, r: StoredRecipient) {
  if (r.blocked) return 'pending' as const;
  if (now() - event.accepted < SETTLE_MS) return 'pending' as const;
  // A failed handler is still a settled route; the failure lives in execution.
  return 'enqueued' as const;
}

const unsettled = (event: StoredEvent) =>
  event.recipients.some((r) => recipientState(event, r) === 'pending');

function settledAt(event: StoredEvent) {
  return unsettled(event) ? undefined : event.accepted + SETTLE_MS;
}

const receiptUrl = (e: StoredEvent) =>
  `/v1/events/receipt?source=${encodeURIComponent(e.source)}&id=${encodeURIComponent(e.id)}`;

function backlogRecipient(event: StoredEvent, r: StoredRecipient): S['EventBacklogRecipient'] {
  const reason = r.blocked ?? 'ready';
  return {
    event_source: event.source,
    event_id: event.id,
    event_type: event.type,
    accepted_at: iso(event.accepted),
    app_id: r.sub.app.id,
    app_slug: r.sub.app.slug,
    target_available: true,
    subscription_id: r.sub.subscription_id,
    consumer_kind: r.sub.workflow_name ? 'workflow' : 'application',
    origin: 'acceptance',
    routing_mode: 'recipient',
    state: 'pending',
    attempts: r.blocked ? 3 : 0,
    capacity_deferrals: 0,
    pending_age_seconds: Math.round((now() - event.accepted) / 1000),
    waiting_reason: reason,
    receipt_url: receiptUrl(event),
    ...(r.sub.workflow_name ? { workflow_name: r.sub.workflow_name } : {}),
    ...(reason === 'circuit_open' ? { next_attempt_at: iso(now() + 90_000) } : {}),
    ...(reason === 'ordering_blocked'
      ? {
          ordering_blocker: {
            event_source: 'catalog',
            event_id: 'prod-8812-v14',
            subscription_id: r.sub.subscription_id,
            accepted_at: iso(events.get(eventKey('catalog', 'prod-8812-v14'))?.accepted ?? now()),
            state: 'pending' as const,
            age_seconds: 18 * 60,
            receipt_url: '/v1/events/receipt?source=catalog&id=prod-8812-v14',
          },
        }
      : {}),
  };
}

function waitingRecipients() {
  const rows: { event: StoredEvent; r: StoredRecipient }[] = [];
  for (const event of events.values())
    for (const r of event.recipients)
      if (recipientState(event, r) === 'pending') rows.push({ event, r });
  return rows.sort((a, b) => a.event.accepted - b.event.accepted);
}

function backlog(query: URLSearchParams): S['EventBacklogResponse'] {
  const subscription = query.get('subscription_id');
  const rows = waitingRecipients().filter(
    ({ r }) => !subscription || r.sub.subscription_id === subscription
  );
  const recipients = rows.map(({ event, r }) => backlogRecipient(event, r));
  const bySub = new Map<string, S['EventBacklogRecipient'][]>();
  for (const recipient of recipients)
    bySub.set(recipient.subscription_id, [
      ...(bySub.get(recipient.subscription_id) ?? []),
      recipient,
    ]);
  const consumers: S['EventBacklogConsumer'][] = [...bySub.values()].map((group) => {
    const first = group[0];
    const counts: Record<string, number> = {};
    for (const item of group) counts[item.waiting_reason] = (counts[item.waiting_reason] ?? 0) + 1;
    const capacity = group.filter((g) => g.waiting_reason.startsWith('capacity_')).length;
    return {
      app_id: first.app_id,
      app_slug: first.app_slug,
      target_available: true,
      subscription_id: first.subscription_id,
      consumer_kind: first.consumer_kind,
      waiting_recipients: group.length,
      pending_recipients: group.length,
      processing_recipients: 0,
      capacity_waiting_recipients: capacity,
      ordering_waiting_recipients: counts.ordering_blocked ?? 0,
      oldest_accepted_at: first.accepted_at,
      oldest_age_seconds: first.pending_age_seconds,
      pending_waiting_reasons: counts,
    };
  });
  const at = iso(now());
  return {
    observed_at: at,
    window_at: at,
    coverage: 'captured_and_backfill_recipients',
    recipients: recipients.slice(0, Number(query.get('limit') ?? 100)),
    consumers: consumers.slice(0, Number(query.get('consumer_limit') ?? 100)),
    unattributed_receipts: 0,
  };
}

const bytesOf = (event: StoredEvent) => JSON.stringify(event).length * 3;

function storage(): S['EventStorageUsageResponse'] {
  const all = [...events.values()];
  const pending = all.filter(unsettled).sort((a, b) => a.accepted - b.accepted);
  return {
    retained_events: all.length,
    retained_bytes: all.reduce((sum, e) => sum + bytesOf(e), 0),
    pending_events: pending.length,
    oldest_pending_at: pending[0] ? iso(pending[0].accepted) : null,
    limits: { retained_events: 16384, retained_bytes: 67108864 },
  };
}

function retention(): S['EventRetentionHealth'] {
  const usage = storage();
  const countPct = (usage.retained_events / usage.limits.retained_events) * 100;
  const bytePct = (usage.retained_bytes / usage.limits.retained_bytes) * 100;
  return {
    observed_at: iso(now()),
    window_seconds: 86_400,
    retained_receipts: usage.retained_events,
    retained_bytes: usage.retained_bytes,
    unsettled_receipts: usage.pending_events,
    unknown_deadline_receipts: 0,
    held_receipts: 0,
    running_backfill_holds: 0,
    retryable_backfill_holds: 0,
    recovery_holds: 0,
    held_due_receipts: 0,
    eligible_for_pruning: 0,
    expiring_receipts: 0,
    storage: usage,
    storage_count_utilization_pct: countPct,
    storage_bytes_utilization_pct: bytePct,
    storage_utilization_pct: Math.max(countPct, bytePct),
    sample: [],
    sample_truncated: false,
  };
}

function receiptRecipient(
  event: StoredEvent,
  r: StoredRecipient
): S['EventReceiptRecipientResponse'] {
  const state = recipientState(event, r);
  const settled = state === 'enqueued';
  const invocation = createHash('sha256')
    .update(`${event.source}/${event.id}/${r.sub.subscription_id}`)
    .digest('hex');
  const invocationId = `${invocation.slice(0, 8)}-${invocation.slice(8, 12)}-4${invocation.slice(13, 16)}-8${invocation.slice(17, 20)}-${invocation.slice(20, 32)}`;
  return {
    origin: 'acceptance',
    subscription_id: r.sub.subscription_id,
    app_id: r.sub.app.id,
    app_slug: r.sub.app.slug,
    ...(r.sub.workflow_name ? { workflow_name: r.sub.workflow_name } : {}),
    routing: {
      state,
      attempts: r.blocked ? 3 : 1,
      retryable: true,
      replay_count: 0,
      updated_at: iso(settled ? event.accepted + SETTLE_MS : now()),
      ...(state === 'pending'
        ? { pending_age_seconds: Math.round((now() - event.accepted) / 1000) }
        : {}),
      ...(r.blocked === 'circuit_open'
        ? { last_error: 'consumer circuit open after 3 failed routes' }
        : {}),
    },
    ...(settled && !r.sub.workflow_name
      ? {
          execution: {
            invocation_id: invocationId,
            state: r.failed ? ('dead_letter' as const) : ('completed' as const),
            attempts: r.failed ? 3 : 1,
            replay_generation: 0,
            created_at: iso(event.accepted + SETTLE_MS),
            completed_at: iso(event.accepted + SETTLE_MS + 400),
            ...(r.failed ? { last_error: r.failed } : {}),
          },
        }
      : {}),
    ...(settled && r.sub.workflow_name
      ? { workflow_run_id: invocationId, workflow_run_status: 'completed' }
      : {}),
    ...(!settled ? { execution_unavailable: 'not_enqueued' as const } : {}),
    recovery_actions: [],
  };
}

function receipt(event: StoredEvent): S['EventReceiptResponse'] {
  const recipients = event.recipients.map((r) => receiptRecipient(event, r));
  const summary: Record<string, number> = {};
  for (const r of recipients) summary[r.routing.state] = (summary[r.routing.state] ?? 0) + 1;
  const settled = settledAt(event);
  return {
    event_id: event.id,
    ...(event.client_event_id ? { client_event_id: event.client_event_id } : {}),
    event_source: event.source,
    event_type: event.type,
    ...(event.schemaversion ? { schema_version: event.schemaversion } : {}),
    accepted_at: iso(event.accepted),
    ...(settled
      ? { routing_settled_at: iso(settled), retain_until: iso(settled + 30 * 86_400_000) }
      : {}),
    snapshot_captured: true,
    routing_mode: 'recipient',
    recipient_count: recipients.length,
    routing_summary: summary,
    recipients,
  };
}

function blocker(query: S['EventRecipientBlockerQuery']): S['EventRecipientBlockerResponse'] {
  const observed_at = iso(now());
  const event = events.get(eventKey(query.source, query.id));
  if (!event) return { query, observed_at, status: 'unavailable', reason: 'receipt_unavailable' };
  if (Date.parse(query.expected_accepted_at) !== event.accepted)
    return { query, observed_at, status: 'acceptance_replaced', reason: 'acceptance_replaced' };
  const r = event.recipients.find((x) => x.sub.subscription_id === query.subscription_id);
  if (!r) return { query, observed_at, status: 'unavailable', reason: 'recipient_unavailable' };
  const state = recipientState(event, r);
  if (state !== 'pending')
    return { query, observed_at, status: 'not_waiting', routing_state: state };
  return {
    query,
    observed_at,
    status: 'available',
    routing_state: state,
    recipient: backlogRecipient(event, r),
  };
}

const publication = (event: StoredEvent): S['PublishEventResponse'] => ({
  id: event.id,
  ...(event.client_event_id ? { client_event_id: event.client_event_id } : {}),
  accepted_at: iso(event.accepted),
  account_id: account.id,
  receipt_url: receiptUrl(event),
});

/* --- Outbound integrations --------------------------------------------- */

const DEFAULT_POLICY: S['OutboundRequestPolicy'] = {
  rate_per_second: 10,
  burst: 20,
  max_in_flight: 10,
  request_timeout_ms: 30_000,
  max_retries: 0,
  response_cache_ttl_seconds: 0,
  circuit_breaker_failure_threshold: 0,
  circuit_breaker_open_seconds: 0,
  retry_budget_per_minute: 0,
};

const integrations: S['OutboundIntegrationOffer'][] = EMPTY
  ? []
  : [
      {
        id: '0d4c9a52-5a3e-4b8e-9f61-2b7f1c6e0a11',
        name: 'stripe',
        origin: 'https://api.stripe.com',
        allowed_methods: ['GET', 'POST'],
        allowed_path_prefixes: ['/v1/'],
        enabled: true,
        runs_enabled: false,
        credential_source: 'operator_env',
        credential_configured: true,
        owner_kind: 'operator',
        daily_request_limit: 50_000,
        request_policy: { ...DEFAULT_POLICY, rate_per_second: 25, burst: 50 },
      },
      {
        id: '0d4c9a52-5a3e-4b8e-9f61-2b7f1c6e0a12',
        name: 'openai',
        origin: 'https://api.openai.com',
        allowed_methods: ['GET', 'POST'],
        allowed_path_prefixes: ['/v1/chat/', '/v1/embeddings', '/v1/models'],
        enabled: true,
        runs_enabled: true,
        credential_source: 'customer_sealed',
        credential_configured: true,
        owner_kind: 'customer',
        daily_request_limit: 10_000,
        request_policy: { ...DEFAULT_POLICY, request_timeout_ms: 120_000 },
        ai_provider: 'openai',
        ai_daily_token_limit: 2_000_000,
        ai_daily_cost_limit_millicents: 5_000_000,
        ai_monthly_cost_limit_millicents: 100_000_000,
        ai_request_log_enabled: true,
        ai_request_log_content: false,
      },
      {
        id: '0d4c9a52-5a3e-4b8e-9f61-2b7f1c6e0a13',
        name: 'geocoder',
        origin: 'https://geo.example-maps.com',
        allowed_methods: ['GET'],
        allowed_path_prefixes: ['/geocode/'],
        enabled: true,
        runs_enabled: false,
        credential_source: 'customer_sealed',
        credential_configured: false,
        owner_kind: 'customer',
        daily_request_limit: null,
        request_policy: DEFAULT_POLICY,
      },
    ];

const usageCounts = new Map<string, number>(
  EMPTY
    ? []
    : [
        ['0d4c9a52-5a3e-4b8e-9f61-2b7f1c6e0a11', 1_204],
        ['0d4c9a52-5a3e-4b8e-9f61-2b7f1c6e0a12', 8_731],
        ['0d4c9a52-5a3e-4b8e-9f61-2b7f1c6e0a13', 0],
      ]
);

const probes = new Map<string, S['OutboundBindingProbePolicy']>(
  EMPTY
    ? []
    : [
        [
          '0d4c9a52-5a3e-4b8e-9f61-2b7f1c6e0a12',
          { method: 'GET', path: '/v1/models', expected_status: 200 },
        ],
      ]
);

/** Usage counters added upstream that the mock does not model (all zero). */
const ZERO_AI_COUNTERS = {
  bad_feedback: 0,
  cache_saved_millicents: 0,
  cached_requests: 0,
  code_session_gb: 0,
  empty_requests: 0,
  evaluated_requests: 0,
  evaluation_errors: 0,
  evaluation_score_sum: 0,
  file_searches: 0,
  good_feedback: 0,
  input_audio_tokens: 0,
  invalid_json_requests: 0,
  output_audio_tokens: 0,
  prompt_cache_saved_millicents: 0,
  refused_requests: 0,
  tool_error_requests: 0,
  truncated_requests: 0,
  video_seconds: 0,
  web_searches: 0,
} satisfies Partial<S['OutboundAIUsageItem']>;

const aiRoutes: S['OutboundAIRoute'][] = EMPTY
  ? []
  : [
      {
        id: '6a0e3f4d-2b1c-4e8f-9a7b-5c6d7e8f9a01',
        name: 'chat-default',
        format: 'openai',
        strategy: 'ordered',
        targets: [{ integration_id: '0d4c9a52-5a3e-4b8e-9f61-2b7f1c6e0a12', model: 'gpt-4o-mini' }],
        created_at: '2026-09-02T09:14:00Z',
        updated_at: '2026-09-20T16:40:00Z',
      },
    ];

function midnightAfter(date: string) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString();
}

export function registerEventMocks(route: Register, Problem: ProblemCtor, noContent: symbol) {
  const findEvent = (source: string | null, id: string | null) => {
    if (!source || !id) throw new Problem(400, 'validation_failed', 'source and id are required');
    const event = events.get(eventKey(source, id));
    if (!event)
      throw new Problem(404, 'not_found', 'No retained receipt exists for this source and id');
    return event;
  };

  route('GET', '/v1/events/backlog', ({ query }) => backlog(query));
  route('GET', '/v1/events/storage', () => storage());
  route('GET', '/v1/events/retention', () => retention());
  route('GET', '/v1/events/receipt', ({ query }) =>
    receipt(findEvent(query.get('source'), query.get('id')))
  );
  route('GET', '/v1/events/recipient-blocker', ({ query }) =>
    blocker({
      source: query.get('source') ?? '',
      id: query.get('id') ?? '',
      subscription_id: query.get('subscription_id') ?? '',
      expected_accepted_at: query.get('expected_accepted_at') ?? '',
    })
  );
  route('POST', '/v1/events/recipient-blockers', ({ body }) => {
    const queries = Array.isArray(body.queries)
      ? (body.queries as S['EventRecipientBlockerQuery'][])
      : [];
    if (!queries.length || queries.length > 50)
      throw new Problem(400, 'validation_failed', 'queries must hold 1 to 50 items');
    return { items: queries.map((query) => ({ query, result: blocker(query) })) };
  });

  route('POST', '/v1/events:preview', ({ body }) => {
    const source = String(body.source ?? '');
    const type = String(body.type ?? '');
    if (!source || !type || !('data' in body))
      throw new Problem(422, 'validation_failed', 'source, type and data are required');
    const result = matchSubscriptions(source, type, body.data);
    const preview: S['PreviewEventResponse'] = {
      event_id: typeof body.id === 'string' ? body.id : randomUUID(),
      source,
      type,
      candidate_count: result.candidates.length,
      matched_count: result.matches.length,
      filter_mismatch_count: result.filterMismatch,
      other_mismatch_count: result.other,
      matches: result.matches,
      non_matches: result.nonMatches,
      truncated: false,
    };
    return preview;
  });

  const accept = (event: StoredEvent) => {
    const existing = events.get(eventKey(event.source, event.id));
    if (existing) {
      const same =
        existing.type === event.type &&
        existing.schemaversion === event.schemaversion &&
        JSON.stringify(existing.data) === JSON.stringify(event.data);
      if (!same)
        throw new Problem(
          409,
          'conflict',
          'This event id was already accepted with different content'
        );
      return { event: existing, duplicate: true };
    }
    event.recipients = matchSubscriptions(event.source, event.type, event.data).matches.map(
      (m) => ({
        sub: subscriptions.find((s) => s.subscription_id === m.subscription_id)!,
      })
    );
    events.set(eventKey(event.source, event.id), event);
    return { event, duplicate: false };
  };

  route('POST', '/v1/events:publish', ({ body }) => {
    const { id, source, type } = body;
    if (
      typeof id !== 'string' ||
      typeof source !== 'string' ||
      typeof type !== 'string' ||
      !('data' in body)
    )
      throw new Problem(422, 'validation_failed', 'id, source, type and data are required');
    const { event } = accept({
      id,
      source,
      type,
      data: body.data,
      schemaversion: typeof body.schemaversion === 'string' ? body.schemaversion : undefined,
      accepted: now(),
      recipients: [],
    });
    return status(202, publication(event));
  });

  const producer = (slug: string, key: string) => {
    const target = apps.find((a) => a.slug === slug);
    if (!target) throw new Problem(404, 'not_found', 'App not found');
    if (!/^[!-~]{1,256}$/.test(key))
      throw new Problem(400, 'validation_failed', 'key must be printable ASCII without spaces');
    return {
      target,
      source: `app.${target.id}`,
      id: `key.${createHash('sha256').update(key).digest('hex')}`,
    };
  };

  route('POST', '/v1/apps/{slug}/events:publish', ({ params, body }) => {
    const { target, source, id } = producer(params.slug, String(body.key ?? ''));
    if (typeof body.type !== 'string' || !('data' in body))
      throw new Problem(422, 'validation_failed', 'type and data are required');
    const { event, duplicate } = accept({
      id,
      source,
      type: body.type,
      data: body.data,
      schemaversion: typeof body.schemaversion === 'string' ? body.schemaversion : undefined,
      accepted: now(),
      recipients: [],
    });
    const result: S['AppPublishEventResponse'] = {
      app_id: target.id,
      source,
      duplicate,
      receipt: publication(event),
    };
    return status(202, result);
  });

  route('GET', '/v1/apps/{slug}/events/publish-status', ({ params, query }) => {
    const { target, source, id } = producer(params.slug, query.get('key') ?? '');
    const event = events.get(eventKey(source, id));
    const base = {
      app_id: target.id,
      source,
      event_id: id,
      observed_at: iso(now()),
      receipt_url: `/v1/events/receipt?source=${encodeURIComponent(source)}&id=${id}`,
    };
    const result: S['AppEventPublishStatusResponse'] = event
      ? {
          ...base,
          status: unsettled(event) ? 'processing' : 'accepted',
          receipt: publication(event),
          evidence: receipt(event),
        }
      : { ...base, status: 'unavailable', reason: 'not_retained_or_not_observed' };
    return result;
  });

  /* --- outbound --- */

  const findIntegration = (id: string, customerOnly = false) => {
    const found = integrations.find((i) => i.id === id);
    if (!found || (customerOnly && found.owner_kind !== 'customer'))
      throw new Problem(404, 'not_found', 'Customer integration not found');
    return found;
  };

  route('GET', '/v1/outbound/integrations', () => ({ items: integrations }));
  route('POST', '/v1/outbound/integrations', ({ body }) => {
    const name = String(body.name ?? '');
    if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(name))
      throw new Problem(
        400,
        'validation_failed',
        'Integration name, methods, paths, or request policy are invalid'
      );
    if (!String(body.origin ?? '').startsWith('https://'))
      throw new Problem(
        400,
        'validation_failed',
        'Origin must resolve only to public addresses over HTTPS'
      );
    if (integrations.some((i) => i.name === name))
      throw new Problem(409, 'conflict', 'An outbound integration with this name already exists');
    const created: S['OutboundIntegrationOffer'] = {
      id: randomUUID(),
      name,
      origin: String(body.origin),
      allowed_methods: (body.allowed_methods as string[]) ?? ['GET'],
      allowed_path_prefixes: (body.allowed_path_prefixes as string[]) ?? ['/'],
      enabled: true,
      runs_enabled: false,
      credential_source: 'customer_sealed',
      credential_configured: false,
      owner_kind: 'customer',
      daily_request_limit: (body.daily_request_limit as number | null | undefined) ?? null,
      request_policy:
        (body.request_policy as S['OutboundRequestPolicy'] | undefined) ?? DEFAULT_POLICY,
      ...(typeof body.ai_provider === 'string'
        ? {
            ai_provider: body.ai_provider as NonNullable<
              S['OutboundIntegrationOffer']['ai_provider']
            >,
            ai_daily_token_limit: (body.ai_daily_token_limit as number | null | undefined) ?? null,
          }
        : {}),
    };
    integrations.push(created);
    usageCounts.set(created.id, 0);
    return status(201, created);
  });
  route('DELETE', '/v1/outbound/integrations/{integration}', ({ params }) => {
    const found = findIntegration(params.integration, true);
    integrations.splice(integrations.indexOf(found), 1);
    probes.delete(found.id);
    return noContent;
  });
  route('PUT', '/v1/outbound/integrations/{integration}/credential', ({ params, body }) => {
    const found = findIntegration(params.integration, true);
    if (typeof body.authorization !== 'string' || !body.authorization)
      throw new Problem(400, 'validation_failed', 'authorization is required');
    // The value is deliberately dropped: the mock only records that one exists.
    found.credential_configured = true;
    return noContent;
  });
  route('DELETE', '/v1/outbound/integrations/{integration}/credential', ({ params }) => {
    findIntegration(params.integration, true).credential_configured = false;
    return noContent;
  });
  route('PUT', '/v1/outbound/integrations/{integration}/budget', ({ params, body }) => {
    const found = findIntegration(params.integration, true);
    const limit = body.daily_request_limit;
    if (limit !== null && (typeof limit !== 'number' || limit < 1 || limit > 100_000_000))
      throw new Problem(
        400,
        'validation_failed',
        'Daily request limit exceeds the account plan ceiling'
      );
    found.daily_request_limit = limit;
    return noContent;
  });
  route('PUT', '/v1/outbound/integrations/{integration}/request-policy', ({ params, body }) => {
    const found = findIntegration(params.integration, true);
    const policy = body.request_policy as S['OutboundRequestPolicy'] | undefined;
    if (!policy || !(policy.rate_per_second > 0) || policy.rate_per_second > 500)
      throw new Problem(400, 'validation_failed', 'A complete outbound request policy is required');
    found.request_policy = policy;
    return noContent;
  });
  route('GET', '/v1/outbound/integrations/{integration}/usage', ({ params }) => {
    const found = findIntegration(params.integration);
    const date = iso(now()).slice(0, 10);
    const usage: S['OutboundIntegrationUsageResponse'] = {
      daily_request_count: usageCounts.get(found.id) ?? 0,
      daily_request_limit: found.daily_request_limit,
      usage_date: date,
      resets_at: midnightAfter(date),
    };
    return usage;
  });
  route('GET', '/v1/outbound/integrations/{integration}/probe-policy', ({ params }) => {
    findIntegration(params.integration, true);
    const probe = probes.get(params.integration);
    if (!probe) throw new Problem(404, 'not_found', 'Probe policy not configured');
    return probe;
  });
  route('PUT', '/v1/outbound/integrations/{integration}/probe-policy', ({ params, body }) => {
    const found = findIntegration(params.integration, true);
    const policy = body as unknown as S['OutboundBindingProbePolicy'];
    const allowed =
      (policy.method === 'GET' || policy.method === 'HEAD') &&
      found.allowed_methods.includes(policy.method) &&
      found.allowed_path_prefixes.some((p) => String(policy.path ?? '').startsWith(p)) &&
      policy.expected_status >= 200 &&
      policy.expected_status <= 299;
    if (!allowed)
      throw new Problem(
        400,
        'validation_failed',
        "Probe must be allowed by a customer-owned integration's route policy"
      );
    probes.set(found.id, policy);
    return policy;
  });
  route('DELETE', '/v1/outbound/integrations/{integration}/probe-policy', ({ params }) => {
    findIntegration(params.integration, true);
    probes.delete(params.integration);
    return noContent;
  });

  route('GET', '/v1/outbound/integrations/{integration}/ai-usage', ({ params, query }) => {
    const found = findIntegration(params.integration);
    const date = query.get('date') || iso(now()).slice(0, 10);
    const ai = Boolean(found.ai_provider);
    const seed = Number(date.replace(/-/g, '')) % 7;
    const items: S['OutboundAIUsageItem'][] = ai
      ? [
          {
            model: 'gpt-4o-mini',
            requests: 1_840 + seed * 31,
            input: 912_000,
            output: 211_000,
            cost: 412_000,
          },
          {
            model: 'gpt-4o',
            requests: 212 + seed * 3,
            input: 301_000,
            output: 88_000,
            cost: 1_610_000,
          },
          {
            model: 'text-embedding-3-small',
            requests: 640,
            input: 128_000,
            output: 0,
            cost: 2_600,
          },
        ].map((m) => ({
          caller: apps[0]?.id ?? 'runs',
          model: m.model,
          requests: m.requests,
          error_requests: Math.round(m.requests * 0.01),
          usage_unknown_requests: 0,
          input_tokens: m.input + seed * 1000,
          cached_input_tokens: Math.round(m.input * 0.2),
          cache_write_tokens: 0,
          output_tokens: m.output,
          cost_millicents: m.cost,
          images: 0,
          audio_seconds: 0,
          characters: 0,
          ...ZERO_AI_COUNTERS,
        }))
      : [];
    const tokens = items.reduce((sum, i) => sum + i.input_tokens + i.output_tokens, 0);
    const usage: S['OutboundAIUsageResponse'] = {
      usage_date: date,
      ai_provider: found.ai_provider ?? '',
      daily_token_count: tokens,
      daily_token_limit: found.ai_daily_token_limit ?? null,
      resets_at: midnightAfter(date),
      items,
      daily_cost_millicents: items.reduce((sum, i) => sum + (i.cost_millicents ?? 0), 0),
      daily_cost_limit_millicents: found.ai_daily_cost_limit_millicents ?? null,
    };
    return usage;
  });
  route('GET', '/v1/outbound/integrations/{integration}/ai-alerts', ({ params }) => {
    const found = findIntegration(params.integration);
    const items: S['OutboundAIBudgetAlert'][] =
      found.ai_provider && found.ai_daily_token_limit
        ? [
            {
              id: '9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c61',
              integration_id: found.id,
              budget: 'daily_tokens',
              app_id: null,
              end_user: null,
              tag: null,
              period_start: iso(now() - 86_400_000).slice(0, 10),
              threshold_percent: 80,
              limit: found.ai_daily_token_limit,
              used: Math.round(found.ai_daily_token_limit * 0.81),
              crossed_at: iso(now() - 80_000_000),
            },
          ]
        : [];
    return { items };
  });
  route('GET', '/v1/outbound/ai-routes', () => ({ items: aiRoutes }));
}
