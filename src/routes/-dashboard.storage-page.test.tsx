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

vi.mock('@/components/dashboard/object-storage', () => ({
  ObjectStorage: () => <h2>Buckets</h2>,
}));

it('is about buckets only: app capacity lives on the Usage page', async () => {
  const root = createRootRoute({ component: Outlet });
  const route = createRoute({
    getParentRoute: () => root,
    path: '/dashboard/storage',
    component: Storage.options.component,
    validateSearch: Storage.options.validateSearch,
  });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ['/dashboard/storage'] }),
  });
  await router.load();
  await act(async () => {
    render(<RouterProvider router={router} />);
  });
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
