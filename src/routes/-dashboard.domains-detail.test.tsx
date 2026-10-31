import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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
