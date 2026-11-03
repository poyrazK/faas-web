import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  plan: 'pro',
  access: new Map<string, string>(),
  create: vi.fn(),
  confirm: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('@/lib/api/queries', () => ({
  useCreateEdgeRule: () => ({ mutateAsync: state.create, isPending: false }),
}));
vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: (key: string) => ({ access: state.access.get(key) ?? 'on' }),
  useCapabilityStage: () => 'Beta',
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { id: 'acct', plan: state.plan } }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => state.confirm }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: state.toast }) }));

const { EdgeRuleRecipes } = await import('./edge-rule-recipes-panel');

beforeEach(() => {
  state.plan = 'pro';
  state.access = new Map();
  state.create.mockReset().mockResolvedValue({});
  state.confirm.mockReset().mockResolvedValue(true);
  state.toast.mockReset();
});

const panel = () => screen.getByRole('region', { name: 'Recipes' });

describe('EdgeRuleRecipes', () => {
  it('lists the whole catalog, with what each counts in log mode', () => {
    render(<EdgeRuleRecipes slug="api" />);
    for (const title of [
      'Block unverified bots',
      'Rate-limit a path per client IP',
      'Allow only listed IPs on a path',
      'Block countries',
      'Block vulnerability scanner paths',
      'Challenge visitors on a path',
      'Control AI crawlers',
    ])
      expect(within(panel()).getByText(title)).toBeInTheDocument();
    expect(within(panel()).getAllByText(/^In log mode/)).toHaveLength(7);
  });

  it('adds a recipe that is not among the suggestions, in log mode', async () => {
    render(<EdgeRuleRecipes slug="api" />);
    await userEvent.click(within(panel()).getByRole('button', { name: 'Add Block countries' }));
    await userEvent.type(screen.getByLabelText(/^Countries/), 'KP, IR');
    await userEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    await waitFor(() => expect(state.create).toHaveBeenCalled());
    expect(state.create).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'api',
        kind: 'ip',
        mode: 'log',
        match: { field: 'country', op: 'in', values: ['KP', 'IR'] },
      })
    );
  });

  it('says why a recipe cannot be added on this account', () => {
    state.plan = 'free';
    state.access.set('edge-ai-crawler-controls', 'off');
    render(<EdgeRuleRecipes slug="api" />);
    expect(within(panel()).getByRole('button', { name: 'Add Block countries' })).toBeDisabled();
    expect(within(panel()).getAllByText('IP rules need a paid plan.').length).toBeGreaterThan(0);
    expect(
      within(panel()).getByRole('button', { name: 'Add Rate-limit a path per client IP' })
    ).toBeEnabled();
    expect(
      within(panel()).getByText('AI crawler conditions are not released to this account yet.')
    ).toBeInTheDocument();
  });
});
