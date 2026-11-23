import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { problem, renderWithProviders, routeApi, type Handlers } from '@/test/monetization';
import type {
  AgentActivityEntry,
  AgentBudget,
  AgentConnection,
  AgentUndoPlan,
} from '@/lib/api/agents';

const workspace = vi.hoisted(() => ({
  org: null as string | null,
  label: 'Personal',
  ready: true,
}));
const navigate = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/workspace-apps', () => ({ useWorkspaceTarget: () => workspace }));
vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: () => ({ access: 'on', capability: undefined, refresh: vi.fn() }),
}));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  Link: ({ children, className }: { children: ReactNode; className?: string }) => (
    <a href="#" className={className}>
      {children}
    </a>
  ),
}));

const { AgentPage } = await import('./agent-page');

const CLAUDE: AgentConnection = {
  id: 'key-claude',
  kind: 'hosted_mcp',
  client_name: 'Claude Code',
  label: 'mcp-login',
  prefix: 'faas_live_a1b2',
  scopes: ['apps:read', 'deploy:write'],
  created_at: '2026-11-15T10:00:00Z',
  last_used_at: '2026-11-21T09:00:00Z',
  approvals: ['delete', 'production'],
};
const BUDGET: AgentBudget = {
  source: 'plan_default',
  monthly_cents: 2500,
  spent_cents: 640,
  month: '2026-11',
};
const ENTRIES: AgentActivityEntry[] = [
  {
    id: 'act-2',
    method: 'POST',
    path: '/v1/apps/api/deployments',
    status: 201,
    reason: 'Ship the retry fix',
    approval_id: 'appr-1',
    created_at: '2026-11-21T09:00:00Z',
  },
  {
    id: 'act-1',
    method: 'POST',
    path: '/v1/apps/api/secrets',
    status: 409,
    created_at: '2026-11-21T08:00:00Z',
  },
];
const PLAN: AgentUndoPlan = {
  since: '2026-11-20T09:00:00Z',
  undoable: 1,
  plan_digest: 'sha256:plan-1',
  items: [
    {
      activity_id: 'act-2',
      method: 'POST',
      path: '/v1/apps/api/deployments',
      kind: 'deploy',
      summary: 'api: deployed a new release',
      created_at: '2026-11-21T09:00:00Z',
      status: 'undoable',
    },
    {
      activity_id: 'act-0',
      method: 'POST',
      path: '/v1/apps/api/secrets',
      kind: 'other',
      summary: 'api: secret STRIPE_KEY set',
      created_at: '2026-11-21T07:00:00Z',
      status: 'not_undoable',
      reason: 'Gregale keeps no copy of a replaced secret; set it again.',
    },
  ],
};

function handlers(over: Handlers = {}): Handlers {
  return {
    'GET /v1/agent-connections': () => ({ items: [CLAUDE] }),
    'GET /v1/agent-connections/{id}/budget': () => BUDGET,
    'GET /v1/agent-connections/{id}/activity': () => ({ activity: ENTRIES }),
    ...over,
  };
}

beforeEach(() => {
  workspace.org = null;
  navigate.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe('AgentPage', () => {
  it('says what the agent can do, where, and what it asks about', async () => {
    routeApi(handlers());
    renderWithProviders(<AgentPage agentId="key-claude" />);
    expect(await screen.findByRole('heading', { name: 'Claude Code' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Agent access' })).toHaveTextContent(
      'Claude Code can inspect apps, deployments, logs and metrics and deploy, roll back, change app settings and delete apps in every project. It asks you before deletes and production changes.'
    );
  });

  it('shows the budget and saves a new monthly amount in whole cents', async () => {
    const spies = routeApi(
      handlers({
        'PUT /v1/agent-connections/{id}/budget': () => ({
          source: 'key',
          monthly_cents: 1250,
          key_monthly_cents: 1250,
          spent_cents: 640,
          month: '2026-11',
        }),
      })
    );
    renderWithProviders(<AgentPage agentId="key-claude" />);
    expect(await screen.findByText('$6.40 of $25.00')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Change budget' }));
    const dialog = await screen.findByRole('dialog', { name: 'Change budget' });
    await userEvent.click(within(dialog).getByRole('radio', { name: /A monthly amount/ }));
    await userEvent.type(within(dialog).getByLabelText('Dollars a month'), '12.50');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save budget' }));
    await waitFor(() =>
      expect(spies.PUT).toHaveBeenCalledWith('/v1/agent-connections/{id}/budget', {
        params: { path: { id: 'key-claude' } },
        body: { monthly_cents: 1250 },
      })
    );
    expect(await screen.findByText('$6.40 of $12.50')).toBeInTheDocument();
  });

  it('refuses an amount that is not money before calling the API', async () => {
    const spies = routeApi(handlers());
    renderWithProviders(<AgentPage agentId="key-claude" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Change budget' }));
    const dialog = await screen.findByRole('dialog', { name: 'Change budget' });
    await userEvent.click(within(dialog).getByRole('radio', { name: /A monthly amount/ }));
    await userEvent.type(within(dialog).getByLabelText('Dollars a month'), 'lots');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save budget' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Enter a dollar amount');
    expect(spies.PUT).not.toHaveBeenCalled();
  });

  it('lists what the agent changed: a sentence where the path is known, the request otherwise', async () => {
    routeApi(handlers());
    renderWithProviders(<AgentPage agentId="key-claude" />);
    const changes = await screen.findByRole('list', { name: 'Changes' });
    const [deploy, secret] = within(changes).getAllByRole('listitem');
    expect(within(deploy).getByText('Deployed api')).toBeInTheDocument();
    expect(within(deploy).getByText('Ship the retry fix')).toBeInTheDocument();
    expect(within(deploy).getByText('Went through')).toBeInTheDocument();
    expect(within(deploy).getByText('After a person approved it')).toBeInTheDocument();
    expect(within(secret).getByText('POST /v1/apps/api/secrets')).toBeInTheDocument();
    expect(within(secret).getByText('Refused (409)')).toBeInTheDocument();
  });

  it('undoes only after showing the plan, and applies exactly that plan', async () => {
    const spies = routeApi(
      handlers({
        'POST /v1/agent-connections/{id}/undo/plan': () => PLAN,
        'POST /v1/agent-connections/{id}/undo': () => ({
          undone: 1,
          failed: 0,
          items: [{ ...PLAN.items[0], status: 'undone', result: 'undone' }],
        }),
      })
    );
    renderWithProviders(<AgentPage agentId="key-claude" />);
    await userEvent.click(await screen.findByRole('button', { name: 'See what undo would do' }));
    const plan = await screen.findByRole('list', { name: 'Undo plan' });
    expect(screen.getByText('1 of 2 changes will be undone.')).toBeInTheDocument();
    expect(within(plan).getByText('Will be undone')).toBeInTheDocument();
    expect(within(plan).getByText("Can't be undone")).toBeInTheDocument();
    expect(within(plan).getByText(/keeps no copy of a replaced secret/)).toBeInTheDocument();
    expect(spies.POST).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Undo 1 change' }));
    const dialog = await screen.findByRole('dialog', { name: /Undo 1 change by Claude Code/ });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Undo changes' }));
    await waitFor(() => expect(spies.POST).toHaveBeenCalledTimes(2));
    const [path, init] = spies.POST.mock.calls[1] as [string, { body: Record<string, unknown> }];
    expect(path).toBe('/v1/agent-connections/{id}/undo');
    expect(init.body).toMatchObject({ force: false, plan_digest: 'sha256:plan-1' });
    expect(init.body.since).toBe(
      (spies.POST.mock.calls[0] as [string, { body: { since: string } }])[1].body.since
    );
    expect(await screen.findByText('1 change undone.')).toBeInTheDocument();
  });

  it('plans again instead of applying when the changes moved (409)', async () => {
    let plans = 0;
    const spies = routeApi(
      handlers({
        'POST /v1/agent-connections/{id}/undo/plan': () => {
          plans += 1;
          return PLAN;
        },
        'POST /v1/agent-connections/{id}/undo': () => problem(409, 'conflict'),
      })
    );
    renderWithProviders(<AgentPage agentId="key-claude" />);
    await userEvent.click(await screen.findByRole('button', { name: 'See what undo would do' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Undo 1 change' }));
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: /Undo 1 change/ })).getByRole('button', {
        name: 'Undo changes',
      })
    );
    await waitFor(() => expect(plans).toBe(2));
    expect(spies.POST).toHaveBeenCalledTimes(3);
    expect(await screen.findByRole('list', { name: 'Undo plan' })).toBeInTheDocument();
  });

  it('says so when the agent is no longer connected', async () => {
    routeApi(handlers({ 'GET /v1/agent-connections': () => ({ items: [] }) }));
    renderWithProviders(<AgentPage agentId="key-claude" />);
    expect(await screen.findByText(/This agent is no longer connected/)).toBeInTheDocument();
  });

  it('uses the company’s routes and explains a colleague’s unreadable budget', async () => {
    workspace.org = 'acme';
    const spies = routeApi({
      'GET /v1/orgs/{slug}/agent-connections': () => ({
        items: [{ ...CLAUDE, member: 'poyraz@acme.dev' }],
      }),
      'GET /v1/agent-connections/{id}/budget': () => problem(404, 'not_found'),
      'GET /v1/orgs/{slug}/agent-connections/{id}/activity': () => ({ activity: [] }),
    });
    renderWithProviders(<AgentPage agentId="key-claude" />);
    expect(
      await screen.findByText(/Only poyraz@acme.dev can see and change its budget/)
    ).toBeInTheDocument();
    expect(await screen.findByText('No changes in the last 7 days.')).toBeInTheDocument();
    expect(spies.GET).toHaveBeenCalledWith(
      '/v1/orgs/{slug}/agent-connections/{id}/activity',
      expect.objectContaining({
        params: expect.objectContaining({ path: { slug: 'acme', id: 'key-claude' } }),
      })
    );
    expect(spies.GET).not.toHaveBeenCalledWith('/v1/agent-connections', expect.anything());
  });
});
