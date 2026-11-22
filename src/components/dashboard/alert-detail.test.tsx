import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { problem, renderWithProviders, routeApi, type Handlers } from '@/test/monetization';

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

const { AlertDetail } = await import('./alert-detail');

const SLACK = {
  id: '6a1f5b2e-0c1d-4e2f-8a9b-0c1d2e3f4a5b',
  name: 'ops-slack',
  kind: 'slack',
  target: 'T04/B07',
  created_at: '2026-10-01T00:00:00Z',
};
const PAGER = {
  ...SLACK,
  id: '7b2f6c3e-1d2e-4f3a-9b0c-1d2e3f4a5b6c',
  name: 'oncall',
  kind: 'pagerduty',
};
const SLO = {
  id: '9d4a8e5f-3f4a-4b5c-8d6e-3f4a5b6c7d8e',
  name: 'checkout',
  sli: 'availability',
  objective_pct: 99.9,
  window_days: 30,
  created_at: '2026-10-01T00:00:00Z',
};
const RULE = {
  id: '0123456789abcdef0123456789abcdef',
  app_id: 'fedcba9876543210fedcba9876543210',
  name: 'Checkout budget',
  enabled: true,
  metric: 'slo_budget_burn',
  comparison: 'gt',
  threshold: 14.4,
  window_spec: '1h',
  slo_id: SLO.id,
  channel_ids: [SLACK.id],
  webhook_url: '',
  webhook_secret_sealed_masked: '***',
  cooldown_minutes: 30,
  action: 'webhook',
  state: 'firing',
  last_fired_at: '2026-11-03T09:00:00Z',
  last_evaluated_at: '2026-11-03T09:30:00Z',
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
};

let rule: Record<string, unknown>;
function api(extra: Handlers = {}) {
  return routeApi({
    'GET /v1/apps/{slug}/alerts/{id}': () => rule,
    'GET /v1/notification-channels': () => [SLACK, PAGER],
    'GET /v1/apps/{slug}/slos': () => [SLO],
    'GET /v1/apps/{slug}/alerts/{id}/deliveries': () => [],
    ...extra,
  });
}

beforeEach(() => {
  registry.hidden = [];
  rule = { ...RULE };
});
afterEach(() => vi.restoreAllMocks());

describe('AlertDetail', () => {
  it('shows what the rule watches, where it delivers, and its state', async () => {
    api();
    renderWithProviders(<AlertDetail slug="api" ruleId={RULE.id} onClose={vi.fn()} />);
    expect(
      await screen.findByRole('heading', { name: 'Checkout budget' }, { timeout: 4000 })
    ).toBeInTheDocument();
    expect(screen.getByText('Firing')).toBeInTheDocument();
    expect(await screen.findByText('checkout')).toBeInTheDocument();
    expect(screen.getByText('Not used by this metric')).toBeInTheDocument();
    const to = screen.getByRole('region', { name: 'Delivers to' });
    expect(await within(to).findByText('ops-slack')).toBeInTheDocument();
    expect(within(to).getByText(/Channels receive fires and resolves/)).toBeInTheDocument();
    // A channel-only rule has no secret to rotate.
    expect(screen.queryByRole('button', { name: /rotate secret/i })).toBeNull();
  });

  it('names the SLO by id while SLOs are off, without reading them', async () => {
    registry.hidden = ['custom-slos'];
    const spies = api();
    renderWithProviders(<AlertDetail slug="api" ruleId={RULE.id} onClose={vi.fn()} />);
    expect(await screen.findByText(SLO.id, {}, { timeout: 4000 })).toBeInTheDocument();
    expect(spies.GET).not.toHaveBeenCalledWith('/v1/apps/{slug}/slos', expect.anything());
  });

  it.each([
    ['insufficient_traffic', 0, 50, '0 of 50 eligible requests in the last 15 minutes.'],
    ['insufficient_history', 3, 5, '3 of 5 required historical windows qualified.'],
    [
      'telemetry_missing_or_stale',
      0,
      undefined,
      'Request telemetry is missing or stale for this window.',
    ],
    ['telemetry_unavailable', 0, undefined, 'Gregale couldn’t read telemetry for this evaluation.'],
  ])('explains a skipped anomaly evaluation for %s', async (reason, count, required, message) => {
    rule = {
      ...RULE,
      metric: 'error_rate_pct',
      comparison: 'above_baseline',
      threshold: 3,
      state: required ? 'unknown' : 'degraded',
      window_spec: '15m',
      slo_id: undefined,
      anomaly_evaluation: {
        reason,
        count,
        required_count: required,
        evaluated_at: RULE.last_evaluated_at,
      },
    };
    api();
    renderWithProviders(<AlertDetail slug="api" ruleId={RULE.id} onClose={vi.fn()} />);
    const evaluation = await screen.findByRole('region', { name: 'Latest evaluation' });
    expect(within(evaluation).getByText(message)).toBeInTheDocument();
  });

  it.each([
    {
      name: 'an error-rate increase below the threshold',
      metric: 'error_rate_pct',
      comparison: 'above_baseline',
      values: { reason: 'threshold_not_reached', observed: 1.4, baseline: 0.8, trigger_value: 2.4 },
      message: 'The observed value hasn’t reached the baseline threshold.',
      shown: ['1.4%', '0.8%', '2.4% or higher'],
    },
    {
      name: 'a latency increase below the observation minimum',
      metric: 'latency_p95_ms',
      comparison: 'above_baseline',
      values: {
        reason: 'minimum_impact_not_reached',
        observed: 30,
        baseline: 10,
        trigger_value: 30,
        minimum_value: 50,
      },
      message: 'The observed value is below the required minimum of 50 ms.',
      shown: ['30 ms', '10 ms', '30 ms or higher'],
    },
    {
      name: 'a traffic drop below the baseline minimum',
      metric: 'request_count',
      comparison: 'below_baseline',
      values: {
        reason: 'minimum_impact_not_reached',
        observed: 0,
        baseline: 40,
        trigger_value: 10,
        minimum_value: 50,
      },
      message: 'The baseline is below the required minimum of 50 requests.',
      shown: ['0 requests', '40 requests', '10 requests or lower'],
    },
    {
      name: 'a zero baseline',
      metric: 'error_rate_pct',
      comparison: 'above_baseline',
      values: { reason: 'zero_baseline', observed: 5, baseline: 0 },
      message: 'This rule needs a positive baseline to detect a relative increase.',
      shown: ['5%', '0%'],
    },
  ])(
    'explains $name after a completed evaluation',
    async ({ metric, comparison, values, message, shown }) => {
      rule = {
        ...RULE,
        metric,
        comparison,
        threshold: comparison === 'above_baseline' ? 3 : 0.25,
        state: 'ok',
        slo_id: undefined,
        anomaly_evaluation: { ...values, count: 0, evaluated_at: RULE.last_evaluated_at },
      };
      api();
      renderWithProviders(<AlertDetail slug="api" ruleId={RULE.id} onClose={vi.fn()} />);
      const evaluation = within(await screen.findByRole('region', { name: 'Latest evaluation' }));
      expect(evaluation.getByText(message)).toBeInTheDocument();
      for (const value of shown) expect(evaluation.getByText(value)).toBeInTheDocument();
      if (!('trigger_value' in values))
        expect(evaluation.queryByText('Baseline threshold')).toBeNull();
    }
  );

  it('shows cooldown eligibility and switches to awaiting evaluation at the deadline', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date('2026-11-03T09:30:00Z'));
    const eligibleAt = new Date('2026-11-03T09:32:00Z');
    try {
      rule = {
        ...RULE,
        metric: 'error_rate_pct',
        comparison: 'above_baseline',
        threshold: 3,
        slo_id: undefined,
        anomaly_evaluation: {
          reason: 'notification_cooldown',
          count: 0,
          evaluated_at: RULE.last_evaluated_at,
          next_notification_eligible_at: eligibleAt.toISOString(),
          observed: 5,
          baseline: 1,
          trigger_value: 3,
        },
      };
      api();
      renderWithProviders(<AlertDetail slug="api" ruleId={RULE.id} onClose={vi.fn()} />);
      const details = await vi.waitFor(() =>
        screen.getByRole('region', { name: 'Latest evaluation' })
      );
      const evaluation = within(details);
      const message = evaluation.getByText(/Still firing. Another notification is eligible from/);
      expect(message).toHaveTextContent('if the breach continues.');
      expect(message.querySelector('time')).toHaveAttribute('datetime', eligibleAt.toISOString());
      expect(evaluation.getByText('5%')).toBeInTheDocument();
      expect(evaluation.getByText('3% or higher')).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(eligibleAt.getTime() - Date.now() - 1));
      expect(message).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(1));
      expect(evaluation.getByText(/Awaiting next evaluation/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('previews unsaved request-count edits without updating the rule', async () => {
    rule = {
      ...RULE,
      metric: 'request_count',
      comparison: 'above_baseline',
      threshold: 3,
      window_spec: '15m',
      slo_id: undefined,
    };
    const path = '/v1/apps/{slug}/alerts/anomaly-preview';
    const spies = api({
      [`GET ${path}`]: () => ({
        first_check_at: '2026-10-27T10:00:00Z',
        last_check_at: '2026-11-03T09:00:00Z',
        step_seconds: 3600,
        evaluated: 0,
        skipped: 168,
        skipped_windows: Array.from({ length: 168 }, (_, i) => ({
          evaluated_at: new Date(Date.parse('2026-10-27T10:00:00Z') + i * 3600000).toISOString(),
          reason: i < 100 ? 'telemetry_missing_or_stale' : 'insufficient_history',
        })),
        breaches: [],
      }),
    });
    renderWithProviders(<AlertDetail slug="api" ruleId={RULE.id} onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: /edit/i }));
    const form = within(screen.getByRole('form', { name: 'Edit rule' }));
    const multiplier = form.getByRole('spinbutton', { name: 'Multiplier' });
    await userEvent.clear(multiplier);
    await userEvent.type(multiplier, '4');
    await userEvent.click(form.getByRole('button', { name: 'Test on recent traffic' }));
    expect(
      await form.findByText('No windows had enough request data or history.')
    ).toBeInTheDocument();
    expect(spies.GET).toHaveBeenCalledWith(
      path,
      expect.objectContaining({
        params: {
          path: { slug: 'api' },
          query: { comparison: 'above_baseline', threshold: 4, window_spec: '15m' },
        },
      })
    );
    expect(spies.PATCH).not.toHaveBeenCalled();
  });

  it('shows a recovered incident using the metric and trigger recorded at opening', async () => {
    rule = {
      ...RULE,
      observe_only: true,
      environment_scope: 'production',
      metric: 'latency_p95_ms',
      comparison: 'above_baseline',
      threshold: 4,
      window_spec: '1h',
      observed_incidents: [
        {
          environment_scope: 'production',
          opened_at: '2026-11-03T08:00:00Z',
          ended_at: '2026-11-03T09:05:00Z',
          outcome: 'recovered',
          eligible_notifications: 2,
          last_eligible_at: '2026-11-03T09:00:00Z',
          opening_evidence: {
            metric: 'error_rate_pct',
            window: '15m',
            comparison: 'above_baseline',
            observed: 4.2,
            baseline: 0.7,
            trigger_value: 2.1,
            baseline_days: 6,
          },
        },
      ],
    };
    api();
    renderWithProviders(<AlertDetail slug="api" ruleId={RULE.id} onClose={vi.fn()} />);
    const history = within(await screen.findByRole('region', { name: 'Observed incidents' }));
    expect(history.getByText(/Recovered/)).toBeInTheDocument();
    expect(
      history.getByText(
        'Error rate at opening was 4.2% over 15 minutes. Baseline 0.7% (6 qualifying days). Trigger at least 2.1%.'
      )
    ).toBeInTheDocument();
  });

  it.each([2, 0])('shows %i completed checks for a rule with zero incidents', async (completed) => {
    rule = {
      ...RULE,
      metric: 'error_rate_pct',
      comparison: 'above_baseline',
      threshold: 3,
      observe_only: true,
      observation_coverage: {
        attempted: 2,
        completed,
        last_checked_at: RULE.last_evaluated_at,
        skipped: completed === 0 ? [{ reason: 'telemetry_missing_or_stale', count: 2 }] : undefined,
      },
    };
    api();
    renderWithProviders(<AlertDetail slug="api" ruleId={RULE.id} onClose={vi.fn()} />);
    const coverage = within(await screen.findByRole('region', { name: 'Evaluation coverage' }));
    expect(
      coverage.getByText(
        new RegExp(`${completed} of 2 attempted checks completed in the last 24 hours`)
      )
    ).toBeInTheDocument();
    expect(coverage.getByText(/Last check at/)).toBeInTheDocument();
    if (completed === 0) {
      expect(coverage.getByText(/2 with missing or stale telemetry/)).toBeInTheDocument();
    }
    expect(screen.getByText('No observed incidents yet.')).toBeInTheDocument();
  });

  it('shows observed incidents and requires a destination when switching to Notify', async () => {
    rule = {
      ...RULE,
      metric: 'request_count',
      comparison: 'above_baseline',
      threshold: 3,
      window_spec: '15m',
      slo_id: undefined,
      channel_ids: [],
      observe_only: true,
      state: 'ok',
      observed_incidents: [
        {
          opened_at: '2026-11-03T08:00:00Z',
          ended_at: '2026-11-03T09:05:00Z',
          outcome: 'recovered',
          eligible_notifications: 2,
          last_eligible_at: '2026-11-03T09:00:00Z',
        },
      ],
    };
    const spies = api({
      'PATCH /v1/apps/{slug}/alerts/{id}': ({ body }) => ({ ...rule, ...(body as object) }),
    });
    renderWithProviders(<AlertDetail slug="api" ruleId={RULE.id} onClose={vi.fn()} />);
    const history = within(await screen.findByRole('region', { name: 'Observed incidents' }));
    expect(history.getByText('2 eligible notifications')).toBeInTheDocument();
    expect(history.getByText(/Recovered/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /edit/i }));
    const form = within(screen.getByRole('form', { name: 'Edit rule' }));
    await userEvent.selectOptions(form.getByRole('combobox', { name: /mode/i }), 'notify');
    await userEvent.click(form.getByRole('button', { name: 'Save changes' }));
    expect(
      form.getByText('A rule without a webhook needs at least one channel.')
    ).toBeInTheDocument();
    expect(spies.PATCH).not.toHaveBeenCalled();
    await userEvent.click(await form.findByRole('checkbox', { name: /ops-slack/ }));
    await userEvent.click(form.getByRole('button', { name: 'Save changes' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Enable notifications?' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Enable notifications' }));
    await waitFor(() =>
      expect(spies.PATCH).toHaveBeenCalledWith('/v1/apps/{slug}/alerts/{id}', {
        params: { path: { slug: 'api', id: RULE.id } },
        body: { observe_only: false, channel_ids: [SLACK.id] },
      })
    );
  });

  it('shows the saved environment, baseline coverage, and the scope of older incidents', async () => {
    rule = {
      ...RULE,
      metric: 'error_rate_pct',
      comparison: 'above_baseline',
      threshold: 3,
      observe_only: true,
      environment_scope: 'production',
      anomaly_evaluation: {
        reason: 'threshold_not_reached',
        count: 0,
        baseline_days: 6,
        evaluated_at: RULE.last_evaluated_at,
      },
      observed_incidents: [
        {
          environment_scope: 'staging',
          opened_at: '2026-11-03T08:00:00Z',
          ended_at: '2026-11-03T09:05:00Z',
          outcome: 'observation_ended',
          eligible_notifications: 1,
          last_eligible_at: '2026-11-03T08:00:00Z',
        },
      ],
    };
    const spies = api({
      'PATCH /v1/apps/{slug}/alerts/{id}': ({ body }) => ({ ...rule, ...(body as object) }),
    });
    renderWithProviders(<AlertDetail slug="api" ruleId={RULE.id} onClose={vi.fn()} />);
    expect(await screen.findByText('production')).toBeInTheDocument();
    expect(screen.getByText('6 days qualified for the baseline.')).toBeInTheDocument();
    const history = within(screen.getByRole('region', { name: 'Observed incidents' }));
    expect(history.getByText('staging')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /edit/i }));
    const form = within(screen.getByRole('form', { name: 'Edit rule' }));
    expect(form.getByRole('option', { name: 'Notify' })).toBeEnabled();
    await userEvent.click(form.getByRole('button', { name: 'Use all environments' }));
    await userEvent.click(form.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(spies.PATCH).toHaveBeenCalledWith('/v1/apps/{slug}/alerts/{id}', {
        params: { path: { slug: 'api', id: RULE.id } },
        body: { environment_scope: '' },
      })
    );
  });

  it('shows scoped observation coverage before switching to Notify and keeps the environment', async () => {
    rule = {
      ...RULE,
      metric: 'error_rate_pct',
      comparison: 'above_baseline',
      threshold: 3,
      observe_only: true,
      environment_scope: 'staging',
      observation_coverage: {
        attempted: 480,
        completed: 420,
        last_checked_at: RULE.last_evaluated_at,
        skipped: [
          { reason: 'telemetry_missing_or_stale', count: 40 },
          { reason: 'insufficient_traffic', count: 20 },
        ],
      },
      anomaly_evaluation: {
        reason: 'observed_breach',
        count: 0,
        baseline_days: 6,
        evaluated_at: RULE.last_evaluated_at,
      },
    };
    const spies = api({
      'PATCH /v1/apps/{slug}/alerts/{id}': ({ body }) => ({ ...rule, ...(body as object) }),
    });
    renderWithProviders(<AlertDetail slug="api" ruleId={RULE.id} onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: /edit/i }));
    const form = within(screen.getByRole('form', { name: 'Edit rule' }));
    await userEvent.selectOptions(form.getByRole('combobox', { name: /mode/i }), 'notify');
    await userEvent.click(form.getByRole('button', { name: 'Save changes' }));
    const dialog = within(
      await screen.findByRole('dialog', { name: 'Enable notifications for staging?' })
    );
    expect(
      dialog.getByText(/Last check at .*6 days qualified for the baseline/)
    ).toBeInTheDocument();
    expect(dialog.getByText(/420 of 480 attempted checks completed/)).toBeInTheDocument();
    expect(
      dialog.getByText(/40 with missing or stale telemetry, 20 with too few eligible requests/)
    ).toBeInTheDocument();
    expect(spies.PATCH).not.toHaveBeenCalled();
    await userEvent.click(dialog.getByRole('button', { name: 'Enable notifications' }));
    await waitFor(() =>
      expect(spies.PATCH).toHaveBeenCalledWith('/v1/apps/{slug}/alerts/{id}', {
        params: { path: { slug: 'api', id: RULE.id } },
        body: { observe_only: false, environment_scope: 'staging' },
      })
    );
  });

  it('shows pending recovery progress and saves a changed confirmation setting', async () => {
    rule = {
      ...RULE,
      metric: 'error_rate_pct',
      comparison: 'above_baseline',
      threshold: 3,
      recovery_confirmation_checks: 2,
      anomaly_evaluation: {
        reason: 'recovery_confirmation_pending',
        count: 1,
        required_count: 2,
        evaluated_at: RULE.last_evaluated_at,
      },
    };
    const spies = api({
      'PATCH /v1/apps/{slug}/alerts/{id}': ({ body }) => ({ ...rule, ...(body as object) }),
    });
    renderWithProviders(<AlertDetail slug="api" ruleId={RULE.id} onClose={vi.fn()} />);
    expect(
      await screen.findByText('1 of 2 healthy checks. The incident is still open.')
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /edit/i }));
    const form = within(screen.getByRole('form', { name: 'Edit rule' }));
    const confirmation = form.getByRole('combobox', { name: 'Healthy checks to recover' });
    expect(confirmation).toHaveValue('2');
    await userEvent.selectOptions(confirmation, '1');
    await userEvent.click(form.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(spies.PATCH).toHaveBeenCalledWith('/v1/apps/{slug}/alerts/{id}', {
        params: { path: { slug: 'api', id: RULE.id } },
        body: { recovery_confirmation_checks: 1 },
      })
    );
  });

  it('changes the channels and threshold with a PATCH of only what changed', async () => {
    const spies = api({
      'PATCH /v1/apps/{slug}/alerts/{id}': ({ body }) => ({ ...rule, ...(body as object) }),
    });
    renderWithProviders(<AlertDetail slug="api" ruleId={RULE.id} onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: /edit/i }, { timeout: 4000 }));
    const form = screen.getByRole('form', { name: 'Edit rule' });
    await userEvent.click(await within(form).findByRole('checkbox', { name: /oncall/ }));
    const threshold = within(form).getByRole('spinbutton', { name: 'Threshold' });
    await userEvent.clear(threshold);
    await userEvent.type(threshold, '6');
    await userEvent.click(within(form).getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(spies.PATCH).toHaveBeenCalledWith('/v1/apps/{slug}/alerts/{id}', {
        params: { path: { slug: 'api', id: RULE.id } },
        body: { threshold: 6, channel_ids: [SLACK.id, PAGER.id] },
      })
    );
  });

  it('keeps a channel-only rule from losing its last channel', async () => {
    const spies = api();
    renderWithProviders(<AlertDetail slug="api" ruleId={RULE.id} onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: /edit/i }, { timeout: 4000 }));
    const form = screen.getByRole('form', { name: 'Edit rule' });
    await userEvent.click(await within(form).findByRole('checkbox', { name: /ops-slack/ }));
    await userEvent.click(within(form).getByRole('button', { name: 'Save changes' }));
    expect(
      within(form).getByText('A rule without a webhook needs at least one channel.')
    ).toBeInTheDocument();
    expect(spies.PATCH).not.toHaveBeenCalled();
  });

  it('says so when the rule is gone', async () => {
    api({ 'GET /v1/apps/{slug}/alerts/{id}': () => problem(404, 'not_found', 'no such rule') });
    renderWithProviders(<AlertDetail slug="api" ruleId={RULE.id} onClose={vi.fn()} />);
    expect(await screen.findByText(/no longer exists/, {}, { timeout: 4000 })).toBeInTheDocument();
  });
});
