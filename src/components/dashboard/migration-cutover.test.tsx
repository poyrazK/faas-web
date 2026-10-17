import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MigrationCutover } from './migration-cutover';
import type {
  MigrationCutover as Plan,
  MigrationCutoverRequest,
} from '@/lib/api/migration-cutover';
import type { MigrationVerification } from '@/lib/api/migration-verification';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  action: vi.fn(),
  connect: vi.fn(),
}));
vi.mock('@/lib/api/migration-cutover', () => ({
  listMigrationCutovers: mocks.list,
  createMigrationCutover: mocks.create,
  actOnMigrationCutover: mocks.action,
  connectMigrationDomain: mocks.connect,
}));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

const verification: MigrationVerification = {
  id: '33333333-3333-4333-8333-333333333333',
  app: 'shop-api',
  deployment_id: '11111111-1111-4111-8111-111111111111',
  scope: 'default',
  configuration_revision: 'a'.repeat(64),
  status: 'passed',
  phase: 'complete',
  checks: [],
  created_at: '2026-10-17T12:00:00Z',
  expires_at: '2026-10-17T12:10:00Z',
  request: {
    id: '33333333-3333-4333-8333-333333333333',
    deployment_id: '11111111-1111-4111-8111-111111111111',
    smoke_path: '/ready',
    checks: {},
    cold_wake: true,
  },
};
const plan: Plan = {
  id: '44444444-4444-4444-8444-444444444444',
  app: verification.app,
  deployment_id: verification.deployment_id,
  configuration_revision: verification.configuration_revision,
  smoke_path: '/ready',
  status: 'prepared',
  request: {
    id: '44444444-4444-4444-8444-444444444444',
    verification_id: verification.id,
    hostname: 'api.example.test',
    previous_records: [{ type: 'CNAME', value: 'old.provider.test', ttl: 300 }],
    previous_proxy_enabled: true,
    max_5xx_rate_bps: 100,
    max_p95_ms: 1000,
  },
  domain_connected: false,
  dns_records: [],
  checks: [],
  traffic: {
    status: 'unknown',
    coverage: 'deployment_route_observed_only',
    reason: 'checks_not_started',
    requests: 0,
    server_errors: 0,
  },
  created_at: '2026-10-17T12:01:00Z',
  limited_traffic_acknowledged: false,
};
function setup(v: MigrationVerification | undefined = verification) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <MigrationCutover
        app={verification.app}
        deployment={verification.deployment_id}
        verification={v}
      />
    </QueryClientProvider>
  );
  return { ...view, client };
}
beforeEach(() => {
  mocks.list.mockResolvedValue({ plans: [] });
  mocks.create.mockImplementation(async (_app: string, body: MigrationCutoverRequest) => ({
    ...plan,
    id: body.id,
    request: body,
  }));
  mocks.action.mockImplementation(async (_app: string, _id: string, body: { action: string }) => ({
    ...plan,
    status:
      body.action === 'confirm_restored'
        ? 'restored'
        : body.action === 'cancel'
          ? 'cancelled'
          : 'checking',
  }));
});
afterEach(() => vi.resetAllMocks());

async function fillPlan() {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Production hostname'), 'api.example.test');
  await user.type(
    screen.getByLabelText('Previous provider routing records'),
    'CNAME old.provider.test 300'
  );
  await user.click(screen.getByLabelText('The DNS provider’s CDN proxy is currently enabled.'));
  await user.click(
    screen.getByLabelText('I copied all current routing records and TTLs for this hostname.')
  );
  return user;
}

it('saves previous DNS settings without enrolling a domain or starting probes', async () => {
  setup();
  const user = await fillPlan();
  await user.click(screen.getByRole('button', { name: 'Prepare production switch' }));
  await screen.findByText('Production switch prepared — traffic is unchanged');
  expect(mocks.create).toHaveBeenCalledWith(
    'shop-api',
    expect.objectContaining({
      verification_id: verification.id,
      hostname: 'api.example.test',
      previous_records: [{ type: 'CNAME', value: 'old.provider.test', ttl: 300 }],
      previous_proxy_enabled: true,
      max_5xx_rate_bps: 100,
      max_p95_ms: 1000,
    })
  );
  expect(mocks.connect).not.toHaveBeenCalled();
  expect(mocks.action).not.toHaveBeenCalled();
});

it('rejects a TTL that would lose its original value when serialized', async () => {
  setup();
  const user = await fillPlan();
  const records = screen.getByLabelText('Previous provider routing records');
  await user.clear(records);
  await user.type(records, 'CNAME old.provider.test 999999999999999999999999999999999999');
  await user.click(screen.getByRole('button', { name: 'Prepare production switch' }));
  expect(
    await screen.findByText('Each DNS TTL must be a whole number from 0 to 2147483647 seconds.')
  ).toBeInTheDocument();
  expect(mocks.create).not.toHaveBeenCalled();
});
it('recovers a lost creation response through the saved plan ID', async () => {
  mocks.create.mockImplementation(async (_app: string, body: MigrationCutoverRequest) => {
    mocks.list.mockResolvedValue({ plans: [{ ...plan, id: body.id, request: body }] });
    throw new Error('response lost');
  });
  setup();
  const user = await fillPlan();
  await user.click(screen.getByRole('button', { name: 'Prepare production switch' }));
  await screen.findByText('Production switch prepared — traffic is unchanged');
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(mocks.connect).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Retry saving this plan' })).not.toBeInTheDocument();
});
it('retries uncertain creation with the original ID and immutable settings', async () => {
  mocks.create.mockRejectedValueOnce(new Error('unreachable'));
  setup();
  const user = await fillPlan();
  await user.click(screen.getByRole('button', { name: 'Prepare production switch' }));
  await user.click(await screen.findByRole('button', { name: 'Retry saving this plan' }));
  await screen.findByText('Production switch prepared — traffic is unchanged');
  expect(mocks.create.mock.calls[1]).toEqual(mocks.create.mock.calls[0]);
});
it('adds the planned hostname through the existing domain API and keeps checking explicit', async () => {
  mocks.list.mockResolvedValue({ plans: [plan] });
  mocks.connect.mockImplementation(async () => {
    mocks.list.mockResolvedValue({
      plans: [
        {
          ...plan,
          domain_connected: true,
          dns_records: [
            {
              type: 'TXT',
              name: '_gregale.api.example.test',
              value: 'challenge',
              purpose: 'verification',
            },
            {
              type: 'CNAME',
              name: plan.request.hostname,
              value: 'edge.gregale.dev',
              purpose: 'routing',
            },
          ],
        },
      ],
    });
  });
  setup();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Add this domain to Gregale' }));
  await screen.findByRole('table', { name: 'Gregale DNS records' });
  expect(mocks.action).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'I updated DNS — start checks' }));
  expect(mocks.connect).toHaveBeenCalledWith('shop-api', 'api.example.test');
  expect(mocks.action).toHaveBeenCalledWith('shop-api', plan.id, {
    action: 'start_checks',
    acknowledge_limited_traffic: false,
  });
});
it('requires explicit limited-traffic acknowledgement before completion', async () => {
  mocks.list.mockResolvedValue({
    plans: [
      {
        ...plan,
        domain_connected: true,
        status: 'ready',
        hostname_verified_at: '2026-10-17T12:02:00Z',
      },
    ],
  });
  setup();
  const user = userEvent.setup();
  const complete = await screen.findByRole('button', { name: 'Complete production switch' });
  expect(complete).toBeDisabled();
  await user.click(
    screen.getByLabelText(
      'I acknowledge the limited traffic evidence and will continue monitoring production.'
    )
  );
  await user.click(complete);
  expect(mocks.action).toHaveBeenCalledWith('shop-api', plan.id, {
    action: 'complete',
    acknowledge_limited_traffic: true,
  });
});
it('shows budget violations and prevents completion even with previous consent', async () => {
  mocks.list.mockResolvedValue({
    plans: [
      {
        ...plan,
        status: 'ready',
        domain_connected: true,
        hostname_verified_at: '2026-10-17T12:02:00Z',
        traffic: { ...plan.traffic, status: 'violated' },
      },
    ],
  });
  setup();
  expect(await screen.findByRole('button', { name: 'Complete production switch' })).toBeDisabled();
  expect(screen.getByText(/Review errors and latency before completing/)).toBeInTheDocument();
});
it('keeps saved recovery instructions available after verification becomes blocked', async () => {
  mocks.list.mockResolvedValue({
    plans: [{ ...plan, status: 'blocked', reason: 'deployment_or_configuration_changed' }],
  });
  setup({ ...verification, status: 'blocked' });
  expect(await screen.findByText('old.provider.test')).toBeInTheDocument();
  expect(screen.getByRole('table', { name: 'Previous DNS records' })).toHaveTextContent('300');
  const button = screen.getByRole('button', {
    name: 'Record that I restored the previous provider',
  });
  expect(button).toBeDisabled();
  const user = userEvent.setup();
  await user.click(
    screen.getByLabelText('I restored the previous DNS settings and checked the previous service.')
  );
  await user.click(button);
  expect(mocks.action).toHaveBeenCalledWith('shop-api', plan.id, {
    action: 'confirm_restored',
    acknowledge_limited_traffic: false,
  });
});
it('retains cached recovery instructions while the API is unreachable', async () => {
  mocks.list.mockResolvedValue({ plans: [{ ...plan, status: 'attention' }] });
  const { client } = setup();
  await screen.findByText('old.provider.test');
  mocks.list.mockRejectedValue(new Error('offline'));
  await client.refetchQueries({ queryKey: ['migration-cutovers', 'shop-api'] });
  await waitFor(() =>
    expect(screen.getByText(/The saved plan could not refresh/)).toBeInTheDocument()
  );
  expect(screen.getByText('old.provider.test')).toBeInTheDocument();
});

it('loads a saved plan on the app page without the original import or verification context', async () => {
  mocks.list.mockResolvedValue({ plans: [{ ...plan, status: 'restored' }] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MigrationCutover app={plan.app} deployment="" />
    </QueryClientProvider>
  );
  expect(
    await screen.findByText('Previous provider restored — confirmed by you')
  ).toBeInTheDocument();
  expect(screen.getByRole('table', { name: 'Previous DNS records' })).toHaveTextContent(
    'old.provider.test'
  );
  expect(screen.queryByLabelText('Production hostname')).not.toBeInTheDocument();
});
