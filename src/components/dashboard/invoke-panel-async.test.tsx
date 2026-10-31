import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/ui/toast';
import { spyApi } from '@/test/api';

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ account: { id: 'acct', plan: 'pro' }, loading: false }),
}));
vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: () => ({
    access: 'on',
    capability: { key: 'async-invocations', maturity: 'beta' },
    refresh: vi.fn(),
  }),
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

const { InvokePanel } = await import('./app-core-panels');

const ok = (data: unknown) => Promise.resolve({ data, response: new Response() });

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <InvokePanel slug="docs" />
      </ToastProvider>
    </QueryClientProvider>
  );
}

function routes() {
  spyApi('GET').mockImplementation((path: string) => {
    if (path === '/v1/apps/{slug}/work-policies')
      return ok({ policies: [{ name: 'document-index', revision: 1 }] });
    if (path === '/v1/apps/{slug}/webhooks') return ok([]);
    return ok({ id: 'inv', state: 'pending' });
  });
  return spyApi('POST').mockImplementation(() =>
    ok({ id: 'inv', status_url: '/v1/invocations/inv' })
  );
}

afterEach(() => vi.restoreAllMocks());

it('sends the work policy with an async invocation', async () => {
  const post = routes();
  mount();
  expect(screen.queryByText(/Work policy, deadline and destinations/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Async' }));
  await userEvent.click(screen.getByText(/Work policy, deadline and destinations/));
  await waitFor(() =>
    expect(screen.getByRole('option', { name: 'document-index' })).toBeInTheDocument()
  );
  await userEvent.selectOptions(screen.getByLabelText('Work policy'), 'document-index');
  await userEvent.type(screen.getByLabelText('Work key'), '42');
  await userEvent.click(screen.getByRole('button', { name: 'Send request' }));
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith('/v1/apps/{slug}/invoke/async', {
      params: { path: { slug: 'docs' } },
      body: expect.objectContaining({ work: { policy: 'document-index', key: 42 } }),
    })
  );
});

it('refuses a policy without a key, before sending anything', async () => {
  const post = routes();
  mount();
  await userEvent.click(screen.getByRole('button', { name: 'Async' }));
  await userEvent.click(screen.getByText(/Work policy, deadline and destinations/));
  await waitFor(() =>
    expect(screen.getByRole('option', { name: 'document-index' })).toBeInTheDocument()
  );
  await userEvent.selectOptions(screen.getByLabelText('Work policy'), 'document-index');
  await userEvent.click(screen.getByRole('button', { name: 'Send request' }));
  expect(await screen.findByText(/Work key must be/)).toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
});

it('sends no async-only fields with a synchronous invocation', async () => {
  const post = routes();
  mount();
  await userEvent.click(screen.getByRole('button', { name: 'Send request' }));
  await waitFor(() => expect(post).toHaveBeenCalled());
  const [path, init] = post.mock.calls[0] as [string, { body: Record<string, unknown> }];
  expect(path).toBe('/v1/apps/{slug}/invoke');
  expect(init.body).not.toHaveProperty('work');
  expect(init.body).not.toHaveProperty('destinations');
});
