import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { problem, renderWithProviders, routeApi, type Handlers } from '@/test/monetization';

const caps = vi.hoisted(() => ({ gitops: 'off' }));
vi.mock('@/lib/api/capabilities', () => ({
  useCapability: () => ({ capability: { maturity: 'beta' }, state: 'available' }),
  useCapabilityAccess: (id: string) => ({
    access: id === 'environment-gitops' ? caps.gitops : 'on',
    refresh: vi.fn(),
  }),
}));

const { ReleaseWebhooks } = await import('./release-webhooks');

const HOOK = {
  id: '0123456789abcdef0123456789abcdef',
  scope: 'account',
  account_id: '8b1f5e5d-273e-5a18-ae00-58fceba4fe6c',
  target_url: 'https://platform.example.com/releases',
  webhook_secret_sealed_masked: '***',
  event_filter: ['deployment.live', 'deployment.failed'],
  retry_policy: 'default',
  delivery_format: 'cloudevents',
  enabled: true,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-02T00:00:00Z',
};
const HEALTH = {
  webhook_id: HOOK.id,
  snapshot_at: '2026-11-03T10:00:00Z',
  pending_count: 2,
  in_flight_count: 0,
  dead_count: 1,
  receiver_state: 'cooling_down',
  receiver_cooldown_until: '2026-11-03T10:05:00Z',
  oldest_overdue_seconds: 420,
  recent_succeeded_count: 9,
  recent_dead_count: 1,
  recent_success_rate: 0.9,
};

let hooks: unknown[];
function api(extra: Handlers = {}) {
  return routeApi({
    'GET /v1/account/release-webhooks': () => hooks,
    'GET /v1/account/release-webhooks/{id}/health': () => HEALTH,
    'GET /v1/account/release-webhooks/{id}/deliveries': () => ({ deliveries: [] }),
    'GET /v1/apps': () => [],
    ...extra,
  });
}

beforeEach(() => {
  hooks = [];
  caps.gitops = 'off';
});
afterEach(() => vi.restoreAllMocks());

async function fillTarget() {
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Target URL' }),
    'https://platform.example.com/releases'
  );
}

describe('ReleaseWebhooks', () => {
  it('generates a secret when none is given and shows it once, out of every cache', async () => {
    const spies = api({
      'POST /v1/account/release-webhooks': () => {
        hooks = [HOOK];
        return HOOK;
      },
    });
    const { client } = renderWithProviders(<ReleaseWebhooks />);
    expect(screen.getByText('Beta')).toBeInTheDocument();
    await fillTarget();
    await userEvent.click(screen.getByRole('button', { name: 'Add receiver' }));
    await waitFor(() => expect(spies.POST).toHaveBeenCalled());
    const [, init] = spies.POST.mock.calls[0] as [string, { body: Record<string, unknown> }];
    const secret = String(init.body.webhook_secret);
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(init.body).toMatchObject({
      target_url: 'https://platform.example.com/releases',
      event_filter: [
        'deployment.live',
        'deployment.failed',
        'rollout.completed',
        'rollout.aborted',
      ],
      delivery_format: 'json',
      retry_policy: 'default',
      enabled: true,
    });

    const shown = await screen.findByRole('region', { name: 'Signing secret' });
    expect(within(shown).queryByText(secret)).toBeNull();
    await userEvent.click(within(shown).getByRole('button', { name: 'Reveal' }));
    expect(within(shown).getByText(secret)).toBeInTheDocument();
    const cached = JSON.stringify([
      client
        .getQueryCache()
        .getAll()
        .map((q) => q.state.data),
      client
        .getMutationCache()
        .getAll()
        .map((m) => m.state.variables),
    ]);
    expect(cached).not.toContain(secret);
    await userEvent.click(within(shown).getByRole('button', { name: 'Dismiss' }));
    expect(document.body.innerHTML).not.toContain(secret);
  });

  it('sends a pasted secret without showing it back', async () => {
    const spies = api({ 'POST /v1/account/release-webhooks': () => HOOK });
    renderWithProviders(<ReleaseWebhooks />);
    await fillTarget();
    await userEvent.type(screen.getByLabelText('Signing secret'), 'from-my-manager');
    await userEvent.click(screen.getByRole('button', { name: 'CloudEvents 1.0' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add receiver' }));
    await waitFor(() =>
      expect(spies.POST).toHaveBeenCalledWith('/v1/account/release-webhooks', {
        body: expect.objectContaining({
          webhook_secret: 'from-my-manager',
          delivery_format: 'cloudevents',
        }),
      })
    );
    expect(screen.queryByRole('region', { name: 'Signing secret' })).toBeNull();
    expect(document.body.innerHTML).not.toContain('from-my-manager');
  });

  it('needs at least one event and offers GitOps changes only with environment GitOps', async () => {
    const spies = api();
    const { unmount } = renderWithProviders(<ReleaseWebhooks />);
    expect(screen.queryByRole('checkbox', { name: 'environment.gitops.changed' })).toBeNull();
    for (const ev of [
      'deployment.live',
      'deployment.failed',
      'rollout.completed',
      'rollout.aborted',
    ])
      await userEvent.click(screen.getByRole('checkbox', { name: ev }));
    await fillTarget();
    await userEvent.click(screen.getByRole('button', { name: 'Add receiver' }));
    expect(screen.getByText('Choose at least one event.')).toBeInTheDocument();
    expect(spies.POST).not.toHaveBeenCalled();
    unmount();

    caps.gitops = 'on';
    renderWithProviders(<ReleaseWebhooks />);
    expect(
      screen.getByRole('checkbox', { name: 'environment.gitops.changed' })
    ).toBeInTheDocument();
  });

  it('names the shared webhook quota when the account is full', async () => {
    api({
      'POST /v1/account/release-webhooks': () =>
        problem(403, 'plan_webhook_quota', 'The account has used all 10 webhooks on its plan.'),
    });
    renderWithProviders(<ReleaseWebhooks />);
    await fillTarget();
    await userEvent.click(screen.getByRole('button', { name: 'Add receiver' }));
    expect(await screen.findByText(/used all 10 webhooks/)).toBeInTheDocument();
    expect(screen.getByText('plan_webhook_quota')).toBeInTheDocument();
  });

  it('explains the plan gate instead of a list', async () => {
    api({
      'GET /v1/account/release-webhooks': () =>
        problem(402, 'plan_webhooks_not_allowed', 'the free plan does not include webhooks'),
    });
    renderWithProviders(<ReleaseWebhooks />);
    expect(await screen.findByText(/on Hobby and above/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add receiver' })).toBeNull();
  });
});
