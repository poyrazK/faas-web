import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '@/lib/api/client';
import { Route as Audit } from './dashboard.audit';

const firstEntry = {
  id: 'entry-1',
  kind: 'account.deleted',
  actor: 'grace-sweep',
  received_at: '2026-09-11T12:00:00Z',
  data: { source: 'grace-sweep' },
};
const olderEntry = {
  ...firstEntry,
  id: 'entry-2',
  kind: 'account.updated',
  received_at: '2026-09-11T11:00:00Z',
};
let failOlder: boolean;

async function mount() {
  const root = createRootRoute({ component: Outlet });
  const dashboard = createRoute({
    getParentRoute: () => root,
    path: 'dashboard',
    component: Outlet,
  });
  const route = createRoute({
    getParentRoute: () => dashboard,
    path: 'audit',
    component: Audit.options.component,
  });
  const router = createRouter({
    routeTree: root.addChildren([dashboard.addChildren([route])]),
    history: createMemoryHistory({ initialEntries: ['/dashboard/audit'] }),
  });
  await router.load();
  await act(async () => {
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
      >
        <RouterProvider router={router} />
      </QueryClientProvider>
    );
  });
}

beforeEach(() => {
  failOlder = false;
  vi.spyOn(api, 'GET').mockImplementation(async (path, options) => {
    const query = (options as { params?: { query?: { before?: string; limit?: number } } })?.params
      ?.query;
    if (path !== '/v1/audit-log') throw new Error(`Unexpected GET ${path}`);
    if (query?.before && failOlder) throw new Error('Older audit read failed');
    return {
      data: query?.before
        ? { entries: [olderEntry], limit: 1 }
        : { entries: [firstEntry], limit: 1, next_before: 'audit-cursor-1' },
      response: new Response(),
    } as never;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('loads older audit entries without losing the current page', async () => {
  await mount();
  expect(await screen.findByText('account.deleted')).toBeInTheDocument();

  await userEvent.click(await screen.findByRole('button', { name: 'Load older events' }));
  expect(await screen.findByText('account.updated')).toBeInTheDocument();
});

it('keeps current audit entries visible when an older page fails', async () => {
  failOlder = true;
  await mount();

  await userEvent.click(await screen.findByRole('button', { name: 'Load older events' }));
  expect(await screen.findByText('account.deleted')).toBeInTheDocument();
  await waitFor(
    () => expect(screen.getByRole('alert')).toHaveTextContent('Older audit read failed'),
    { timeout: 5_000 }
  );
});
