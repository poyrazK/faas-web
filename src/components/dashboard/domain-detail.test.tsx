import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';

const useDomainDetail = vi.fn();
const setDefault = vi.fn();
const confirm = vi.fn();
const toast = vi.fn();
const refetch = vi.fn();

vi.mock('@/lib/api/domain-detail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/domain-detail')>()),
  useDomainDetail: (domain: string | null) => useDomainDetail(domain) as unknown,
  useSetDefaultDomain: () => ({ mutateAsync: setDefault, isPending: false }),
}));
vi.mock('@/lib/api/queries', () => ({
  useApps: () => ({
    data: [
      {
        id: 'app-1',
        slug: 'api',
        url: 'https://api.gregale.dev',
        canonical_url: 'https://old.example.com',
      },
    ],
  }),
}));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));

const { DomainDetail, DomainDetailButton } = await import('./domain-detail');

const detail = (over: Record<string, unknown> = {}) => ({
  data: {
    domain: 'shop.example.com',
    app_id: 'app-1',
    verified: true,
    verified_at: '2026-10-01T00:00:00Z',
    cert_status: 'issued',
    cert_not_after: '2026-12-30T00:00:00Z',
    cert_sans: ['shop.example.com', 'www.shop.example.com'],
    dns_records: [
      {
        type: 'TXT',
        name: '_faas-verify.shop.example.com',
        value: 'tok-123',
        purpose: 'verification',
      },
      { type: 'CNAME', name: 'shop.example.com', value: 'edge.gregale.dev', purpose: 'routing' },
      {
        type: 'A',
        name: 'shop.example.com',
        value: '203.0.113.7',
        purpose: 'routing',
        alternative: true,
      },
    ],
    ...over,
  },
  isPending: false,
  error: null,
  refetch,
});

beforeEach(() => {
  useDomainDetail.mockReset().mockReturnValue(detail());
  setDefault.mockReset().mockResolvedValue({});
  confirm.mockReset().mockResolvedValue(true);
  toast.mockReset();
  refetch.mockReset();
});
afterEach(cleanup);

describe('DomainDetailButton', () => {
  it('opens the detail for its domain in a dialog, and reads nothing before', () => {
    render(<DomainDetailButton domain="shop.example.com" />);
    expect(useDomainDetail).not.toHaveBeenCalledWith('shop.example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Details for shop.example.com' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('edge.gregale.dev')).toBeInTheDocument();
    expect(useDomainDetail).toHaveBeenCalledWith('shop.example.com');
  });
});

describe('DomainDetail', () => {
  it('names the app it routes to, and the environment when bound to one', () => {
    useDomainDetail.mockReturnValue(detail({ environment: 'staging' }));
    render(<DomainDetail domain="shop.example.com" />);
    expect(screen.getByText('api')).toBeInTheDocument();
    expect(screen.getByText('staging')).toBeInTheDocument();
  });

  it('shows the certificate status, expiry and names', () => {
    render(<DomainDetail domain="shop.example.com" />);
    expect(screen.getByText('issued')).toBeInTheDocument();
    expect(
      screen.getByText(new Date('2026-12-30T00:00:00Z').toLocaleDateString())
    ).toBeInTheDocument();
    expect(screen.getByText('www.shop.example.com')).toBeInTheDocument();
  });

  it('reads a failed live dial as unreachable, with its reason and last error', () => {
    useDomainDetail.mockReturnValue(
      detail({
        cert_status: 'dial_failed:routing_mismatch',
        cert_not_after: undefined,
        cert_sans: undefined,
        cert_last_error: 'domain does not route to Gregale',
      })
    );
    render(<DomainDetail domain="shop.example.com" />);
    expect(screen.getByText('unreachable')).toBeInTheDocument();
    expect(screen.getByText('routing_mismatch')).toBeInTheDocument();
    expect(screen.getByText('domain does not route to Gregale')).toBeInTheDocument();
  });

  it('lists the DNS records to publish and marks the apex alternative', () => {
    render(<DomainDetail domain="shop.example.com" />);
    expect(screen.getByText('_faas-verify.shop.example.com')).toBeInTheDocument();
    expect(screen.getByText('203.0.113.7')).toBeInTheDocument();
    expect(screen.getByText(/instead of the CNAME at a zone apex/i)).toBeInTheDocument();
  });

  it('says when the domain is already the default, and offers no button', () => {
    useDomainDetail.mockReturnValue(detail({ default: true }));
    render(<DomainDetail domain="shop.example.com" />);
    expect(screen.getByText(/is the default domain for api/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /make default/i })).not.toBeInTheDocument();
  });

  it.each([
    [{ verified: false, verified_at: undefined }, /verify this domain before/i],
    [{ environment: 'staging' }, /routes only to the staging environment/i],
    [{ domain: '*.example.com' }, /a wildcard cannot be the default/i],
  ])('explains why %o cannot be the default', (over, reason) => {
    useDomainDetail.mockReturnValue(detail(over));
    render(<DomainDetail domain="shop.example.com" />);
    expect(screen.getByText(reason)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /make default/i })).not.toBeInTheDocument();
  });

  it('names the effect before making it the default, then sets it', async () => {
    render(<DomainDetail domain="shop.example.com" />);
    fireEvent.click(screen.getByRole('button', { name: 'Make default' }));
    await waitFor(() => expect(setDefault).toHaveBeenCalledWith('shop.example.com'));
    const asked = confirm.mock.calls[0][0] as { title: string; description: string };
    expect(asked.title).toBe('Make shop.example.com the default for api?');
    expect(asked.description).toContain('https://shop.example.com');
    expect(asked.description).toContain('https://old.example.com');
    expect(asked.description).toContain('https://api.gregale.dev keeps working');
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'success', title: 'shop.example.com is now the default' })
    );
  });

  it('does nothing when the confirmation is declined', async () => {
    confirm.mockResolvedValue(false);
    render(<DomainDetail domain="shop.example.com" />);
    fireEvent.click(screen.getByRole('button', { name: 'Make default' }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(setDefault).not.toHaveBeenCalled();
  });

  it('re-reads a domain the API says is no longer verified', async () => {
    setDefault.mockRejectedValue(
      new ApiError({ status: 409, code: 'domain_not_verified', title: 'Domain not verified' })
    );
    render(<DomainDetail domain="shop.example.com" />);
    fireEvent.click(screen.getByRole('button', { name: 'Make default' }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'error', title: 'shop.example.com is not verified' })
      )
    );
    expect(refetch).toHaveBeenCalled();
  });

  it('reports any other failure in prose', async () => {
    setDefault.mockRejectedValue(
      new ApiError({
        status: 422,
        code: 'validation_failed',
        title: 'Environment domain cannot be default',
      })
    );
    render(<DomainDetail domain="shop.example.com" />);
    fireEvent.click(screen.getByRole('button', { name: 'Make default' }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'error', title: 'Could not set the default' })
      )
    );
    expect(refetch).not.toHaveBeenCalled();
  });

  it('shows the read state while loading and on error', () => {
    useDomainDetail.mockReturnValue({ data: undefined, isPending: true, error: null, refetch });
    const { unmount } = render(<DomainDetail domain="shop.example.com" />);
    expect(screen.getByText(/reading shop\.example\.com/i)).toBeInTheDocument();
    unmount();

    useDomainDetail.mockReturnValue({
      data: undefined,
      isPending: false,
      error: new Error('offline'),
      refetch,
    });
    render(<DomainDetail domain="shop.example.com" />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(refetch).toHaveBeenCalled();
  });
});
