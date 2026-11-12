import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
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
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));

const app = (id: string, runtime = 'node') => ({
  id,
  name: id,
  runtime,
  state: 'running',
  memoryMb: 256,
  invocations24h: 3,
  avgDurationMs: 42,
  errorRatePct: 0,
  lastDeployedAt: Date.now() - 86_400_000,
  metricsUnavailable: false,
});
vi.mock('@/lib/store', () => ({
  useData: () => ({
    workflows: [app('api-gateway'), app('nightly-etl', 'python'), app('pr-42-api-gateway')],
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));
vi.mock('@/components/dashboard/recently-deleted-apps', () => ({
  RecentlyDeletedApps: ({ note }: { note?: string | null }) => (
    <p data-testid="deleted">{note ?? 'no note'}</p>
  ),
}));

const { Route } = await import('./dashboard.apps.index');
const Page = Route.options.component as () => ReactNode;

const project = (slug: string, slugs: string[] | null, settled = true): ProjectScope => ({
  project: slug,
  label: slug === '_standalone' ? 'Standalone apps' : slug,
  appSlugs: slugs ? new Set(slugs) : null,
  settled,
  choices: [],
});

describe('Apps inside a project', () => {
  it('lists only the project’s apps under its name, and says deleted apps are account-wide', () => {
    scope = project('acme-shop', ['api-gateway']);
    render(<Page />);
    expect(screen.getByRole('heading', { name: 'Apps in acme-shop' })).toBeInTheDocument();
    expect(screen.getAllByText('api-gateway').length).toBeGreaterThan(0);
    expect(screen.queryByText('nightly-etl')).toBeNull();
    // The runtime filter offers only what the project runs.
    expect(screen.queryByRole('option', { name: 'python' })).toBeNull();
    expect(screen.getByTestId('deleted')).toHaveTextContent(
      'Account-wide — not limited to acme-shop.'
    );
  });

  it('lists standalone apps under “Standalone apps”', () => {
    scope = project('_standalone', ['pr-42-api-gateway']);
    render(<Page />);
    expect(screen.getByRole('heading', { name: 'Standalone apps' })).toBeInTheDocument();
    expect(screen.getAllByText('pr-42-api-gateway').length).toBeGreaterThan(0);
    expect(screen.queryByText('nightly-etl')).toBeNull();
  });

  it('names the project when it has no apps', () => {
    scope = project('acme-shop', []);
    const { unmount } = render(<Page />);
    expect(screen.getByText('No apps in acme-shop yet.')).toBeInTheDocument();
    unmount();
    scope = project('_standalone', []);
    render(<Page />);
    expect(
      screen.getByText('No standalone apps — every app belongs to a project.')
    ).toBeInTheDocument();
  });

  it('shows the loading state, not every app, while membership loads', () => {
    scope = project('acme-shop', null, false);
    render(<Page />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(screen.queryByText('nightly-etl')).toBeNull();
    expect(screen.queryByText(/No apps/)).toBeNull();
  });
});

describe('Apps with no project', () => {
  it('lists every app under “Apps”, as before', () => {
    scope = { project: null, label: '', appSlugs: null, settled: true, choices: [] };
    render(<Page />);
    expect(screen.getByRole('heading', { name: 'Apps' })).toBeInTheDocument();
    expect(screen.getAllByText('nightly-etl').length).toBeGreaterThan(0);
    expect(screen.getByTestId('deleted')).toHaveTextContent('no note');
  });
});
