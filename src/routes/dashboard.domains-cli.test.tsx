import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useDomains = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: object) => ({
    ...options,
    useSearch: () => ({}),
    useNavigate: () => vi.fn(),
  }),
}));
vi.mock('@/lib/api/queries', () => ({
  useDomains: () => useDomains() as unknown,
  useApps: () => ({ data: [{ id: 'app-1', slug: 'api' }] }),
  useAddDomain: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteDomain: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useVerifyDomain: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/components/dashboard/resource-table', () => ({
  Pill: () => null,
  ResourceTable: () => null,
}));
vi.mock('@/components/dashboard/domain-doctor', () => ({ DomainDoctor: () => null }));

const { Route } = await import('./dashboard.domains');
const DomainsPage = (Route as unknown as { component: React.ComponentType }).component;

const domain = (name: string, verified: boolean) => ({
  domain: name,
  app_id: 'app-1',
  verified,
  verified_at: verified ? '2026-10-01T00:00:00Z' : null,
  txt_record: verified ? null : 'gregale-verify=abc',
});
const ready = (data: unknown[]) => ({ data, isPending: false, error: null, refetch: vi.fn() });

beforeEach(() => {
  useDomains.mockReset().mockReturnValue(ready([]));
});

describe('domains page CLI commands', () => {
  it('gives the set-default command for a verified domain and names the app it affects', () => {
    useDomains.mockReturnValue(
      ready([domain('b.example.com', true), domain('a.example.com', true)])
    );
    render(<DomainsPage />);

    expect(screen.getByText('gregale domains set-default a.example.com')).toBeInTheDocument();
    expect(screen.getByText(/default domain for api/i)).toBeInTheDocument();
  });

  it('offers no set-default command while no domain is verified', () => {
    useDomains.mockReturnValue(ready([domain('pending.example.com', false)]));
    render(<DomainsPage />);

    expect(screen.queryByText(/gregale domains set-default/)).not.toBeInTheDocument();
  });
});
