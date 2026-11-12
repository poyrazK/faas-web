import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectScope } from '@/lib/project-scope';

const scope = vi.hoisted(() => ({ current: null as unknown as ProjectScope }));
const domains = vi.hoisted(() => ({ current: [] as unknown[] }));

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
  Link: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/lib/api/queries', () => ({
  useDomains: () => ({ data: domains.current, isPending: false, error: null, refetch: vi.fn() }),
  useApps: () => ({
    data: [
      { id: 'app-1', slug: 'api-gateway' },
      { id: 'app-2', slug: 'nightly-etl' },
    ],
    isPending: false,
  }),
  useAddDomain: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteDomain: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRetryDomain: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/components/dashboard/domain-doctor', () => ({ DomainDoctor: () => null }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { id: 'acct-1', plan: 'pro' } }) }));
vi.mock('@/lib/api/projects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/projects')>()),
  useProjectMembership: () => ({
    projectOfApp: new Map(),
    state: 'ready',
    list: { error: null },
    details: [],
    retry: () => {},
  }),
  useProjectEnvironments: () => ({
    data: undefined,
    isPending: true,
    error: null,
    refetch: () => {},
  }),
}));
vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: () => ({ access: 'on', refresh: () => {} }),
}));

const { Route } = await import('./dashboard.domains');
const DomainsPage = (Route as unknown as { component: React.ComponentType }).component;

const base = { label: '', choices: [] };
const NONE: ProjectScope = { ...base, project: null, appSlugs: null, settled: true };
const ACME: ProjectScope = {
  ...base,
  project: 'acme-shop',
  label: 'acme-shop',
  appSlugs: new Set(['api-gateway']),
  settled: true,
};
const LOADING: ProjectScope = {
  ...base,
  project: 'acme-shop',
  label: 'acme-shop',
  appSlugs: null,
  settled: false,
};

const BOTH = [
  { domain: 'shop.example.com', app_id: 'app-1', verified: true },
  { domain: 'etl.example.com', app_id: 'app-2', verified: true },
];

beforeEach(() => {
  scope.current = NONE;
  domains.current = BOTH;
});

describe('Domains in a project', () => {
  it('lists only the domains routing to the project’s apps', () => {
    scope.current = ACME;
    render(<DomainsPage />);
    expect(screen.getByRole('article', { name: 'shop.example.com' })).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'etl.example.com' })).toBeNull();
  });

  it('names the project when it has no domains', () => {
    scope.current = ACME;
    domains.current = [BOTH[1]];
    render(<DomainsPage />);
    expect(screen.getByText(/No custom domains in acme-shop yet/)).toBeInTheDocument();
  });

  it('routes a new domain only to the project’s apps', async () => {
    scope.current = ACME;
    render(<DomainsPage />);
    await userEvent.click(screen.getByRole('button', { name: /add domain/i }));
    const sheet = await screen.findByRole('dialog');
    const picker = within(sheet).getByRole('combobox', { name: 'Routes to' });
    expect(
      within(picker)
        .getAllByRole('option')
        .map((o) => o.textContent)
    ).toEqual(['api-gateway']);
  });

  it('lists every domain without a project', () => {
    render(<DomainsPage />);
    expect(screen.getByRole('article', { name: 'shop.example.com' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'etl.example.com' })).toBeInTheDocument();
  });

  it('keeps loading, never the whole account, while membership loads', () => {
    scope.current = LOADING;
    render(<DomainsPage />);
    expect(screen.getByText('Loading domains…')).toBeInTheDocument();
    expect(screen.queryByRole('article')).toBeNull();
  });
});
