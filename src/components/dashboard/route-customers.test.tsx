import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { problem, renderWithProviders, routeApi, type Answer } from '@/test/monetization';
import { withRouter } from '@/test/router';

const { RouteCustomersPanel } = await import('./route-customers');

const DEPLOYMENTS = '/v1/apps/{slug}/deployments';
const PATH = '/v1/apps/{slug}/analytics/route-customers';
const LIVE = '9a3c41f07d2e4b8a9c1f5e6d7b8a9c0d';
const NEWER_FAILED = '1b2c3d4e5f60718293a4b5c6d7e8f901';
const OLD = '0f1e2d3c4b5a69788796a5b4c3d2e1f0';

const deployments = [
  { id: NEWER_FAILED, app_id: 'app-1', status: 'failed', created_at: '2026-10-31T09:00:00Z' },
  { id: LIVE, app_id: 'app-1', status: 'live', created_at: '2026-10-30T09:00:00Z' },
  { id: OLD, app_id: 'app-1', status: 'superseded', created_at: '2026-10-20T09:00:00Z' },
];

function usage(extra: Record<string, unknown> = {}) {
  return {
    slug: 'api',
    deployment_id: LIVE,
    from: '2026-10-30T10:00:00Z',
    until: '2026-10-31T10:00:00Z',
    as_of: '2026-10-31T10:00:00Z',
    window_clamped: false,
    coverage: 'observed_only',
    routes_limit: 200,
    routes_truncated: false,
    customers_limit: 20,
    routes: [
      {
        route: '/orders',
        method: 'GET',
        requests: 18420,
        identified_requests: 15104,
        anonymous_requests: 3316,
        unresolved_identity_requests: 0,
        consumer_count: 19,
        platform_tenant_count: 2,
        last_observed_at: '2026-10-31T09:56:00Z',
        customers: [
          {
            consumer_id: '3f6c2a1e-8b4d-4c7a-9e21-5d0f7b3a6c48',
            platform_tenant_id: '5b0e9c41-7d2a-4f63-8e15-2c9a0b7d4e18',
            requests: 6200,
            last_observed_at: '2026-10-31T09:56:00Z',
          },
        ],
        customers_truncated: true,
        other_customer_requests: 412,
      },
      {
        route: '/orders/{id}',
        method: 'DELETE',
        requests: 87,
        identified_requests: 70,
        anonymous_requests: 15,
        unresolved_identity_requests: 2,
        consumer_count: 1,
        platform_tenant_count: 0,
        last_observed_at: '2026-10-31T08:00:00Z',
        customers: [],
        customers_truncated: false,
        other_customer_requests: 0,
      },
    ],
    ...extra,
  };
}

let answer: (query: Record<string, unknown>) => Answer;
let deploymentsAnswer: () => Answer;
let spies: ReturnType<typeof routeApi>;

beforeEach(() => {
  answer = () => usage();
  deploymentsAnswer = () => ({ items: deployments, next_before: null });
  spies = routeApi({
    [`GET ${DEPLOYMENTS}`]: () => deploymentsAnswer(),
    [`GET ${PATH}`]: (init) => answer(init.params?.query ?? {}),
  });
});

afterEach(() => vi.restoreAllMocks());

const usageCalls = () =>
  spies.GET.mock.calls
    .filter(([path]) => path === PATH)
    .map(([, init]) => (init as { params: { query: Record<string, string> } }).params.query);

const render = () => renderWithProviders(withRouter(<RouteCustomersPanel slug="api" />));

it('reads the live deployment over the last 24 hours by default', async () => {
  render();
  await screen.findByText('/orders');
  expect(usageCalls().at(-1)).toEqual({ deployment_id: LIVE, since: '24h' });
});

it('lists each route with its requests split by identity and its customer counts', async () => {
  render();
  const row = (await screen.findByText('/orders')).closest('tr')!;
  expect(within(row).getByText('GET')).toBeInTheDocument();
  expect(within(row).getByText('18,420')).toBeInTheDocument();
  expect(within(row).getByText('15,104')).toBeInTheDocument();
  expect(within(row).getByText('3,316')).toBeInTheDocument();
  expect(within(row).getByText('19')).toBeInTheDocument();
});

it('says the counts are observed only and that consumers and tenants overlap', async () => {
  render();
  await screen.findByText('/orders');
  expect(screen.getByText(/observed only/i)).toBeInTheDocument();
  expect(screen.getByText(/do not add them/i)).toBeInTheDocument();
});

it('shows a route’s customers, and how many requests the list leaves out', async () => {
  render();
  await userEvent.click(await screen.findByText('/orders'));
  const detail = await screen.findByRole('region', { name: /customers on GET \/orders/i });
  expect(within(detail).getByText('3f6c2a1e-8b4d-4c7a-9e21-5d0f7b3a6c48')).toBeInTheDocument();
  expect(within(detail).getByText('6,200')).toBeInTheDocument();
  expect(within(detail).getByText(/412 requests from customers not listed/i)).toBeInTheDocument();
});

it('reads another deployment and another window when chosen', async () => {
  render();
  await screen.findByText('/orders');
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Deployment' }), OLD);
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Lookback' }), '7d');
  await waitFor(() => expect(usageCalls().at(-1)).toEqual({ deployment_id: OLD, since: '7d' }));
});

it('says when plan retention shortened the window', async () => {
  answer = () => usage({ window_clamped: true });
  render();
  expect(await screen.findByText(/shortened to what your plan retains/i)).toBeInTheDocument();
});

it('says when routes were left out', async () => {
  answer = () => usage({ routes_truncated: true });
  render();
  expect(await screen.findByText(/the top 200 routes/i)).toBeInTheDocument();
});

it('says nothing was observed, without calling the route unused', async () => {
  answer = () => usage({ routes: [] });
  render();
  expect(await screen.findByText(/no requests observed/i)).toBeInTheDocument();
  expect(screen.getByText(/not proof/i)).toBeInTheDocument();
});

it('shows the plan panel on plan_feature_gated', async () => {
  answer = () =>
    problem(
      402,
      'plan_feature_gated',
      "the free plan doesn't include request analytics; upgrade to Hobby or higher for historical observability."
    );
  render();
  expect(await screen.findByText(/available on Hobby and above/i)).toBeInTheDocument();
  expect(screen.getByText(/doesn't include request analytics/i)).toBeInTheDocument();
});

it('says the app has no deployment to read yet', async () => {
  deploymentsAnswer = () => ({ items: [], next_before: null });
  render();
  expect(await screen.findByText(/no deployments to read yet/i)).toBeInTheDocument();
  expect(usageCalls()).toHaveLength(0);
});

it('keeps the API prose for a failed read', async () => {
  answer = () => problem(400, 'validation_failed', 'until must be within retained telemetry');
  render();
  expect(await screen.findByText(/until must be within retained telemetry/i)).toBeInTheDocument();
});

it('says the deployment is no longer this app’s on not_found', async () => {
  answer = () => problem(404, 'not_found', 'no such deployment');
  render();
  expect(await screen.findByText(/no longer part of this app/i)).toBeInTheDocument();
});
