import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { spyApi } from '@/test/api';
import type { Deployment } from '@/lib/api/queries';

/**
 * The same panel through the real hooks, with only the API client stubbed:
 * the busy state and double submits live in the mutation, which the other
 * suite mocks away.
 */
vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: () => ({
    access: 'on',
    capability: { key: 'deployment-aliases', maturity: 'beta' },
    refresh: () => {},
  }),
}));
vi.mock('@/lib/api/queries', async (original) => ({
  ...(await original<object>()),
  useAppDeployments: () => ({
    data: { pages: [{ items: [live] }] },
    isPending: false,
    error: null,
  }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/ui/confirm', () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
}));

const { DeploymentAliasesPanel } = await import('./deployment-aliases');

const live: Deployment = {
  id: 'd3',
  app_id: 'a1',
  image_digest: 'sha256:abc',
  kind: 'github',
  status: 'live',
  revision: 3,
  created_at: '2026-10-30T10:00:00Z',
};
const ok = (data: unknown) => ({ data, response: new Response() }) as never;

afterEach(() => vi.restoreAllMocks());

it('disables the submit while the set is in flight and sends it once', async () => {
  spyApi('GET').mockResolvedValue(ok({ items: [] }));
  let finish: (value: unknown) => void = () => {};
  const put = spyApi('PUT').mockReturnValue(new Promise((resolve) => (finish = resolve)));
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <DeploymentAliasesPanel slug="api" onOpenDeployment={vi.fn()} />
    </QueryClientProvider>
  );
  const name = await screen.findByRole('textbox', { name: 'Alias name' });
  await userEvent.type(name, 'stable');
  const submit = screen.getByRole('button', { name: 'Set alias' });
  await userEvent.click(submit);
  await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
  expect(submit).toBeDisabled();
  // Enter submits the form directly, past the disabled button.
  await userEvent.type(name, '{Enter}');
  await userEvent.type(name, '{Enter}');
  expect(put).toHaveBeenCalledTimes(1);
  finish(
    ok({
      name: 'stable',
      deployment_id: 'd3',
      revision: 3,
      deployment_status: 'live',
      created_at: '2026-10-30T10:00:00Z',
      updated_at: '2026-10-30T10:00:00Z',
    })
  );
  await waitFor(() => expect(submit).not.toBeDisabled());
});

it('ignores a second submit while the fresh read is still out', async () => {
  let release: (value: unknown) => void = () => {};
  spyApi('GET')
    .mockResolvedValueOnce(ok({ items: [] }))
    .mockReturnValueOnce(new Promise((resolve) => (release = resolve)))
    .mockResolvedValue(ok({ items: [] }));
  const put = spyApi('PUT').mockResolvedValue(
    ok({
      name: 'stable',
      deployment_id: 'd3',
      revision: 3,
      created_at: '2026-10-30T10:00:00Z',
      updated_at: '2026-10-30T10:00:00Z',
    })
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <DeploymentAliasesPanel slug="api" onOpenDeployment={vi.fn()} />
    </QueryClientProvider>
  );
  const name = await screen.findByRole('textbox', { name: 'Alias name' });
  await userEvent.type(name, 'stable');
  const submit = screen.getByRole('button', { name: 'Set alias' });
  await userEvent.click(submit);
  expect(submit).toBeDisabled();
  await userEvent.type(name, '{Enter}');
  expect(put).not.toHaveBeenCalled();
  release(ok({ items: [] }));
  await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(put).toHaveBeenCalledTimes(1);
});
