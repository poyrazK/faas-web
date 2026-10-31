import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { recipeEffect } from '@/lib/edge-rule-recipes';

const state = vi.hoisted(() => ({
  data: undefined as unknown,
  error: null as unknown,
  create: vi.fn(),
  confirm: vi.fn(),
  toast: vi.fn(),
  penalty: 'off' as string,
}));
vi.mock('@/lib/api/edge-rules', () => ({
  useEdgeRuleSuggestions: () => ({
    data: state.data,
    error: state.error,
    isPending: false,
    refetch: vi.fn(),
  }),
}));
vi.mock('@/lib/api/queries', () => ({
  useCreateEdgeRule: () => ({ mutateAsync: state.create, isPending: false }),
}));
vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: () => ({ access: state.penalty }),
  useCapabilityStage: () => 'Beta',
}));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => state.confirm }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: state.toast }) }));
vi.mock('@/components/dashboard/plan-gate', () => ({
  PlanGate: ({ feature }: { feature: string }) => <p>{feature} needs a paid plan</p>,
}));

const { EdgeRuleSuggestions } = await import('./edge-rule-suggestions');

beforeEach(() => {
  state.data = {
    window: '7d',
    since: '2026-10-24T00:00:00Z',
    suggestions: [
      {
        recipe: 'rate-limit-path',
        title: 'Rate-limit a path per client IP',
        reason: 'POST /login received 900 requests in the last 7 days.',
        params: { path: '/login', methods: 'POST' },
        alternative: {
          recipe: 'challenge-path',
          title: 'Challenge visitors on a path',
          params: { path: '/login' },
        },
      },
      {
        recipe: 'allow-ips-only',
        title: 'Allow only listed IPs on a path',
        reason: '/admin received 40 requests in the last 7 days and is open to every IP.',
        params: { path: '/admin/**' },
      },
    ],
  };
  state.error = null;
  state.create.mockReset().mockResolvedValue({ id: 'r1' });
  state.confirm.mockReset().mockResolvedValue(true);
  state.toast.mockReset();
  state.penalty = 'off';
});

describe('EdgeRuleSuggestions', () => {
  it('lists each suggestion with the traffic behind it', () => {
    render(<EdgeRuleSuggestions slug="api" />);
    expect(screen.getByText(/^Beta · .*last 7 days/)).toBeInTheDocument();
    expect(screen.getByText(/POST \/login received 900 requests/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Challenge visitors on a path instead' })
    ).toBeVisible();
  });

  it('confirms with exactly what the rule refuses, then creates it in log mode', async () => {
    render(<EdgeRuleSuggestions slug="api" />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Add Rate-limit a path per client IP' })
    );
    const dialog = screen.getByRole('dialog', { name: 'Rate-limit a path per client IP' });
    expect(within(dialog).getByLabelText(/^Path/)).toHaveValue('/login');
    expect(within(dialog).queryByLabelText(/^Penalty box/)).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add rule' }));
    const effect = recipeEffect('rate-limit-path', { path: '/login', methods: 'POST' }, false);
    expect(state.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Add this rule?', description: effect, destructive: false })
    );
    await waitFor(() =>
      expect(state.create).toHaveBeenCalledWith(
        expect.objectContaining({
          slug: 'api',
          kind: 'throttle',
          match_host: '@app',
          match_path: '/login',
          mode: 'log',
          description: 'Created from the rate-limit-path protection recipe.',
        })
      )
    );
    expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }));
  });

  it('enforces at once only when asked, and the confirmation says so', async () => {
    render(<EdgeRuleSuggestions slug="api" />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Add Rate-limit a path per client IP' })
    );
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('switch', { name: 'Enforce now' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add rule' }));
    expect(state.confirm.mock.calls[0][0]).toMatchObject({
      destructive: true,
      description: expect.stringContaining('applies as soon as it is created'),
    });
    await waitFor(() =>
      expect(state.create).toHaveBeenCalledWith(expect.objectContaining({ mode: 'enforce' }))
    );
  });

  it('asks for the allowed IPs before anything is confirmed', async () => {
    render(<EdgeRuleSuggestions slug="api" />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Add Allow only listed IPs on a path' })
    );
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add rule' }));
    expect(within(dialog).getByText('Allowed IPs is required.')).toBeInTheDocument();
    expect(state.confirm).not.toHaveBeenCalled();
    await userEvent.type(within(dialog).getByLabelText(/^Allowed IPs/), '203.0.113.7');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add rule' }));
    await waitFor(() =>
      expect(state.create).toHaveBeenCalledWith(
        expect.objectContaining({
          match: { not: { field: 'client_ip', op: 'cidr', values: ['203.0.113.7/32'] } },
        })
      )
    );
  });

  it('offers the softer challenge instead', async () => {
    render(<EdgeRuleSuggestions slug="api" />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Challenge visitors on a path instead' })
    );
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Add rule' })
    );
    await waitFor(() =>
      expect(state.create).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'challenge', match_path: '/login' })
      )
    );
  });

  it('offers the penalty box only once it is released to the account', async () => {
    state.penalty = 'on';
    render(<EdgeRuleSuggestions slug="api" />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Add Rate-limit a path per client IP' })
    );
    expect(within(screen.getByRole('dialog')).getByLabelText(/^Penalty box/)).toBeInTheDocument();
  });

  it('keeps a refused create in the dialog', async () => {
    state.create.mockRejectedValue(
      new ApiError({
        status: 403,
        code: 'plan_edge_rule_kind_quota_reached',
        title: 'Quota',
        detail: 'hobby plan caps throttle rules at 5 per app',
      })
    );
    render(<EdgeRuleSuggestions slug="api" />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Add Rate-limit a path per client IP' })
    );
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add rule' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/caps throttle rules/);
  });

  it('says when the traffic suggests nothing', () => {
    state.data = { window: '7d', since: '2026-10-24T00:00:00Z', suggestions: [] };
    render(<EdgeRuleSuggestions slug="api" />);
    expect(screen.getByText(/Nothing to suggest/)).toBeInTheDocument();
  });

  it('explains a plan without request analytics', () => {
    state.data = undefined;
    state.error = new ApiError({ status: 402, code: 'plan_feature_gated', title: 'No analytics' });
    render(<EdgeRuleSuggestions slug="api" />);
    expect(screen.getByText('Suggested protections needs a paid plan')).toBeInTheDocument();
  });
});
