import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import { PlatformCapabilities } from './platform-capabilities';
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { id: 'account', plan: 'scale' } }) }));
afterEach(() => vi.restoreAllMocks());
const entry = {
  key: 'object-storage',
  name: 'Private object storage',
  category: 'data',
  description: 'Private buckets.',
  maturity: 'preview',
  plans: ['hobby', 'pro', 'scale'],
  docs_url: '/docs/object-storage',
  acceptance: 'qualified',
  enabled: false,
  unavailable_reason: 'runtime_unavailable',
};
function show() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <PlatformCapabilities />
    </QueryClientProvider>
  );
}
it('separates Preview from runtime availability and omits internal entries', async () => {
  vi.spyOn(api, 'GET').mockResolvedValue({
    data: {
      registry_version: 1,
      plan: 'scale',
      capabilities: [entry, { ...entry, key: 'hidden', name: 'Hidden', maturity: 'internal' }],
    },
    response: new Response(),
  } as never);
  show();
  await screen.findByText('Private object storage');
  expect(screen.getByText(/Unavailable on this installation/)).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /plans/i })).not.toBeInTheDocument();
  expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Documentation' })).toHaveAttribute(
    'href',
    '/docs/object-storage'
  );
  fireEvent.change(screen.getByLabelText('Search capabilities'), { target: { value: 'missing' } });
  expect(screen.getByText('No matching capabilities.')).toBeInTheDocument();
});
it('shows a retryable registry failure, not an empty feature list', async () => {
  const get = vi
    .spyOn(api, 'GET')
    .mockRejectedValueOnce(
      new ApiError({ status: 403, code: 'forbidden', title: 'Permission denied' })
    )
    .mockResolvedValue({
      data: { registry_version: 1, plan: 'scale', capabilities: [] },
      response: new Response(),
    } as never);
  show();
  const retry = await screen.findByRole('button', { name: 'Retry capabilities' });
  expect(screen.queryByText('No matching capabilities.')).not.toBeInTheDocument();
  fireEvent.click(retry);
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
});
