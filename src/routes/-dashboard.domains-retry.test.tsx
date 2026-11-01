import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route as Domains } from './dashboard.domains';
import { spyApi } from '@/test/api';

const toast = vi.hoisted(() => vi.fn());
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: () => ({ access: 'on', refresh: () => {} }),
}));

const APP_ID = '0123456789abcdef0123456789abcdef';
const OLD_TXT = '_gregale-challenge.alpha.example.com TXT "old-token"';
const NEW_TXT = '_gregale-challenge.alpha.example.com TXT "new-token"';

let domains: Record<string, unknown>[];
let retry: (domain: string) => unknown;
let readd: (body: Record<string, unknown>) => unknown;
let post: ReturnType<typeof spyApi>;
let get: ReturnType<typeof spyApi>;
let domainsFail = false;

const problem = (status: number, code: string, title: string) => ({
  data: undefined,
  error: { type: 'about:blank', status, code, title },
  response: new Response(null, { status }),
});

beforeEach(() => {
  toast.mockReset();
  domains = [
    { domain: 'alpha.example.com', app_id: APP_ID, verified: false, txt_record: OLD_TXT },
    { domain: 'beta.example.com', app_id: APP_ID, verified: true },
  ];
  retry = () => ({ data: undefined, response: new Response(null, { status: 202 }) });
  readd = (body) => {
    domains = domains.map((d) => (d.domain === body.domain ? { ...d, txt_record: NEW_TXT } : d));
    return {
      data: { domain: body.domain, app_id: body.app_id, verified: false, txt_record: NEW_TXT },
      response: new Response(null, { status: 202 }),
    };
  };
  domainsFail = false;
  get = spyApi('GET').mockImplementation(async (path) => {
    if (path === '/v1/domains' && domainsFail) throw new Error('offline');
    const data =
      path === '/v1/apps'
        ? [{ id: APP_ID, slug: 'api' }]
        : path === '/v1/domains'
          ? domains
          : { checks: [], stale: true, observed_at: '2026-09-11T00:00:00Z' };
    return { data, response: new Response() } as never;
  });
  post = spyApi('POST').mockImplementation(async (path, init) => {
    const i = init as { params?: { path?: { domain: string } }; body?: Record<string, unknown> };
    if (path === '/v1/domains/{domain}/retry') return retry(i.params!.path!.domain);
    if (path === '/v1/domains') return readd(i.body!);
    throw new Error(`unexpected POST ${path}`);
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function mount() {
  const root = createRootRoute({ component: Outlet });
  const dashboard = createRoute({
    getParentRoute: () => root,
    path: 'dashboard',
    component: Outlet,
  });
  const route = createRoute({
    getParentRoute: () => dashboard,
    path: 'domains',
    component: Domains.options.component,
    validateSearch: Domains.options.validateSearch,
  });
  const router = createRouter({
    routeTree: root.addChildren([dashboard.addChildren([route])]),
    history: createMemoryHistory({ initialEntries: ['/dashboard/domains'] }),
  });
  await router.load();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    );
  });
  await screen.findByText('alpha.example.com');
}

const rowOf = (host: string) => screen.getByText(host).closest('tr') as HTMLElement;

const domainReads = () => get.mock.calls.filter(([path]) => path === '/v1/domains').length;

describe('Domain verification retry', () => {
  it('has no Verify button on a pending domain: /verify does not look up the TXT record', async () => {
    await mount();
    expect(within(rowOf('alpha.example.com')).queryByRole('button', { name: 'Verify' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Verify' })).toBeNull();
  });

  it('re-reads the domains 5 s and 20 s after a retry is queued, so the result shows up', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await mount();
      await user.click(
        within(rowOf('alpha.example.com')).getByRole('button', { name: 'Check again' })
      );
      await waitFor(() =>
        expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Checking again' }))
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      const afterRetry = domainReads();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(domainReads()).toBe(afterRetry + 1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });
      expect(domainReads()).toBe(afterRetry + 2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('says so when the domain is gone after a 409, instead of doing nothing', async () => {
    retry = () => {
      domains = domains.filter((d) => d.domain !== 'alpha.example.com');
      return problem(409, 'validation_failed', 'Domain cannot be retried');
    };
    await mount();
    await userEvent.click(
      within(rowOf('alpha.example.com')).getByRole('button', { name: 'Check again' })
    );
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'alpha.example.com is no longer listed' })
      )
    );
  });

  it('says so when the re-read fails after a 409', async () => {
    retry = () => {
      domainsFail = true;
      return problem(409, 'validation_failed', 'Domain cannot be retried');
    };
    await mount();
    await userEvent.click(
      within(rowOf('alpha.example.com')).getByRole('button', { name: 'Check again' })
    );
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'error', title: 'Could not read the domain’s state' })
      )
    );
  });

  it('offers Check again for an unverified domain only, and says it is checking', async () => {
    await mount();
    expect(
      within(rowOf('beta.example.com')).queryByRole('button', { name: 'Check again' })
    ).toBeNull();
    await userEvent.click(
      within(rowOf('alpha.example.com')).getByRole('button', { name: 'Check again' })
    );
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        '/v1/domains/{domain}/retry',
        expect.objectContaining({ params: { path: { domain: 'alpha.example.com' } } })
      )
    );
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Checking again' }))
    );
  });

  it('on 409 re-reads the domains and reports a domain that has since verified', async () => {
    retry = () => {
      domains = domains.map((d) => ({ ...d, verified: true }));
      return problem(409, 'validation_failed', 'Domain cannot be retried');
    };
    await mount();
    await userEvent.click(
      within(rowOf('alpha.example.com')).getByRole('button', { name: 'Check again' })
    );
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'success', title: 'alpha.example.com verified' })
      )
    );
    expect(screen.queryByText(/verification expired/i)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Get a new TXT record' })).toBeNull();
  });

  it('on 409 for a still-unverified domain says it expired and offers a new TXT record', async () => {
    retry = () => problem(409, 'validation_failed', 'Domain cannot be retried');
    await mount();
    await userEvent.click(
      within(rowOf('alpha.example.com')).getByRole('button', { name: 'Check again' })
    );
    const row = rowOf('alpha.example.com');
    expect(await within(row).findByText(/This verification expired/)).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Check again' })).toBeNull();

    await userEvent.click(within(row).getByRole('button', { name: 'Get a new TXT record' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        '/v1/domains',
        expect.objectContaining({ body: { domain: 'alpha.example.com', app_id: APP_ID } })
      )
    );
    const dialog = within(await screen.findByRole('dialog', { name: /New TXT record/ }));
    expect(dialog.getByText(NEW_TXT)).toBeInTheDocument();
    expect(dialog.getByText(/previous value no longer works/i)).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: /Copy: TXT record/ })).toBeInTheDocument();
  });

  it('keeps the domain environment when it re-arms an expired challenge', async () => {
    domains[0] = { ...domains[0], environment: 'staging' };
    retry = () => problem(409, 'validation_failed', 'Domain cannot be retried');
    await mount();
    await userEvent.click(
      within(rowOf('alpha.example.com')).getByRole('button', { name: 'Check again' })
    );
    await userEvent.click(
      await within(rowOf('alpha.example.com')).findByRole('button', {
        name: 'Get a new TXT record',
      })
    );
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        '/v1/domains',
        expect.objectContaining({
          body: { domain: 'alpha.example.com', app_id: APP_ID, environment: 'staging' },
        })
      )
    );
  });

  it('reports a refused re-add and leaves the expired state in place', async () => {
    retry = () => problem(409, 'validation_failed', 'Domain cannot be retried');
    readd = () => problem(409, 'validation_failed', 'Domain taken');
    await mount();
    await userEvent.click(
      within(rowOf('alpha.example.com')).getByRole('button', { name: 'Check again' })
    );
    await userEvent.click(
      await within(rowOf('alpha.example.com')).findByRole('button', {
        name: 'Get a new TXT record',
      })
    );
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'error', title: 'Could not get a new TXT record' })
      )
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(
      within(rowOf('alpha.example.com')).getByRole('button', { name: 'Get a new TXT record' })
    ).toBeInTheDocument();
  });

  it('does not call a non-409 failure an expiry', async () => {
    retry = () => problem(429, 'rate_limited', 'Slow down');
    await mount();
    await userEvent.click(
      within(rowOf('alpha.example.com')).getByRole('button', { name: 'Check again' })
    );
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'error', title: 'Could not check again' })
      )
    );
    expect(screen.queryByText(/verification expired/i)).toBeNull();
  });
});
