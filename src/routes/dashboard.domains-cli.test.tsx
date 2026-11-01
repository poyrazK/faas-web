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

describe('domains page', () => {
  // The detail dialog sets a domain as its app's default (POST
  // /v1/domains/{domain}/default), so the page no longer sends people to the CLI.
  it('no longer points verified domains at the CLI to become the default', () => {
    useDomains.mockReturnValue(
      ready([domain('b.example.com', true), domain('a.example.com', true)])
    );
    render(<DomainsPage />);
    expect(screen.queryByText('Set a default domain')).not.toBeInTheDocument();
    expect(screen.queryByText(/gregale domains set-default/)).not.toBeInTheDocument();
  });
});
