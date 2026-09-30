import { act, render, screen, waitFor } from '@testing-library/react';
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
import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '@/lib/api/client';
import { Route as Storage } from './dashboard.storage';

vi.mock('@/components/dashboard/object-storage', () => ({
  ObjectStorage: () => <h2>Object storage</h2>,
}));
let account: { plan: string; app_count: number; limits: { deployed_apps: number } };
let fails: boolean;
beforeEach(() => {
  fails = false;
  account = { plan: 'free', app_count: 1, limits: { deployed_apps: 3 } };
  vi.spyOn(api, 'GET').mockImplementation(async (path) => {
    if (path === '/v1/account') {
      if (fails) throw new Error('Account capacity unavailable');
      return { data: account, response: new Response() } as never;
    }
    return { data: path === '/v1/apps' ? [] : { items: [] }, response: new Response() } as never;
  });
});
async function mount() {
  const root = createRootRoute({ component: Outlet });
  const route = createRoute({
    getParentRoute: () => root,
    path: '/dashboard/storage',
    component: Storage.options.component,
  });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ['/dashboard/storage'] }),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await router.load();
  await act(async () => {
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    );
  });
}
it('shows the authoritative app quota instead of runtime bytes, keeping object storage', async () => {
  await mount();
  const meter = await screen.findByRole('meter', { name: 'App capacity' });
  expect(meter).toHaveAttribute('aria-valuenow', '1');
  expect(meter).toHaveAttribute('aria-valuemax', '3');
  expect(screen.getByText('2 app slots available')).toBeInTheDocument();
  expect(screen.getByText('Free plan')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Object storage' })).toBeInTheDocument();
  expect(screen.queryByText('Runtime storage usage')).not.toBeInTheDocument();
  expect(api.GET).not.toHaveBeenCalledWith('/v1/usage/storage', expect.anything());
});
it('uses a different plan limit and exposes the full-plan state', async () => {
  account = { plan: 'pro', app_count: 12, limits: { deployed_apps: 12 } };
  await mount();
  expect(await screen.findByRole('meter', { name: 'App capacity' })).toHaveAttribute(
    'aria-valuemax',
    '12'
  );
  expect(screen.getByText('All app slots are in use')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'View plans' })).toHaveAttribute(
    'href',
    '/dashboard/plans'
  );
});
it('does not invent a zero count while loading, and supports retry after failure', async () => {
  fails = true;
  await mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('Account capacity unavailable');
  expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  fails = false;
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '1'));
});

it('keeps quota numbers hidden until the account response arrives', async () => {
  vi.mocked(api.GET).mockImplementation(() => new Promise(() => {}));
  await mount();
  expect(screen.getByText('Loading app capacity…')).toBeInTheDocument();
  expect(screen.queryByRole('meter')).not.toBeInTheDocument();
});

it('keeps the true count visible when a downgraded account exceeds its limit', async () => {
  account.app_count = 4;
  await mount();
  const meter = await screen.findByRole('meter');
  expect(meter).toHaveAttribute('aria-valuenow', '3');
  expect(meter).toHaveAttribute('aria-valuetext', '4 of 3 app slots used');
  expect(screen.getByText('All app slots are in use')).toBeInTheDocument();
});
