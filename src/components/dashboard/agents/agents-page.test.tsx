import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { problem, renderWithProviders, routeApi, type Handlers } from '@/test/monetization';
import type { AgentApproval, AgentBudget, AgentConnection } from '@/lib/api/agents';

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

const { AgentsPage } = await import('./agents-page');

const CLAUDE: AgentConnection = {
  id: 'key-claude',
  kind: 'hosted_mcp',
  client_name: 'Claude Code',
  label: 'mcp-login',
  prefix: 'faas_live_a1b2',
  scopes: ['apps:read', 'deploy:write'],
  created_at: '2026-11-15T10:00:00Z',
  last_used_at: '2026-11-21T09:00:00Z',
  approvals: ['delete', 'production', 'credentials', 'billing'],
};
const CI: AgentConnection = {
  id: 'key-ci',
  kind: 'agent_key',
  label: 'ci-agent',
  prefix: 'faas_live_c3d4',
  scopes: ['agent', 'apps:read'],
  created_at: '2026-11-02T10:00:00Z',
  projects: ['acme-shop'],
  approvals: [],
};
const BUDGET: AgentBudget = {
  source: 'plan_default',
  monthly_cents: 2500,
  spent_cents: 640,
  month: '2026-11',
};
const PENDING: AgentApproval = {
  id: '11111111-1111-4111-8111-111111111111',
  agent: 'Claude Code',
  category: 'production',
  method: 'POST',
  path: '/v1/apps/api/deployments',
  body_bound: true,
  status: 'pending',
  reason: 'Deploy the reviewed fix',
  review_url: 'https://api.gregale.dev/cli-auth?agent_approval=1111',
  created_at: '2026-11-21T09:50:00Z',
  expires_at: '2099-01-01T00:00:00Z',
};
const SLACK = {
  id: '6a1f5b2e-0c1d-4e2f-8a9b-0c1d2e3f4a5b',
  name: 'ops-slack',
  kind: 'slack',
  target: 'hooks.slack.com',
  created_at: '2026-10-01T00:00:00Z',
};

function handlers(over: Handlers = {}): Handlers {
  return {
    'GET /v1/agent-connections': () => ({ items: [CLAUDE, CI] }),
    'GET /v1/agent-approvals': () => ({ items: [] }),
    'GET /v1/agent-connections/{id}/budget': () => BUDGET,
    'GET /v1/agent-approvals/channels': () => ({ channels: [] }),
    'GET /v1/notification-channels': () => [SLACK],
    ...over,
  };
}

beforeEach(() => {
  workspace.org = null;
  workspace.label = 'Personal';
  navigate.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe('AgentsPage', () => {
  it('answers first: how many agents, and that nothing is waiting', async () => {
    routeApi(handlers());
    renderWithProviders(<AgentsPage />);
    expect(await screen.findByRole('status', { name: 'Agents status' })).toHaveTextContent(
      '2 agents are connected. Nothing is waiting for you.'
    );
    expect(screen.queryByRole('heading', { name: 'Waiting for you' })).not.toBeInTheDocument();
  });

  it('describes each agent in plain words, with its budget', async () => {
    routeApi(handlers());
    renderWithProviders(<AgentsPage />);
    const claude = (await screen.findByText('Claude Code')).closest('tr')!;
    expect(claude).toHaveTextContent('Signed in · Can make changes');
    expect(within(claude).getByText('Every project')).toBeInTheDocument();
    expect(await within(claude).findByText('$6.40 of $25.00')).toBeInTheDocument();
    const ci = screen.getByText('ci-agent').closest('tr')!;
    expect(ci).toHaveTextContent('Agent key · Read only');
    expect(within(ci).getByText('acme-shop')).toBeInTheDocument();
    expect(within(ci).getByText('Nothing')).toBeInTheDocument();
    expect(within(ci).getByText('Never')).toBeInTheDocument();
  });

  it('puts a waiting request first, with the agent’s reason and a review link', async () => {
    routeApi(handlers({ 'GET /v1/agent-approvals': () => ({ items: [PENDING] }) }));
    renderWithProviders(<AgentsPage />);
    expect(await screen.findByRole('status', { name: 'Agents status' })).toHaveTextContent(
      '1 request is waiting for your approval.'
    );
    const requests = screen.getByRole('list', { name: 'Approval requests' });
    expect(within(requests).getByText('Claude Code wants to change production')).toBeVisible();
    expect(within(requests).getByText('Deploy the reviewed fix')).toBeVisible();
    expect(within(requests).getByText('POST /v1/apps/api/deployments')).toBeVisible();
    const review = within(requests).getByRole('link', { name: /Review/ });
    expect(review).toHaveAttribute('href', PENDING.review_url);
    expect(review).toHaveAttribute('rel', 'noreferrer');
  });

  it('opens an agent’s own page from its row', async () => {
    routeApi(handlers());
    renderWithProviders(<AgentsPage />);
    await userEvent.click(await screen.findByText('Claude Code'));
    expect(navigate).toHaveBeenCalledWith({
      to: '/dashboard/agents/$agentId',
      params: { agentId: 'key-claude' },
    });
  });

  it('disconnects an agent only after a confirm', async () => {
    const spies = routeApi(handlers({ 'DELETE /v1/agent-connections/{id}': () => undefined }), {
      'DELETE /v1/agent-connections/{id}': 204,
    });
    renderWithProviders(<AgentsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for ci-agent' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Disconnect' }));
    expect(spies.DELETE).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog', { name: 'Disconnect ci-agent?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
    await waitFor(() =>
      expect(spies.DELETE).toHaveBeenCalledWith('/v1/agent-connections/{id}', {
        params: { path: { id: 'key-ci' } },
      })
    );
  });

  it('invites a first connection when there are none', async () => {
    routeApi(handlers({ 'GET /v1/agent-connections': () => ({ items: [] }) }));
    renderWithProviders(<AgentsPage />);
    expect(await screen.findByRole('status', { name: 'Agents status' })).toHaveTextContent(
      'No agents are connected.'
    );
    const buttons = await screen.findAllByRole('button', { name: 'Connect an agent' });
    await userEvent.click(buttons[buttons.length - 1]);
    const dialog = await screen.findByRole('dialog', { name: 'Connect an agent' });
    expect(within(dialog).getByText('gregale mcp connect')).toBeInTheDocument();
    expect(within(dialog).getByText('https://api.gregale.dev/mcp')).toBeInTheDocument();
  });

  it('saves the channels approval requests also go to', async () => {
    const spies = routeApi(
      handlers({
        'PUT /v1/agent-approvals/channels': ({ body }) => body,
      })
    );
    renderWithProviders(<AgentsPage />);
    await userEvent.click(await screen.findByRole('checkbox', { name: /ops-slack/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(spies.PUT).toHaveBeenCalledWith('/v1/agent-approvals/channels', {
        body: { channels: ['ops-slack'] },
      })
    );
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    );
    expect(screen.getByRole('checkbox', { name: /ops-slack/ })).toBeChecked();
  });

  it('reads a company’s agents from its own routes, and never the personal ones', async () => {
    workspace.org = 'acme';
    workspace.label = 'Acme Corp';
    const spies = routeApi({
      'GET /v1/orgs/{slug}/agent-connections': () => ({
        items: [{ ...CLAUDE, member: 'poyraz@acme.dev' }],
      }),
      'GET /v1/agent-approvals': () => ({ items: [] }),
      // Another member's agent: its budget is not this person's to read.
      'GET /v1/agent-connections/{id}/budget': () => problem(404, 'not_found'),
      'GET /v1/orgs/{slug}/agent-policy': () => ({
        agents_allowed: true,
        allowed_scopes: ['deploy:write'],
        approval_categories: ['delete'],
        max_agent_budget_cents: 10000,
      }),
    });
    renderWithProviders(<AgentsPage />);
    const row = (await screen.findByText('Claude Code')).closest('tr')!;
    expect(within(row).getByText(/poyraz@acme.dev/)).toBeInTheDocument();
    // The company's policy, in a sentence, with the way to its page.
    expect(
      await screen.findByText('Agents in Acme Corp may inspect apps, and deploy and change apps.')
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Every agent asks a person before deletes. No agent's always-on budget can pass $100.00 a month."
      )
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open policy' })).toBeInTheDocument();
    expect(spies.GET).toHaveBeenCalledWith(
      '/v1/orgs/{slug}/agent-connections',
      expect.objectContaining({ params: { path: { slug: 'acme' } } })
    );
    expect(spies.GET).not.toHaveBeenCalledWith('/v1/agent-connections', expect.anything());
    expect(spies.GET).not.toHaveBeenCalledWith('/v1/agent-approvals/channels', expect.anything());
    expect(
      screen.queryByRole('heading', { name: 'Where requests reach you' })
    ).not.toBeInTheDocument();
  });

  it('explains a company list only owners and admins may read', async () => {
    workspace.org = 'acme';
    workspace.label = 'Acme Corp';
    routeApi({
      'GET /v1/orgs/{slug}/agent-connections': () => problem(403, 'org_role_forbidden'),
      'GET /v1/agent-approvals': () => ({ items: [] }),
      // Every member may read the policy, whatever their role.
      'GET /v1/orgs/{slug}/agent-policy': () => ({ agents_allowed: false, allowed_scopes: [] }),
    });
    renderWithProviders(<AgentsPage />);
    expect(
      await screen.findByText(/Only owners and admins of Acme Corp can see the agents/)
    ).toBeInTheDocument();
    expect(await screen.findByText('Agents are not allowed in Acme Corp.')).toBeInTheDocument();
  });
});
