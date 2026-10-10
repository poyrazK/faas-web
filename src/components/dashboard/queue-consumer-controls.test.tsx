import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { readQueueBindingOperation } from '@/lib/queue-binding-operation';
import { ApiError } from '@/lib/api/errors';

const app = { id: 'app-1', slug: 'worker-1', type: 'app', workload_class: 'worker' };
const binding = {
  id: 'binding-1',
  app_id: 'app-1',
  account_id: 'account-1',
  name: 'orders',
  queue_name: 'orders',
  mode: 'push',
  workload_class: 'worker',
  enabled: true,
  max_concurrency: 1,
  created_at: '2026-10-10T00:00:00Z',
  updated_at: '2026-10-10T00:00:00Z',
};
const state = vi.hoisted(() => ({
  app: { id: 'app-1', slug: 'worker-1', type: 'app', workload_class: 'worker' },
  read: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('@/lib/api/queries', () => ({
  useApp: () => ({ data: state.app, isPending: false, error: null }),
  keys: { apps: ['apps'] },
}));
vi.mock('@/lib/api/queue-bindings', () => ({
  readQueueBindingContext: state.read,
  createQueueBinding: state.create,
  updateQueueBinding: state.update,
  deleteQueueBinding: state.remove,
  queueBindingsKey: (account: string, slug: string) => ['account', account, slug, 'bindings'],
  queueBindingStatusKey: (account: string, slug: string, id: string) => [account, slug, id],
}));
const { QueueConsumerControls } = await import('./queue-consumer-controls');

function mount(bindings = [binding]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <QueueConsumerControls
        accountId="account-1"
        plan="hobby"
        slug="worker-1"
        bindings={bindings as never}
      />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  sessionStorage.clear();
  state.read.mockReset().mockResolvedValue({ app, bindings: [binding] });
  state.create.mockReset().mockResolvedValue({ id: 'new-binding' });
  state.update.mockReset().mockResolvedValue({ ...binding, enabled: false });
  state.remove.mockReset().mockResolvedValue(undefined);
});

it('reviews an explicit pull binding and never invokes the default push profile', async () => {
  const user = userEvent.setup();
  mount();
  await user.click(screen.getByRole('button', { name: 'New binding' }));
  await user.type(screen.getByLabelText('Binding name'), 'exports');
  await user.type(screen.getByLabelText('Queue name'), 'exports');
  await user.selectOptions(screen.getByLabelText('Delivery mode'), 'pull');
  await user.click(screen.getByRole('button', { name: 'Review binding' }));
  expect(await screen.findByText(/External pull worker/)).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Create binding' }));
  await waitFor(() => expect(state.create).toHaveBeenCalledTimes(1));
  expect(state.create.mock.calls[0][1]).toMatchObject({
    name: 'exports',
    queue_name: 'exports',
    mode: 'pull',
    workload_class: 'worker',
  });
  expect(state.create.mock.calls[0][2]).toMatch(/[0-9a-f-]{30,}/);
  expect(readQueueBindingOperation('account-1', 'worker-1')).toBeNull();
});

it('rejects a stale final list read before creating a binding', async () => {
  const user = userEvent.setup();
  mount();
  await user.click(screen.getByRole('button', { name: 'New binding' }));
  await user.type(screen.getByLabelText('Binding name'), 'exports');
  await user.type(screen.getByLabelText('Queue name'), 'exports');
  await user.click(screen.getByRole('button', { name: 'Review binding' }));
  await screen.findByRole('button', { name: 'Create binding' });
  state.read.mockResolvedValueOnce({ app, bindings: [{ ...binding, updated_at: 'later' }] });
  await user.click(screen.getByRole('button', { name: 'Create binding' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/changed since review/i);
  expect(state.create).not.toHaveBeenCalled();
});

it('keeps a lost create response frozen across reload until explicit inspection', async () => {
  const user = userEvent.setup();
  state.create.mockRejectedValue(new TypeError('connection lost'));
  mount();
  await user.click(screen.getByRole('button', { name: 'New binding' }));
  await user.type(screen.getByLabelText('Binding name'), 'exports');
  await user.type(screen.getByLabelText('Queue name'), 'exports');
  await user.click(screen.getByRole('button', { name: 'Review binding' }));
  await user.click(await screen.findByRole('button', { name: 'Create binding' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/outcome is unconfirmed/i);
  expect(readQueueBindingOperation('account-1', 'worker-1')?.request.name).toBe('exports');
  cleanup();
  mount();
  expect(screen.getByRole('button', { name: 'Inspect binding outcome' })).toBeVisible();
  expect(state.create).toHaveBeenCalledTimes(1);
});

it('allows a fresh reviewed request after a confirmed validation rejection', async () => {
  const user = userEvent.setup();
  state.create.mockRejectedValueOnce(
    new ApiError({ status: 422, code: 'invalid_queue_binding', title: 'Invalid binding' })
  );
  mount();
  await user.click(screen.getByRole('button', { name: 'New binding' }));
  await user.type(screen.getByLabelText('Binding name'), 'exports');
  await user.type(screen.getByLabelText('Queue name'), 'exports');
  await user.click(screen.getByRole('button', { name: 'Review binding' }));
  await user.click(await screen.findByRole('button', { name: 'Create binding' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/rejected/i);
  expect(readQueueBindingOperation('account-1', 'worker-1')).toBeNull();
  expect(screen.getByRole('button', { name: 'Review binding' })).toBeVisible();
});

it('requires explicit acknowledgement after inspecting an unconfirmed create', async () => {
  const user = userEvent.setup();
  state.create.mockRejectedValueOnce(new TypeError('connection lost'));
  mount();
  await user.click(screen.getByRole('button', { name: 'New binding' }));
  await user.type(screen.getByLabelText('Binding name'), 'exports');
  await user.type(screen.getByLabelText('Queue name'), 'exports');
  await user.click(screen.getByRole('button', { name: 'Review binding' }));
  await user.click(await screen.findByRole('button', { name: 'Create binding' }));
  await screen.findByRole('alert');
  state.read.mockResolvedValueOnce({
    app,
    bindings: [
      binding,
      { ...binding, id: 'binding-2', name: 'exports', queue_name: 'exports', mode: 'pull' },
    ],
  });
  await user.click(screen.getByRole('button', { name: 'Inspect binding outcome' }));
  expect(await screen.findByText(/Found 1 matching binding record/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Start a new reviewed attempt' })).toBeDisabled();
  await user.click(screen.getByLabelText(/I inspected the binding records/));
  await user.click(screen.getByRole('button', { name: 'Start a new reviewed attempt' }));
  expect(readQueueBindingOperation('account-1', 'worker-1')).toBeNull();
  expect(state.create).toHaveBeenCalledTimes(1);
});

it('does not reveal a delayed review after switching accounts', async () => {
  const user = userEvent.setup();
  let finish: ((value: unknown) => void) | undefined;
  state.read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const view = mount();
  await user.click(screen.getByRole('button', { name: 'New binding' }));
  await user.type(screen.getByLabelText('Binding name'), 'exports');
  await user.type(screen.getByLabelText('Queue name'), 'exports');
  await user.click(screen.getByRole('button', { name: 'Review binding' }));
  view.rerender(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <QueueConsumerControls
        accountId="account-2"
        plan="hobby"
        slug="worker-1"
        bindings={[binding] as never}
      />
    </QueryClientProvider>
  );
  finish?.({ app, bindings: [binding] });
  expect(screen.queryByRole('button', { name: 'Create binding' })).not.toBeInTheDocument();
  expect(state.create).not.toHaveBeenCalled();
});
