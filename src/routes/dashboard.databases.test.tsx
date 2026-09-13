import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const addUpstream = vi.fn();
const toast = vi.fn();

vi.mock('@tanstack/react-router', () => ({ createFileRoute: () => (options: unknown) => options }));
vi.mock('@/lib/api/queries', () => ({
  useUpstreams: () => ({
    data: { upstreams: [] },
    isPending: false,
    error: null,
    refetch: vi.fn(),
  }),
  useAddUpstream: () => ({ mutateAsync: addUpstream, isPending: false }),
  useDeleteUpstream: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/components/dashboard/resource-table', () => ({
  Pill: () => null,
  ResourceTable: () => null,
}));
vi.mock('@/components/dashboard/upstream-history', () => ({ UpstreamHistoryPanel: () => null }));
vi.mock('@/components/dashboard/app-select', () => ({
  AppScope: ({ children }: { children: React.ReactNode }) => children,
  AppSelect: () => null,
  useSelectedApp: () => ({ slug: 'api', apps: [], select: vi.fn() }),
}));

const { UpstreamsBody } = await import('./dashboard.databases');

beforeEach(() => {
  addUpstream
    .mockReset()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ id: 'upstream-1' });
  toast.mockReset();
});

describe('upstream form validation', () => {
  it('focuses malformed host, port, and scope fields before allowing a retryable request', async () => {
    render(<UpstreamsBody slug="api" />);
    const host = screen.getByRole('textbox', { name: 'Host' });
    const port = screen.getByRole('spinbutton', { name: 'Port' });
    const scope = screen.getByRole('textbox', { name: 'Scope' });

    await userEvent.type(host, '127.0.0.1');
    await userEvent.click(screen.getByRole('button', { name: 'Declare' }));
    expect(host).toHaveFocus();
    expect(host).toHaveAccessibleDescription('Enter a hostname, not an IP address or URL.');
    expect(addUpstream).not.toHaveBeenCalled();

    await userEvent.clear(host);
    await userEvent.type(host, 'db.internal');
    await userEvent.clear(port);
    await userEvent.type(port, '70000{Enter}');
    expect(port).toHaveFocus();
    expect(port).toHaveAccessibleDescription('Enter a whole-number port from 1 to 65535.');

    await userEvent.clear(port);
    await userEvent.type(port, '5432');
    await userEvent.type(scope, 'Prod{Enter}');
    expect(scope).toHaveFocus();
    expect(scope).toHaveAccessibleDescription('Use 3–40 lowercase letters, numbers, or dashes.');

    await userEvent.clear(scope);
    await userEvent.type(scope, 'prod{Enter}');
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' }))
    );
    expect(host).toHaveValue('db.internal');
    await userEvent.type(scope, '{Enter}');
    await waitFor(() => expect(addUpstream).toHaveBeenCalledTimes(2));
  });
});
