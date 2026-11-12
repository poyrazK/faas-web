import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectScope } from '@/lib/project-scope';

const scope = vi.hoisted(() => ({ current: null as unknown as ProjectScope }));
const list = vi.hoisted(() => ({ rows: [] as unknown[], hasNextPage: false }));

vi.mock('@/lib/project-scope', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/project-scope')>()),
  useProjectScope: () => scope.current,
}));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: object) => ({
    ...options,
    useSearch: () => ({}),
    useNavigate: () => vi.fn(),
  }),
}));
vi.mock('@/components/dashboard/async-invocations', () => ({
  AsyncInvocationsMaturity: () => null,
  InvocationDelivery: () => null,
  ReplayInvocationButton: () => null,
}));
vi.mock('@/lib/api/queries', () => ({
  useApps: () => ({
    data: [
      { id: 'app-1', slug: 'api-gateway' },
      { id: 'app-2', slug: 'nightly-etl' },
    ],
    isPending: false,
  }),
  useInfiniteInvocations: () => ({
    data: { pages: [{ invocations: list.rows }] },
    isPending: false,
    error: null,
    hasNextPage: list.hasNextPage,
    refetch: vi.fn(),
  }),
  useInvocation: () => ({ data: undefined, isPending: false, error: null }),
}));

const { Route } = await import('./dashboard.invocations');
const InvocationsPage = (Route as unknown as { component: React.ComponentType }).component;

const base = { label: '', choices: [] };
const NONE: ProjectScope = { ...base, project: null, appSlugs: null, settled: true };
const ACME: ProjectScope = {
  ...base,
  project: 'acme-shop',
  label: 'acme-shop',
  appSlugs: new Set(['api-gateway']),
  settled: true,
};
const LOADING: ProjectScope = { ...ACME, appSlugs: null, settled: false };

const row = (id: string, app_id: string) => ({
  id,
  app_id,
  state: 'completed',
  source: 'async_invoke',
  created_at: '2026-11-01T00:00:00Z',
});
const BOTH = [row('a'.repeat(32), 'app-1'), row('b'.repeat(32), 'app-2')];

const table = () => screen.getByRole('table');

beforeEach(() => {
  scope.current = NONE;
  list.rows = BOTH;
  list.hasNextPage = false;
});

describe('Invocations in a project', () => {
  it('lists only the project’s apps’ invocations', () => {
    scope.current = ACME;
    render(<InvocationsPage />);
    expect(within(table()).getByText('api-gateway')).toBeInTheDocument();
    expect(within(table()).queryByText('nightly-etl')).toBeNull();
  });

  it('names the project when it has none, and points further back when more pages exist', () => {
    scope.current = ACME;
    list.rows = [BOTH[1]];
    const { unmount } = render(<InvocationsPage />);
    expect(screen.getByText('No invocations recorded for acme-shop yet.')).toBeInTheDocument();
    unmount();
    list.hasNextPage = true;
    render(<InvocationsPage />);
    expect(screen.getByText(/No acme-shop invocations among the latest 1\./)).toBeInTheDocument();
  });

  it('lists every invocation without a project', () => {
    render(<InvocationsPage />);
    expect(within(table()).getByText('api-gateway')).toBeInTheDocument();
    expect(within(table()).getByText('nightly-etl')).toBeInTheDocument();
  });

  it('shows no unscoped rows while membership loads', () => {
    scope.current = LOADING;
    render(<InvocationsPage />);
    expect(screen.queryByText('api-gateway')).toBeNull();
    expect(screen.queryByText('nightly-etl')).toBeNull();
  });
});
