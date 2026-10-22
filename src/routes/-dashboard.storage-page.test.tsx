import { act, render, screen } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { expect, it, vi } from 'vitest';
import { Route as Storage } from './dashboard.storage';
import type { StorageSelection } from '@/components/dashboard/object-storage';

const page = vi.hoisted(() => ({
  change: undefined as
    undefined | ((next: StorageSelection, options?: { replace?: boolean }) => void),
}));
vi.mock('@/components/dashboard/object-storage', () => ({
  ObjectStorage: ({
    onSelectionChange,
  }: {
    onSelectionChange: (next: StorageSelection, options?: { replace?: boolean }) => void;
  }) => {
    page.change = onSelectionChange;
    return <h2>Buckets</h2>;
  },
}));

async function mount(entries = ['/dashboard/storage']) {
  const root = createRootRoute({ component: Outlet });
  const route = createRoute({
    getParentRoute: () => root,
    path: '/dashboard/storage',
    component: Storage.options.component,
    validateSearch: Storage.options.validateSearch,
  });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: entries }),
  });
  await router.load();
  await act(async () => {
    render(<RouterProvider router={router} />);
  });
  return router;
}

it('is about buckets only: app capacity lives on the Usage page', async () => {
  await mount();
  expect(screen.queryByText('App capacity')).not.toBeInTheDocument();
  expect(screen.queryByText(/app capacity/i)).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Buckets' })).toBeInTheDocument();
});

it('keeps the open bucket, section and folder in the URL', () => {
  const validate = Storage.options.validateSearch as (s: Record<string, unknown>) => unknown;
  expect(validate({ app: 'shop', bucket: 'b1', tab: 'code', prefix: 'images/' })).toEqual({
    app: 'shop',
    bucket: 'b1',
    tab: 'code',
    prefix: 'images/',
  });
  expect(validate({ tab: 'nope', bucket: '' })).toEqual({});
});

it('gives each chosen bucket, section and folder its own Back step', async () => {
  const router = await mount();
  const go = async (next: StorageSelection) => {
    await act(async () => {
      page.change!(next);
    });
  };
  await go({ app: 'shop', bucket: 'a' });
  await go({ app: 'shop', bucket: 'b' });
  await go({ app: 'shop', bucket: 'b', tab: 'code' });
  await go({ app: 'shop', bucket: 'b', tab: 'objects', prefix: 'images/' });

  const back = async () => {
    await act(async () => {
      router.history.back();
      await router.load();
    });
    return router.state.location.search;
  };
  expect(await back()).toEqual({ app: 'shop', bucket: 'b', tab: 'code' });
  expect(await back()).toEqual({ app: 'shop', bucket: 'b' });
  expect(await back()).toEqual({ app: 'shop', bucket: 'a' });
  expect(await back()).toEqual({});
});

it('replaces the entry for a change the page made on its own', async () => {
  const router = await mount();
  await act(async () => {
    page.change!({ app: 'shop', bucket: 'a' });
  });
  const length = router.history.length;
  await act(async () => {
    page.change!({ app: 'shop' }, { replace: true });
  });
  expect(router.history.length).toBe(length);
  expect(router.state.location.search).toEqual({ app: 'shop' });
});
