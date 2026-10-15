import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { api } from '@/lib/api/client';
import { NewAppCapabilities } from './new-app-capabilities';
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { id: 'account', plan: 'scale' } }) }));
it('loads isolated-run discovery only on request and explains runtime denial without an upgrade', async () => {
  const get = vi.spyOn(api, 'GET').mockResolvedValue({
    data: {
      registry_version: 1,
      plan: 'scale',
      capabilities: [
        {
          key: 'disposable-runs',
          name: 'Disposable runs',
          category: 'runtime',
          description: 'Bounded isolated work.',
          maturity: 'preview',
          plans: ['hobby', 'pro', 'scale'],
          docs_url: '/docs/executions',
          acceptance: 'test',
          enabled: false,
          unavailable_reason: 'runtime_unavailable',
        },
      ],
    },
    response: new Response(),
  } as never);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NewAppCapabilities />
    </QueryClientProvider>
  );
  expect(get).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Container images and isolated runs' }));
  await screen.findByText(/Unavailable on this installation/);
  expect(screen.queryByRole('link', { name: 'View plans' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Documentation' })).toHaveAttribute(
    'href',
    '/docs/executions'
  );
  get.mockRestore();
});
