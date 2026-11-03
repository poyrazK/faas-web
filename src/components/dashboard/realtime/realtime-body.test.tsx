import type { ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Realtime tab end to end above the HTTP client: the typed `api` is
 * replaced by a router of canned apid answers, so hooks, caching, gates and
 * the components all run for real.
 */

type Reply = { status: number; body?: unknown };
type Opts = {
  params: {
    path: Record<string, string>;
    query: Record<string, unknown>;
    header: Record<string, string>;
  };
  body: Record<string, unknown>;
};
type Call = { method: string; path: string; opts: Opts };
const fake = vi.hoisted(() => {
  const calls: Call[] = [];
  const routes = new Map<string, (opts: Opts) => Reply>();
  const send =
    (method: string) =>
    async (path: string, opts: Opts = {} as Opts) => {
      calls.push({ method, path, opts });
      const handler = routes.get(`${method} ${path}`);
      const reply = handler
        ? handler(opts)
        : { status: 404, body: { status: 404, code: 'not_mocked', title: 'not mocked' } };
      const response = new Response(reply.status === 204 ? null : JSON.stringify(reply.body), {
        status: reply.status,
        headers: { 'content-type': 'application/json' },
      });
      return reply.status >= 400 ? { error: reply.body, response } : { data: reply.body, response };
    };
  return { calls, routes, send };
});
vi.mock('@/lib/api/client', async (original) => ({
  ...(await original<object>()),
  api: {
    GET: fake.send('GET'),
    POST: fake.send('POST'),
    PATCH: fake.send('PATCH'),
    DELETE: fake.send('DELETE'),
  },
}));

const access = vi.hoisted(() => ({ off: new Set<string>() }));
vi.mock('@/lib/api/capabilities', () => ({
  useCapability: (key: string) => ({ capability: { key, maturity: 'preview' } }),
  useCapabilityAccess: (key: string) => ({
    access: access.off.has(key) ? 'off' : 'on',
    refresh: vi.fn(),
  }),
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { id: 'acct', plan: 'pro' } }) }));
const toast = vi.fn();
const confirm = vi.fn();
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));

const { RealtimeBody } = await import('./realtime-body');

const EP = '6f1c2a4e-1d9b-4c7a-9a39-0b8d6f0f4c11';
const base = '/v1/apps/{slug}/realtime/endpoints';
const endpoint = (over: Record<string, unknown> = {}) => ({
  id: EP,
  app_id: 'app',
  account_id: 'acct',
  slug: 'chat',
  callback_url: 'https://shop.example.com',
  connect_path: '/realtime/connect',
  message_path: '/realtime/message',
  disconnect_path: '/realtime/disconnect',
  callback_auth_token_masked: '***',
  auth_token_masked: '***',
  auth_mode: 'oidc_jwt',
  auth_issuer: 'https://id.example.com',
  auth_jwks_url: 'https://id.example.com/jwks.json',
  auth_algorithms: ['RS256'],
  allowed_origins: ['https://shop.example.com'],
  max_connections: 500,
  max_message_bytes: 0,
  max_connection_age_seconds: 0,
  enabled: true,
  created_at: '2026-10-28T09:00:00Z',
  updated_at: '2026-10-28T09:00:00Z',
  ...over,
});
const usage = {
  plan: 'pro',
  connection_limit: 1000,
  open_connections: 12,
  from: '2026-11-02T12:00:00Z',
  to: '2026-11-03T12:00:00Z',
  hours: [],
  endpoints: [],
};
const connections = (over: Record<string, unknown> = {}) => ({
  connections: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      endpoint_id: EP,
      app_id: 'app',
      account_id: 'acct',
      principal: 'user-101',
      channels: ['lobby', 'orders'],
      connected_at: '2026-11-03T11:00:00Z',
      last_seen_at: '2026-11-03T11:59:00Z',
      expires_at: '2026-11-04T11:00:00Z',
    },
  ],
  limit: 100,
  truncated: false,
  partial: true,
  nodes_queried: 2,
  nodes_unavailable: 1,
  ...over,
});

function setRoutes(over: Record<string, (opts: Opts) => Reply> = {}) {
  fake.routes.clear();
  const all: Record<string, (opts: Opts) => Reply> = {
    'GET /v1/usage/realtime': () => ({ status: 200, body: usage }),
    [`GET ${base}`]: () => ({ status: 200, body: [endpoint()] }),
    [`GET ${base}/{id}/connections`]: () => ({ status: 200, body: connections() }),
    [`GET ${base}/{id}/push/providers`]: () => ({ status: 200, body: [] }),
    ...over,
  };
  for (const [k, v] of Object.entries(all)) fake.routes.set(k, v);
}

let client: QueryClient;
function renderBody(appUrl: string | undefined = 'https://api-gateway.gregale.app') {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<RealtimeBody slug="api-gateway" appUrl={appUrl} />, { wrapper: wrap });
}
const called = (method: string, path: string) =>
  fake.calls.filter((c) => c.method === method && c.path === path);
/** Everything TanStack holds, as text: a secret must never appear in it. */
const cacheText = () =>
  JSON.stringify([
    client
      .getQueryCache()
      .getAll()
      .map((q) => q.state.data),
    client
      .getMutationCache()
      .getAll()
      .map((m) => [m.state.variables, m.state.data]),
  ]);

beforeEach(() => {
  fake.calls.length = 0;
  access.off.clear();
  setRoutes();
  toast.mockReset();
  confirm.mockReset().mockResolvedValue(true);
});
afterEach(() => client?.clear());

describe('endpoints', () => {
  it('lists endpoints with state as colour, icon and label, and shows the client URL', async () => {
    renderBody();
    const list = await screen.findByRole('list', { name: 'Realtime endpoints' });
    expect(within(list).getByText('chat')).toBeInTheDocument();
    expect(within(list).getByText('Enabled')).toBeInTheDocument();
    expect(within(list).getByText('OIDC JWT')).toBeInTheDocument();
    expect(
      await screen.findByText(`wss://api-gateway.gregale.app/__gregale/realtime/${EP}`)
    ).toBeInTheDocument();
    expect(screen.getByText('Preview')).toBeInTheDocument();
  });

  it('says so when the app has none, and opens the form from the empty state', async () => {
    setRoutes({ [`GET ${base}`]: () => ({ status: 200, body: [] }) });
    renderBody();
    await userEvent.click(await screen.findByRole('button', { name: 'Create an endpoint' }));
    expect(screen.getByRole('form', { name: 'New endpoint' })).toBeInTheDocument();
  });

  it('explains a plan without realtime instead of showing a raw error', async () => {
    setRoutes({
      [`GET ${base}`]: () => ({
        status: 402,
        body: { status: 402, code: 'plan_realtime_not_allowed', detail: 'the free plan …' },
      }),
    });
    renderBody();
    expect(await screen.findByText(/not included in your plan/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View plans' })).toHaveAttribute(
      'href',
      '/dashboard/plans'
    );
  });

  it('creates an endpoint, shows a generated token once, and caches no token', async () => {
    setRoutes({
      [`GET ${base}`]: () => ({ status: 200, body: [] }),
      [`POST ${base}`]: (opts) => ({ status: 201, body: endpoint({ ...opts.body, id: EP }) }),
    });
    renderBody();
    await userEvent.click(await screen.findByRole('button', { name: 'New endpoint' }));
    const form = screen.getByRole('form', { name: 'New endpoint' });
    await userEvent.click(within(form).getByRole('button', { name: 'Generate' }));
    const token = (within(form).getByLabelText('Callback token') as HTMLInputElement).value;
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    await userEvent.click(within(form).getByRole('button', { name: 'Create endpoint' }));

    await waitFor(() => expect(called('POST', base)).toHaveLength(1));
    const body = called('POST', base)[0].opts.body;
    expect(body).toMatchObject({
      callback_url: 'https://api-gateway.gregale.app',
      callback_auth_token: token,
      auth_mode: 'none',
      enabled: true,
    });
    const secret = await screen.findByRole('region', { name: 'Callback token' });
    expect(within(secret).queryByText(token)).toBeNull();
    await userEvent.click(within(secret).getByRole('button', { name: 'Reveal' }));
    expect(within(secret).getByText(token)).toBeInTheDocument();
    expect(cacheText()).not.toContain(token);
  });

  it('refuses a create without a callback token, before calling the API', async () => {
    setRoutes({ [`GET ${base}`]: () => ({ status: 200, body: [] }) });
    renderBody();
    await userEvent.click(await screen.findByRole('button', { name: 'New endpoint' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create endpoint' }));
    expect(await screen.findByText(/checks this token on every callback/)).toBeInTheDocument();
    expect(called('POST', base)).toHaveLength(0);
  });

  it('confirms an edit that changes admission, and sends only what changed', async () => {
    setRoutes({
      [`PATCH ${base}/{id}`]: (opts) => ({ status: 200, body: endpoint(opts.body) }),
    });
    renderBody();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const form = screen.getByRole('form', { name: 'Edit endpoint' });
    await userEvent.selectOptions(within(form).getByLabelText('Client authentication'), 'none');
    await userEvent.click(within(form).getByRole('button', { name: 'Save endpoint' }));

    await waitFor(() => expect(called('PATCH', `${base}/{id}`)).toHaveLength(1));
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringContaining('1008'), destructive: true })
    );
    expect(called('PATCH', `${base}/{id}`)[0].opts.body).toEqual({ auth_mode: 'none' });
  });

  it('keeps the endpoint when the disruptive edit is not confirmed', async () => {
    confirm.mockResolvedValue(false);
    renderBody();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    await userEvent.click(screen.getByLabelText(/Enabled — accepts new connections/));
    await userEvent.click(screen.getByRole('button', { name: 'Save endpoint' }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(confirm.mock.calls[0][0].description).toMatch(/closes every open connection/);
    expect(called('PATCH', `${base}/{id}`)).toHaveLength(0);
  });

  it('deletes only after a destructive confirmation that names what goes with it', async () => {
    setRoutes({ [`DELETE ${base}/{id}`]: () => ({ status: 204 }) });
    renderBody();
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(called('DELETE', `${base}/{id}`)).toHaveLength(1));
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining('retained history and consumer groups'),
        destructive: true,
      })
    );
    expect(called('DELETE', `${base}/{id}`)[0].opts.params.path).toEqual({
      slug: 'api-gateway',
      id: EP,
    });
  });

  it('shows open connections against the plan limit', async () => {
    renderBody();
    expect(await screen.findByText('of 1,000 your plan allows at once')).toBeInTheDocument();
    expect(
      screen.getByText('No hourly usage has been recorded for this account.')
    ).toBeInTheDocument();
  });
});

describe('capability gates', () => {
  it('reads nothing a hidden child capability owns, and says why', async () => {
    for (const key of [
      'realtime-connections',
      'realtime-occupancy',
      'realtime-channels',
      'realtime-tickets',
      'realtime-access',
      'realtime-push',
    ])
      access.off.add(key);
    renderBody();
    await screen.findByRole('list', { name: 'Realtime endpoints' });
    expect(screen.getAllByText('Not enabled for this account')).toHaveLength(6);
    expect(screen.queryByRole('form', { name: 'Issue a ticket' })).toBeNull();
    expect(called('GET', `${base}/{id}/connections`)).toHaveLength(0);
    expect(called('GET', `${base}/{id}/push/providers`)).toHaveLength(0);
  });

  it('keeps the parts that are on when one child is off', async () => {
    access.off.add('realtime-tickets');
    renderBody();
    expect(await screen.findByRole('form', { name: 'Filter connections' })).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Issue a ticket' })).toBeNull();
    expect(screen.getByRole('form', { name: 'Watch channels' })).toBeInTheDocument();
  });
});

describe('connections and occupancy', () => {
  it('lists connections, says when a node did not answer, and closes after confirming', async () => {
    setRoutes({
      [`POST ${base}/{id}/connections/{connection_id}/close`]: () => ({ status: 204 }),
    });
    renderBody();
    expect(await screen.findByText('user-101')).toBeInTheDocument();
    expect(screen.getByText(/1 of 3 realtime nodes did not answer/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() =>
      expect(called('POST', `${base}/{id}/connections/{connection_id}/close`)).toHaveLength(1)
    );
    expect(confirm.mock.calls[0][0]).toMatchObject({ destructive: true });
  });

  it('treats a connection that already left as closed, not as a failure', async () => {
    setRoutes({
      [`POST ${base}/{id}/connections/{connection_id}/close`]: () => ({
        status: 410,
        body: { status: 410, code: 'not_found', detail: 'the connection is no longer live' },
      }),
    });
    renderBody();
    await userEvent.click(await screen.findByRole('button', { name: 'Close' }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'info', title: 'That connection had already closed' })
      )
    );
  });

  it('filters by principal and channel', async () => {
    renderBody();
    const form = await screen.findByRole('form', { name: 'Filter connections' });
    await userEvent.type(within(form).getByLabelText('Principal'), 'user-101');
    await userEvent.type(within(form).getByLabelText('Channel'), 'orders');
    await userEvent.click(within(form).getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(
        called('GET', `${base}/{id}/connections`).some(
          (c) =>
            c.opts.params.query.principal === 'user-101' && c.opts.params.query.channel === 'orders'
        )
      ).toBe(true)
    );
  });

  it('counts the named channels and polls the REST snapshot', async () => {
    setRoutes({
      [`GET ${base}/{id}/occupancy`]: (opts) => ({
        status: 200,
        body: {
          channels: (opts.params.query.channel as string[]).map((channel, i) => ({
            channel,
            subscribers: 23 - i,
            presence_members: 19 - i,
          })),
          partial: false,
          nodes_queried: 3,
          nodes_unavailable: 0,
        },
      }),
    });
    renderBody();
    const form = await screen.findByRole('form', { name: 'Watch channels' });
    await userEvent.type(within(form).getByRole('textbox'), 'lobby, game-42');
    await userEvent.click(within(form).getByRole('button', { name: 'Watch' }));
    const table = await screen.findByRole('table', { name: 'Channel occupancy' });
    expect(within(table).getByText('23')).toBeInTheDocument();
    expect(called('GET', `${base}/{id}/occupancy`)[0].opts.params.query.channel).toEqual([
      'lobby',
      'game-42',
    ]);
  });

  it('refuses more than 20 channels or a channel with a slash', async () => {
    renderBody();
    const form = await screen.findByRole('form', { name: 'Watch channels' });
    const input = within(form).getByRole('textbox');
    await userEvent.type(input, Array.from({ length: 21 }, (_, i) => `c${i}`).join(' '));
    await userEvent.click(within(form).getByRole('button', { name: 'Watch' }));
    expect(screen.getByText('At most 20 channels at once.')).toBeInTheDocument();
    await userEvent.clear(input);
    await userEvent.type(input, 'a/b');
    expect(screen.getByText(/has no spaces, slashes/)).toBeInTheDocument();
    expect(called('GET', `${base}/{id}/occupancy`)).toHaveLength(0);
  });
});

describe('channels', () => {
  const channelRoutes = (publish: (opts: Opts) => Reply) =>
    setRoutes({
      [`POST ${base}/{id}/channels/{channel}/publish`]: publish,
      [`GET ${base}/{id}/channels/{channel}/retained-messages`]: () => ({
        status: 200,
        body: {
          messages: [
            {
              sequence: 812,
              data_base64: btoa('{"id":42}'),
              binary: false,
              created_at: '2026-11-03T11:00:00Z',
              event: 'order.paid',
            },
          ],
          oldest_sequence: 812,
          latest_sequence: 812,
          has_more: false,
        },
      }),
      [`GET ${base}/{id}/channels/{channel}/groups`]: () => ({ status: 200, body: [] }),
    });
  async function openChannel() {
    renderBody();
    const form = await screen.findByRole('form', { name: 'Open a channel' });
    await userEvent.type(within(form).getByRole('textbox'), 'orders');
    await userEvent.click(within(form).getByRole('button', { name: 'Open channel' }));
  }

  it('publishes only after a confirmation that says real subscribers receive it', async () => {
    channelRoutes(() => ({
      status: 200,
      body: { queued: 2, subscribers: 3, queue_full: 1, failed: 0, partial: true, durable: false },
    }));
    await openChannel();
    await userEvent.type(screen.getByLabelText('Message for orders'), 'hello');
    await userEvent.click(screen.getByRole('button', { name: 'Publish…' }));
    await screen.findByText('Queued for 2 of 3 subscribers.');
    expect(confirm.mock.calls[0][0].description).toMatch(/real traffic/);
    const call = called('POST', `${base}/{id}/channels/{channel}/publish`)[0];
    expect(call.opts.params.path.channel).toBe('orders');
    expect(call.opts.params.query).toEqual({ delivery: 'live' });
    expect(call.opts.body).toEqual({ data_base64: btoa('hello'), binary: false });
    expect(screen.getByText('1 had a full output queue and did not get it.')).toBeInTheDocument();
  });

  it('sends nothing when the publish is not confirmed', async () => {
    channelRoutes(() => ({ status: 200, body: { queued: 0 } }));
    confirm.mockResolvedValue(false);
    await openChannel();
    await userEvent.type(screen.getByLabelText('Message for orders'), 'hello');
    await userEvent.click(screen.getByRole('button', { name: 'Publish…' }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(called('POST', `${base}/{id}/channels/{channel}/publish`)).toHaveLength(0);
  });

  it('retries a failed publish with the same idempotency key', async () => {
    let n = 0;
    channelRoutes(() =>
      n++ === 0
        ? { status: 503, body: { status: 503, code: 'capacity_unavailable', detail: 'owner down' } }
        : { status: 200, body: { queued: 1, subscribers: 1, durable: false } }
    );
    await openChannel();
    await userEvent.type(screen.getByLabelText('Message for orders'), 'hello');
    await userEvent.click(screen.getByRole('button', { name: 'Publish…' }));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    await userEvent.click(screen.getByRole('button', { name: 'Publish…' }));
    await screen.findByText('Queued for 1 of 1 subscriber.');
    const keys = called('POST', `${base}/{id}/channels/{channel}/publish`).map(
      (c) => c.opts.params.header['Idempotency-Key']
    );
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('reads retained history as text', async () => {
    channelRoutes(() => ({ status: 200, body: { queued: 0 } }));
    await openChannel();
    expect(await screen.findByText('{"id":42}')).toBeInTheDocument();
    expect(screen.getByText('order.paid')).toBeInTheDocument();
    expect(screen.getByText('No consumer group reads this channel.')).toBeInTheDocument();
  });
});

describe('tickets and access', () => {
  it('shows an issued ticket once, keeps only its ID, and revokes by ID', async () => {
    const TICKET = 'grt_secret_value';
    setRoutes({
      [`POST ${base}/{id}/tickets`]: () => ({
        status: 201,
        body: {
          ticket: TICKET,
          ticket_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
          expires_at: '2026-11-03T12:02:00Z',
        },
      }),
      [`DELETE ${base}/{id}/tickets/{ticket}`]: () => ({ status: 204 }),
    });
    renderBody();
    const form = await screen.findByRole('form', { name: 'Issue a ticket' });
    await userEvent.type(within(form).getByLabelText('Principal'), 'customer-42');
    await userEvent.type(within(form).getByLabelText(/Channels/), 'orders:tenant-42');
    await userEvent.click(within(form).getByRole('button', { name: 'Issue ticket' }));

    const secret = await screen.findByRole('region', { name: 'Subscription ticket' });
    expect(within(secret).queryByText(TICKET)).toBeNull();
    expect(called('POST', `${base}/{id}/tickets`)[0].opts.body).toEqual({
      principal: 'customer-42',
      channels: ['orders:tenant-42'],
      ttl_seconds: 120,
    });
    expect(cacheText()).not.toContain(TICKET);

    await userEvent.click(
      screen.getByRole('button', { name: 'Revoke ticket aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' })
    );
    await waitFor(() =>
      expect(called('DELETE', `${base}/{id}/tickets/{ticket}`)[0].opts.params.path.ticket).toBe(
        'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
      )
    );
  });

  it('validates a ticket lifetime of 1 to 300 seconds', async () => {
    renderBody();
    const form = await screen.findByRole('form', { name: 'Issue a ticket' });
    await userEvent.type(within(form).getByLabelText('Principal'), 'customer-42');
    await userEvent.type(within(form).getByLabelText(/Channels/), 'orders');
    const ttl = within(form).getByLabelText('Lifetime (s)');
    await userEvent.clear(ttl);
    await userEvent.type(ttl, '301');
    await userEvent.click(within(form).getByRole('button', { name: 'Issue ticket' }));
    expect(screen.getByText('A whole number of seconds from 1 to 300.')).toBeInTheDocument();
    expect(called('POST', `${base}/{id}/tickets`)).toHaveLength(0);
  });

  it('reads a principal and denies a channel after confirming', async () => {
    let state = { denied_channels: ['project-7'], revision: 2, updated_at: '2026-11-03T10:00:00Z' };
    setRoutes({
      [`GET ${base}/{id}/principals/{principal}/access`]: () => ({ status: 200, body: state }),
      [`POST ${base}/{id}/principals/{principal}/access`]: (opts) => {
        state = {
          ...state,
          denied_channels: [...state.denied_channels, String(opts.body.channel)],
        };
        return { status: 200, body: state };
      },
    });
    renderBody();
    const lookup = await screen.findByRole('form', { name: 'Look up a principal' });
    await userEvent.type(within(lookup).getByRole('textbox'), 'user-101');
    await userEvent.click(within(lookup).getByRole('button', { name: 'Look up' }));
    expect(await screen.findByText('project-7')).toBeInTheDocument();
    const deny = screen.getByRole('form', { name: 'Deny a channel' });
    await userEvent.type(within(deny).getByRole('textbox'), 'project-42');
    await userEvent.click(within(deny).getByRole('button', { name: 'Deny…' }));
    await waitFor(() =>
      expect(called('POST', `${base}/{id}/principals/{principal}/access`)[0].opts.body).toEqual({
        action: 'revoke_channel',
        channel: 'project-42',
      })
    );
    expect(confirm.mock.calls[0][0]).toMatchObject({ destructive: true });
    expect(await screen.findByText('project-42')).toBeInTheDocument();
  });
});
