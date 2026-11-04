import { randomBytes, randomUUID } from 'node:crypto';
import type { components } from '../src/lib/api/schema';
import { account, apps, EMPTY } from './data';

/**
 * Dev-mock answers for an app's managed realtime (the Realtime tab). The
 * routes are registered in `plugin.ts`, one line each, so the spec-drift test
 * sees them; the state and the rules live here.
 *
 * Modelled on faas pkg/apid/managedrealtime: tokens are write-only (the
 * response carries the constant `***` mask), the plan caps endpoints per app
 * (ADR-1323: 2 / 10 / 25), a ticket is returned once and only its ID is kept,
 * access controls work on OIDC endpoints, and a closed connection answers
 * `410 not_found`. Live reads report one unanswered realtime node on the
 * `chat` endpoint so the partial state is reachable.
 */

type S = components['schemas'];
type Endpoint = S['ManagedRealtimeEndpointResponse'];
export type MockProblem = { status: number; code: string; detail: string };
export type Answer = { status: number; body?: unknown } | MockProblem;
export const isProblem = (a: Answer): a is MockProblem => 'code' in a;

const problem = (status: number, code: string, detail: string): MockProblem => ({
  status,
  code,
  detail,
});
const ok = (body: unknown, status = 200): Answer => ({ status, body });
const NONE: Answer = { status: 204 };
const invalid = (detail: string) => problem(400, 'realtime_invalid', detail);
const iso = (ms: number) => new Date(ms).toISOString();
const now = () => Date.now();

const PER_APP: Record<string, number> = { hobby: 2, pro: 10, scale: 25 };
const CONNECTION_LIMIT: Record<string, number> = { hobby: 200, pro: 1000, scale: 5000 };

interface Connection {
  id: string;
  principal?: string;
  channels: string[];
  connected_at: string;
  last_seen_at: string;
  expires_at: string;
}
interface Retained {
  sequence: number;
  data_base64: string;
  binary: boolean;
  created_at: string;
  event?: string;
}
interface Access {
  denied_channels: string[];
  sessions_revoked_before?: string;
  revision: number;
  updated_at: string;
}
interface State {
  endpoint: Endpoint;
  connections: Connection[];
  retained: Map<string, Retained[]>;
  /** ticket_id → principal and expiry; the bearer value is never kept. */
  tickets: Map<string, { principal: string; expires: number }>;
  access: Map<string, Access>;
  previousExpires?: number;
}

const appBySlug = (slug: string) => apps.find((a) => a.slug === slug);
const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');

function seedEndpoint(slug: string, over: Partial<Endpoint>): Endpoint {
  const app = appBySlug(slug)!;
  const at = iso(now() - 6 * 86_400_000);
  return {
    id: randomUUID(),
    app_id: app.id,
    account_id: account.id,
    callback_url: `https://${slug}.gregale.app`,
    connect_path: '/realtime/connect',
    message_path: '/realtime/message',
    disconnect_path: '/realtime/disconnect',
    callback_auth_token_masked: '***',
    auth_token_masked: '***',
    auth_token_previous_expires_at: null,
    auth_mode: 'none',
    allowed_origins: [],
    max_connections: 0,
    max_message_bytes: 0,
    max_connection_age_seconds: 0,
    enabled: true,
    created_at: at,
    updated_at: at,
    ...over,
  };
}

function seedConnections(n: number, channels: string[][]): Connection[] {
  return Array.from({ length: n }, (_, i) => ({
    id: randomUUID(),
    principal: i % 4 === 3 ? undefined : `user-${100 + i}`,
    channels: channels[i % channels.length],
    connected_at: iso(now() - (i + 1) * 7 * 60_000),
    last_seen_at: iso(now() - (i % 5) * 9_000),
    expires_at: iso(now() + (24 - i) * 3_600_000),
  }));
}

const states = new Map<string, State[]>();

if (!EMPTY) {
  const chat = seedEndpoint('api-gateway', {
    slug: 'chat',
    auth_mode: 'oidc_jwt',
    auth_issuer: 'https://id.example.com',
    auth_jwks_url: 'https://id.example.com/.well-known/jwks.json',
    auth_audience: ['realtime'],
    auth_algorithms: ['RS256'],
    allowed_origins: ['https://shop.example.com'],
    max_connections: 500,
    channel_rules: [{ pattern: 'org:{org_id}:room:*', read: true, presence: true }],
  });
  const ops = seedEndpoint('api-gateway', {
    auth_mode: 'static_bearer',
    enabled: false,
    created_at: iso(now() - 30 * 86_400_000),
  });
  const notify = seedEndpoint('webhook-router', { slug: 'notify' });
  const retained = new Map<string, Retained[]>([
    [
      'orders',
      ['created', 'paid', 'shipped'].map((status, i) => ({
        sequence: 812 + i,
        data_base64: b64(JSON.stringify({ id: 42, status })),
        binary: false,
        created_at: iso(now() - (3 - i) * 20 * 60_000),
        event: `order.${status}`,
      })),
    ],
  ]);
  states.set('api-gateway', [
    {
      endpoint: chat,
      connections: seedConnections(12, [['lobby'], ['lobby', 'orders'], ['game-42'], []]),
      retained,
      tickets: new Map(),
      access: new Map([
        [
          'user-101',
          {
            denied_channels: ['project-7'],
            revision: 2,
            updated_at: iso(now() - 3_600_000),
          },
        ],
      ]),
    },
    { endpoint: ops, connections: [], retained: new Map(), tickets: new Map(), access: new Map() },
  ]);
  states.set('webhook-router', [
    {
      endpoint: notify,
      connections: seedConnections(2, [['alerts']]),
      retained: new Map(),
      tickets: new Map(),
      access: new Map(),
    },
  ]);
}

function plan() {
  const raw = process.env.MOCK_PLAN ?? account.plan;
  return raw === 'free' || raw === 'hobby' || raw === 'scale' ? raw : 'pro';
}

function forApp(slug: string): State[] | MockProblem {
  if (!appBySlug(slug)) return problem(404, 'not_found', 'App not found.');
  if (plan() === 'free')
    return problem(
      402,
      'plan_realtime_not_allowed',
      'the free plan does not include managed realtime endpoints; upgrade to Hobby or above to keep WebSocket clients connected while your app sleeps.'
    );
  if (!states.has(slug)) states.set(slug, []);
  return states.get(slug)!;
}

function find(slug: string, id: string): State | MockProblem {
  const list = forApp(slug);
  if ('code' in list) return list;
  return (
    list.find((s) => s.endpoint.id === id) ??
    problem(404, 'not_found', 'managed realtime endpoint not found')
  );
}

/** The chat endpoint answers as if one of three nodes were down. */
const nodes = (s: State) =>
  s.endpoint.slug === 'chat'
    ? { partial: true, nodes_queried: 2, nodes_unavailable: 1 }
    : { partial: false, nodes_queried: 3, nodes_unavailable: 0 };

const strings = (v: unknown) => (Array.isArray(v) ? v.map(String) : undefined);

function applyFields(e: Endpoint, body: Record<string, unknown>): MockProblem | undefined {
  const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : undefined);
  const callback = str('callback_url');
  if (callback !== undefined) {
    if (!/^https?:\/\/[^/]/.test(callback))
      return invalid('callback_url must be an absolute http:// or https:// URL');
    e.callback_url = callback;
  }
  for (const k of ['connect_path', 'message_path', 'disconnect_path'] as const) {
    const v = str(k);
    if (v) e[k] = v;
  }
  const mode = str('auth_mode') as Endpoint['auth_mode'] | undefined;
  if (mode && mode !== e.auth_mode) {
    e.auth_mode = mode;
    if (mode !== 'oidc_jwt') {
      delete e.auth_issuer;
      delete e.auth_jwks_url;
      delete e.auth_audience;
      delete e.auth_algorithms;
      delete e.auth_required_claims;
    }
  }
  if (e.auth_mode === 'static_bearer' && mode === 'static_bearer' && !str('auth_token'))
    return invalid('auth_mode static_bearer requires auth_token');
  if (e.auth_mode === 'oidc_jwt') {
    if (str('auth_issuer') !== undefined) e.auth_issuer = str('auth_issuer');
    if (str('auth_jwks_url') !== undefined) e.auth_jwks_url = str('auth_jwks_url');
    if (strings(body.auth_audience)) e.auth_audience = strings(body.auth_audience);
    if (strings(body.auth_algorithms))
      e.auth_algorithms = strings(body.auth_algorithms) as Endpoint['auth_algorithms'];
    if (body.auth_required_claims && typeof body.auth_required_claims === 'object')
      e.auth_required_claims = body.auth_required_claims as Record<string, string>;
    if (!e.auth_issuer?.startsWith('https://'))
      return invalid('auth_issuer must be an https URL of at most 2048 bytes');
    if (!e.auth_jwks_url?.startsWith('https://'))
      return invalid('auth_jwks_url must be an https URL without credentials, query, or fragment');
    if (!e.auth_algorithms?.length)
      return invalid('auth_audience and auth_algorithms are bounded to 16 entries');
  }
  if (strings(body.allowed_origins)) e.allowed_origins = strings(body.allowed_origins)!;
  for (const k of ['max_connections', 'max_message_bytes', 'max_connection_age_seconds'] as const)
    if (typeof body[k] === 'number') e[k] = body[k];
  if (typeof body.enabled === 'boolean') e.enabled = body.enabled;
  e.updated_at = iso(now());
  return undefined;
}

export function listEndpoints(slug: string): Answer {
  const list = forApp(slug);
  return 'code' in list ? list : ok(list.map((s) => s.endpoint));
}

export function createEndpoint(slug: string, body: Record<string, unknown>): Answer {
  const list = forApp(slug);
  if ('code' in list) return list;
  const limit = PER_APP[plan()] ?? 10;
  if (list.length >= limit)
    return problem(
      403,
      'plan_realtime_quota',
      `${plan()} plan caps managed realtime endpoints at ${limit} for this app; you have ${list.length}. Delete one to add another.`
    );
  if (typeof body.callback_auth_token !== 'string' || !body.callback_auth_token)
    return invalid('callback_auth_token is required');
  const e = seedEndpoint(slug, { created_at: iso(now()) });
  const failed = applyFields(e, { ...body, auth_mode: body.auth_mode ?? 'none' });
  if (failed) return failed;
  if (e.auth_mode === 'static_bearer' && typeof body.auth_token !== 'string')
    return invalid('auth_mode static_bearer requires auth_token');
  list.push({
    endpoint: e,
    connections: [],
    retained: new Map(),
    tickets: new Map(),
    access: new Map(),
  });
  return ok(e, 201);
}

export function updateEndpoint(slug: string, id: string, body: Record<string, unknown>): Answer {
  const s = find(slug, id);
  if ('code' in s) return s;
  const draft = structuredClone(s.endpoint);
  const failed = applyFields(draft, body);
  if (failed) return failed;
  s.endpoint = draft;
  // Disabling closes every connection (docs/realtime.md § Connect clients).
  if (!draft.enabled) s.connections = [];
  return ok(draft);
}

export function deleteEndpoint(slug: string, id: string): Answer {
  const list = forApp(slug);
  if ('code' in list) return list;
  const i = list.findIndex((s) => s.endpoint.id === id);
  if (i < 0) return problem(404, 'not_found', 'managed realtime endpoint not found');
  list.splice(i, 1);
  return NONE;
}

export function rotateAuth(slug: string, id: string, body: Record<string, unknown>): Answer {
  const s = find(slug, id);
  if ('code' in s) return s;
  if (s.endpoint.auth_mode !== 'static_bearer')
    return invalid('auth rotation requires auth_mode static_bearer');
  if (typeof body.new_auth_token !== 'string' || !body.new_auth_token)
    return invalid('new_auth_token is required');
  const grace = typeof body.grace_period_seconds === 'number' ? body.grace_period_seconds : 300;
  s.previousExpires = now() + grace * 1000;
  s.endpoint.auth_token_previous_expires_at = iso(s.previousExpires);
  return ok({
    endpoint_id: id,
    auth_mode: 'static_bearer',
    previous_token_expires_at: iso(s.previousExpires),
  });
}

export function finalizeAuth(slug: string, id: string): Answer {
  const s = find(slug, id);
  if ('code' in s) return s;
  s.previousExpires = undefined;
  s.endpoint.auth_token_previous_expires_at = null;
  return ok({ endpoint_id: id, auth_mode: 'static_bearer', previous_token_expires_at: null });
}

export function usage(): Answer {
  const all = [...states.values()].flat();
  const open = all.reduce((n, s) => n + s.connections.length, 0);
  const to = Math.floor(now() / 3_600_000) * 3_600_000 + 3_600_000;
  const from = to - 24 * 3_600_000;
  const hours = EMPTY
    ? []
    : Array.from({ length: 24 }, (_, i) => ({
        hour: iso(from + i * 3_600_000),
        peak_connections: 6 + ((i * 7) % 11),
        connection_seconds: (6 + ((i * 7) % 11)) * 2_900,
        delivered_messages: 120 + ((i * 37) % 90),
        delivered_bytes: (120 + ((i * 37) % 90)) * 180,
        received_messages: 30 + ((i * 13) % 20),
        received_bytes: (30 + ((i * 13) % 20)) * 90,
      }));
  const chat = states.get('api-gateway')?.[0];
  return ok({
    plan: plan(),
    connection_limit: CONNECTION_LIMIT[plan()] ?? 0,
    open_connections: open,
    from: iso(from),
    to: iso(to),
    hours,
    endpoints:
      chat && !EMPTY
        ? hours.map((h) => ({ ...h, endpoint_id: chat.endpoint.id, app_id: chat.endpoint.app_id }))
        : [],
  });
}

export function listConnections(slug: string, id: string, query: URLSearchParams): Answer {
  const s = find(slug, id);
  if ('code' in s) return s;
  const principal = query.get('principal');
  const channel = query.get('channel');
  const limit = Math.min(Number(query.get('limit') ?? 100) || 100, 1000);
  const cursor = query.get('cursor');
  const matching = s.connections
    .filter(
      (c) => (!principal || c.principal === principal) && (!channel || c.channels.includes(channel))
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  const start = cursor ? matching.findIndex((c) => c.id > cursor) : 0;
  const page = start < 0 ? [] : matching.slice(start, start + limit);
  const truncated = start >= 0 && start + limit < matching.length;
  return ok({
    connections: page.map((c) => ({
      ...c,
      endpoint_id: s.endpoint.id,
      app_id: s.endpoint.app_id,
      account_id: account.id,
    })),
    limit,
    truncated,
    ...(truncated ? { next_cursor: page[page.length - 1].id } : {}),
    ...nodes(s),
  });
}

export function closeConnection(slug: string, id: string, connectionId: string): Answer {
  const s = find(slug, id);
  if ('code' in s) return s;
  const i = s.connections.findIndex((c) => c.id === connectionId);
  if (i < 0) return problem(410, 'not_found', 'the connection is no longer live on its owner node');
  s.connections.splice(i, 1);
  return NONE;
}

export function sendConnection(slug: string, id: string, connectionId: string): Answer {
  const s = find(slug, id);
  if ('code' in s) return s;
  if (!s.connections.some((c) => c.id === connectionId))
    return problem(410, 'not_found', 'the connection is no longer live on its owner node');
  return { status: 202 };
}

function subscribers(s: State, channel: string) {
  return s.connections.filter((c) => c.channels.includes(channel)).length;
}

export function occupancy(slug: string, id: string, query: URLSearchParams): Answer {
  const s = find(slug, id);
  if ('code' in s) return s;
  const channels = query.getAll('channel');
  if (channels.length === 0 || channels.length > 20)
    return invalid('occupancy needs 1 to 20 channel parameters');
  return ok({
    channels: channels.map((channel) => {
      const subs = subscribers(s, channel);
      return { channel, subscribers: subs, presence_members: Math.max(0, subs - 1) };
    }),
    ...nodes(s),
  });
}

const replays = new Map<string, unknown>();

export function publish(
  slug: string,
  id: string,
  channel: string,
  query: URLSearchParams,
  body: Record<string, unknown>,
  key: string | undefined
): Answer {
  const s = find(slug, id);
  if ('code' in s) return s;
  const delivery = query.get('delivery') ?? 'live';
  if (delivery !== 'live' && delivery !== 'retained')
    return invalid('delivery must be live or retained, and may be specified once');
  const data = typeof body.data_base64 === 'string' ? body.data_base64 : '';
  const replayKey = key ? `${id}:${key}` : undefined;
  if (replayKey && replays.has(replayKey)) return ok(replays.get(replayKey));
  const targeted = subscribers(s, channel);
  let sequence: number | undefined;
  if (delivery === 'retained') {
    if (!key) return invalid('delivery=retained requires exactly one Idempotency-Key header');
    if (Buffer.from(data, 'base64').length > 4096)
      return invalid('retained messages are limited to 4096 decoded bytes');
    const log = s.retained.get(channel) ?? [];
    sequence = (log[log.length - 1]?.sequence ?? 0) + 1;
    log.push({ sequence, data_base64: data, binary: Boolean(body.binary), created_at: iso(now()) });
    s.retained.set(channel, log);
  }
  const queueFull = s.endpoint.slug === 'chat' && targeted > 2 ? 1 : 0;
  const result = {
    queued: targeted - queueFull,
    subscribers: targeted,
    queue_full: queueFull,
    failed: 0,
    ...nodes(s),
    ...(sequence ? { sequence, durable: true } : { durable: false }),
  };
  if (replayKey) replays.set(replayKey, result);
  return ok(result);
}

export function retained(
  slug: string,
  id: string,
  channel: string,
  query: URLSearchParams
): Answer {
  const s = find(slug, id);
  if ('code' in s) return s;
  const after = Number(query.get('after') ?? 0);
  const limit = Math.min(Number(query.get('limit') ?? 100) || 100, 100);
  const log = s.retained.get(channel) ?? [];
  const page = log.filter((m) => m.sequence > after).slice(0, limit);
  return ok({
    messages: page,
    oldest_sequence: log[0]?.sequence ?? 1,
    latest_sequence: log[log.length - 1]?.sequence ?? 0,
    has_more:
      page.length > 0 && page[page.length - 1].sequence < (log[log.length - 1]?.sequence ?? 0),
  });
}

export function consumerGroups(slug: string, id: string, channel: string): Answer {
  const s = find(slug, id);
  if ('code' in s) return s;
  if (channel !== 'orders' || EMPTY) return ok([]);
  const base = {
    deduplication_metadata_key: 'event_id',
    deduplication_window_seconds: 3600,
    duplicate_messages: '3',
    deduplication_keys: 41,
    channel,
    assigned_sequence: '813',
    latest_sequence: '814',
    oldest_sequence: '812',
    completed: '1',
    expired_leases: 0,
    history_unavailable: false,
    capacity_blocked: false,
    lease_seconds: 120,
    max_attempts: 5,
    created_at: iso(now() - 5 * 86_400_000),
    paused_at: null,
    draining: false,
    drained: false,
    ordering_metadata_key: 'customer_id',
    dead_letter_policy: 'block' as const,
    last_fencing_token: '17',
    dead_letter_retention_seconds: 0,
    expired_dead_letters: '0',
    deadline_metadata_key: '',
    expired_deliveries: '0',
    filter: {},
    filtered_messages: '0',
  };
  return ok([
    {
      ...base,
      group_id: 'f1a2b3c4-0000-4000-8000-000000000001',
      name: 'billing',
      unassigned: '1',
      ready: 1,
      leased: 1,
      dead: 0,
      active_workers: 2,
      paused: false,
      ordering_blocked: 1,
    },
    {
      ...base,
      group_id: 'f1a2b3c4-0000-4000-8000-000000000002',
      name: 'analytics',
      unassigned: '2',
      ready: 0,
      leased: 0,
      dead: 1,
      active_workers: 0,
      paused: true,
      paused_at: iso(now() - 2 * 3_600_000),
      ordering_blocked: 0,
    },
  ]);
}

export function issueTicket(slug: string, id: string, body: Record<string, unknown>): Answer {
  const s = find(slug, id);
  if ('code' in s) return s;
  const principal = typeof body.principal === 'string' ? body.principal : '';
  const channels = strings(body.channels) ?? [];
  const ttl = typeof body.ttl_seconds === 'number' ? body.ttl_seconds : 0;
  if (!principal || channels.length < 1 || channels.length > 32 || ttl < 1 || ttl > 300)
    return invalid('ticket requires a principal, 1-32 unique channels and ttl_seconds 1-300');
  if (!s.endpoint.enabled) return problem(404, 'not_found', 'enabled endpoint required');
  const ticketId = randomUUID();
  const expires = now() + ttl * 1000;
  s.tickets.set(ticketId, { principal, expires });
  return ok(
    {
      ticket: `grt_${randomBytes(24).toString('base64url')}`,
      ticket_id: ticketId,
      expires_at: iso(expires),
    },
    201
  );
}

export function revokeTicket(slug: string, id: string, ticketId: string): Answer {
  const s = find(slug, id);
  if ('code' in s) return s;
  const t = s.tickets.get(ticketId);
  if (!t || t.expires < now())
    return problem(404, 'not_found', 'ticket not found or already expired');
  s.tickets.delete(ticketId);
  return NONE;
}

export function revokePrincipalTickets(slug: string, id: string, query: URLSearchParams): Answer {
  const s = find(slug, id);
  if ('code' in s) return s;
  const principals = query.getAll('principal');
  if (principals.length !== 1) return invalid('exactly one principal query parameter is required');
  let revoked = 0;
  for (const [ticketId, t] of s.tickets)
    if (t.principal === principals[0] && t.expires >= now()) {
      s.tickets.delete(ticketId);
      revoked++;
    }
  return ok({ revoked });
}

const noControls = (): Access => ({ denied_channels: [], revision: 0, updated_at: iso(0) });

export function readAccess(slug: string, id: string, principal: string): Answer {
  const s = find(slug, id);
  if ('code' in s) return s;
  if (s.endpoint.auth_mode !== 'oidc_jwt')
    return invalid('access controls require OIDC authentication');
  return ok(s.access.get(principal) ?? noControls());
}

export function changeAccess(
  slug: string,
  id: string,
  principal: string,
  body: Record<string, unknown>
): Answer {
  const s = find(slug, id);
  if ('code' in s) return s;
  if (s.endpoint.auth_mode !== 'oidc_jwt')
    return invalid('access controls require OIDC authentication');
  const current = s.access.get(principal) ?? noControls();
  const channel = typeof body.channel === 'string' ? body.channel : '';
  const next: Access = { ...current, denied_channels: [...current.denied_channels] };
  switch (body.action) {
    case 'revoke_channel':
      if (!channel) return invalid('invalid principal, action or channel');
      if (!next.denied_channels.includes(channel)) next.denied_channels.push(channel);
      s.connections = s.connections.map((c) =>
        c.principal === principal ? { ...c, channels: c.channels.filter((x) => x !== channel) } : c
      );
      break;
    case 'restore_channel':
      if (!channel) return invalid('invalid principal, action or channel');
      next.denied_channels = next.denied_channels.filter((x) => x !== channel);
      break;
    case 'revoke_sessions':
      next.sessions_revoked_before = iso(now());
      s.connections = s.connections.filter((c) => c.principal !== principal);
      break;
    default:
      return invalid('invalid principal, action or channel');
  }
  next.revision = current.revision + 1;
  next.updated_at = iso(now());
  s.access.set(principal, next);
  return ok(next);
}

export function pushProviders(slug: string, id: string): Answer {
  const s = find(slug, id);
  if ('code' in s) return s;
  return ok(
    s.endpoint.slug === 'chat'
      ? [
          { provider: 'fcm', enabled: true, updated_at: iso(now() - 4 * 86_400_000) },
          { provider: 'webpush', enabled: false, updated_at: iso(now() - 9 * 86_400_000) },
        ]
      : []
  );
}
