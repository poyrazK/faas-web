import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectScope } from '@/lib/project-scope';

let scope: ProjectScope;
vi.mock('@/lib/project-scope', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/project-scope')>()),
  useProjectScope: () => scope,
}));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: object) => ({
    options,
    useSearch: () => ({}),
    useNavigate: () => vi.fn(),
  }),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));

const instance = (id: string, app_id: string) => ({
  id,
  app_id,
  deployment_id: 'dep',
  state: 'running',
  ram_mb: 256,
  started_at: '2026-11-10T10:00:00Z',
});
let appsPending = false;
vi.mock('@/lib/api/queries', () => ({
  useApps: () => ({
    data: appsPending
      ? undefined
      : [
          { id: 'a1', slug: 'api-gateway' },
          { id: 'a2', slug: 'nightly-etl' },
        ],
    isPending: appsPending,
    error: null,
    refetch: vi.fn(),
  }),
  useInfiniteInstances: () => ({
    data: { pages: [{ instances: [instance('vm-1', 'a1'), instance('vm-2', 'a2')] }] },
    isPending: false,
    error: null,
    refetch: vi.fn(),
    hasNextPage: false,
  }),
}));
vi.mock('@/components/dashboard/instance-detail', () => ({ InstanceDetail: () => null }));

const { Route } = await import('./dashboard.instances');
const Page = Route.options.component as () => ReactNode;

const project = (slugs: string[] | null, settled = true): ProjectScope => ({
  project: 'acme-shop',
  label: 'acme-shop',
  appSlugs: slugs ? new Set(slugs) : null,
  settled,
  choices: [],
});

beforeEach(() => {
  appsPending = false;
});

describe('Instances inside a project', () => {
  it('lists only the project’s instances', () => {
    scope = project(['api-gateway']);
    render(<Page />);
    expect(screen.getByText('api-gateway')).toBeInTheDocument();
    expect(screen.queryByText('nightly-etl')).toBeNull();
  });

  it('says none of the project’s apps is running, by name', () => {
    scope = project(['image-resize']);
    render(<Page />);
    expect(
      screen.getByText('No instances running in acme-shop — every app is parked.')
    ).toBeInTheDocument();
  });

  it('words the standalone scope as standalone apps', () => {
    scope = { ...project(['pr-42-api-gateway']), project: '_standalone', label: 'Standalone apps' };
    render(<Page />);
    expect(
      screen.getByText('No instances running among standalone apps — every app is parked.')
    ).toBeInTheDocument();
  });

  it('shows the loading state, not every instance, while membership or apps load', () => {
    scope = project(null, false);
    const { unmount } = render(<Page />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(screen.queryByText('nightly-etl')).toBeNull();
    unmount();
    scope = project(['api-gateway']);
    appsPending = true;
    render(<Page />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(screen.queryByText('a2')).toBeNull();
  });
});

describe('Instances with no project', () => {
  it('lists every instance, as before', () => {
    scope = { project: null, label: '', appSlugs: null, settled: true, choices: [] };
    render(<Page />);
    expect(screen.getByText('api-gateway')).toBeInTheDocument();
    expect(screen.getByText('nightly-etl')).toBeInTheDocument();
  });
});
