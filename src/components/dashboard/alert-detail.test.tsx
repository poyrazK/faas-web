import { screen, waitFor, within } from '@testing-library/react';
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

  it('switches a rule to rolling back, with its window after cutover, after a confirmation', async () => {
    rule = { ...RULE, metric: 'error_rate_pct', comparison: 'gt', threshold: 5, slo_id: undefined };
    const spies = api({
      'PATCH /v1/apps/{slug}/alerts/{id}': ({ body }) => ({ ...rule, ...(body as object) }),
    });
    renderWithProviders(<AlertDetail slug="api" ruleId={RULE.id} onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: /edit/i }, { timeout: 4000 }));
    const form = screen.getByRole('form', { name: 'Edit rule' });
    await userEvent.selectOptions(
      within(form).getByRole('combobox', { name: 'When it fires' }),
      'rollback'
    );
    await userEvent.selectOptions(
      within(form).getByRole('combobox', { name: 'After cutover' }),
      '600'
    );
    await userEvent.click(within(form).getByRole('button', { name: 'Save changes' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/For 10 minutes after a release takes all traffic/);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save rule' }));
    await waitFor(() =>
      expect(spies.PATCH).toHaveBeenCalledWith('/v1/apps/{slug}/alerts/{id}', {
        params: { path: { slug: 'api', id: RULE.id } },
        body: { action: 'rollback', post_deploy_rollback_window_seconds: 600 },
      })
    );
  });

  it('offers no rollback while alert-rollbacks is off for the account', async () => {
    registry.hidden = ['alert-rollbacks'];
    rule = { ...RULE, metric: 'error_rate_pct', comparison: 'gt', threshold: 5, slo_id: undefined };
    api();
    renderWithProviders(<AlertDetail slug="api" ruleId={RULE.id} onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: /edit/i }, { timeout: 4000 }));
    expect(screen.queryByRole('combobox', { name: 'When it fires' })).toBeNull();
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
