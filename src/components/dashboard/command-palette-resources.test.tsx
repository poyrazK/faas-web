import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { CommandPalette } from './command-palette';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  retry: vi.fn(),
  load: vi.fn(),
  loading: false,
  errors: [] as Error[],
  more: false,
  empty: false,
}));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
  useRouterState: () => ({ pathname: '/dashboard', search: {}, hash: '' }),
}));
vi.mock('@/lib/store', () => ({ useData: () => ({ workflows: [] }) }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { id: 'account1' } }) }));
vi.mock('@/lib/api/palette', () => ({
  usePaletteResources: (_account: string, _open: boolean, query: string) => ({
    enabled: Boolean(query.trim()),
    loading: mocks.loading,
    errors: mocks.errors,
    retry: mocks.retry,
    moreDeployments: mocks.more,
    moreInvocations: mocks.more,
    loadDeployments: mocks.load,
    loadInvocations: mocks.load,
    appName: () => 'api',
    deployments: mocks.empty ? [] : [{ id: 'deployment-id', appId: 'app1', status: 'failed' }],
    domains: mocks.empty ? [] : [{ hostname: 'api.example.com', appId: 'app1', verified: true }],
    keys: mocks.empty ? [] : [{ id: 'key-id', label: 'api-bot', scopes: ['apps:read'] }],
    invocations: mocks.empty ? [] : [{ id: 'invocation-id', appId: 'app1', status: 'failed' }],
  }),
}));
beforeEach(() => {
  mocks.navigate.mockReset();
  mocks.retry.mockReset();
  mocks.load.mockReset();
  mocks.loading = false;
  mocks.errors = [];
  mocks.more = false;
  mocks.empty = false;
});
const search = async (query: string) => {
  render(<CommandPalette open onOpenChange={vi.fn()} />);
  await userEvent.type(screen.getByRole('combobox'), query);
};

describe('palette resource results', () => {
  it('keeps resource types grouped while searching', async () => {
    await search('api');
    const list = screen.getByRole('listbox');
    const headers = within(list)
      .getAllByRole('presentation')
      .map((row) => row.textContent);
    expect(headers).toEqual(
      expect.arrayContaining(['Deployments', 'Domains', 'API keys', 'Invocations'])
    );
    expect(screen.getByText(/includes loaded pages/)).toBeInTheDocument();
  });

  it.each([
    [
      'Deployment deployment-id',
      '/dashboard/deployments',
      { deployment: 'deployment-id', releaseSection: 'overview' },
    ],
    ['api.example.com', '/dashboard/domains', { doctor: 'api.example.com' }],
    ['api-bot', '/dashboard/settings', { section: 'api-keys', scope: 'personal', key: 'key-id' }],
    ['Invocation invocation-id', '/dashboard/traces', { invocation: 'invocation-id' }],
  ])('opens the detail destination for %s', async (label, to, params) => {
    await search('api');
    await userEvent.click(
      screen.getByRole('option', { name: new RegExp(label.replaceAll('.', '\\.')) })
    );
    expect(mocks.navigate).toHaveBeenCalledWith({ to, search: params });
    expect(localStorage.getItem('gregale.palette.recent')).toContain('resource-account1-');
  });

  it('supports keyboard selection of resource results', async () => {
    await search('invocation-id');
    await userEvent.keyboard('{End}{Enter}');
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/dashboard/traces',
      search: { invocation: 'invocation-id' },
    });
  });

  it('reports partial failures and loading while keeping authorized matches usable', async () => {
    mocks.loading = true;
    mocks.errors = [
      new ApiError({ status: 403, code: 'forbidden', title: 'Keys require permission' }),
    ];
    await search('api');
    expect(screen.getByRole('status')).toHaveTextContent('Searching account resources');
    expect(screen.getByRole('alert')).toHaveTextContent('Keys require permission');
    expect(screen.getByRole('option', { name: /api.example.com/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry resource search' }));
    expect(mocks.retry).toHaveBeenCalledOnce();
  });

  it('explains an empty result and offers older history rather than claiming an exhaustive search', async () => {
    mocks.empty = true;
    mocks.more = true;
    await search('unmatched-xyz');
    expect(screen.getByText(/No matches for/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Search older deployments' }));
    await userEvent.click(screen.getByRole('button', { name: 'Search older invocations' }));
    expect(mocks.load).toHaveBeenCalledTimes(2);
  });
});
