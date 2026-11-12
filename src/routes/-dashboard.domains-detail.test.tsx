import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// No project chosen (lib/project-scope.ts): the page behaves as before.
vi.mock('@/lib/project-scope', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/project-scope')>()),
  useProjectScope: () => ({ project: null, label: '', appSlugs: null, settled: true, choices: [] }),
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: object) => ({
    ...options,
    useSearch: () => ({}),
    useNavigate: () => vi.fn(),
  }),
  Link: () => null,
}));
vi.mock('@/lib/api/queries', () => ({
  useDomains: () => ({
    data: [
      { domain: 'a.example.com', app_id: 'app-1', verified: true },
      { domain: 'b.example.com', app_id: 'app-1', verified: false, txt_record: 'tok' },
    ],
    isPending: false,
    error: null,
    refetch: vi.fn(),
  }),
  useApps: () => ({ data: [{ id: 'app-1', slug: 'api' }] }),
  useAddDomain: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteDomain: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useVerifyDomain: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRetryDomain: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
// The add form's plan gate and environment choice (domain-add-form.tsx).
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
  useCapabilityAccess: () => ({ access: 'on', capability: undefined, refresh: vi.fn() }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/components/dashboard/domain-detail', () => ({
  DomainDetailButton: ({ domain }: { domain: string }) => <button>Details for {domain}</button>,
}));

const { Route } = await import('./dashboard.domains');
const DomainsPage = (Route as unknown as { component: React.ComponentType }).component;

describe('domains page detail', () => {
  it('gives every row, verified or not, a way into its detail', () => {
    render(<DomainsPage />);
    expect(screen.getAllByRole('button', { name: 'Details for a.example.com' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Details for b.example.com' })).toHaveLength(1);
  });
});
