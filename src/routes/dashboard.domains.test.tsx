import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const addDomain = vi.fn();
const toast = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: object) => ({
    ...options,
    useSearch: () => ({}),
    useNavigate: () => vi.fn(),
  }),
}));
vi.mock('@/lib/api/queries', () => ({
  useDomains: () => ({ data: [], isPending: false, error: null, refetch: vi.fn() }),
  useApps: () => ({ data: [{ id: 'app-1', slug: 'api' }] }),
  useAddDomain: () => ({ mutateAsync: addDomain, isPending: false }),
  useDeleteDomain: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useVerifyDomain: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/components/dashboard/resource-table', () => ({
  Pill: () => null,
  ResourceTable: () => null,
}));
vi.mock('@/components/dashboard/domain-doctor', () => ({ DomainDoctor: () => null }));

const { Route } = await import('./dashboard.domains');
const DomainsPage = (Route as unknown as { component: React.ComponentType }).component;

beforeEach(() => {
  addDomain.mockReset().mockResolvedValue({ domain: 'api.example.com', txt_record: 'verify' });
  toast.mockReset();
});

describe('domain form validation', () => {
  it('explains an empty keyboard submission and focuses the hostname', async () => {
    render(<DomainsPage />);
    const hostname = screen.getByRole('textbox', { name: 'Hostname' });

    await userEvent.type(hostname, '{Enter}');

    expect(hostname).toHaveFocus();
    expect(hostname).toHaveAttribute('aria-invalid', 'true');
    expect(hostname).toHaveAccessibleDescription('Enter a full hostname, like api.example.com.');
    expect(addDomain).not.toHaveBeenCalled();
  });
});
