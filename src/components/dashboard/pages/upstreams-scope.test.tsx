import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';

const add = vi.fn().mockResolvedValue({ id: 'u1' });
vi.mock('@/lib/api/queries', () => ({
  useUpstreams: () => ({
    data: { upstreams: [] },
    isPending: false,
    error: null,
    refetch: vi.fn(),
  }),
  useAddUpstream: () => ({ mutateAsync: add, isPending: false }),
  useDeleteUpstream: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/components/dashboard/upstream-history', () => ({ UpstreamHistoryPanel: () => null }));

const { UpstreamsBody } = await import('./upstreams');

it('declares an upstream in a short scope like qa, as faas allows', async () => {
  render(<UpstreamsBody slug="api" />);
  await userEvent.click(screen.getByRole('button', { name: /declare upstream/i }));
  const sheet = await screen.findByRole('dialog');
  await userEvent.type(within(sheet).getByRole('textbox', { name: 'Host' }), 'db.internal');
  await userEvent.type(within(sheet).getByRole('textbox', { name: 'Scope' }), 'qa');
  await userEvent.click(within(sheet).getByRole('button', { name: 'Declare' }));
  expect(add).toHaveBeenCalledWith(expect.objectContaining({ scope: 'qa' }));
});
