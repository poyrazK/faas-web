import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectScope } from '@/lib/project-scope';

let scope: ProjectScope;
vi.mock('@/lib/project-scope', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/project-scope')>()),
  useProjectScope: () => scope,
}));

let search: Record<string, unknown> = {};
let hasNextPage = false;
const childScopes: Record<string, unknown> = {};

vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({ useSearch: () => search, useNavigate: () => vi.fn() }),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

const apps = [
  { id: 'a1', slug: 'api-gateway' },
  { id: 'a2', slug: 'nightly-etl' },
];
const deployment = (id: string, app_id: string) => ({
  id,
  app_id,
  image_digest: '',
  kind: 'github',
  status: 'live',
  created_at: '2026-11-10T10:00:00Z',
});
const build = (id: string, deployment_id: string) => ({
  id,
  deployment_id,
  kind: 'github',
  source_bytes: 1024,
  status: 'succeeded',
  enqueued_at: '2026-11-10T10:00:00Z',
});
let deployments: unknown[];
let builds: unknown[];
const page = (items: unknown[]) => ({
  data: { pages: [{ items }] },
  isPending: false,
  error: null,
  refetch: vi.fn(),
  fetchNextPage: vi.fn(),
  hasNextPage,
  isFetchingNextPage: false,
});

vi.mock('@/lib/api/queries', () => ({
  useApps: () => ({ data: apps, isPending: false, error: null, refetch: vi.fn() }),
  useBuildRecords: () => [],
  useInfiniteBuilds: () => page(builds),
  useInfiniteDeployments: () => page(deployments),
}));
vi.mock('@/components/dashboard/deploy-queue', () => ({
  DeployQueue: ({ scope }: { scope: unknown }) => {
    childScopes.queue = scope;
    return null;
  },
}));
vi.mock('@/components/dashboard/release-safety', () => ({
  WorkspaceReleaseGuards: ({ scope }: { scope: unknown }) => {
    childScopes.guards = scope;
    return null;
  },
}));
vi.mock('@/components/dashboard/release-previews', () => ({
  ReleasePreviews: ({ scope }: { scope: unknown }) => {
    childScopes.previews = scope;
    return null;
  },
}));
vi.mock('@/components/dashboard/release-detail', () => ({ ReleaseDetailPanel: () => null }));

const { DeploymentsPage } = await import('@/components/dashboard/pages/releases');

const project = (slugs: string[] | null, settled = true): ProjectScope => ({
  project: 'acme-shop',
  label: 'acme-shop',
  appSlugs: slugs ? new Set(slugs) : null,
  settled,
  choices: [],
});

beforeEach(() => {
  search = {};
  hasNextPage = false;
  deployments = [deployment('d1', 'a1'), deployment('d2', 'a2')];
  builds = [build('b1', 'd1'), build('b2', 'd2'), build('b3', 'd-unloaded')];
  for (const key of Object.keys(childScopes)) delete childScopes[key];
});

describe('Releases inside a project', () => {
  it('lists only the project’s releases and hands the scope to the queue, guards and previews', () => {
    scope = project(['api-gateway']);
    render(<DeploymentsPage />);
    expect(screen.getByText('api-gateway')).toBeInTheDocument();
    expect(screen.queryByText('nightly-etl')).toBeNull();
    for (const child of ['queue', 'guards', 'previews'])
      expect(childScopes[child]).toMatchObject({ scope: { project: 'acme-shop' } });
  });

  it('places builds through their release and counts the ones it cannot place', () => {
    scope = project(['api-gateway']);
    search = { view: 'builds' };
    render(<DeploymentsPage />);
    expect(screen.getByRole('button', { name: /Copy: build ID b1/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Copy: build ID b2/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Copy: build ID b3/i })).toBeNull();
    expect(screen.getByText(/1 build not shown: their release hasn’t loaded/)).toHaveTextContent(
      'belong in acme-shop'
    );
  });

  it('says the project has no releases yet, by name', () => {
    scope = project(['image-resize']);
    render(<DeploymentsPage />);
    expect(screen.getByText('No releases in acme-shop yet.')).toBeInTheDocument();
  });

  it('does not claim the project has none while older pages are unread', () => {
    scope = project(['image-resize']);
    hasNextPage = true;
    render(<DeploymentsPage />);
    expect(screen.getByText(/No releases in acme-shop among the account’s latest/)).toBeVisible();
  });

  it('shows the loading state, not every release, while membership loads', () => {
    scope = project(null, false);
    render(<DeploymentsPage />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(screen.queryByText('api-gateway')).toBeNull();
    expect(screen.queryByText('nightly-etl')).toBeNull();
    expect(screen.queryByText(/No releases/)).toBeNull();
  });

  it('says membership failed rather than showing an empty project', () => {
    scope = project(null, true);
    render(<DeploymentsPage />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Couldn’t read which apps are in acme-shop'
    );
    expect(screen.queryByText(/No releases/)).toBeNull();
  });
});

describe('Releases with no project', () => {
  it('lists every release and every build, as before', () => {
    scope = { project: null, label: '', appSlugs: null, settled: true, choices: [] };
    const { unmount } = render(<DeploymentsPage />);
    expect(screen.getByText('api-gateway')).toBeInTheDocument();
    expect(screen.getByText('nightly-etl')).toBeInTheDocument();
    unmount();
    search = { view: 'builds' };
    render(<DeploymentsPage />);
    expect(screen.getAllByRole('button', { name: /Copy: build ID/i })).toHaveLength(3);
    expect(screen.queryByText(/not shown/)).toBeNull();
  });
});
