import type { ReactNode } from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { problem, renderWithProviders, routeApi, type Handlers } from '@/test/monetization';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));
const access = vi.hoisted(() => ({ off: new Set<string>(), plan: new Set<string>() }));
vi.mock('@/lib/api/capabilities', () => ({
  useCapability: (key: string) => ({ capability: { key, maturity: 'preview' } }),
  useCapabilityAccess: (key: string) => ({
    access: access.off.has(key) ? 'off' : access.plan.has(key) ? 'plan-not-entitled' : 'on',
    refresh: vi.fn(),
  }),
  useCapabilityRegistry: () => ({
    query: {
      data: {
        registry_version: 1,
        plan: 'pro',
        capabilities: [],
        hidden_capabilities: [...access.off],
      },
    },
    phase: 'ready',
  }),
}));

const { SyntheticsBody, checkFormErrors, checkState, explainCheckError, runLabel } =
  await import('./synthetics-body');
const { CapabilityGate } = await import('./capability-gate');
const { ApiError } = await import('@/lib/api/errors');

const HEALTH = '8c3e7d4f-2e3f-4a4b-9c5d-2e3f4a5b6c7d';
const HOME = '6a1f5b2e-0c1d-4e2f-8a9b-0c1d2e3f4a5b';
const health = {
  id: HEALTH,
  name: 'health',
  method: 'GET',
  path: '/healthz',
  url: 'https://shop.gregale.dev/healthz',
  timeout_ms: 10000,
  interval_seconds: 300,
  enabled: true,
  created_at: '2026-10-01T00:00:00Z',
};
const home = {
  ...health,
  id: HOME,
  name: 'home',
  method: 'HEAD',
  path: '/',
  url: 'https://shop.gregale.dev/',
  expected_status: 200,
  interval_seconds: 900,
  enabled: false,
};
const results = (over: Record<string, unknown> = {}) => ({
  uptime_24h_pct: 99.65,
  uptime_7d_pct: 99.9,
  runs_24h: 288,
  p95_latency_ms_24h: 840,
  recent: [
    { started_at: '2026-11-03T12:05:00Z', ok: true, status_code: 200, latency_ms: 92 },
    {
      started_at: '2026-11-03T12:00:00Z',
      ok: false,
      status_code: 503,
      latency_ms: 31,
      error_class: 'status',
    },
  ],
  ...over,
});
const rule = {
  id: 'r-1',
  name: 'health failing',
  metric: 'synthetic_check_consecutive_failures',
  comparison: 'gte',
  threshold: 2,
  window_spec: '1h',
  synthetic_check_id: HEALTH,
  state: 'ok',
  enabled: true,
};

let created: Record<string, unknown>[];
let patched: unknown[];
let deleted: string[];
function api(extra: Handlers = {}) {
  return routeApi({
    'GET /v1/apps/{slug}/synthetics': () => [health, home],
    'GET /v1/apps/{slug}/synthetics/{id}': ({ params }) =>
      params?.path?.id === HEALTH
        ? { ...health, results: results() }
        : { ...home, results: results({ recent: [], runs_24h: 0, uptime_24h_pct: null }) },
    'POST /v1/apps/{slug}/synthetics': ({ body }) => {
      created.push(body as Record<string, unknown>);
      return { ...health, id: 'new', ...(body as object) };
    },
    'PATCH /v1/apps/{slug}/synthetics/{id}': ({ params, body }) => {
      patched.push({ id: params?.path?.id, ...(body as object) });
      return { ...health, ...(body as object) };
    },
    'DELETE /v1/apps/{slug}/synthetics/{id}': ({ params }) => {
      deleted.push(String(params?.path?.id));
      return undefined;
    },
    'GET /v1/apps/{slug}/alerts': () => [
      rule,
      { ...rule, id: 'r-2', name: 'other', synthetic_check_id: HOME },
    ],
    'GET /v1/notification-channels': () => [],
    ...extra,
  });
}

beforeEach(() => {
  access.off.clear();
  access.plan.clear();
  created = [];
  patched = [];
  deleted = [];
});
afterEach(() => vi.restoreAllMocks());

describe('SyntheticsBody', () => {
  it('lists each check with its schedule, uptime and last result', async () => {
    api();
    renderWithProviders(<SyntheticsBody slug="shop" />);
    const list = await screen.findByRole('list');
    const first = within(list).getByRole('button', { name: /health/ });
    expect(first).toHaveTextContent('GET /healthz · every 5 minutes · expecting any 2xx');
    await waitFor(() => expect(first).toHaveTextContent('99.65% up (24h)'));
    expect(first).toHaveTextContent('Passing');
    const second = within(list).getByRole('button', { name: /home/ });
    expect(second).toHaveTextContent('HEAD / · every 15 minutes · expecting 200');
    expect(second).toHaveTextContent('Paused');
  });

  it('shows uptime, p95 and recent runs for the selected check', async () => {
    api();
    renderWithProviders(<SyntheticsBody slug="shop" />);
    expect(await screen.findByText('288 runs')).toBeInTheDocument();
    expect(screen.getByText('99.90%')).toBeInTheDocument();
    expect(screen.getByText('840 ms')).toBeInTheDocument();
    const runs = screen.getByRole('region', { name: 'Recent runs' });
    expect(within(runs).getByText('Failed: unexpected status')).toBeInTheDocument();
    expect(within(runs).getByText('503')).toBeInTheDocument();
    const alerts = screen.getByRole('region', { name: 'Alerts on this check' });
    expect(await within(alerts).findByText('health failing')).toBeInTheDocument();
    expect(within(alerts).queryByText('other')).toBeNull();
  });

  it('says there was no successful run rather than a p95 of zero', async () => {
    api({
      'GET /v1/apps/{slug}/synthetics': () => [health],
      'GET /v1/apps/{slug}/synthetics/{id}': () => ({
        ...health,
        results: results({ p95_latency_ms_24h: 0, uptime_24h_pct: 0 }),
      }),
    });
    renderWithProviders(<SyntheticsBody slug="shop" />);
    expect(await screen.findByText('No successful run in 24 hours')).toBeInTheDocument();
  });

  it('opens the alert form pointed at this check with two failures in a row', async () => {
    api();
    renderWithProviders(<SyntheticsBody slug="shop" />);
    const alerts = await screen.findByRole('region', { name: 'Alerts on this check' });
    await userEvent.click(within(alerts).getByRole('button', { name: 'Add an alert' }));
    expect(within(alerts).getByRole('combobox', { name: 'Metric' })).toHaveValue(
      'synthetic_check_consecutive_failures'
    );
    expect(await within(alerts).findByRole('combobox', { name: 'Synthetic check' })).toHaveValue(
      HEALTH
    );
    expect(within(alerts).getByRole('spinbutton', { name: 'Threshold' })).toHaveValue(2);
  });

  it('pauses and resumes', async () => {
    api();
    renderWithProviders(<SyntheticsBody slug="shop" />);
    await screen.findByText('288 runs');
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(patched).toEqual([{ id: HEALTH, enabled: false }]));
    await userEvent.click(screen.getByRole('button', { name: /home/ }));
    expect(await screen.findByText(/Paused: the check does not run/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(patched).toContainEqual({ id: HOME, enabled: true }));
  });

  it('deletes after confirming that its history and rules go with it', async () => {
    api();
    renderWithProviders(<SyntheticsBody slug="shop" />);
    await screen.findByText('288 runs');
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText(/run history goes with it/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Delete check' }));
    await waitFor(() => expect(deleted).toEqual([HEALTH]));
  });

  it('says a probe is billed traffic that can keep the app warm, where checks are created', async () => {
    api();
    renderWithProviders(<SyntheticsBody slug="shop" />);
    const note = await screen.findByRole('note', { name: 'Probes are billed traffic' });
    expect(note).toHaveTextContent('A probe is an ordinary request and is billed like one.');
    expect(note).toHaveTextContent('keeps the app warm continuously');
    expect(within(note).getByRole('link', { name: 'What checks cost' })).toHaveAttribute(
      'href',
      '/docs/synthetic-checks'
    );
  });

  it('creates a check with only the fields given', async () => {
    api();
    renderWithProviders(<SyntheticsBody slug="shop" />);
    const form = screen.getByRole('button', { name: 'Create check' }).closest('form')!;
    await userEvent.type(within(form).getByRole('textbox', { name: 'Name' }), 'api');
    const path = within(form).getByRole('textbox', { name: 'Path' });
    await userEvent.clear(path);
    await userEvent.type(path, '/api/ping?deep=1');
    await userEvent.selectOptions(within(form).getByRole('combobox', { name: 'Interval' }), '3600');
    await userEvent.click(within(form).getByRole('button', { name: 'Create check' }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toEqual({
      name: 'api',
      method: 'GET',
      path: '/api/ping?deep=1',
      timeout_ms: 10000,
      interval_seconds: 3600,
    });

    await userEvent.type(within(form).getByRole('textbox', { name: 'Name' }), 'home2');
    await userEvent.selectOptions(within(form).getByRole('combobox', { name: 'Method' }), 'HEAD');
    await userEvent.type(within(form).getByRole('spinbutton', { name: 'Expected status' }), '301');
    await userEvent.click(within(form).getByRole('button', { name: 'Create check' }));
    await waitFor(() => expect(created).toHaveLength(2));
    expect(created[1]).toMatchObject({ method: 'HEAD', expected_status: 301 });
  });

  it('catches a bad path, status or timeout before sending', async () => {
    api();
    renderWithProviders(<SyntheticsBody slug="shop" />);
    const form = screen.getByRole('button', { name: 'Create check' }).closest('form')!;
    await userEvent.type(within(form).getByRole('textbox', { name: 'Name' }), 'x');
    const path = within(form).getByRole('textbox', { name: 'Path' });
    await userEvent.clear(path);
    await userEvent.type(path, '//evil.example');
    await userEvent.type(within(form).getByRole('spinbutton', { name: 'Expected status' }), '99');
    const timeout = within(form).getByRole('spinbutton', { name: 'Timeout (ms)' });
    await userEvent.clear(timeout);
    await userEvent.type(timeout, '500');
    await userEvent.click(within(form).getByRole('button', { name: 'Create check' }));
    expect(await within(form).findByText(/Start with a single \//)).toBeInTheDocument();
    expect(within(form).getByText(/from 100 to 599/)).toBeInTheDocument();
    expect(within(form).getByText(/from 1,000 to 30,000/)).toBeInTheDocument();
    expect(created).toEqual([]);
  });

  it('explains the cap and a taken name from their codes, and turns off at five', async () => {
    api({
      'POST /v1/apps/{slug}/synthetics': () => problem(422, 'synthetic_check_limit_reached', 'cap'),
    });
    renderWithProviders(<SyntheticsBody slug="shop" />);
    const form = screen.getByRole('button', { name: 'Create check' }).closest('form')!;
    await userEvent.type(within(form).getByRole('textbox', { name: 'Name' }), 'more');
    await userEvent.click(within(form).getByRole('button', { name: 'Create check' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent(
      'This app already has 5 checks. Delete one to add another.'
    );
    const taken = new ApiError({
      status: 409,
      code: 'synthetic_check_invalid',
      title: 'x',
      detail: 'x',
    });
    expect(explainCheckError(taken)).toBe('This app already has a check with that name.');
  });

  it('turns the form off at the 5-check cap', async () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ ...health, id: `c-${i}`, name: `c${i}` }));
    api({ 'GET /v1/apps/{slug}/synthetics': () => five });
    renderWithProviders(<SyntheticsBody slug="shop" />);
    await screen.findByText(/5 of 5 defined/);
    expect(screen.getByRole('button', { name: 'Create check' })).toBeDisabled();
  });

  it('shows the plan gate when the plan has no per-app observability', async () => {
    api({
      'GET /v1/apps/{slug}/synthetics': () =>
        problem(402, 'plan_per_app_metrics_not_allowed', 'the free plan does not include it'),
    });
    renderWithProviders(<SyntheticsBody slug="shop" />);
    expect(
      await screen.findByText('Synthetic checks is available on Hobby and above')
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create check' })).toBeNull();
  });

  it('says so when the app has none', async () => {
    api({ 'GET /v1/apps/{slug}/synthetics': () => [] });
    renderWithProviders(<SyntheticsBody slug="shop" />);
    expect(
      await screen.findByText('shop has no synthetic checks yet. Create one below.')
    ).toBeInTheDocument();
  });

  it('reads nothing behind the gate while the preview is off or outside the plan', () => {
    access.off.add('synthetic-checks');
    const spies = api();
    const { unmount } = renderWithProviders(
      <CapabilityGate capability="synthetic-checks" title="Synthetic checks">
        <SyntheticsBody slug="shop" />
      </CapabilityGate>
    );
    expect(screen.getByText('Not enabled for this account')).toBeInTheDocument();
    unmount();
    access.off.clear();
    access.plan.add('synthetic-checks');
    renderWithProviders(
      <CapabilityGate capability="synthetic-checks" title="Synthetic checks">
        <SyntheticsBody slug="shop" />
      </CapabilityGate>
    );
    expect(screen.getByText('Not included in your plan')).toBeInTheDocument();
    expect(spies.GET).not.toHaveBeenCalled();
  });

  it('does not read alert rules while alerts are off', async () => {
    access.off.add('alerts');
    const spies = api();
    renderWithProviders(<SyntheticsBody slug="shop" />);
    expect(await screen.findByText('Not enabled for this account')).toBeInTheDocument();
    expect(spies.GET).not.toHaveBeenCalledWith('/v1/apps/{slug}/alerts', expect.anything());
  });
});

describe('synthetic check figures', () => {
  it('words runs and check states from what the check did', () => {
    expect(runLabel({ started_at: '', ok: true, latency_ms: 1 })).toBe('OK');
    expect(runLabel({ started_at: '', ok: false, latency_ms: 1, error_class: 'tls' })).toBe(
      'Failed: TLS failed'
    );
    expect(checkState({ enabled: false }, results() as never).label).toBe('Paused');
    expect(checkState({ enabled: true }, results({ recent: [] }) as never).label).toBe(
      'No runs yet'
    );
  });

  it('checks the create fields as apid does', () => {
    const ok = { name: 'health', path: '/healthz', expected: '', timeout: '10000' };
    expect(Object.values(checkFormErrors(ok)).filter(Boolean)).toEqual([]);
    expect(checkFormErrors({ ...ok, path: '/' }).path).toBeUndefined();
    expect(checkFormErrors({ ...ok, path: 'healthz' }).path).toBeDefined();
    expect(checkFormErrors({ ...ok, path: '/a b' }).path).toBeDefined();
    expect(checkFormErrors({ ...ok, path: '/a\\b' }).path).toBeDefined();
    expect(checkFormErrors({ ...ok, expected: '600' }).expected).toBeDefined();
    expect(checkFormErrors({ ...ok, timeout: '30001' }).timeout).toBeDefined();
  });
});
