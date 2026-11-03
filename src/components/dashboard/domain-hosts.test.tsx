import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';

const useDomainHosts = vi.fn();
const save = vi.fn();
const clear = vi.fn();
const confirm = vi.fn();
const toast = vi.fn();
const refetch = vi.fn();

vi.mock('@/lib/api/domain-hosts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/domain-hosts')>()),
  useDomainHosts: (domain: string) => useDomainHosts(domain) as unknown,
  useSetDomainHosts: () => ({ mutateAsync: save, isPending: false }),
  useClearDomainHosts: () => ({ mutateAsync: clear, isPending: false }),
}));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));

const { DomainHosts } = await import('./domain-hosts');

const hosts = (names: string[]) => ({
  data: { domain: '*.example.com', names, restricted: names.length > 0 },
  isPending: false,
  error: null,
  refetch,
});

beforeEach(() => {
  useDomainHosts.mockReset().mockReturnValue(hosts([]));
  save.mockReset().mockResolvedValue({});
  clear.mockReset().mockResolvedValue(undefined);
  confirm.mockReset().mockResolvedValue(true);
  toast.mockReset();
  refetch.mockReset();
});
afterEach(cleanup);

describe('DomainHosts', () => {
  it('says every name below an open wildcard may get a certificate, and what that costs', () => {
    render(<DomainHosts domain="*.example.com" />);
    expect(useDomainHosts).toHaveBeenCalledWith('*.example.com');
    expect(screen.getByText('Every name')).toBeInTheDocument();
    expect(screen.getByText(/40 new certificates/i)).toBeInTheDocument();
    expect(screen.getByText(/gregale-wildcard-check\.example\.com/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove allowlist' })).not.toBeInTheDocument();
  });

  it('lists the allowed names as full hosts', () => {
    useDomainHosts.mockReturnValue(hosts(['api', 'eu.shop']));
    render(<DomainHosts domain="*.example.com" />);
    expect(screen.getByText('Listed names only')).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Allowed names' });
    expect(list).toHaveTextContent('api.example.com');
    expect(list).toHaveTextContent('eu.shop.example.com');
  });

  it('restricts an open wildcard to the names typed, normalised', async () => {
    render(<DomainHosts domain="*.example.com" />);
    fireEvent.click(screen.getByRole('button', { name: 'Restrict to listed names' }));
    const names = screen.getByRole('textbox', { name: 'Names' });
    expect(screen.getByText(/keeps serving until its next reload or renewal/i)).toBeInTheDocument();
    fireEvent.change(names, { target: { value: 'eu.shop.example.com\nAPI' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save names' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(['api', 'eu.shop']));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }));
  });

  it('names the listed hosts an edit drops, with the documented caveat', () => {
    useDomainHosts.mockReturnValue(hosts(['api', 'eu.shop']));
    render(<DomainHosts domain="*.example.com" />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit names' }));
    const names = screen.getByRole('textbox', { name: 'Names' });
    expect(names).toHaveValue('api\neu.shop');
    fireEvent.change(names, { target: { value: 'api' } });
    expect(screen.getByText(/removing eu\.shop\.example\.com/i)).toBeInTheDocument();
  });

  it('refuses an empty list or a bad name before sending anything', () => {
    render(<DomainHosts domain="*.example.com" />);
    fireEvent.click(screen.getByRole('button', { name: 'Restrict to listed names' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save names' }));
    expect(screen.getByRole('textbox', { name: 'Names' })).toHaveAccessibleDescription(
      /list at least one name/i
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Names' }), {
      target: { value: 'ok\n-bad' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save names' }));
    expect(screen.getByRole('textbox', { name: 'Names' })).toHaveAccessibleDescription(
      /-bad is not a name below \*\.example\.com/i
    );
    expect(save).not.toHaveBeenCalled();
  });

  it('refuses more than 100 names', () => {
    render(<DomainHosts domain="*.example.com" />);
    fireEvent.click(screen.getByRole('button', { name: 'Restrict to listed names' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Names' }), {
      target: { value: Array.from({ length: 101 }, (_, i) => `n${i}`).join('\n') },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save names' }));
    expect(screen.getByRole('textbox', { name: 'Names' })).toHaveAccessibleDescription(
      /at most 100 names; this list has 101/i
    );
    expect(save).not.toHaveBeenCalled();
  });

  it('keeps the draft and shows the API refusal inline', async () => {
    save.mockRejectedValue(
      new ApiError({
        status: 422,
        code: 'validation_failed',
        title: 'Invalid host name',
        detail: '"x" is not a name below *.example.com',
      })
    );
    render(<DomainHosts domain="*.example.com" />);
    fireEvent.click(screen.getByRole('button', { name: 'Restrict to listed names' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Names' }), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save names' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('is not a name below');
    expect(screen.getByText('validation_failed')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Names' })).toHaveValue('x');
  });

  it('confirms before removing the allowlist, as a destructive action', async () => {
    useDomainHosts.mockReturnValue(hosts(['api']));
    render(<DomainHosts domain="*.example.com" />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove allowlist' }));
    await waitFor(() => expect(clear).toHaveBeenCalled());
    const asked = confirm.mock.calls[0][0] as {
      title: string;
      description: string;
      destructive: boolean;
    };
    expect(asked.destructive).toBe(true);
    expect(asked.title).toBe('Remove the host allowlist for *.example.com?');
    expect(asked.description).toMatch(/every name below example\.com/i);
  });

  it('does nothing when the removal is declined', async () => {
    confirm.mockResolvedValue(false);
    useDomainHosts.mockReturnValue(hosts(['api']));
    render(<DomainHosts domain="*.example.com" />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove allowlist' }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(clear).not.toHaveBeenCalled();
  });

  it('shows the read state while loading and on error, with a retry', () => {
    useDomainHosts.mockReturnValue({ data: undefined, isPending: true, error: null, refetch });
    const { unmount } = render(<DomainHosts domain="*.example.com" />);
    expect(screen.getByText(/reading the host allowlist/i)).toBeInTheDocument();
    unmount();

    useDomainHosts.mockReturnValue({
      data: undefined,
      isPending: false,
      error: new Error('offline'),
      refetch,
    });
    render(<DomainHosts domain="*.example.com" />);
    expect(screen.queryByRole('button', { name: /restrict/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(refetch).toHaveBeenCalled();
  });
});
