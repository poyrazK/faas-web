import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { problem, renderWithProviders, routeApi, type Handlers } from '@/test/monetization';
import type { AgentConnection, AgentPolicy } from '@/lib/api/agents';

const workspace = vi.hoisted(() => ({
  org: 'acme' as string | null,
  label: 'Acme Corp',
  ready: true,
}));
vi.mock('@/lib/api/workspace-apps', () => ({ useWorkspaceTarget: () => workspace }));
vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: () => ({ access: 'on', capability: undefined, refresh: vi.fn() }),
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, className }: { children: ReactNode; className?: string }) => (
    <a href="#" className={className}>
      {children}
    </a>
  ),
}));

const { AgentPolicyPage } = await import('./agent-policy-page');

const EVERY = [
  'deploy:write',
  'secrets:request',
  'storage:manage',
  'postgres:manage',
  'env:write',
  'usage:read',
  'data:read',
];
const DEFAULT: AgentPolicy = {
  agents_allowed: true,
  allowed_scopes: EVERY,
  approval_categories: [],
  approval_channels: [],
};
const CURSOR: AgentConnection = {
  id: 'key-cursor',
  kind: 'hosted_mcp',
  client_name: 'Cursor',
  prefix: 'faas_live_e5f6',
  scopes: ['apps:read', 'deploy:write'],
  created_at: '2026-11-15T10:00:00Z',
  member: 'me@acme.dev',
};
const CODEX: AgentConnection = {
  id: 'key-codex',
  kind: 'hosted_mcp',
  client_name: 'Codex',
  prefix: 'faas_live_g7h8',
  scopes: ['apps:read', 'deploy:write', 'postgres:manage', 'postgres:read'],
  created_at: '2026-11-12T10:00:00Z',
  member: 'poyraz@acme.dev',
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
    'GET /v1/orgs/{slug}/agent-policy': () => DEFAULT,
    'GET /v1/orgs/{slug}/agent-connections': () => ({ items: [CURSOR, CODEX] }),
    'GET /v1/notification-channels': () => [SLACK],
    ...over,
  };
}

const putBody = (spies: ReturnType<typeof routeApi>) =>
  (spies.PUT.mock.calls[0] as [string, { body: Record<string, unknown> }])[1].body;

beforeEach(() => {
  workspace.org = 'acme';
  workspace.label = 'Acme Corp';
});
afterEach(() => vi.restoreAllMocks());

describe('AgentPolicyPage', () => {
  it('answers first, and says a policy nobody set is the default', async () => {
    const spies = routeApi(handlers());
    renderWithProviders(<AgentPolicyPage />);
    expect(await screen.findByRole('status', { name: 'Agent policy' })).toHaveTextContent(
      'Agents may act in Acme Corp, with every capability.'
    );
    expect(screen.getByText(/nobody has set a policy for Acme Corp/)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Allow agents' })).toBeChecked();
    const capabilities = screen.getByRole('list', { name: 'Capabilities' });
    expect(within(capabilities).getAllByRole('checkbox')).toHaveLength(8);
    expect(within(capabilities).getByRole('checkbox', { name: /Inspect apps/ })).toBeDisabled();
    expect(within(capabilities).getByRole('checkbox', { name: /Read app data/ })).toBeChecked();
    // Nothing to save until something changes.
    expect(screen.queryByRole('button', { name: 'Save policy' })).not.toBeInTheDocument();
    expect(spies.GET).toHaveBeenCalledWith(
      '/v1/orgs/{slug}/agent-policy',
      expect.objectContaining({ params: { path: { slug: 'acme' } } })
    );
  });

  it('saves required approvals and a ceiling without asking, when no agent is affected', async () => {
    const spies = routeApi(
      handlers({
        'PUT /v1/orgs/{slug}/agent-policy': ({ body }) => ({
          ...DEFAULT,
          ...(body as object),
          updated_at: '2026-11-21T10:00:00Z',
          revoked: 0,
        }),
      })
    );
    renderWithProviders(<AgentPolicyPage />);
    const approvals = await screen.findByRole('list', { name: 'Required approvals' });
    await userEvent.click(within(approvals).getByRole('checkbox', { name: /Changing production/ }));
    await userEvent.click(screen.getByRole('radio', { name: /A monthly ceiling/ }));
    await userEvent.type(screen.getByLabelText('Dollars a month'), '100');
    await userEvent.click(screen.getByRole('button', { name: 'Save policy' }));
    await waitFor(() => expect(spies.PUT).toHaveBeenCalledTimes(1));
    expect(spies.PUT.mock.calls[0][0]).toBe('/v1/orgs/{slug}/agent-policy');
    expect(putBody(spies)).toEqual({
      agents_allowed: true,
      allowed_scopes: [
        'deploy:write',
        'env:write',
        'secrets:request',
        'storage:manage',
        'postgres:manage',
        'usage:read',
        'data:read',
      ],
      approval_categories: ['production'],
      max_agent_budget_cents: 10000,
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Save policy' })).not.toBeInTheDocument()
    );
    expect(screen.queryByText(/nobody has set a policy/)).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Changing production/ })).toBeChecked();
  });

  it('names the agents a stricter policy disconnects, and saves only after a confirm', async () => {
    const spies = routeApi(
      handlers({
        'PUT /v1/orgs/{slug}/agent-policy': ({ body }) => ({
          ...DEFAULT,
          ...(body as object),
          updated_at: '2026-11-21T10:00:00Z',
          revoked: 1,
        }),
      })
    );
    renderWithProviders(<AgentPolicyPage />);
    await userEvent.click(await screen.findByRole('checkbox', { name: /Manage databases/ }));
    const bar = screen.getByRole('region', { name: 'Unsaved policy changes' });
    expect(bar).toHaveTextContent('Saving disconnects Codex.');
    await userEvent.click(within(bar).getByRole('button', { name: 'Save policy' }));
    const dialog = await screen.findByRole('dialog', { name: 'Save and disconnect Codex?' });
    expect(spies.PUT).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save and disconnect' }));
    await waitFor(() => expect(spies.PUT).toHaveBeenCalledTimes(1));
    expect(putBody(spies).allowed_scopes).not.toContain('postgres:manage');
    expect(await screen.findByText('1 agent was disconnected.')).toBeInTheDocument();
    expect(await screen.findByRole('status', { name: 'Agent policy' })).toHaveTextContent(
      'Agents may act in Acme Corp, but may not manage databases.'
    );
  });

  it('turns agents off: every agent goes, and the rest of the policy is kept', async () => {
    const spies = routeApi(
      handlers({
        'PUT /v1/orgs/{slug}/agent-policy': ({ body }) => ({
          ...DEFAULT,
          ...(body as object),
          updated_at: '2026-11-21T10:00:00Z',
          revoked: 2,
        }),
      })
    );
    renderWithProviders(<AgentPolicyPage />);
    await userEvent.click(await screen.findByRole('switch', { name: 'Allow agents' }));
    expect(screen.queryByRole('list', { name: 'Capabilities' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Unsaved policy changes' })).toHaveTextContent(
      'Saving disconnects Cursor and Codex.'
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save policy' }));
    await userEvent.click(
      within(
        await screen.findByRole('dialog', { name: 'Save and disconnect Cursor and Codex?' })
      ).getByRole('button', { name: 'Save and disconnect' })
    );
    await waitFor(() => expect(spies.PUT).toHaveBeenCalledTimes(1));
    expect(putBody(spies)).toEqual({ agents_allowed: false, allowed_scopes: EVERY });
    expect(await screen.findByRole('status', { name: 'Agent policy' })).toHaveTextContent(
      'Agents are not allowed in Acme Corp.'
    );
  });

  it('refuses a ceiling that is not money before calling the API', async () => {
    const spies = routeApi(handlers());
    renderWithProviders(<AgentPolicyPage />);
    await userEvent.click(await screen.findByRole('radio', { name: /A monthly ceiling/ }));
    await userEvent.type(screen.getByLabelText('Dollars a month'), 'lots');
    await userEvent.click(screen.getByRole('button', { name: 'Save policy' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a dollar amount');
    expect(spies.PUT).not.toHaveBeenCalled();
  });

  it('sends your channels only when you change them', async () => {
    const spies = routeApi(
      handlers({
        'PUT /v1/orgs/{slug}/agent-policy': ({ body }) => ({ ...DEFAULT, ...(body as object) }),
      })
    );
    renderWithProviders(<AgentPolicyPage />);
    await userEvent.click(await screen.findByRole('checkbox', { name: /ops-slack/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save policy' }));
    await waitFor(() => expect(spies.PUT).toHaveBeenCalledTimes(1));
    expect(putBody(spies)).toMatchObject({ approval_channels: ['ops-slack'] });
    expect(putBody(spies)).not.toHaveProperty('approval_categories');
  });

  it('discards unsaved changes', async () => {
    routeApi(handlers());
    renderWithProviders(<AgentPolicyPage />);
    const databases = await screen.findByRole('checkbox', { name: /Manage databases/ });
    await userEvent.click(databases);
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(databases).toBeChecked();
    expect(screen.queryByRole('button', { name: 'Save policy' })).not.toBeInTheDocument();
  });

  it('shows a member who cannot change it a policy they can only read', async () => {
    routeApi(
      handlers({
        'GET /v1/orgs/{slug}/agent-policy': () => ({
          ...DEFAULT,
          allowed_scopes: ['deploy:write'],
          max_agent_budget_cents: 5000,
          updated_at: '2026-11-20T10:00:00Z',
        }),
        'GET /v1/orgs/{slug}/agent-connections': () => problem(403, 'org_role_forbidden'),
      })
    );
    renderWithProviders(<AgentPolicyPage />);
    expect(
      await screen.findByText(/Only owners and admins of Acme Corp can change it/)
    ).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Allow agents' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /Deploy and change apps/ })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /Manage databases/ })).not.toBeChecked();
    expect(screen.getByLabelText('Dollars a month')).toHaveValue('50.00');
    expect(
      screen.queryByRole('heading', { name: 'Where requests reach you' })
    ).not.toBeInTheDocument();
  });

  it('explains that the personal account has no policy, and reads none', async () => {
    workspace.org = null;
    workspace.label = 'Personal';
    const spies = routeApi(handlers());
    renderWithProviders(<AgentPolicyPage />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'An agent policy belongs to an organization.'
    );
    expect(spies.GET).not.toHaveBeenCalled();
  });
});
