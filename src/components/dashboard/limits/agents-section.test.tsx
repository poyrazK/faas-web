import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { problem, renderWithProviders, routeApi, type Handlers } from '@/test/monetization';
import { withRouter } from '@/test/router';

const workspace = vi.hoisted(() => ({
  org: null as string | null,
  label: 'Personal',
  ready: true,
}));
vi.mock('@/lib/api/workspace-apps', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/workspace-apps')>()),
  useWorkspaceTarget: () => workspace,
}));

const { AgentsSection } = await import('./agents-section');

const CODEX = {
  id: '11111111-1111-4111-8111-111111111111',
  kind: 'hosted_mcp',
  client_name: 'Codex',
  prefix: 'gk_codex',
  scopes: ['deploy:write'],
  created_at: '2026-11-01T00:00:00Z',
};
const CLAUDE = {
  id: '22222222-2222-4222-8222-222222222222',
  kind: 'agent_key',
  label: 'Claude',
  prefix: 'gk_claude',
  scopes: ['deploy:write'],
  created_at: '2026-11-02T00:00:00Z',
};
const ADAS = {
  id: '33333333-3333-4333-8333-333333333333',
  kind: 'hosted_mcp',
  client_name: 'Cursor',
  prefix: 'gk_cursor',
  scopes: [],
  created_at: '2026-11-03T00:00:00Z',
  member: 'Ada',
};

const budgets: Record<string, unknown> = {
  [CODEX.id]: {
    monthly_cents: 2500,
    spent_cents: 2500,
    source: 'key',
    key_monthly_cents: 2500,
    month: '2026-11',
  },
  [CLAUDE.id]: { spent_cents: 900, source: 'unlimited', key_unlimited: true, month: '2026-11' },
};

function api(extra: Handlers = {}) {
  return routeApi({
    'GET /v1/agent-connections': () => ({ items: [CODEX, CLAUDE] }),
    'GET /v1/orgs/{slug}/agent-connections': () => ({ items: [CODEX, ADAS] }),
    'GET /v1/agent-connections/{id}/budget': ({ params }) =>
      budgets[params?.path?.id ?? ''] ?? problem(404, 'not_found'),
    'GET /v1/orgs/{slug}/agent-policy': () => ({
      agents_allowed: true,
      allowed_scopes: [],
      max_agent_budget_cents: 5000,
      updated_at: '2026-11-20T00:00:00Z',
    }),
    'PUT /v1/agent-connections/{id}/budget': ({ body }) => ({
      ...(budgets[CODEX.id] as object),
      monthly_cents: (body as { monthly_cents: number }).monthly_cents,
      key_monthly_cents: (body as { monthly_cents: number }).monthly_cents,
    }),
    ...extra,
  });
}

beforeEach(() => {
  workspace.org = null;
  workspace.label = 'Personal';
});
afterEach(() => vi.restoreAllMocks());

const show = () => renderWithProviders(withRouter(<AgentsSection />));

describe('the Agents section', () => {
  it('lists each agent with its budget used', async () => {
    api();
    show();
    const codex = await screen.findByRole('group', { name: 'Codex' });
    await waitFor(() =>
      expect(codex).toHaveTextContent(
        'Past $25.00 a month, each always-on change waits for your approval.'
      )
    );
    expect(codex).toHaveTextContent('You set this budget for the agent.');
    expect(within(codex).getByRole('meter', { name: 'Codex used' })).toHaveAttribute(
      'aria-valuenow',
      '100'
    );
    const claude = screen.getByRole('group', { name: 'Claude' });
    await waitFor(() =>
      expect(claude).toHaveTextContent('No limit: changes are never held for cost.')
    );
    expect(within(claude).queryByRole('meter')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Agent ceiling' })).toBeNull();
  });

  it('a colleague’s agent says who can change it, with no meter or action', async () => {
    workspace.org = 'acme';
    workspace.label = 'Acme';
    api();
    show();
    const cursor = await screen.findByRole('group', { name: 'Cursor' });
    await waitFor(() =>
      expect(cursor).toHaveTextContent('Only Ada can see and change its budget.')
    );
    expect(within(cursor).queryByRole('meter')).toBeNull();
    expect(within(cursor).queryByRole('button')).toBeNull();
  });

  it('Change opens the budget dialog and saves', async () => {
    const spies = api();
    const user = userEvent.setup();
    show();
    const codex = await screen.findByRole('group', { name: 'Codex' });
    await user.click(await within(codex).findByRole('button', { name: 'Change' }));
    const amount = await screen.findByLabelText('Dollars a month');
    await user.clear(amount);
    await user.type(amount, '40');
    await user.click(screen.getByRole('button', { name: 'Save budget' }));
    await waitFor(() =>
      expect(spies.PUT).toHaveBeenCalledWith(
        '/v1/agent-connections/{id}/budget',
        expect.objectContaining({
          params: { path: { id: CODEX.id } },
          body: { monthly_cents: 4000 },
        })
      )
    );
  });

  it('is hidden when there are no agents', async () => {
    const spies = api({ 'GET /v1/agent-connections': () => ({ items: [] }) });
    show();
    await waitFor(() =>
      expect(spies.GET).toHaveBeenCalledWith('/v1/agent-connections', expect.anything())
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole('heading', { name: 'Agents' })).toBeNull();
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('a company shows its agent ceiling, linked to the policy', async () => {
    workspace.org = 'acme';
    workspace.label = 'Acme';
    api();
    show();
    const ceiling = await screen.findByRole('group', { name: 'Agent ceiling' });
    await waitFor(() =>
      expect(ceiling).toHaveTextContent(
        'No agent acting in Acme may have a budget above $50.00 a month.'
      )
    );
    expect(within(ceiling).getByRole('link', { name: 'Change' })).toHaveAttribute(
      'href',
      '/dashboard/agents/policy'
    );
  });

  it('says when a budget could not be read, and offers to retry', async () => {
    api({ 'GET /v1/agent-connections/{id}/budget': () => problem(500, 'internal') });
    show();
    const codex = await screen.findByRole('group', { name: 'Codex' });
    await waitFor(() => expect(codex).toHaveTextContent('Couldn’t read this budget.'));
    expect(within(codex).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('review fixes', () => {
  it('a company member who can’t list agents is told who can, and still sees the ceiling', async () => {
    workspace.org = 'acme';
    workspace.label = 'Acme';
    api({
      'GET /v1/orgs/{slug}/agent-connections': () =>
        problem(403, 'org_role_forbidden', 'owner or admin role required'),
    });
    show();
    expect(
      await screen.findByText(/Only owners and admins of Acme can see the agents acting in it/)
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
    const ceiling = await screen.findByRole('group', { name: 'Agent ceiling' });
    await waitFor(() => expect(ceiling).toHaveTextContent('$50.00 a month'));
  });

  it('a ceiling that couldn’t be read says so', async () => {
    workspace.org = 'acme';
    workspace.label = 'Acme';
    // A refusal that isn't retried, so the test doesn't wait out the backoff.
    api({ 'GET /v1/orgs/{slug}/agent-policy': () => problem(422, 'validation_failed') });
    show();
    const ceiling = await screen.findByRole('group', { name: 'Agent ceiling' });
    await waitFor(() => expect(ceiling).toHaveTextContent('Couldn’t read the agent ceiling.'));
    expect(within(ceiling).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('only apid’s not_found means another member’s agent', async () => {
    api({
      'GET /v1/agent-connections/{id}/budget': () => problem(404, 'not_mocked'),
    });
    show();
    const codex = await screen.findByRole('group', { name: 'Codex' });
    await waitFor(() => expect(codex).toHaveTextContent('Couldn’t read this budget.'));
    expect(codex).not.toHaveTextContent(/can see and change its budget/);
  });

  it('an agent at its budget reads amber, not red: its changes wait, nothing stopped', async () => {
    api();
    show();
    const codex = await screen.findByRole('group', { name: 'Codex' });
    const meter = await within(codex).findByRole('meter', { name: 'Codex used' });
    expect((meter.firstElementChild as HTMLElement).style.background).toBe('var(--status-warning)');
  });
});

describe('agentCloseLines', () => {
  it('names an agent at a budget above $0, and nothing else', async () => {
    const { agentCloseLines } = await import('./use-agent-facts');
    expect(
      agentCloseLines([
        { name: 'Codex', spentCents: 2500, limitCents: 2500 },
        { name: 'Free', spentCents: 0, limitCents: 0 },
        { name: 'Below', spentCents: 2400, limitCents: 2500 },
        { name: 'Unlimited', spentCents: 9000 },
      ])
    ).toEqual(['Codex’s changes now wait for you.']);
  });
});

describe('the status strip with agents', () => {
  const data = {
    settled: true,
    org: null,
    workspaceLabel: 'Personal',
    showPostgres: false,
    facts: {
      workspace: 'personal',
      plan: 'pro',
      cap: { state: 'ready', capCents: 5000, overageCents: 100 },
      egress: { state: 'ready', enabled: false, electable: true, usedGb: 1, includedGb: 500 },
      storage: { state: 'hidden' },
    },
  } as never;

  it('names an agent at its budget', async () => {
    api();
    const { AgentAwareStrip } = await import('./agents-section');
    renderWithProviders(withRouter(<AgentAwareStrip data={data} onAction={vi.fn()} />));
    const strip = () => screen.getByRole('status', { name: 'Spending limits status' });
    await waitFor(() => expect(strip()).toHaveTextContent('Close to a limit'));
    expect(strip()).toHaveTextContent('Codex’s changes now wait for you.');
  });

  it('waits while an agent’s budget is still being read', async () => {
    api({ 'GET /v1/agent-connections/{id}/budget': () => new Promise(() => {}) });
    const { AgentAwareStrip } = await import('./agents-section');
    renderWithProviders(withRouter(<AgentAwareStrip data={data} onAction={vi.fn()} />));
    const strip = await screen.findByRole('status', { name: 'Spending limits status' });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(strip).toHaveTextContent('Checking your limits…');
  });
});
