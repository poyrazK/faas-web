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

const { SlosBody, budgetState, pendingWindow, sloFormErrors, explainSLOError } =
  await import('./slos-body');
const { CapabilityGate } = await import('./capability-gate');
const { ApiError } = await import('@/lib/api/errors');

const CHECKOUT = '9d4a8e5f-3f4a-4b5c-8d6e-3f4a5b6c7d8e';
const PAGES = '7b2c6d3e-1d2e-4f3a-8b4c-1d2e3f4a5b6c';
const checkout = {
  id: CHECKOUT,
  name: 'checkout',
  sli: 'availability',
  objective_pct: 99.9,
  window_days: 30,
  created_at: '2026-10-01T00:00:00Z',
};
const pages = {
  id: PAGES,
  name: 'fast-pages',
  sli: 'latency',
  latency_threshold_ms: 250,
  objective_pct: 99.5,
  window_days: 7,
  created_at: '2026-10-20T00:00:00Z',
};
const status = (over: Record<string, unknown> = {}) => ({
  window_start: '2026-10-04T12:00:00Z',
  hours_recorded: 720,
  hours_expected: 720,
  good: 2398800,
  total: 2400000,
  attainment_pct: 99.95,
  budget_remaining_pct: 50,
  burn_rate_1h: 0.8,
  burn_rate_6h: 1.1,
  source: 'prometheus',
  ...over,
});
const rule = {
  id: 'r-1',
  name: 'checkout burning',
  metric: 'slo_budget_burn',
  comparison: 'gt',
  threshold: 14.4,
  window_spec: '1h',
  slo_id: CHECKOUT,
  state: 'ok',
  enabled: true,
};

let created: Record<string, unknown>[];
let deleted: string[];
function api(extra: Handlers = {}) {
  return routeApi({
    'GET /v1/apps/{slug}/slos': () => [checkout, pages],
    'GET /v1/apps/{slug}/slos/{id}': ({ params }) =>
      params?.path?.id === CHECKOUT
        ? { ...checkout, status: status() }
        : { ...pages, status: status({ budget_remaining_pct: -12.5, burn_rate_1h: 3 }) },
    'POST /v1/apps/{slug}/slos': ({ body }) => {
      created.push(body as Record<string, unknown>);
      return { id: 'new-slo', created_at: '2026-11-03T12:00:00Z', ...(body as object) };
    },
    'DELETE /v1/apps/{slug}/slos/{id}': ({ params }) => {
      deleted.push(String(params?.path?.id));
      return undefined;
    },
    'GET /v1/apps/{slug}/alerts': () => [
      rule,
      { ...rule, id: 'r-2', name: 'other', slo_id: PAGES },
    ],
    'GET /v1/notification-channels': () => [],
    ...extra,
  });
}

beforeEach(() => {
  access.off.clear();
  access.plan.clear();
  created = [];
  deleted = [];
});
afterEach(() => vi.restoreAllMocks());

describe('SlosBody', () => {
  it('lists every SLO with the budget left and burn rate from its own read', async () => {
    api();
    renderWithProviders(<SlosBody slug="shop" />);
    const list = await screen.findByRole('list');
    const first = await within(list).findByRole('button', { name: /checkout/ });
    expect(first).toHaveTextContent('99.9% available over 30 days');
    await waitFor(() => expect(first).toHaveTextContent('50.000% left'));
    expect(first).toHaveTextContent('0.80× (1h)');
    expect(first).toHaveTextContent('Within budget');
    const second = within(list).getByRole('button', { name: /fast-pages/ });
    expect(second).toHaveTextContent('99.5% within 250 ms over 7 days');
    await waitFor(() => expect(second).toHaveTextContent('Objective missed'));
    expect(screen.getByText(/2 of 10 defined/)).toBeInTheDocument();
  });

  it('shows the selected SLO’s figures, history and the alert rules that name it', async () => {
    api();
    renderWithProviders(<SlosBody slug="shop" />);
    expect(await screen.findByText('2,398,800 of 2,400,000 requests')).toBeInTheDocument();
    expect(screen.getByText('99.950%')).toBeInTheDocument();
    expect(screen.getByText('1.10×')).toBeInTheDocument();
    expect(screen.getByText(/History: 720 of 720 hours since/)).toBeInTheDocument();
    const alerts = screen.getByRole('region', { name: 'Alerts on this SLO' });
    expect(await within(alerts).findByText('checkout burning')).toBeInTheDocument();
    expect(within(alerts).queryByText('other')).toBeNull();
  });

  it('opens the alert form already pointed at this SLO with the fast-burn threshold', async () => {
    api();
    renderWithProviders(<SlosBody slug="shop" />);
    const alerts = await screen.findByRole('region', { name: 'Alerts on this SLO' });
    await userEvent.click(within(alerts).getByRole('button', { name: 'Add an alert' }));
    expect(within(alerts).getByRole('combobox', { name: 'Metric' })).toHaveValue('slo_budget_burn');
    expect(await within(alerts).findByRole('combobox', { name: 'SLO' })).toHaveValue(CHECKOUT);
    expect(within(alerts).getByRole('spinbutton', { name: 'Threshold' })).toHaveValue(14.4);
  });

  it('does not read alert rules while alerts are off for the account', async () => {
    access.off.add('alerts');
    const spies = api();
    renderWithProviders(<SlosBody slug="shop" />);
    expect(await screen.findByText('Not enabled for this account')).toBeInTheDocument();
    expect(spies.GET).not.toHaveBeenCalledWith('/v1/apps/{slug}/alerts', expect.anything());
  });

  it('says the first hour is pending instead of claiming no traffic', async () => {
    api({
      'GET /v1/apps/{slug}/slos': () => [checkout],
      'GET /v1/apps/{slug}/slos/{id}': () => ({
        ...checkout,
        status: status({
          hours_recorded: 0,
          hours_expected: 0,
          good: 0,
          total: 0,
          attainment_pct: null,
          budget_remaining_pct: null,
          window_start: '2026-11-03T12:00:00Z',
        }),
      }),
    });
    renderWithProviders(<SlosBody slug="shop" />);
    expect(await screen.findByText(/The first hour closes at 13:00 UTC/)).toBeInTheDocument();
    expect(screen.getAllByText('First hour pending').length).toBeGreaterThan(0);
    expect(screen.queryByText('No traffic')).toBeNull();
  });

  it('names degraded telemetry rather than hiding it', async () => {
    api({
      'GET /v1/apps/{slug}/slos': () => [checkout],
      'GET /v1/apps/{slug}/slos/{id}': () => ({
        ...checkout,
        status: status({ source: 'degraded: burn rate unavailable', burn_rate_1h: null }),
      }),
    });
    renderWithProviders(<SlosBody slug="shop" />);
    expect(await screen.findByText('degraded: burn rate unavailable')).toBeInTheDocument();
  });

  it('defines a latency SLO with its threshold, and only availability without one', async () => {
    api();
    renderWithProviders(<SlosBody slug="shop" />);
    const form = screen.getByRole('button', { name: 'Define SLO' }).closest('form')!;
    await userEvent.type(within(form).getByRole('textbox', { name: 'Name' }), 'api-latency');
    await userEvent.selectOptions(
      within(form).getByRole('combobox', { name: 'Indicator' }),
      'latency'
    );
    await userEvent.selectOptions(within(form).getByRole('combobox', { name: 'Within' }), '500');
    const objective = within(form).getByRole('spinbutton', { name: 'Objective (%)' });
    await userEvent.clear(objective);
    await userEvent.type(objective, '99.5');
    await userEvent.selectOptions(within(form).getByRole('combobox', { name: 'Window' }), '7');
    await userEvent.click(within(form).getByRole('button', { name: 'Define SLO' }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toEqual({
      name: 'api-latency',
      sli: 'latency',
      latency_threshold_ms: 500,
      objective_pct: 99.5,
      window_days: 7,
    });

    await userEvent.type(within(form).getByRole('textbox', { name: 'Name' }), 'avail');
    await userEvent.selectOptions(
      within(form).getByRole('combobox', { name: 'Indicator' }),
      'availability'
    );
    await userEvent.click(within(form).getByRole('button', { name: 'Define SLO' }));
    await waitFor(() => expect(created).toHaveLength(2));
    expect(created[1]).not.toHaveProperty('latency_threshold_ms');
  });

  it('catches a bad name or objective before sending anything', async () => {
    api();
    renderWithProviders(<SlosBody slug="shop" />);
    const form = screen.getByRole('button', { name: 'Define SLO' }).closest('form')!;
    await userEvent.type(within(form).getByRole('textbox', { name: 'Name' }), 'Checkout');
    const objective = within(form).getByRole('spinbutton', { name: 'Objective (%)' });
    await userEvent.clear(objective);
    await userEvent.type(objective, '99.999');
    await userEvent.click(within(form).getByRole('button', { name: 'Define SLO' }));
    expect(await within(form).findByText(/Start with a lowercase letter/)).toBeInTheDocument();
    expect(within(form).getByText(/from 90 to 99.99/)).toBeInTheDocument();
    expect(created).toEqual([]);
  });

  it('explains the cap and a taken name from their codes', async () => {
    api({ 'POST /v1/apps/{slug}/slos': () => problem(422, 'slo_limit_reached', 'cap') });
    renderWithProviders(<SlosBody slug="shop" />);
    const form = screen.getByRole('button', { name: 'Define SLO' }).closest('form')!;
    await userEvent.type(within(form).getByRole('textbox', { name: 'Name' }), 'more');
    await userEvent.click(within(form).getByRole('button', { name: 'Define SLO' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent(
      'This app already has 10 SLOs. Delete one to add another.'
    );
    const taken = new ApiError({ status: 409, code: 'slo_invalid', title: 'x', detail: 'x' });
    expect(explainSLOError(taken)).toBe('This app already has an SLO with that name.');
  });

  it('turns the form off at the 10-SLO cap', async () => {
    const ten = Array.from({ length: 10 }, (_, i) => ({
      ...checkout,
      id: `id-${i}`,
      name: `s${i}`,
    }));
    api({ 'GET /v1/apps/{slug}/slos': () => ten });
    renderWithProviders(<SlosBody slug="shop" />);
    await screen.findByText(/10 of 10 defined/);
    expect(screen.getByRole('button', { name: 'Define SLO' })).toBeDisabled();
  });

  it('deletes after confirming that its alert rules go with it', async () => {
    api();
    renderWithProviders(<SlosBody slug="shop" />);
    await screen.findByText('2,398,800 of 2,400,000 requests');
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText(/every alert rule that watches it/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Delete SLO' }));
    await waitFor(() => expect(deleted).toEqual([CHECKOUT]));
  });

  it('shows the plan gate when the plan has no per-app metrics', async () => {
    api({
      'GET /v1/apps/{slug}/slos': () =>
        problem(402, 'plan_per_app_metrics_not_allowed', 'the free plan does not include it'),
    });
    renderWithProviders(<SlosBody slug="shop" />);
    expect(await screen.findByText('SLOs is available on Hobby and above')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Define SLO' })).toBeNull();
  });

  it('says so when the app has none', async () => {
    api({ 'GET /v1/apps/{slug}/slos': () => [] });
    renderWithProviders(<SlosBody slug="shop" />);
    expect(await screen.findByText('shop has no SLOs yet. Define one below.')).toBeInTheDocument();
  });

  it('reads nothing behind the gate while the preview is off or outside the plan', async () => {
    access.off.add('custom-slos');
    const spies = api();
    const { unmount } = renderWithProviders(
      <CapabilityGate capability="custom-slos" title="SLOs">
        <SlosBody slug="shop" />
      </CapabilityGate>
    );
    expect(screen.getByText('Not enabled for this account')).toBeInTheDocument();
    unmount();
    access.off.clear();
    access.plan.add('custom-slos');
    renderWithProviders(
      <CapabilityGate capability="custom-slos" title="SLOs">
        <SlosBody slug="shop" />
      </CapabilityGate>
    );
    expect(screen.getByText('Not included in your plan')).toBeInTheDocument();
    expect(spies.GET).not.toHaveBeenCalled();
  });
});

describe('SLO figures', () => {
  it('reads the budget the way docs/slos.md defines it', () => {
    expect(budgetState(status() as never)).toEqual({ tone: 'good', label: 'Within budget' });
    expect(budgetState(status({ budget_remaining_pct: 0 }) as never).label).toBe('Budget spent');
    expect(budgetState(status({ budget_remaining_pct: -1 }) as never).label).toBe(
      'Objective missed'
    );
    expect(budgetState(status({ burn_rate_1h: 2, burn_rate_6h: 1.5 }) as never).label).toBe(
      'Burning faster than budget'
    );
    expect(budgetState(status({ budget_remaining_pct: null }) as never).label).toBe('No traffic');
  });

  it('marks a window whose first hour has closed but is not recorded yet', () => {
    expect(
      pendingWindow(
        status({
          hours_recorded: 0,
          hours_expected: 1,
          window_start: '2026-11-03T09:00:00Z',
        }) as never
      )
    ).toBe('The first hour closed at 10:00 UTC and is being recorded.');
    expect(pendingWindow(status() as never)).toBeUndefined();
  });

  it('checks names and objectives as apid does', () => {
    expect(sloFormErrors('checkout', '99.9')).toEqual({ name: undefined, objective: undefined });
    expect(sloFormErrors('9lives', '99.9').name).toBeDefined();
    expect(sloFormErrors('ok', '89.99').objective).toBeDefined();
    expect(sloFormErrors('ok', '99.991').objective).toBeDefined();
    expect(sloFormErrors('ok', '99.99').objective).toBeUndefined();
  });
});
