import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { readQueueBindingWrite, saveQueueBindingWrite } from '@/lib/queue-binding-write';

const state = vi.hoisted(() => ({ context: vi.fn() }));
vi.mock('@/lib/api/queue-bindings', () => ({
  readQueueBindingContext: state.context,
  queueBindingsKey: (account: string, slug: string) => [account, slug, 'bindings'],
}));
const { QueueBindingOrphan } = await import('./queue-binding-orphan');

beforeEach(() => {
  sessionStorage.clear();
  state.context.mockReset().mockResolvedValue({ app: { id: 'app-1' }, bindings: [] });
});

it('recovers a missing deleted binding only after fresh metadata inspection and acknowledgement', async () => {
  const user = userEvent.setup();
  const write = {
    version: 1 as const,
    accountId: 'account-1',
    slug: 'worker-1',
    appId: 'app-1',
    bindingId: 'binding-1',
    action: 'delete' as const,
    beforeFingerprint: 'fp',
    createdAt: 1,
  };
  saveQueueBindingWrite(write);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <QueueBindingOrphan write={write} plan="hobby" />
    </QueryClientProvider>
  );
  expect(screen.getByText(/Deletion of binding-1 has an unconfirmed outcome/)).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Inspect missing binding' }));
  expect(await screen.findByText(/absent from the current list/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Clear reviewed recovery' })).toBeDisabled();
  await user.click(screen.getByLabelText(/I inspected the current binding list/));
  await user.click(screen.getByRole('button', { name: 'Clear reviewed recovery' }));
  expect(readQueueBindingWrite('account-1', 'worker-1', 'binding-1')).toBeNull();
});
