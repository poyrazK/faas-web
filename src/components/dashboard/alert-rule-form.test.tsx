import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, routeApi, type Handlers } from '@/test/monetization';
import { withRouter } from '@/test/router';

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
    await userEvent.click(screen.getByRole('checkbox', { name: /when the issue is resolved/ }));
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
    expect(windows).not.toContain('7 days');
    expect(windows).toContain('15 minutes');
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

  it('creates an observe-only anomaly rule without a delivery destination', async () => {
    api();
    renderWithProviders(
      <AlertRuleForm
        slug="api"
        initial={{ metric: 'request_count', comparison: 'above_baseline', threshold: '3' }}
      />
    );
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'Observed traffic');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /mode/i }), 'observe_only');
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Healthy checks to recover' }),
      '2'
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({
      observe_only: true,
      comparison: 'above_baseline',
      recovery_confirmation_checks: 2,
    });
    expect(created[0]).not.toHaveProperty('channel_ids');
    expect(created[0]).not.toHaveProperty('webhook_url');
  });

  it('saves a replay environment as an observe-only rule', async () => {
    api({
      'GET /v1/apps/{slug}/alerts/anomaly-preview': () => ({
        first_check_at: '2026-10-27T10:00:00Z',
        last_check_at: '2026-11-03T09:00:00Z',
        step_seconds: 3600,
        evaluated: 168,
        skipped: 0,
        skipped_windows: [],
        breaches: [],
        environment_scopes: ['default', 'production', 'staging'],
      }),
    });
    renderWithProviders(
      <AlertRuleForm
        slug="api"
        initial={{ metric: 'error_rate_pct', comparison: 'above_baseline', threshold: '3' }}
      />
    );
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'Staging error rate');
    await userEvent.click(screen.getByRole('button', { name: 'Test on recent traffic' }));
    await userEvent.selectOptions(
      await screen.findByRole('combobox', { name: 'Replay environment' }),
      'staging'
    );
    await userEvent.click(screen.getByRole('button', { name: 'Use environment for Observe only' }));
    expect(screen.getByText('Observing staging')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /mode/i })).toHaveValue('observe_only');
    await userEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    await waitFor(() =>
      expect(created).toEqual([
        expect.objectContaining({ environment_scope: 'staging', observe_only: true }),
      ])
    );
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

  it('compares request-count multipliers on demand and clears the results when the draft changes', async () => {
    const path = '/v1/apps/{slug}/alerts/anomaly-preview';
    const spies = api({
      [`GET ${path}`]: () => ({
        first_check_at: '2026-10-27T10:00:00Z',
        last_check_at: '2026-11-03T09:00:00Z',
        step_seconds: 3600,
        evaluated: 165,
        skipped: 3,
        skipped_windows: [
          { evaluated_at: '2026-11-02T06:00:00Z', reason: 'insufficient_history' },
          { evaluated_at: '2026-11-02T07:00:00Z', reason: 'telemetry_missing_or_stale' },
          { evaluated_at: '2026-11-02T08:00:00Z', reason: 'insufficient_history' },
        ],
        breaches: [
          { evaluated_at: '2026-11-03T08:00:00Z', observed: 0, baseline: 100, trigger_value: 25 },
        ],
        candidate: {
          threshold: 0.5,
          breaches: [
            {
              evaluated_at: '2026-11-03T07:00:00Z',
              observed: 40,
              baseline: 100,
              trigger_value: 50,
            },
            { evaluated_at: '2026-11-03T08:00:00Z', observed: 0, baseline: 100, trigger_value: 50 },
          ],
        },
      }),
    });
    renderWithProviders(
      <AlertRuleForm
        slug="api"
        initial={{ metric: 'request_count', comparison: 'below_baseline', threshold: '0.25' }}
      />
    );
    expect(spies.GET).not.toHaveBeenCalledWith(path, expect.anything());
    const candidate = screen.getByRole('textbox', { name: /candidate multiplier/i });
    const replay = screen.getByRole('button', { name: 'Test on recent traffic' });
    await userEvent.type(candidate, '0.95');
    expect(replay).toBeDisabled();
    expect(screen.getByText('Enter a multiplier between 0.05 and 0.67.')).toBeInTheDocument();
    await userEvent.clear(candidate);
    await userEvent.type(candidate, '0.5{Enter}');
    const result = within(screen.getByRole('region', { name: 'Recent traffic preview' }));
    const breaches = within(await result.findByRole('table', { name: 'Threshold breaches' }));
    expect(breaches.getByRole('cell', { name: '0' })).toBeInTheDocument();
    expect(breaches.getByRole('cell', { name: '25 or lower' })).toBeInTheDocument();
    expect(breaches.getByRole('columnheader', { name: 'Candidate trigger' })).toBeInTheDocument();
    expect(breaches.getByRole('cell', { name: 'No breach' })).toBeInTheDocument();
    expect(breaches.getAllByRole('cell', { name: '50 or lower' })).toHaveLength(2);
    expect(result.getByText('165 of 168')).toBeInTheDocument();
    await userEvent.click(
      result.getByText(/3 skipped \(1 with missing or stale request data, 2 with insufficient/)
    );
    const skips = within(result.getByRole('table', { name: 'Skipped windows' }));
    expect(skips.getByRole('cell', { name: 'Missing or stale request data' })).toBeInTheDocument();
    expect(skips.getAllByRole('cell', { name: 'Insufficient baseline history' })).toHaveLength(2);
    expect(spies.GET).toHaveBeenCalledWith(
      path,
      expect.objectContaining({
        params: {
          path: { slug: 'api' },
          query: {
            comparison: 'below_baseline',
            threshold: 0.25,
            window_spec: '15m',
            candidate_threshold: 0.5,
          },
        },
      })
    );
    const multiplier = screen.getByRole('spinbutton', { name: 'Multiplier' });
    await userEvent.clear(multiplier);
    await userEvent.type(multiplier, '0.5');
    expect(screen.queryByRole('table', { name: 'Threshold breaches' })).not.toBeInTheDocument();
    expect(spies.GET.mock.calls.filter(([url]) => url === path)).toHaveLength(1);
    expect(created).toHaveLength(0);
  });

  it('replays a selected two-hour window with the draft cooldown and both multipliers', async () => {
    const path = '/v1/apps/{slug}/alerts/anomaly-preview';
    const startInput = '2026-11-01T13:12';
    const start = new Date(startInput).getTime();
    const at = (minute: number) => new Date(start + minute * 60_000).toISOString();
    const spies = api({
      [`GET ${path}`]: ({ params }) =>
        params?.query?.incident_replay_start
          ? {
              first_check_at: at(0),
              last_check_at: at(119),
              step_seconds: 60,
              evaluated: 119,
              skipped: 1,
              skipped_windows: [{ evaluated_at: at(18), reason: 'telemetry_missing_or_stale' }],
              breaches: [],
              candidate: { threshold: 0.5, breaches: [] },
              incident_replay: {
                cooldown_minutes: 5,
                incidents: [
                  {
                    opened_at: at(13),
                    ended_at: at(21),
                    outcome: 'recovered',
                    eligible_notifications: 2,
                    last_eligible_at: at(19),
                  },
                ],
                candidate_incidents: [
                  { opened_at: at(0), eligible_notifications: 1, last_eligible_at: at(0) },
                ],
              },
            }
          : {
              first_check_at: '2026-10-27T10:00:00Z',
              last_check_at: '2026-11-03T09:00:00Z',
              step_seconds: 3600,
              evaluated: 168,
              skipped: 0,
              skipped_windows: [],
              breaches: [],
              candidate: { threshold: 0.5, breaches: [] },
            },
    });
    renderWithProviders(
      <AlertRuleForm
        slug="api"
        initial={{ metric: 'request_count', comparison: 'below_baseline', threshold: '0.25' }}
      />
    );
    await userEvent.click(screen.getByText('Advanced settings'));
    const cooldown = screen.getByRole('spinbutton', { name: /Minutes between repeat alerts/ });
    await userEvent.clear(cooldown);
    await userEvent.type(cooldown, '5');
    await userEvent.type(screen.getByRole('textbox', { name: /candidate multiplier/i }), '0.5');
    await userEvent.click(screen.getByRole('button', { name: 'Test on recent traffic' }));
    const detail = within(await screen.findByRole('region', { name: 'Two-hour incident replay' }));
    const input = detail.getByLabelText('Replay start (local time)');
    const replay = detail.getByRole('button', { name: 'Replay two hours' });
    fireEvent.change(input, { target: { value: '2026-11-04T13:12' } });
    expect(replay).toBeDisabled();
    fireEvent.change(input, { target: { value: startInput } });
    expect(spies.GET.mock.calls.filter(([url]) => url === path)).toHaveLength(1);
    await userEvent.click(replay);

    const results = within(await detail.findByRole('region', { name: 'Incident replay results' }));
    const selected = within(results.getByRole('region', { name: 'Selected incidents' }));
    expect(selected.getByText(/Recovered/)).toBeInTheDocument();
    expect(selected.getByText('2 eligible notifications')).toBeInTheDocument();
    const candidate = within(results.getByRole('region', { name: 'Candidate incidents' }));
    expect(candidate.getByText(/Breaching at start/)).toBeInTheDocument();
    expect(candidate.getByText('Open at the end of this replay')).toBeInTheDocument();
    expect(results.getByText(/119 of 120 minute checks evaluated/)).toBeInTheDocument();
    expect(spies.GET).toHaveBeenCalledWith(
      path,
      expect.objectContaining({
        params: {
          path: { slug: 'api' },
          query: {
            comparison: 'below_baseline',
            threshold: 0.25,
            candidate_threshold: 0.5,
            window_spec: '15m',
            incident_replay_start: at(0),
            cooldown_minutes: 5,
          },
        },
      })
    );
    await userEvent.clear(cooldown);
    expect(replay).toBeDisabled();
    expect(
      detail.queryByRole('region', { name: 'Incident replay results' })
    ).not.toBeInTheDocument();
    expect(created).toHaveLength(0);
  });

  it('compares the daily and same-weekday baselines using the same multiplier and cooldown', async () => {
    const path = '/v1/apps/{slug}/alerts/anomaly-preview';
    const fallbackAt = '2026-11-02T07:00:00Z';
    const replayStart = '2026-11-03T07:00:00Z';
    const outageAt = '2026-11-03T07:25:00Z';
    const dailyBreach = {
      evaluated_at: fallbackAt,
      observed: 60,
      baseline: 240,
      trigger_value: 120,
    };
    const weekdayCoverage = {
      evaluated: 168,
      skipped_windows: [],
      fallback_at: [fallbackAt],
    };
    const spies = api({
      [`GET ${path}`]: ({ params }) =>
        params?.query?.incident_replay_start
          ? {
              first_check_at: replayStart,
              last_check_at: '2026-11-03T08:59:00Z',
              step_seconds: 60,
              evaluated: 120,
              skipped: 0,
              skipped_windows: [],
              breaches: [{ ...dailyBreach, evaluated_at: replayStart }],
              candidate: {
                threshold: 0.5,
                breaches: [
                  { evaluated_at: outageAt, observed: 0, baseline: 60, trigger_value: 30 },
                ],
                weekday_baseline: { ...weekdayCoverage, evaluated: 120, fallback_at: [] },
              },
              incident_replay: {
                cooldown_minutes: 30,
                incidents: [
                  {
                    opened_at: replayStart,
                    eligible_notifications: 3,
                    last_eligible_at: '2026-11-03T08:00:00Z',
                  },
                ],
                candidate_incidents: [
                  { opened_at: outageAt, eligible_notifications: 1, last_eligible_at: outageAt },
                ],
              },
            }
          : {
              first_check_at: '2026-10-27T10:00:00Z',
              last_check_at: '2026-11-03T09:00:00Z',
              step_seconds: 3600,
              evaluated: 168,
              skipped: 0,
              skipped_windows: [],
              breaches: [dailyBreach],
              candidate: {
                threshold: 0.5,
                breaches: [dailyBreach],
                weekday_baseline: weekdayCoverage,
              },
            },
    });
    renderWithProviders(
      <AlertRuleForm
        slug="api"
        initial={{ metric: 'request_count', comparison: 'below_baseline', threshold: '0.5' }}
      />
    );
    const check = screen.getByRole('checkbox', { name: 'Compare same-weekday baseline' });
    const candidate = screen.getByRole('textbox', { name: /candidate multiplier/i });
    await userEvent.type(candidate, '0.9');
    await userEvent.click(check);
    expect(candidate).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Test on recent traffic' }));
    const controls = await screen.findByRole('region', { name: 'Two-hour incident replay' });
    const coverage = within(screen.getByRole('region', { name: 'Same-weekday baseline coverage' }));
    await userEvent.click(coverage.getByText('Seven-day fallback at 1 check'));
    expect(
      coverage.getByRole('list', { name: 'Seven-day fallback check times' }).querySelector('time')
    ).toHaveAttribute('datetime', fallbackAt.replace('Z', '.000Z'));
    const table = within(screen.getByRole('table', { name: 'Threshold breaches' }));
    expect(table.getByRole('columnheader', { name: 'Same-weekday trigger' })).toBeInTheDocument();

    await userEvent.click(within(controls).getByRole('button', { name: 'Replay two hours' }));
    const details = within(await screen.findByRole('region', { name: 'Incident replay results' }));
    expect(
      within(details.getByRole('region', { name: 'Seven-day incidents' })).getByText(
        '3 eligible notifications'
      )
    ).toBeInTheDocument();
    expect(
      within(details.getByRole('region', { name: 'Same-weekday incidents' })).getByText(
        '1 eligible notification'
      )
    ).toBeInTheDocument();
    const queries = spies.GET.mock.calls.filter(([url]) => url === path);
    const comparison = {
      comparison: 'below_baseline',
      threshold: 0.5,
      window_spec: '15m',
      candidate_baseline: 'same_weekday',
    };
    expect(queries).toHaveLength(2);
    expect(queries[0][1]).toMatchObject({ params: { query: comparison } });
    expect(queries[1][1]).toMatchObject({
      params: {
        query: { ...comparison, incident_replay_start: expect.any(String), cooldown_minutes: 30 },
      },
    });
    expect(queries[0][1]).not.toHaveProperty('params.query.candidate_threshold');

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Window' }), '1h');
    expect(screen.queryByRole('checkbox', { name: 'Compare same-weekday baseline' })).toBeNull();
    expect(candidate).toBeEnabled();
    expect(created).toHaveLength(0);
  });

  it('compares one- and two-check recovery using the same replay window and cooldown', async () => {
    const path = '/v1/apps/{slug}/alerts/anomaly-preview';
    const start = Date.parse('2026-11-03T07:00:00Z');
    const at = (minute: number) => new Date(start + minute * 60_000).toISOString();
    const incident = (open: number, recover: number) => ({
      opened_at: at(open),
      ended_at: at(recover),
      outcome: 'recovered',
      eligible_notifications: 1,
      last_eligible_at: at(open),
    });
    const spies = api({
      [`GET ${path}`]: ({ params }) =>
        params?.query?.incident_replay_start
          ? {
              first_check_at: at(0),
              last_check_at: at(119),
              step_seconds: 60,
              evaluated: 119,
              skipped: 1,
              skipped_windows: [{ evaluated_at: at(17), reason: 'telemetry_missing_or_stale' }],
              breaches: [],
              incident_replay: {
                cooldown_minutes: 30,
                incidents: [incident(15, 16), incident(13, 14)],
                ...(params?.query?.recovery_confirmation_checks === 2 && {
                  recovery_confirmation: {
                    required_healthy_checks: 2,
                    incidents: [incident(13, 19)],
                  },
                }),
              },
            }
          : {
              first_check_at: '2026-10-27T10:00:00Z',
              last_check_at: '2026-11-03T09:00:00Z',
              step_seconds: 3600,
              evaluated: 168,
              skipped: 0,
              skipped_windows: [],
              breaches: [],
            },
    });
    renderWithProviders(
      <AlertRuleForm
        slug="api"
        initial={{ metric: 'request_count', comparison: 'below_baseline', threshold: '0.25' }}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Test on recent traffic' }));
    const controls = within(
      await screen.findByRole('region', { name: 'Two-hour incident replay' })
    );
    const check = controls.getByRole('checkbox', { name: 'Compare two-check recovery' });
    const replay = controls.getByRole('button', { name: 'Replay two hours' });
    await userEvent.click(check);
    expect(spies.GET.mock.calls.filter(([url]) => url === path)).toHaveLength(1);
    await userEvent.click(replay);

    const results = within(
      await controls.findByRole('region', { name: 'Incident replay results' })
    );
    const current = within(results.getByRole('region', { name: 'One healthy check to recover' }));
    const confirmation = within(
      results.getByRole('region', { name: 'Two healthy checks to recover' })
    );
    expect(current.getByText('2 incidents · 2 eligible notifications')).toBeInTheDocument();
    expect(confirmation.getByText('1 incident · 1 eligible notification')).toBeInTheDocument();
    expect(confirmation.getByText(/Recovered/).querySelector('time')).toHaveAttribute(
      'datetime',
      at(19)
    );
    expect(spies.GET).toHaveBeenCalledWith(
      path,
      expect.objectContaining({
        params: {
          path: { slug: 'api' },
          query: {
            comparison: 'below_baseline',
            threshold: 0.25,
            window_spec: '15m',
            cooldown_minutes: 30,
            incident_replay_start: at(0),
            recovery_confirmation_checks: 2,
          },
        },
      })
    );
    await userEvent.click(check);
    expect(controls.queryByRole('region', { name: 'Two healthy checks to recover' })).toBeNull();
    expect(created).toHaveLength(0);
  });

  it.each([
    {
      metric: 'error_rate_pct',
      observed: 10,
      baseline: 1,
      eligible: 100,
      sparse: 10,
      observedLabel: 'Observed error rate',
      requestsLabel: 'Eligible requests',
      suffix: '%',
    },
    {
      metric: 'latency_p95_ms',
      observed: 400,
      baseline: 100,
      eligible: 50,
      sparse: 49,
      observedLabel: 'Observed p95 latency',
      requestsLabel: 'Successful requests',
      suffix: ' ms',
    },
  ] as const)(
    'replays $metric and distinguishes sparse traffic from missing telemetry',
    async (metricCase) => {
      const { metric, observed, baseline, eligible, sparse, observedLabel, requestsLabel, suffix } =
        metricCase;
      const trigger = baseline * 3;
      const path = '/v1/apps/{slug}/alerts/anomaly-preview';
      const start = Date.parse('2026-11-03T07:00:00Z');
      const at = (minute: number) => new Date(start + minute * 60_000).toISOString();
      const deployment = 'abcdef01-2345-6789-abcd-ef0123456789';
      const spies = api({
        [`GET ${path}`]: ({ params }) => {
          if (params?.query?.environment_scope === 'production') {
            return {
              environment_scope: 'production',
              first_check_at: at(0),
              last_check_at: at(119),
              step_seconds: 60,
              evaluated: 120,
              skipped: 0,
              skipped_windows: [],
              breaches: [],
              incident_replay: {
                cooldown_minutes: 30,
                incidents: [],
                deployment_context: {
                  scope: 'production',
                  promotions: [{ deployment_id: 'prod-release', promoted_at: at(11) }],
                },
              },
            };
          }
          return params?.query?.incident_replay_start
            ? {
                environment_scope: 'staging',
                first_check_at: at(0),
                last_check_at: at(119),
                step_seconds: 60,
                evaluated: 118,
                skipped: 2,
                skipped_windows: [
                  {
                    evaluated_at: at(14),
                    reason: 'insufficient_traffic',
                    eligible_requests: sparse,
                    required_requests: 50,
                  },
                  { evaluated_at: at(15), reason: 'telemetry_missing_or_stale' },
                ],
                breaches: [
                  {
                    evaluated_at: at(13),
                    observed,
                    baseline,
                    trigger_value: trigger,
                    eligible_requests: eligible,
                  },
                ],
                incident_replay: {
                  cooldown_minutes: 30,
                  deployment_context: {
                    scope: 'staging',
                    promotions: [
                      { deployment_id: 'later-release', promoted_at: at(14) },
                      {
                        deployment_id: deployment,
                        commit_sha: 'fedcba9876543210',
                        promoted_at: at(10),
                      },
                      { deployment_id: 'prior-release', promoted_at: at(-10) },
                    ],
                  },
                  incidents: [
                    {
                      opened_at: at(13),
                      ended_at: at(16),
                      outcome: 'recovered',
                      eligible_notifications: 1,
                      last_eligible_at: at(13),
                    },
                  ],
                },
              }
            : {
                environment_scopes: ['default', 'production', 'staging'],
                first_check_at: '2026-10-27T10:00:00Z',
                last_check_at: '2026-11-03T09:00:00Z',
                step_seconds: 3600,
                evaluated: 168,
                skipped: 0,
                skipped_windows: [],
                breaches: [],
              };
        },
      });
      renderWithProviders(
        withRouter(
          <AlertRuleForm
            slug="api"
            initial={{ metric, comparison: 'above_baseline', threshold: '3' }}
          />
        )
      );
      const previewButton = await screen.findByRole('button', { name: 'Test on recent traffic' });
      expect(screen.queryByRole('checkbox', { name: 'Compare same-weekday baseline' })).toBeNull();
      if (metric === 'latency_p95_ms') {
        expect(
          screen.queryByRole('checkbox', { name: 'Compare zero-baseline fallback' })
        ).toBeNull();
      }
      await userEvent.click(previewButton);
      const controls = within(
        await screen.findByRole('region', { name: 'Two-hour incident replay' })
      );
      const environment = controls.getByRole('combobox', { name: 'Replay environment' });
      await userEvent.selectOptions(environment, 'staging');
      await userEvent.click(controls.getByRole('button', { name: 'Replay two hours' }));

      const replay = within(
        await controls.findByRole('region', { name: 'Incident replay results' })
      );
      const promotions = within(replay.getByRole('region', { name: 'Deployment promotions' }));
      expect(promotions.getAllByRole('link')).toHaveLength(2);
      const incidents = within(replay.getByRole('region', { name: 'Selected incidents' }));
      expect(incidents.getByText('3 minutes after promotion')).toBeInTheDocument();
      expect(incidents.getAllByRole('link')).toHaveLength(1);
      expect(incidents.getByRole('link', { name: /abcdef01.*fedcba9/ })).toHaveAttribute(
        'href',
        `/dashboard/releases?deployment=${deployment}`
      );
      const breach = within(replay.getByRole('table', { name: 'Threshold breaches' }));
      expect(breach.getByRole('columnheader', { name: observedLabel })).toBeInTheDocument();
      expect(breach.getByRole('columnheader', { name: requestsLabel })).toBeInTheDocument();
      for (const value of [
        `${observed}${suffix}`,
        String(eligible),
        `${baseline}${suffix}`,
        `${trigger}${suffix} or higher`,
      ]) {
        expect(breach.getByRole('cell', { name: value })).toBeInTheDocument();
      }
      await userEvent.click(replay.getByText(/with insufficient traffic/));
      const skipped = within(replay.getByRole('table', { name: 'Skipped windows' }));
      expect(
        skipped.getByText(`${sparse} ${requestsLabel.toLowerCase()} (minimum 50)`)
      ).toBeInTheDocument();
      expect(
        skipped.getByRole('cell', { name: 'Missing or stale request data' })
      ).toBeInTheDocument();
      expect(spies.GET.mock.calls.filter(([url]) => url === path)).toHaveLength(2);
      expect(spies.GET).toHaveBeenCalledWith(
        path,
        expect.objectContaining({
          params: {
            path: { slug: 'api' },
            query: {
              metric,
              comparison: 'above_baseline',
              threshold: 3,
              window_spec: '15m',
              incident_replay_start: at(0),
              cooldown_minutes: 30,
              environment_scope: 'staging',
            },
          },
        })
      );
      await userEvent.selectOptions(environment, 'production');
      expect(controls.queryByRole('region', { name: 'Incident replay results' })).toBeNull();
      await userEvent.click(controls.getByRole('button', { name: 'Replay two hours' }));
      const production = within(
        await controls.findByRole('region', { name: 'Incident replay results' })
      );
      expect(production.getByText('No incidents in the evaluated minutes.')).toBeInTheDocument();
      expect(production.getByRole('link', { name: 'Deployment prod-rel' })).toHaveAttribute(
        'href',
        '/dashboard/releases?deployment=prod-release'
      );
      expect(production.queryByText('3 minutes after promotion')).toBeNull();
      expect(created).toHaveLength(0);
    }
  );

  it('compares a zero-baseline fallback and identifies the opening threshold for each incident', async () => {
    const path = '/v1/apps/{slug}/alerts/anomaly-preview';
    const start = Date.parse('2026-11-03T07:00:00Z');
    const at = (minute: number) => new Date(start + minute * 60_000).toISOString();
    const fallback = { minimum_error_rate_pct: 5, minimum_failed_requests: 5 };
    const incident = (minute: number) => ({
      opened_at: at(minute),
      eligible_notifications: 1,
      last_eligible_at: at(minute),
    });
    const regularBreach = {
      evaluated_at: at(31),
      observed: 3,
      baseline: 1,
      trigger_value: 3,
      eligible_requests: 100,
    };
    const spies = api({
      [`GET ${path}`]: ({ params }) =>
        params?.query?.incident_replay_start
          ? {
              first_check_at: at(0),
              last_check_at: at(119),
              step_seconds: 60,
              evaluated: 120,
              skipped: 0,
              skipped_windows: [],
              breaches: [regularBreach],
              candidate: {
                threshold: 3,
                zero_baseline_fallback: fallback,
                breaches: [
                  {
                    evaluated_at: at(13),
                    observed: 10,
                    baseline: 0,
                    trigger_value: 5,
                    eligible_requests: 100,
                    failed_requests: 10,
                    zero_baseline_fallback: true,
                  },
                  regularBreach,
                ],
              },
              incident_replay: {
                cooldown_minutes: 30,
                incidents: [incident(31)],
                candidate_incidents: [incident(31), incident(13)],
              },
            }
          : {
              first_check_at: '2026-10-27T10:00:00Z',
              last_check_at: '2026-11-03T09:00:00Z',
              step_seconds: 3600,
              evaluated: 168,
              skipped: 0,
              skipped_windows: [],
              breaches: [],
              candidate: { threshold: 3, zero_baseline_fallback: fallback, breaches: [] },
            },
    });
    renderWithProviders(
      <AlertRuleForm
        slug="api"
        initial={{ metric: 'error_rate_pct', comparison: 'above_baseline', threshold: '3' }}
      />
    );
    const candidate = screen.getByRole('textbox', { name: /candidate multiplier/i });
    await userEvent.type(candidate, '4');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Compare zero-baseline fallback' }));
    expect(candidate).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Test on recent traffic' }));
    const controls = within(
      await screen.findByRole('region', { name: 'Two-hour incident replay' })
    );
    expect(
      screen.getByText(/fallback requires at least 5% errors and 5 failed requests/)
    ).toBeInTheDocument();
    await userEvent.click(controls.getByRole('button', { name: 'Replay two hours' }));
    const replay = within(await controls.findByRole('region', { name: 'Incident replay results' }));
    const selected = within(replay.getByRole('region', { name: 'Selected incidents' }));
    expect(selected.getByText('Baseline multiplier · 3% or higher')).toBeInTheDocument();
    const comparison = within(replay.getByRole('region', { name: 'Candidate incidents' }));
    expect(comparison.getByText('Baseline multiplier · 3% or higher')).toBeInTheDocument();
    expect(
      comparison.getByText('Zero-baseline fallback · 5% or higher and at least 5 failures')
    ).toBeInTheDocument();
    expect(
      within(replay.getByRole('table', { name: 'Threshold breaches' })).getByText('10 failed')
    ).toBeInTheDocument();

    const requests = spies.GET.mock.calls.filter(([url]) => url === path);
    expect(requests).toHaveLength(2);
    for (const [, request] of requests) {
      expect(request).toMatchObject({
        params: {
          query: {
            metric: 'error_rate_pct',
            threshold: 3,
            candidate_baseline: 'zero_baseline_fallback',
          },
        },
      });
      expect(request).not.toHaveProperty('params.query.candidate_threshold');
    }
    expect(created).toHaveLength(0);
  });
});

it('reveals an invalid advanced setting before focusing it, preserving the draft', async () => {
  api();
  renderWithProviders(<AlertRuleForm slug="api" />);
  await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'Quiet overnight');
  await userEvent.click(await screen.findByRole('checkbox', { name: /ops-slack/ }));
  const toggle = screen.getByText('Advanced settings');
  const details = toggle.closest('details')!;
  expect(details.open).toBe(false);
  await userEvent.click(toggle);
  const cooldown = screen.getByRole('spinbutton', { name: /Minutes between repeat alerts/ });
  await userEvent.clear(cooldown);
  await userEvent.type(cooldown, '2');
  await userEvent.click(toggle);
  expect(details.open).toBe(false);
  await userEvent.click(screen.getByRole('button', { name: 'Add rule' }));
  expect(details.open).toBe(true);
  expect(cooldown).toHaveFocus();
  expect(cooldown).toHaveAccessibleDescription('Enter whole minutes from 5 to 1440.');
  expect(created).toHaveLength(0);
  await userEvent.clear(cooldown);
  await userEvent.type(cooldown, '60');
  await userEvent.click(screen.getByRole('button', { name: 'Add rule' }));
  await waitFor(() => expect(created).toHaveLength(1));
  expect(created[0]).toMatchObject({
    name: 'Quiet overnight',
    cooldown_minutes: 60,
    channel_ids: [CHANNEL.id],
  });
});

it('keeps the condition preview aligned with comparison and time range', async () => {
  api();
  renderWithProviders(<AlertRuleForm slug="api" />);
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Is' }), 'lte');
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Window' }), '1h');
  expect(screen.getByText('Error rate is at most 5%')).toBeInTheDocument();
  expect(screen.getByText(/1 hour evaluation window/)).toBeInTheDocument();
  await userEvent.clear(screen.getByRole('spinbutton', { name: 'Threshold' }));
  expect(screen.queryByText('Error rate is at most 0%')).not.toBeInTheDocument();
  expect(screen.getByText(/Choose a valid threshold to preview/)).toBeInTheDocument();
});
