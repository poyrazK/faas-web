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
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route as Traces } from './dashboard.traces';

const listedId = 'a'.repeat(32);
const olderId = 'b'.repeat(32);
const mocks = vi.hoisted(() => ({ read: vi.fn(), missing: false }));
vi.mock('@/lib/api/queries', () => ({
  useApps: () => ({ data: [{ id: 'app1', slug: 'api' }] }),
  useInfiniteInvocations: () => ({
    data: {
      pages: [
        {
          invocations: [
            {
              id: 'a'.repeat(32),
              app_id: 'app1',
              state: 'completed',
              source: 'async_invoke',
              created_at: '2026-09-01T00:00:00Z',
            },
          ],
        },
      ],
    },
    isPending: false,
    error: null,
    hasNextPage: false,
  }),
  useReplayInvocation: () => ({ mutateAsync: vi.fn() }),
  useInvocation: (id: string) => {
    mocks.read(id);
    return {
      data:
        id && !mocks.missing
          ? {
              id,
              state: 'completed',
              source: 'async_invoke',
              created_at: '2026-09-01T00:00:00Z',
              method: 'POST',
              path: '/work',
            }
          : undefined,
      isPending: false,
      error: null,
    };
  },
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => vi.fn() }));
beforeEach(() => {
  mocks.read.mockReset();
  mocks.missing = false;
});
async function mount(entry: string) {
  const root = createRootRoute({ component: Outlet });
  const dashboard = createRoute({
    getParentRoute: () => root,
    path: 'dashboard',
    component: Outlet,
  });
  const traces = createRoute({
    getParentRoute: () => dashboard,
    path: 'traces',
    component: Traces.options.component,
    validateSearch: Traces.options.validateSearch,
  });
  const history = createMemoryHistory({ initialEntries: [entry] });
  const router = createRouter({
    routeTree: root.addChildren([dashboard.addChildren([traces])]),
    history,
  });
  await router.load();
  await act(async () => {
    render(<RouterProvider router={router} />);
  });
  return { router, history };
}

describe('invocation detail links', () => {
  it('opens an ID directly even when it is not in the loaded list', async () => {
    await mount(`/dashboard/traces?invocation=${olderId}`);
    expect(await screen.findByRole('dialog', { name: 'POST /work' })).toHaveTextContent(olderId);
    expect(mocks.read).toHaveBeenCalledWith(olderId);
  });
  it('writes row selection to the URL and follows back/forward navigation', async () => {
    const { router, history } = await mount('/dashboard/traces');
    await userEvent.click(screen.getByText(listedId));
    await waitFor(() => expect(router.state.location.search.invocation).toBe(listedId));
    await act(async () => {
      history.back();
    });
    await waitFor(() => expect(router.state.location.search.invocation).toBeUndefined());
    await act(async () => {
      history.forward();
    });
    await waitFor(() => expect(router.state.location.search.invocation).toBe(listedId));
    expect(screen.getByRole('dialog')).toHaveTextContent(listedId);
  });
  it('removes the selected ID when the drawer closes', async () => {
    const { router } = await mount(`/dashboard/traces?invocation=${olderId}`);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(router.state.location.search.invocation).toBeUndefined());
  });
  it('ignores invalid IDs without requesting them', async () => {
    await mount('/dashboard/traces?invocation=invalid%2Fpath');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.read).not.toHaveBeenCalledWith('invalid/path');
  });
  it('handles an unavailable linked invocation without selecting another record', async () => {
    mocks.missing = true;
    await mount(`/dashboard/traces?invocation=${olderId}`);
    expect(screen.getByRole('dialog')).toHaveTextContent('This invocation has no recorded detail.');
    expect(mocks.read).toHaveBeenCalledWith(olderId);
  });
});
