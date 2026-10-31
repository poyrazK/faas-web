import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';

const binding = {
  id: 'binding-1',
  app_id: 'app-1',
  account_id: 'account-1',
  name: 'orders',
  queue_name: 'orders',
  mode: 'push',
  workload_class: 'worker',
  enabled: true,
  max_concurrency: 2,
  created_at: '2026-10-10T00:00:00Z',
  updated_at: '2026-10-10T00:00:00Z',
};
const app = { id: 'app-1', slug: 'worker-1', workload_class: 'worker' };
const state = vi.hoisted(() => ({
  context: vi.fn(),
  read: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('@/lib/api/queue-bindings', () => ({
  readQueueBindingContext: state.context,
  readQueueBinding: state.read,
  updateQueueBinding: state.update,
  deleteQueueBinding: state.remove,
  queueBindingsKey: (account: string, slug: string) => [account, slug, 'bindings'],
  queueBindingStatusKey: (account: string, slug: string, id: string) => [account, slug, id],
}));
const { QueueBindingEditor } = await import('./queue-binding-editor');

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <QueueBindingEditor
        accountId="account-1"
        plan="hobby"
        slug="worker-1"
        binding={binding as never}
      />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  sessionStorage.clear();
  state.context.mockReset().mockResolvedValue({ app, bindings: [binding] });
  state.read.mockReset().mockResolvedValue(binding);
  state.update.mockReset().mockResolvedValue({ ...binding, enabled: false });
  state.remove.mockReset().mockResolvedValue(undefined);
});

it('freezes an ambiguous deletion across reload and never resends it automatically', async () => {
  const user = userEvent.setup();
  state.remove.mockRejectedValueOnce(new TypeError('connection lost'));
  mount();
  await user.click(screen.getByRole('button', { name: 'Manage orders' }));
  await user.click(screen.getByRole('button', { name: 'Review deletion' }));
  await user.click(await screen.findByRole('button', { name: 'Delete binding' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/outcome is unconfirmed/i);
  cleanup();
  mount();
  await user.click(screen.getByRole('button', { name: 'Manage orders' }));
  expect(screen.getByRole('button', { name: 'Inspect write outcome' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Review deletion' })).not.toBeInTheDocument();
  expect(state.remove).toHaveBeenCalledTimes(1);
});

it('reviews and pauses one identified binding after a fresh binding read', async () => {
  const user = userEvent.setup();
  mount();
  await user.click(screen.getByRole('button', { name: 'Manage orders' }));
  await user.click(screen.getByLabelText('Pause delivery'));
  await user.click(screen.getByRole('button', { name: 'Review changes' }));
  expect(await screen.findByText(/Pause delivery for orders/)).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Save binding' }));
  await waitFor(() => expect(state.update).toHaveBeenCalledTimes(1));
  expect(state.update.mock.calls[0][2]).toEqual({ enabled: false });
  expect(state.read).toHaveBeenCalledTimes(2);
});

it('blocks deletion when the identified binding changed after review', async () => {
  const user = userEvent.setup();
  mount();
  await user.click(screen.getByRole('button', { name: 'Manage orders' }));
  await user.click(screen.getByRole('button', { name: 'Review deletion' }));
  state.read.mockResolvedValueOnce({ ...binding, updated_at: 'later' });
  await user.click(await screen.findByRole('button', { name: 'Delete binding' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/changed since review/i);
  expect(state.remove).not.toHaveBeenCalled();
});

it('requires a new review after a server conflict', async () => {
  const user = userEvent.setup();
  state.update.mockRejectedValueOnce(
    new ApiError({ status: 409, code: 'validation', title: 'Conflict' })
  );
  mount();
  await user.click(screen.getByRole('button', { name: 'Manage orders' }));
  await user.click(screen.getByLabelText('Pause delivery'));
  await user.click(screen.getByRole('button', { name: 'Review changes' }));
  await user.click(await screen.findByRole('button', { name: 'Save binding' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/conflict/i);
  expect(screen.queryByRole('button', { name: 'Save binding' })).not.toBeInTheDocument();
});
