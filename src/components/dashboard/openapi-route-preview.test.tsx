import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  account: 'account-1',
  query: {
    data: undefined as unknown,
    isPending: false,
    isFetching: false,
    error: null as unknown,
    refetch: vi.fn(),
  },
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { id: state.account } }) }));
vi.mock('@/lib/api/openapi-preview', async (original) => ({
  ...(await original<typeof import('@/lib/api/openapi-preview')>()),
  useOpenAPIPreview: () => state.query,
}));
const { OpenAPIRoutePreview } = await import('./openapi-route-preview');
const row = (path: string, status = 'matched') => ({
  path,
  method: 'get',
  status,
  declared: status !== 'observed_only',
  observed: status !== 'declared_only',
  covered: true,
  rules: [
    {
      id: 'enabled-rule',
      kind: 'validate',
      enabled: true,
      match_host: '*',
      match_path: path,
      match_methods: ['GET'],
      priority: 10,
    },
    {
      id: 'disabled-rule',
      kind: 'deny',
      enabled: false,
      match_host: '*',
      match_path: path,
      match_methods: [],
      priority: 20,
    },
  ],
});
const base = () => ({
  app_id: 'app-1',
  source: 'preview',
  openapi_version: '3.1.0',
  observed_available: true,
  observed_source: 'live',
  observed_inventory_available: false,
  observed_cap_hit: false,
  collectors_expected: 2,
  collectors_healthy: 2,
  routes: [row('/orders'), row('/declared', 'declared_only'), row('/observed', 'observed_only')],
});
beforeEach(() => {
  state.account = 'account-1';
  state.query.data = base();
  state.query.error = null;
  state.query.isPending = false;
  state.query.isFetching = false;
});

it('shows route provenance and enabled policy matches without claiming correctness', () => {
  render(<OpenAPIRoutePreview slug="app-a" />);
  const routes = within(screen.getByRole('list', { name: 'Compared routes' }));
  expect(routes.getByText('Matched')).toBeInTheDocument();
  expect(routes.getByText('Declared only')).toBeInTheDocument();
  expect(routes.getByText('Observed only')).toBeInTheDocument();
  expect(screen.getByText(/does not prove policy correctness/i)).toBeInTheDocument();
  expect(screen.getAllByText(/Disabled.*deny/i)).toHaveLength(3);
  expect(screen.queryByText(/healthy API/i)).not.toBeInTheDocument();
});

it.each(['partial', 'unavailable'])(
  'keeps %s live observations distinct from retained inventory',
  (source) => {
    state.query.data = {
      ...base(),
      observed_source: source,
      observed_inventory_available: true,
      collectors_healthy: 1,
    };
    render(<OpenAPIRoutePreview slug="app-a" />);
    expect(
      screen.getByText(
        source === 'partial' ? /live telemetry is partial/i : /live telemetry is unavailable/i
      )
    ).toBeInTheDocument();
    expect(screen.getByText(/retained discovered routes are included/i)).toBeInTheDocument();
  }
);

it('distinguishes a healthy zero-traffic snapshot from unavailable or capped discovery', () => {
  state.query.data = { ...base(), routes: [], openapi_version: undefined };
  render(<OpenAPIRoutePreview slug="app-a" />);
  expect(screen.getByText(/no observations in this live snapshot/i)).toBeInTheDocument();
  expect(screen.getByText(/no imported declaration/i)).toBeInTheDocument();
});

it('preserves cap evidence and hides stale routes during a failed refresh', () => {
  state.query.data = { ...base(), observed_cap_hit: true };
  const view = render(<OpenAPIRoutePreview slug="app-a" />);
  expect(screen.getByText(/route cap reached/i)).toBeInTheDocument();
  state.query.error = new Error('Read permission denied');
  view.rerender(<OpenAPIRoutePreview slug="app-a" />);
  expect(screen.getByRole('alert')).toHaveTextContent('Read permission denied');
  expect(screen.queryByText('/orders')).not.toBeInTheDocument();
});

it('pages long lists, filters by route, and resets local controls on account change', () => {
  state.query.data = {
    ...base(),
    routes: Array.from({ length: 42 }, (_, i) => row(`/route-${String(i).padStart(2, '0')}`)),
  };
  const view = render(<OpenAPIRoutePreview slug="app-a" />);
  expect(screen.getByText('/route-00')).toBeInTheDocument();
  expect(screen.queryByText('/route-20')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Next routes' }));
  expect(screen.getByText('/route-20')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: 'Filter routes' }), {
    target: { value: 'route-41' },
  });
  expect(screen.getByText('/route-41')).toBeInTheDocument();
  state.account = 'account-2';
  state.query.data = undefined;
  state.query.isPending = true;
  view.rerender(<OpenAPIRoutePreview slug="app-a" />);
  expect(screen.queryByText('/route-41')).not.toBeInTheDocument();
  state.query.data = base();
  state.query.isPending = false;
  view.rerender(<OpenAPIRoutePreview slug="app-a" />);
  expect(screen.getByRole('textbox', { name: 'Filter routes' })).toHaveValue('');
});
