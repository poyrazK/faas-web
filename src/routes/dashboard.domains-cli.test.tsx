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
  useApps: () => ({
    data: [
      { id: 'app-1', slug: 'api' },
      { id: 'app-2', slug: 'web' },
    ],
  }),
  useAddDomain: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteDomain: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useVerifyDomain: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRetryDomain: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/components/dashboard/resource-table', () => ({
  Pill: () => null,
  ResourceTable: () => null,
}));
vi.mock('@/components/dashboard/domain-doctor', () => ({ DomainDoctor: () => null }));
vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: () => ({ access: 'on', refresh: () => {} }),
}));

const { Route } = await import('./dashboard.domains');
const DomainsPage = (Route as unknown as { component: React.ComponentType }).component;

const domain = (name: string, verified: boolean, over: Record<string, unknown> = {}) => ({
  domain: name,
  app_id: 'app-1',
  verified,
  default: false,
  ...over,
  verified_at: verified ? '2026-10-01T00:00:00Z' : null,
  txt_record: verified ? null : 'gregale-verify=abc',
});
const ready = (data: unknown[]) => ({ data, isPending: false, error: null, refetch: vi.fn() });

beforeEach(() => {
  useDomains.mockReset().mockReturnValue(ready([]));
});

describe('domains page CLI commands', () => {
  it('gives a set-default command for each verified domain that is not yet the default', () => {
    useDomains.mockReturnValue(
      ready([domain('b.example.com', true), domain('a.example.com', true)])
    );
    render(<DomainsPage />);

    expect(screen.getByText('gregale domains set-default a.example.com')).toBeInTheDocument();
    expect(screen.getByText('gregale domains set-default b.example.com')).toBeInTheDocument();
    expect(screen.getByText(/Make a\.example\.com the default domain for api/)).toBeInTheDocument();
  });

  it('names each set-default copy button after its domain, as a noun', () => {
    useDomains.mockReturnValue(
      ready([domain('b.example.com', true), domain('a.example.com', true)])
    );
    render(<DomainsPage />);

    expect(
      screen.getByRole('button', { name: 'Copy: set-default command for a.example.com' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Copy: set-default command for b.example.com' })
    ).toBeInTheDocument();
  });

  it('does not offer a domain that is already its app default', () => {
    useDomains.mockReturnValue(
      ready([
        domain('a.example.com', true),
        domain('b.example.com', true, { default: true }),
        domain('c.example.com', true),
      ])
    );
    render(<DomainsPage />);

    expect(screen.getByText('gregale domains set-default a.example.com')).toBeInTheDocument();
    expect(screen.getByText('gregale domains set-default c.example.com')).toBeInTheDocument();
    expect(screen.queryByText('gregale domains set-default b.example.com')).not.toBeInTheDocument();
  });

  it('offers a command for every app that has a candidate, not only the first', () => {
    useDomains.mockReturnValue(
      ready([domain('a.example.com', true), domain('shop.example.com', true, { app_id: 'app-2' })])
    );
    render(<DomainsPage />);

    expect(screen.getByText(/the default domain for api/)).toBeInTheDocument();
    expect(screen.getByText(/the default domain for web/)).toBeInTheDocument();
    expect(screen.getByText('gregale domains set-default shop.example.com')).toBeInTheDocument();
  });

  it('shows nothing when every verified domain is already its app default', () => {
    useDomains.mockReturnValue(
      ready([
        domain('a.example.com', true, { default: true }),
        domain('shop.example.com', true, { app_id: 'app-2', default: true }),
      ])
    );
    render(<DomainsPage />);

    expect(screen.queryByText(/gregale domains set-default/)).not.toBeInTheDocument();
    expect(screen.queryByText('Set a default domain')).not.toBeInTheDocument();
  });

  it('offers no set-default command while no domain is verified', () => {
    useDomains.mockReturnValue(ready([domain('pending.example.com', false)]));
    render(<DomainsPage />);

    expect(screen.queryByText(/gregale domains set-default/)).not.toBeInTheDocument();
  });
});
