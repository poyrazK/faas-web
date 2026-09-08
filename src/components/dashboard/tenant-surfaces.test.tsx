import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withRouter } from '@/test/router';
import { ApiError } from '@/lib/api/errors';

const useTenantSurfaces = vi.fn();
const useApp = vi.fn();
const create = vi.fn();
const remove = vi.fn();
const addHostname = vi.fn();
const removeHostname = vi.fn();
const toast = vi.fn();
const confirm = vi.fn();

vi.mock('@/lib/api/queries', () => ({
  useTenantSurfaces: (slug: string) => useTenantSurfaces(slug) as unknown,
  useApp: (slug: string) => useApp(slug) as unknown,
  useCreateTenantSurface: () => ({ mutateAsync: create, isPending: false }),
  useDeleteTenantSurface: () => ({ mutateAsync: remove, isPending: false }),
  useAddTenantHostname: () => ({ mutateAsync: addHostname, isPending: false }),
  useRemoveTenantHostname: () => ({ mutateAsync: removeHostname, isPending: false }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));

const { TenantSurfaces, certificateLine } = await import('./tenant-surfaces');

const ready = (data: unknown) => ({ data, isPending: false, error: null, refetch: vi.fn() });
const hostname = (name: string, verified: boolean, last_error: string | null = null) => ({
  hostname: name,
  challenge_token: verified ? null : 'tok',
  verified,
  verified_at: verified ? '2026-09-04T10:00:00Z' : null,
  last_error,
  txt_record: `_gregale-challenge.${name} TXT "tok"`,
});
const surface = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  account_id: 'acct',
  app_id: 'app1',
  name: 'customer-domains',
  cert_kind: 'per_host_san',
  status: 'pending',
  cert_state: 'pending',
  cert_last_error: null,
  hostnames: [
    hostname('app.acme.example', true),
    hostname('app.globex.example', false, 'TXT record not found'),
  ],
  ...over,
});

beforeEach(() => {
  useTenantSurfaces.mockReset().mockReturnValue(ready({ surfaces: [surface()] }));
  useApp.mockReset().mockReturnValue(ready({ id: 'app1', slug: 'api' }));
  create.mockReset().mockResolvedValue(surface({ id: 's2', name: 'eu' }));
  remove.mockReset().mockResolvedValue(undefined);
  addHostname.mockReset().mockResolvedValue(hostname('new.example', false));
  removeHostname.mockReset().mockResolvedValue(undefined);
  toast.mockReset();
  confirm.mockReset().mockResolvedValue(true);
});

describe('certificateLine', () => {
  it('reports the certificate in the API’s own terms', () => {
    expect(certificateLine(surface({ cert_state: 'none' }) as never).text).toMatch(
      /no certificate yet/i
    );
    expect(certificateLine(surface({ cert_state: 'pending' }) as never).text).toMatch(/pending/i);
    expect(
      certificateLine(
        surface({ cert_state: 'issued', cert_not_after: '2026-11-17T00:00:00Z' }) as never
      ).text
    ).toMatch(/valid until/i);
    expect(
      certificateLine(surface({ cert_state: 'failed', cert_last_error: 'CAA forbids' }) as never)
        .text
    ).toBe('Issuance failed: CAA forbids');
  });
});

describe('TenantSurfaces', () => {
  it('shows the TXT record and last check only for unverified hostnames', () => {
    render(<TenantSurfaces slug="api" />);
    expect(screen.getByText('app.globex.example')).toBeInTheDocument();
    expect(screen.getByText(/_gregale-challenge\.app\.globex\.example/)).toBeInTheDocument();
    expect(screen.getByText(/last check: TXT record not found/i)).toBeInTheDocument();
    expect(screen.queryByText(/_gregale-challenge\.app\.acme\.example/)).not.toBeInTheDocument();
  });

  it('renders the 402 gate as the plan panel, matched on the code', async () => {
    useTenantSurfaces.mockReturnValue({
      data: undefined,
      isPending: false,
      error: new ApiError({
        status: 402,
        code: 'tenant_surfaces_not_allowed',
        title: 'Not on your plan',
        detail: 'tenant surfaces need the Pro or Scale plan.',
      }),
      refetch: vi.fn(),
    });
    render(withRouter(<TenantSurfaces slug="api" />));
    expect(
      await screen.findByText(/tenant surfaces need the pro or scale plan/i)
    ).toBeInTheDocument();
  });

  it('creates a surface with the parsed seed hostnames and the app id', async () => {
    render(<TenantSurfaces slug="api" />);
    await userEvent.type(screen.getByLabelText('Surface name'), 'eu');
    await userEvent.type(screen.getByLabelText('Seed hostnames'), 'a.example, B.example');
    await userEvent.click(screen.getByRole('button', { name: /create surface/i }));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        app_id: 'app1',
        name: 'eu',
        cert_kind: 'per_host_san',
        hostnames: ['a.example', 'b.example'],
      })
    );
  });

  it('adds a hostname to a surface and tells the customer what to publish', async () => {
    render(<TenantSurfaces slug="api" />);
    await userEvent.type(screen.getByPlaceholderText('app.customer.example'), 'new.example');
    await userEvent.click(screen.getByRole('button', { name: /add hostname/i }));
    await waitFor(() =>
      expect(addHostname).toHaveBeenCalledWith({ id: 's1', hostname: 'new.example' })
    );
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'success', description: expect.stringMatching(/TXT record/) })
    );
  });

  it('explains a 409 as the hostname being held by another surface', async () => {
    addHostname.mockRejectedValue(
      new ApiError({ status: 409, code: 'tenant_hostname_already_claimed', title: 'Conflict' })
    );
    render(<TenantSurfaces slug="api" />);
    await userEvent.type(screen.getByPlaceholderText('app.customer.example'), 'x.example');
    await userEvent.click(screen.getByRole('button', { name: /add hostname/i }));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Hostname already claimed' })
    );
  });

  it('confirms before removing a hostname or deleting a surface', async () => {
    render(<TenantSurfaces slug="api" />);
    await userEvent.click(screen.getByRole('button', { name: /remove app\.acme\.example/i }));
    await waitFor(() =>
      expect(removeHostname).toHaveBeenCalledWith({ id: 's1', hostname: 'app.acme.example' })
    );
    await userEvent.click(screen.getByRole('button', { name: /delete surface customer-domains/i }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('s1'));
    expect(confirm).toHaveBeenCalledTimes(2);
  });
});
