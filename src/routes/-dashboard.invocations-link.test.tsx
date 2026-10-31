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
import { ApiError } from '@/lib/api/errors';
import { Route as Traces } from './dashboard.invocations';

const listedId = 'a'.repeat(32);
const olderId = 'b'.repeat(32);
const mocks = vi.hoisted(() => ({ read: vi.fn(), missing: false, errorStatus: 0 }));
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
              state: 'failed',
              source: 'async_invoke',
              created_at: '2026-09-01T00:00:00Z',
              work_policy_name: 'document-index',
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
        id && !mocks.missing && !mocks.errorStatus
          ? {
              id,
              app_id: 'app1',
              state: 'failed',
              work_policy_name: 'document-index',
              source: 'async_invoke',
              created_at: '2026-09-01T00:00:00Z',
              method: 'POST',
              path: '/work',
            }
          : undefined,
      isPending: false,
      error: mocks.errorStatus
        ? new ApiError({
            status: mocks.errorStatus,
            code: mocks.errorStatus === 404 ? 'invocation_not_found' : 'forbidden',
            title: 'Invocation unavailable',
            detail: 'This invocation is unavailable.',
          })
        : null,
    };
  },
}));
vi.mock('@/components/dashboard/async-invocations', () => ({
  AsyncInvocationsMaturity: () => <span>maturity-label</span>,
  ReplayInvocationButton: (p: {
    invocation: { id: string; work_policy_name?: string };
    variant?: string;
  }) => (
    <span>{`replay:${p.variant ?? 'icon'}:${p.invocation.id}:${p.invocation.work_policy_name}`}</span>
  ),
  InvocationDelivery: (p: { appSlug: string; invocation: { work_policy_name?: string } }) => (
    <span>{`delivery:${p.appSlug}:${p.invocation.work_policy_name}`}</span>
  ),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => vi.fn() }));
beforeEach(() => {
  mocks.read.mockReset();
  mocks.missing = false;
  mocks.errorStatus = 0;
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
    path: 'invocations',
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
  it('describes the async work it lists and sends HTTP requests to the Debugger', async () => {
    await mount('/dashboard/invocations');
    expect(screen.queryByText(/Every request into your apps/)).not.toBeInTheDocument();
    expect(screen.getByText(/queue messages/)).toHaveTextContent(
      /HTTP requests are in the Debugger/
    );
  });
  it('labels the page from the capability and replays rows through the routing button', async () => {
    await mount('/dashboard/invocations');
    expect(screen.getByText('maturity-label')).toBeInTheDocument();
    expect(screen.getByText(`replay:icon:${listedId}:document-index`)).toBeInTheDocument();
  });
  it('shows how the work was admitted, and the replay it allows, in the drawer', async () => {
    await mount(`/dashboard/invocations?invocation=${olderId}`);
    const dialog = await screen.findByRole('dialog', { name: 'POST /work' });
    expect(dialog).toHaveTextContent('delivery:api:document-index');
    expect(dialog).toHaveTextContent(`replay:full:${olderId}:document-index`);
  });
  it('opens an ID directly even when it is not in the loaded list', async () => {
    await mount(`/dashboard/invocations?invocation=${olderId}`);
    expect(await screen.findByRole('dialog', { name: 'POST /work' })).toHaveTextContent(olderId);
    expect(mocks.read).toHaveBeenCalledWith(olderId);
  });
  it('writes row selection to the URL and follows back/forward navigation', async () => {
    const { router, history } = await mount('/dashboard/invocations');
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
    const { router } = await mount(`/dashboard/invocations?invocation=${olderId}`);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(router.state.location.search.invocation).toBeUndefined());
  });
  it('ignores invalid IDs without requesting them', async () => {
    await mount('/dashboard/invocations?invocation=invalid%2Fpath');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.read).not.toHaveBeenCalledWith('invalid/path');
  });
  it.each([403, 404])(
    'keeps a denied or stale ID visible without substituting list data (%s)',
    async (status) => {
      mocks.errorStatus = status;
      const { router } = await mount(`/dashboard/invocations?invocation=${olderId}`);
      expect(screen.getByRole('dialog')).toHaveTextContent(olderId);
      expect(screen.getByRole('dialog')).toHaveTextContent('This invocation is unavailable.');
      expect(screen.getByRole('dialog')).not.toHaveTextContent('POST /work');
      expect(router.state.location.search.invocation).toBe(olderId);
    }
  );
  it('handles an unavailable linked invocation without selecting another record', async () => {
    mocks.missing = true;
    await mount(`/dashboard/invocations?invocation=${olderId}`);
    expect(screen.getByRole('dialog')).toHaveTextContent('This invocation has no recorded detail.');
    expect(mocks.read).toHaveBeenCalledWith(olderId);
  });
});
