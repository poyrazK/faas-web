import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { problem, renderWithProviders, routeApi, type Handlers } from '@/test/monetization';
import type { Budget, BudgetSpec } from '@/lib/budgets';

const workspace = vi.hoisted(() => ({
  org: 'acme' as string | null,
  label: 'Acme',
  ready: true,
}));
vi.mock('@/lib/api/workspace-apps', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/workspace-apps')>()),
  useWorkspaceTarget: () => workspace,
}));
vi.mock('@/lib/api/capabilities', () => ({
  useCapability: () => ({
    accountId: 'acct',
    capability: { maturity: 'beta' },
    state: 'available',
    refresh: vi.fn(),
  }),
}));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ account: { id: 'acct', email: 'me@example.com', plan: 'pro' } }),
}));

const { BudgetsSection } = await import('./budgets-page');

const ORG_APP = { id: '55555555-5555-4555-8555-555555555555', slug: 'billing' };
const PERSONAL_APP = { id: '22222222-2222-4222-8222-222222222222', slug: 'my-side-project' };

const SPEC: BudgetSpec = {
  name: 'Billing app',
  scope: { kind: 'app', id: ORG_APP.id },
  currency: 'USD',
  meters: ['compute'],
  basis: 'net_usage',
  limit_millicents: 2_500_000,
  notify_millicents: [1_000_000],
  mode: 'monitored',
  action: 'notify',
  drain_seconds: 0,
  resume_rule: 'next_period',
  enabled: true,
};
const ORG_BUDGET: Budget = {
  id: '66666666-6666-4666-8666-666666666666',
  account_id: 'org-acct',
  revision: 1,
  spec: SPEC,
  created_at: '2026-11-20T00:00:00Z',
  updated_at: '2026-11-20T00:00:00Z',
  status: 'active',
  notification_ready: true,
  enforcement_ready: false,
  reasons: [],
} as Budget;

let orgBudgets: Budget[];
function api(extra: Handlers = {}) {
  return routeApi({
    'GET /v1/orgs/{slug}/billing/budgets': () => ({ budgets: orgBudgets }),
    'GET /v1/orgs/{slug}/billing/budgets/{id}': ({ params }) =>
      orgBudgets.find((b) => b.id === params?.path?.id),
    'GET /v1/orgs/{slug}/billing/budgets/{id}/revisions': () => ({ revisions: [] }),
    'GET /v1/orgs/{slug}/apps': () => ({ apps: [ORG_APP] }),
    'GET /v1/apps': () => [PERSONAL_APP],
    'GET /v1/orgs/{organization}/projects': () => [],
    'POST /v1/orgs/{slug}/billing/budgets/preview': (init) => ({
      spec: (init.body as { spec: BudgetSpec }).spec,
      period_start: '2026-11-01T00:00:00Z',
      period_end: '2026-12-01T00:00:00Z',
      as_of: '2026-11-23T00:00:00Z',
      known_millicents: 0,
      known_limit_reached: false,
      coverage_complete: true,
      fresh: true,
      reasons: [],
      enforcement_ready: false,
      guarantee: 'monitored',
      targets: [],
      continuing_targets: [],
    }),
    ...extra,
  });
}

beforeEach(() => {
  orgBudgets = [ORG_BUDGET];
  workspace.org = 'acme';
  workspace.label = 'Acme';
});
afterEach(() => vi.restoreAllMocks());

async function openForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'New budget' }));
  return screen.getByRole('form', { name: 'New budget' });
}

describe('organization budgets', () => {
  it('a company workspace lists the organization’s budgets', async () => {
    const spies = api();
    renderWithProviders(<BudgetsSection />);
    expect(await screen.findByText('Billing app')).toBeInTheDocument();
    expect(screen.queryByText(/Budgets belong to your personal account/)).toBeNull();
    expect(spies.GET).not.toHaveBeenCalledWith('/v1/billing/budgets', expect.anything());
  });

  it('an organization app scope reads the organization’s apps', async () => {
    api();
    const user = userEvent.setup();
    renderWithProviders(<BudgetsSection />);
    // The existing budget scoped to the org app is named by the org app's slug.
    const row = (await screen.findByText('Billing app')).closest('tr')!;
    await waitFor(() => expect(row).toHaveTextContent(/billing/));
    expect(row).not.toHaveTextContent('app 55555555');
    const form = await openForm(user);
    await user.selectOptions(within(form).getByLabelText('Scope'), 'app');
    const picker = await within(form).findByRole('combobox', { name: /app/i });
    await waitFor(() =>
      expect(within(picker).getByRole('option', { name: 'billing' })).toBeInTheDocument()
    );
    expect(within(picker).queryByRole('option', { name: 'my-side-project' })).toBeNull();
  });

  it('an organization form offers Alert and Stop previews only, and no Job scope', async () => {
    api();
    const user = userEvent.setup();
    renderWithProviders(<BudgetsSection />);
    const form = await openForm(user);
    const responses = within(form)
      .getAllByRole('radio')
      .map((radio) => radio.getAttribute('value'));
    expect(responses).toEqual(['alert', 'stop-previews']);
    const scopes = within(within(form).getByLabelText('Scope'))
      .getAllByRole('option')
      .map((option) => option.getAttribute('value'));
    expect(scopes).not.toContain('job');
  });

  it('an organization budget has no alert channels', async () => {
    const spies = api();
    const user = userEvent.setup();
    renderWithProviders(<BudgetsSection />);
    await user.click(await screen.findByText('Billing app'));
    await screen.findByRole('heading', { name: /Billing app/ });
    expect(screen.queryByText('Alert channels')).toBeNull();
    expect(spies.GET).not.toHaveBeenCalledWith(
      '/v1/billing/budgets/{id}/channels',
      expect.anything()
    );
  });

  it('an organization that doesn’t own its resources sees apid’s reason', async () => {
    api({
      'POST /v1/orgs/{slug}/billing/budgets': () =>
        problem(
          422,
          'financial_budget_activation_unavailable',
          'This organization does not own its resources yet, so its usage is billed to the members who created it. Budgets follow the subject that pays.'
        ),
    });
    const user = userEvent.setup();
    renderWithProviders(<BudgetsSection />);
    const form = await openForm(user);
    await user.type(within(form).getByLabelText('Name'), 'Whole org');
    await user.type(within(form).getByLabelText('Limit (GB-hours a month)'), '500');
    await user.click(within(form).getByRole('button', { name: 'Create budget' }));
    expect(
      await screen.findByText(/does not own its resources yet/, undefined, { timeout: 3000 })
    ).toBeInTheDocument();
    expect(within(form).queryByRole('radio', { name: 'Strict cap' })).toBeNull();
    expect(within(form).getByRole('radio', { name: 'Alert' })).toBeInTheDocument();
  });

  it('a member without the billing role is told who can change budgets', async () => {
    api({
      'POST /v1/orgs/{slug}/billing/budgets': () =>
        problem(403, 'org_role_forbidden', 'owner or billing role required'),
    });
    const user = userEvent.setup();
    renderWithProviders(<BudgetsSection />);
    const form = await openForm(user);
    await user.type(within(form).getByLabelText('Name'), 'Whole org');
    await user.type(within(form).getByLabelText('Limit (GB-hours a month)'), '500');
    await user.click(within(form).getByRole('button', { name: 'Create budget' }));
    expect(
      await screen.findByText(
        /Only Acme’s owner or billing role can change its budgets/,
        undefined,
        {
          timeout: 3000,
        }
      )
    ).toBeInTheDocument();
  });
});
