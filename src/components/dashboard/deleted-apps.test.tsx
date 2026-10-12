import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { api } from '@/lib/api/client';
import { DeletedApps } from './deleted-apps';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => (
    <a href="/dashboard/workflows/retained-app">{children}</a>
  ),
}));
const row = {
  account_id: 'account-a',
  id: '00000000-0000-4000-8000-000000000001',
  slug: 'retained-app',
  deleted_at: '2026-10-12T12:00:00Z',
  delete_grace_until: '2026-10-19T12:00:00Z',
  restore_eligible: true,
  restore_blocker: '',
  evaluated_at: '2026-10-12T13:00:00Z',
};
let detail = { ...row };
let rows = [row];
let failure = false;
beforeEach(() => {
  window.sessionStorage.clear();
  detail = { ...row };
  rows = [row];
  failure = false;
  vi.spyOn(api, 'GET').mockImplementation(async (path) => {
    if (path === '/v1/account')
      return { data: { id: 'account-a' }, response: new Response() } as never;
    if (path === '/v1/deleted-apps')
      return failure
        ? ({
            error: { status: 403, code: 'forbidden', title: 'Fixture read denied' },
            response: new Response(null, { status: 403 }),
          } as never)
        : ({
            data: {
              account_id: 'account-a',
              apps: rows,
              next_cursor: 'opaque-next',
              evaluated_at: row.evaluated_at,
            },
            response: new Response(),
          } as never);
    if (path === '/v1/deleted-apps/{id}')
      return { data: detail, response: new Response() } as never;
    return {
      error: { status: 404, code: 'not_found', title: 'Not found' },
      response: new Response(null, { status: 404 }),
    } as never;
  });
});
afterEach(() => vi.restoreAllMocks());
function setup(accountId = 'account-a') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: 2 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return {
    client,
    wrapper,
    ...render(
      <DeletedApps accountId={accountId} cursor="" onNext={vi.fn()} onRestart={vi.fn()} />,
      { wrapper }
    ),
  };
}

it('shows returned lifecycle blockers and bounded paging without claiming execution health', async () => {
  rows = [
    row,
    {
      ...row,
      id: '00000000-0000-4000-8000-000000000002',
      slug: 'expired-app',
      restore_eligible: false,
      restore_blocker: 'grace_expired',
    },
  ];
  const next = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <DeletedApps accountId="account-a" cursor="" onNext={next} onRestart={vi.fn()} />
    </QueryClientProvider>
  );
  await screen.findByText('retained-app');
  expect(screen.getByText(/Grace expired/)).toBeVisible();
  expect(screen.getByRole('button', { name: /Review restore.*expired-app/ })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Next deleted apps' }));
  expect(next).toHaveBeenCalledWith('opaque-next');
  expect(screen.getByText(/does not prove execution health/)).toBeVisible();
});

it('requires a new review after a changed deadline and sends no POST', async () => {
  const post = vi.spyOn(api, 'POST');
  setup();
  await userEvent.click(
    await screen.findByRole('button', { name: /Review restore.*retained-app/ })
  );
  await screen.findByRole('dialog', { name: 'Restore retained-app?' });
  detail = { ...row, delete_grace_until: '2026-10-20T12:00:00Z' };
  await userEvent.click(screen.getByRole('button', { name: 'Confirm restore' }));
  await screen.findByText(/changed.*review again/i);
  expect(post).not.toHaveBeenCalled();
});

it('keeps uncertain recovery across remount and requires inspection before a new attempt', async () => {
  const post = vi.spyOn(api, 'POST').mockRejectedValue(new TypeError('Response lost'));
  const view = setup();
  await userEvent.click(
    await screen.findByRole('button', { name: /Review restore.*retained-app/ })
  );
  await screen.findByRole('dialog', { name: 'Restore retained-app?' });
  await userEvent.click(screen.getByRole('button', { name: 'Confirm restore' }));
  await screen.findByRole('button', { name: /Inspect restore.*retained-app/ });
  view.unmount();
  setup();
  await screen.findByRole('button', { name: /Inspect restore.*retained-app/ });
  expect(
    await screen.findByRole('button', { name: /Review restore.*retained-app/ })
  ).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: /Inspect restore.*retained-app/ }));
  await screen.findByText(/still retained/i);
  expect(post).toHaveBeenCalledTimes(1);
});

it('does not submit or reveal a delayed review after account changes', async () => {
  const post = vi.spyOn(api, 'POST');
  let resolve!: (value: unknown) => void;
  const get = vi.mocked(api.GET);
  get.mockImplementation((path) =>
    path === '/v1/deleted-apps/{id}'
      ? (new Promise((done) => {
          resolve = done;
        }) as never)
      : ({
          data:
            path === '/v1/account'
              ? { id: 'account-a' }
              : {
                  account_id: 'account-a',
                  apps: rows,
                  next_cursor: 'opaque-next',
                  evaluated_at: row.evaluated_at,
                },
          response: new Response(),
        } as never)
  );
  const view = setup();
  await userEvent.click(
    await screen.findByRole('button', { name: /Review restore.*retained-app/ })
  );
  await waitFor(() => expect(resolve).toBeDefined());
  view.rerender(
    <DeletedApps accountId="account-b" cursor="" onNext={vi.fn()} onRestart={vi.fn()} />
  );
  await act(async () => {
    resolve({ data: detail, response: new Response() });
  });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
});

it('shows denied reads with no stale restore control', async () => {
  failure = true;
  setup();
  await screen.findByText(/Fixture read denied/);
  expect(screen.queryByRole('button', { name: /Review restore/ })).not.toBeInTheDocument();
});

it.each([402, 409, 503])(
  'keeps a %s restore failure visible without automatically repeating the write',
  async (status) => {
    const post = vi.spyOn(api, 'POST').mockResolvedValue({
      error: { status, code: 'restore_failed', title: `Fixture restore ${status}` },
      response: new Response(null, { status }),
    } as never);
    setup();
    await userEvent.click(
      await screen.findByRole('button', { name: /Review restore.*retained-app/ })
    );
    await screen.findByRole('dialog', { name: 'Restore retained-app?' });
    await userEvent.click(screen.getByRole('button', { name: 'Confirm restore' }));
    await screen.findByText(`Fixture restore ${status}`);
    expect(post).toHaveBeenCalledTimes(1);
    if (status === 503)
      await screen.findByRole('button', { name: /Inspect restore.*retained-app/ });
    else
      expect(
        await screen.findByRole('button', { name: /Review restore.*retained-app/ })
      ).toBeEnabled();
  }
);

it('shows an empty account inventory without offering restore', async () => {
  rows = [];
  setup();
  await screen.findByText('No retained deleted apps were returned for this account.');
  expect(screen.queryByRole('button', { name: /Review restore/ })).not.toBeInTheDocument();
});
