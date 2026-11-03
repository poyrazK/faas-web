import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, routeApi, type Handlers } from '@/test/monetization';

const registry = vi.hoisted(() => ({ hidden: [] as string[] }));
vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityRegistry: () => ({
    query: {
      data: {
        registry_version: 1,
        plan: 'pro',
        capabilities: [],
        hidden_capabilities: registry.hidden,
      },
    },
    phase: 'ready',
  }),
}));

const { AlertRuleForm } = await import('./alert-rule-form');

const CHANNEL = {
  id: '6a1f5b2e-0c1d-4e2f-8a9b-0c1d2e3f4a5b',
  name: 'ops-slack',
  kind: 'slack',
  target: 'T04/B07',
  created_at: '2026-10-01T00:00:00Z',
};
const SLO = {
  id: '9d4a8e5f-3f4a-4b5c-8d6e-3f4a5b6c7d8e',
  name: 'checkout',
  sli: 'availability',
  objective_pct: 99.9,
  window_days: 30,
  created_at: '2026-10-01T00:00:00Z',
};
const CHECK = {
  id: '8c3e7d4f-2e3f-4a4b-9c5d-2e3f4a5b6c7d',
  name: 'health',
  method: 'GET',
  path: '/healthz',
  url: 'https://api.gregale.app/healthz',
  timeout_ms: 10000,
  interval_seconds: 300,
  enabled: true,
  created_at: '2026-10-01T00:00:00Z',
};

let created: unknown[];
function api(extra: Handlers = {}) {
  return routeApi({
    'GET /v1/notification-channels': () => [CHANNEL],
    'GET /v1/apps/{slug}/slos': () => [SLO],
    'GET /v1/apps/{slug}/synthetics': () => [CHECK],
    'POST /v1/apps/{slug}/alerts': ({ body }) => {
      created.push(body);
      return { id: 'r1', name: (body as { name: string }).name };
    },
    ...extra,
  });
}
const metricSelect = () => screen.getByRole('combobox', { name: 'Metric' });
const metricOptions = () =>
  within(metricSelect())
    .getAllByRole('option')
    .map((o) => (o as HTMLOptionElement).value);

beforeEach(() => {
  registry.hidden = [];
  created = [];
});
afterEach(() => vi.restoreAllMocks());

describe('AlertRuleForm', () => {
  it('creates a channel-only rule without a webhook', async () => {
    api();
    renderWithProviders(<AlertRuleForm slug="api" />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'Checkout errors');
    await userEvent.click(await screen.findByRole('checkbox', { name: /ops-slack/ }));
    expect(screen.getByText(/Webhook URL \(optional\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toEqual({
      name: 'Checkout errors',
      metric: 'error_rate_pct',
      comparison: 'gt',
      threshold: 5,
      window_spec: '15m',
      cooldown_minutes: 30,
      action: 'webhook',
      channel_ids: [CHANNEL.id],
    });
  });

  it('asks for a channel or a webhook before it will create', async () => {
    api();
    renderWithProviders(<AlertRuleForm slug="api" />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'Nowhere');
    await userEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    const url = screen.getByRole('textbox', { name: /Webhook URL/ });
    expect(url).toHaveFocus();
    expect(url).toHaveAccessibleDescription('Choose a channel or enter a webhook URL.');
    expect(created).toHaveLength(0);
  });

  it('sends a webhook secret and resolves only alongside a webhook URL', async () => {
    api();
    renderWithProviders(<AlertRuleForm slug="api" />);
    expect(screen.queryByLabelText('Webhook secret')).toBeNull();
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'Hooked');
    await userEvent.type(
      screen.getByRole('textbox', { name: /Webhook URL/ }),
      'https://hooks.example.com/a'
    );
    await userEvent.type(screen.getByLabelText('Webhook secret'), 'shh');
    await userEvent.click(screen.getByRole('checkbox', { name: /alert.resolved/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({
      webhook_url: 'https://hooks.example.com/a',
      webhook_secret: 'shh',
      notify_resolved: true,
    });
    expect(created[0]).not.toHaveProperty('channel_ids');
    await waitFor(() => expect(screen.queryByLabelText('Webhook secret')).toBeNull());
  });

  it('names one of the app’s SLOs for an SLO metric and drops the window', async () => {
    api();
    renderWithProviders(<AlertRuleForm slug="api" />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'Budget');
    await userEvent.selectOptions(metricSelect(), 'slo_budget_burn');
    expect(await screen.findByRole('combobox', { name: 'SLO' })).toHaveValue(SLO.id);
    expect(screen.queryByRole('combobox', { name: 'Window' })).toBeNull();
    await userEvent.click(await screen.findByRole('checkbox', { name: /ops-slack/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({ metric: 'slo_budget_burn', slo_id: SLO.id });
  });

  it('starts from a draft naming one SLO or check, as the SLO and check pages open it', async () => {
    const other = { ...SLO, id: '7b2c6d3e-1d2e-4f3a-8b4c-1d2e3f4a5b6c', name: 'latency' };
    api({ 'GET /v1/apps/{slug}/slos': () => [SLO, other] });
    renderWithProviders(
      <AlertRuleForm
        slug="api"
        initial={{
          metric: 'slo_budget_burn',
          comparison: 'gt',
          threshold: '14.4',
          sloId: other.id,
        }}
      />
    );
    expect(metricSelect()).toHaveValue('slo_budget_burn');
    expect(await screen.findByRole('combobox', { name: 'SLO' })).toHaveValue(other.id);
    expect(screen.getByRole('spinbutton', { name: 'Threshold' })).toHaveValue(14.4);
  });

  it('names a synthetic check and hands out the CLI when the app has none', async () => {
    api({ 'GET /v1/apps/{slug}/synthetics': () => [] });
    renderWithProviders(<AlertRuleForm slug="api" />);
    await userEvent.selectOptions(metricSelect(), 'synthetic_check_latency_p95_ms');
    expect(await screen.findByText('This app has no synthetic checks yet.')).toBeInTheDocument();
    expect(
      screen.getByText(/gregale alert check create --app api --name <name> --path \/healthz/)
    ).toBeInTheDocument();
  });

  it('does not offer SLO or synthetic check metrics while those previews are off', () => {
    registry.hidden = ['custom-slos', 'synthetic-checks'];
    const spies = api();
    renderWithProviders(<AlertRuleForm slug="api" />);
    const values = metricOptions();
    expect(values).toContain('error_rate_pct');
    expect(values).not.toContain('slo_budget_burn');
    expect(values).not.toContain('slo_budget_remaining_pct');
    expect(values).not.toContain('synthetic_check_consecutive_failures');
    expect(values).not.toContain('synthetic_check_latency_p95_ms');
    expect(spies.GET).not.toHaveBeenCalledWith('/v1/apps/{slug}/slos', expect.anything());
  });

  it('counts log search matches for a query', async () => {
    api();
    renderWithProviders(<AlertRuleForm slug="api" />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'DB errors');
    await userEvent.selectOptions(metricSelect(), 'log_search_matches');
    const windows = within(screen.getByRole('combobox', { name: 'Window' }))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(windows).not.toContain('7d');
    await userEvent.click(await screen.findByRole('checkbox', { name: /ops-slack/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    expect(screen.getByRole('textbox', { name: 'Log query' })).toHaveFocus();
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Log query' }),
      'source=runtime&level=error'
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({
      metric: 'log_search_matches',
      log_query: 'source=runtime&level=error',
    });
  });

  it('offers baseline comparisons only with anomaly alerts on, with the multiplier range', async () => {
    registry.hidden = ['anomaly-alerts'];
    api();
    const { unmount } = renderWithProviders(<AlertRuleForm slug="api" />);
    const comparisons = () =>
      within(screen.getByRole('combobox', { name: 'Is' }))
        .getAllByRole('option')
        .map((o) => (o as HTMLOptionElement).value);
    expect(comparisons()).not.toContain('above_baseline');
    unmount();

    registry.hidden = [];
    renderWithProviders(<AlertRuleForm slug="api" />);
    expect(comparisons()).toContain('above_baseline');
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'Unusual');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Is' }), 'above_baseline');
    await userEvent.click(await screen.findByRole('checkbox', { name: /ops-slack/ }));
    await userEvent.clear(screen.getByRole('spinbutton', { name: 'Multiplier' }));
    await userEvent.type(screen.getByRole('spinbutton', { name: 'Multiplier' }), '50');
    await userEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    expect(created).toHaveLength(0);
    expect(screen.getByRole('spinbutton', { name: 'Multiplier' })).toHaveAccessibleDescription(
      'Enter a multiplier from 1.5 to 20.'
    );
    await userEvent.clear(screen.getByRole('spinbutton', { name: 'Multiplier' }));
    await userEvent.type(screen.getByRole('spinbutton', { name: 'Multiplier' }), '3');
    await userEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({ comparison: 'above_baseline', threshold: 3 });
  });

  it('includes the failure source for failed invocations', async () => {
    api();
    renderWithProviders(<AlertRuleForm slug="api" />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'Failures');
    await userEvent.selectOptions(metricSelect(), 'failed_invocations');
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Failure source' }),
      'inbound_webhook'
    );
    await userEvent.click(await screen.findByRole('checkbox', { name: /ops-slack/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({ failure_source: 'inbound_webhook' });
  });
});
