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
import { Route as Audit } from './dashboard.audit';
import { spyApi } from '@/test/api';

const auditAuth = vi.hoisted(() => ({
  account: { id: 'audit-account' } as { id: string } | null,
  sessionError: undefined as unknown,
  refreshAccount: vi.fn(),
}));

vi.mock('@/lib/auth', async (original) => ({
  ...(await original<object>()),
  useAuth: () => auditAuth,
}));

const firstEntry = {
  id: 'entry-1',
  kind: 'account.deleted',
  actor: 'grace-sweep',
  account_email: 'owner@example.com',
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
  auditAuth.account = { id: 'audit-account' };
  auditAuth.sessionError = undefined;
  auditAuth.refreshAccount.mockReset().mockResolvedValue(undefined);
  spyApi('GET').mockImplementation(async (path, options) => {
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
  expect(await screen.findByText('The account was deleted.')).toBeInTheDocument();

  await userEvent.click(await screen.findByRole('button', { name: 'Load older events' }));
  expect(await screen.findByText('Account settings were updated.')).toBeInTheDocument();
});

it('keeps current audit entries visible when an older page fails', async () => {
  failOlder = true;
  await mount();

  await userEvent.click(await screen.findByRole('button', { name: 'Load older events' }));
  expect(await screen.findByText('The account was deleted.')).toBeInTheDocument();
  await waitFor(
    () => expect(screen.getByRole('alert')).toHaveTextContent('Older audit read failed'),
    { timeout: 5_000 }
  );
});

it('shows the recorded time with the exact timestamp on hover', async () => {
  await mount();
  await screen.findByText('The account was deleted.');

  const when = screen.getByRole('time');
  expect(when).toHaveAttribute('dateTime', '2026-09-11T12:00:00.000Z');
  expect(when).toHaveAttribute('title', expect.stringContaining('2026'));
  expect(when).toHaveTextContent(/^\d{2}:\d{2}$/);
});

it('reveals technical evidence on demand and keeps the account separate from the actor', async () => {
  await mount();
  await screen.findByText('The account was deleted.');
  expect(screen.getByText('account.deleted')).not.toBeVisible();

  await userEvent.click(screen.getByText('View details', { exact: true }));
  expect(screen.getByText('account.deleted')).toBeVisible();
  expect(screen.getByText('Recorded actor')).toBeVisible();
  expect(screen.getByText('grace-sweep')).toBeVisible();
  expect(screen.getByText('Affected account')).toBeVisible();
  expect(screen.getByText('owner@example.com')).toBeVisible();
  expect(screen.queryByText(/By owner@example/)).not.toBeInTheDocument();
});

it('makes loaded-only search visible and keeps older pages accessible when there is no match', async () => {
  await mount();
  await screen.findByText('The account was deleted.');
  await userEvent.type(screen.getByRole('searchbox', { name: 'Search loaded events' }), 'updated');
  expect(screen.getByText('No loaded events match your search.')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Load older events' }));
  expect(await screen.findByText('Account settings were updated.')).toBeInTheDocument();
  expect(screen.queryByText('The account was deleted.')).not.toBeInTheDocument();
  expect(screen.getByRole('searchbox', { name: 'Search events' })).toHaveValue('updated');
});

it('passes date and event filters to the server and restarts pagination', async () => {
  const get = spyApi('GET');
  await mount();
  await screen.findByText('The account was deleted.');
  await userEvent.click(screen.getByRole('button', { name: 'Load older events' }));
  await screen.findByText('Account settings were updated.');

  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Event type' }), 'secret.');
  await waitFor(() =>
    expect(get).toHaveBeenLastCalledWith('/v1/audit-log', {
      params: { query: { limit: 50, since: undefined, kind_prefix: 'secret.' } },
      signal: expect.any(AbortSignal),
    })
  );
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Date range' }), '7');
  await waitFor(() =>
    expect(get).toHaveBeenLastCalledWith('/v1/audit-log', {
      params: { query: { limit: 50, since: expect.any(String), kind_prefix: 'secret.' } },
      signal: expect.any(AbortSignal),
    })
  );
});

it('retries account verification before reading any audit rows', async () => {
  auditAuth.account = null;
  auditAuth.sessionError = new Error('Account read failed');
  await mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('Account read failed');
  expect(spyApi('GET')).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(auditAuth.refreshAccount).toHaveBeenCalledOnce();
});
