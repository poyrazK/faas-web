import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: object) => ({
    ...options,
    useSearch: () => ({}),
    useNavigate: () => vi.fn(),
  }),
  Link: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/lib/api/queries', () => ({
  useDomains: () => ({
    data: [
      {
        domain: 'api.example.com',
        app_id: 'app-1',
        verified: true,
        verified_at: '2026-09-11T00:00:00Z',
      },
      { domain: 'new.example.com', app_id: 'app-1', verified: false, txt_record: 'verify' },
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
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/components/dashboard/domain-doctor', () => ({ DomainDoctor: () => null }));
vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: () => ({ access: 'on', refresh: () => {} }),
}));

const { Route } = await import('./dashboard.domains');
const DomainsPage = (Route as unknown as { component: React.ComponentType }).component;

describe('Domains table', () => {
  it('shows when a domain was verified with the exact time on hover, and a dash when it was not', () => {
    render(<DomainsPage />);

    const when = screen.getByRole('time');
    expect(when).toHaveAttribute('dateTime', '2026-09-11T00:00:00.000Z');
    expect(when).toHaveAttribute('title', expect.stringContaining('2026'));
    expect(when).toHaveTextContent(/ago$/);

    expect(screen.getByText('new.example.com').closest('tr')).toHaveTextContent('—');
  });
});
