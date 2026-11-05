import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useCapabilityAccess = vi.fn();
const usePostgresBindings = vi.fn();
const useApps = vi.fn();
const workspace = vi.fn();
vi.mock('@/lib/api/capabilities', () => ({
  useCapability: (key: string) => ({ capability: { key, maturity: 'preview' } }),
  useCapabilityAccess: (key: string) => useCapabilityAccess(key) as unknown,
}));
vi.mock('@/lib/api/queries', () => ({
  usePostgresBindings: (id: string) => usePostgresBindings(id) as unknown,
  useApps: () => useApps() as unknown,
}));
vi.mock('@/lib/api/workspace-apps', () => ({ useWorkspaceTarget: () => workspace() as unknown }));

const { LiveQueries } = await import('./postgres-live-queries');

const database = { id: 'db-1', name: 'orders' } as Parameters<typeof LiveQueries>[0]['database'];
const binding = (over: Record<string, unknown>) => ({
  id: 'b1',
  database_id: 'db-1',
  app_id: 'app-1',
  scope: 'default',
  environment_key: 'DATABASE_URL',
  access: 'read_write',
  credential_generation: 1,
  rotation_pending: false,
  state: 'ready',
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  ...over,
});
const code = () => screen.getAllByRole('code').map((c) => c.textContent?.replace(/^\$\s*/, ''));

beforeEach(() => {
  useCapabilityAccess.mockReset().mockReturnValue({ access: 'on', refresh: vi.fn() });
  usePostgresBindings.mockReset().mockReturnValue({ data: { items: [] } });
  useApps.mockReset().mockReturnValue({ data: [{ id: 'app-1', slug: 'shop-data' }] });
  workspace.mockReset().mockReturnValue({ org: undefined, label: 'Personal', ready: true });
});

describe('LiveQueries', () => {
  it('renders nothing while the live-queries preview is off for the account', () => {
    useCapabilityAccess.mockReturnValue({ access: 'off', refresh: vi.fn() });
    const { container } = render(<LiveQueries database={database} />);
    expect(container).toBeEmptyDOMElement();
    expect(useCapabilityAccess).toHaveBeenCalledWith('live-queries');
    expect(usePostgresBindings).not.toHaveBeenCalled();
  });

  it('says a plan without live queries does not include them', () => {
    useCapabilityAccess.mockReturnValue({ access: 'plan-not-entitled', refresh: vi.fn() });
    render(<LiveQueries database={database} />);
    expect(screen.getByText(/not included in your plan/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View plans' })).toHaveAttribute(
      'href',
      '/dashboard/plans'
    );
  });

  it('explains live reads from the docs and says the switch is not shown, labelled Preview', () => {
    render(<LiveQueries database={database} />);
    expect(screen.getByRole('region', { name: 'Live queries' })).toBeInTheDocument();
    expect(screen.getByText('Preview')).toBeInTheDocument();
    expect(screen.getByText(/Row-level security decides every row/)).toBeInTheDocument();
    expect(screen.getByText(/realtime connection limit/)).toBeInTheDocument();
    expect(screen.getByText(/does not publish that switch yet/)).toBeInTheDocument();
  });

  it('hands over the database commands when no Data API serves it', () => {
    usePostgresBindings.mockReturnValue({ data: { items: [binding({ access: 'read_write' })] } });
    render(<LiveQueries database={database} />);
    expect(code()).toEqual([
      'gregale postgres live status db-1',
      'gregale postgres live enable db-1',
    ]);
  });

  it('prefers the Data API command, with its scope, when a data_api binding reaches it', () => {
    usePostgresBindings.mockReturnValue({
      data: { items: [binding({ access: 'data_api', scope: 'staging' })] },
    });
    render(<LiveQueries database={database} />);
    expect(code()).toEqual([
      'gregale data-api live status shop-data --scope staging',
      'gregale data-api live enable shop-data --scope staging',
    ]);
  });

  it('says organization databases cannot use live queries, with no command', () => {
    workspace.mockReturnValue({ org: 'acme', label: 'Acme Inc', ready: true });
    render(<LiveQueries database={database} />);
    expect(screen.getByText(/no organization route/)).toBeInTheDocument();
    expect(screen.queryAllByRole('code')).toHaveLength(0);
  });
});
