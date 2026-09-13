import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
import { api } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import type { components } from '@/lib/api/schema';
import { Route as Instances } from './dashboard.workers';

type Instance = components['schemas']['InstanceResponse'];
const instance: Instance = {
  id: 'vm-1',
  app_id: 'app-1',
  deployment_id: 'dep-1',
  state: 'parked',
  host_ip: '10.0.1.2',
  ram_mb: 512,
  wake_id: 'wake-1',
  execution_mode: 'service',
  started_at: '2026-09-11T10:00:00Z',
  parked_at: '2026-09-11T10:05:00Z',
  last_request_at: '2026-09-11T10:04:00Z',
  min_instances_target: 0,
  lifecycle_failure_reason: 'oom',
};
let rows: Instance[];
let olderRows: Instance[];
let apps: { id: string; slug: string }[];
let instanceState: 'ready' | 'pending' | 'error';
let appState: 'ready' | 'pending' | 'error';
let wakeState: 'ready' | 'pending' | 'error' | 'empty';
let paginationState: boolean;
let reads: string[];

async function mount(entry = '/dashboard/workers', previousEntry?: string) {
  const root = createRootRoute({ component: Outlet });
  const dashboard = createRoute({
    getParentRoute: () => root,
    path: 'dashboard',
    component: Outlet,
  });
  const route = createRoute({
    getParentRoute: () => dashboard,
    path: 'workers',
    component: Instances.options.component,
    validateSearch: Instances.options.validateSearch,
  });
  const router = createRouter({
    routeTree: root.addChildren([dashboard.addChildren([route])]),
    history: createMemoryHistory({
      initialEntries: previousEntry ? [previousEntry, entry] : [entry],
    }),
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
  return router;
}

beforeEach(() => {
  rows = [{ ...instance }];
  olderRows = [];
  apps = [{ id: 'app-1', slug: 'alpha' }];
  reads = [];
  instanceState = 'ready';
  appState = 'ready';
  wakeState = 'ready';
  paginationState = false;
  vi.spyOn(api, 'GET').mockImplementation(async (path, options) => {
    const request = options as {
      params?: {
        path?: Record<string, string>;
        query?: Record<string, string | number>;
      };
    };
    const params = request?.params?.path;
    const query = request?.params?.query;
    reads.push(`${path}:${JSON.stringify(params ?? {})}:${JSON.stringify(query ?? {})}`);
    let data: unknown;
    if (path === '/v1/instances') {
      if (instanceState === 'pending') return new Promise(() => {});
      if (instanceState === 'error')
        throw new ApiError({
          status: 400,
          code: 'instance_read_failed',
          title: 'Instance read failed',
          detail: 'Instance read failed',
        });
      const older = query?.before === 'instances-cursor-1';
      data = {
        instances: older ? olderRows : rows,
        ...(paginationState && !older ? { next_before: 'instances-cursor-1' } : {}),
      };
    } else if (path === '/v1/apps') {
      if (appState === 'pending') return new Promise(() => {});
      if (appState === 'error') throw new Error('App lookup failed');
      data = apps;
    } else if (path === '/v1/apps/{slug}/wakes/{wake_id}/timeline') {
      if (params?.slug !== 'alpha' || params?.wake_id !== 'wake-1')
        throw new Error('Invalid wake target');
      if (wakeState === 'pending') return new Promise(() => {});
      if (wakeState === 'error') throw new Error('Timeline read failed');
      data = {
        events:
          wakeState === 'empty'
            ? []
            : [
                { at: '2026-09-11T10:00:00Z', kind: 'wake.queued', actor: 'schedd' },
                { at: '2026-09-11T10:00:00.125Z', kind: 'vm.ready', actor: 'vmmd' },
              ],
      };
    } else throw new Error(`Unexpected GET ${path}`);
    return { data, response: new Response() } as never;
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Instance details', () => {
  it('skips sequential text edits on Back while preserving instance selection and copied URLs', async () => {
    rows.push({ ...instance, id: 'vm-2', app_id: 'app-2', state: 'running' });
    apps.push({ id: 'app-2', slug: 'bravo' });
    const router = await mount(
      '/dashboard/workers?q=alpha&campaign=handoff#lifecycle',
      '/dashboard'
    );
    const filter = screen.getByRole('searchbox');
    expect(filter).toHaveValue('alpha');
    expect(await screen.findByRole('button', { name: /alpha.*vm-1/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /bravo.*vm-2/ })).not.toBeInTheDocument();
    for (const query of ['b', 'br', 'bra', 'brav', 'bravo']) {
      fireEvent.change(filter, { target: { value: query } });
      await waitFor(() => expect(router.state.location.search.q).toBe(query));
      expect(router.state.location.search.campaign).toBe('handoff');
      expect(router.state.location.hash).toBe('lifecycle');
    }
    await userEvent.click(await screen.findByRole('button', { name: /bravo.*vm-2/ }));
    expect(router.state.location.search).toMatchObject({
      q: 'bravo',
      instance: 'vm-2',
      campaign: 'handoff',
    });
    expect(router.state.location.hash).toBe('lifecycle');
    const copied = router.state.location.href;
    await act(async () => router.history.back());
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Instance details' })).not.toBeInTheDocument()
    );
    expect(filter).toHaveValue('bravo');
    await act(async () => router.history.back());
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'));
    await act(async () => router.history.forward());
    await waitFor(() => expect(screen.getByRole('searchbox')).toHaveValue('bravo'));
    expect(router.state.location.search.campaign).toBe('handoff');
    expect(router.state.location.hash).toBe('lifecycle');
    cleanup();
    await mount(copied);
    expect(screen.getByRole('searchbox')).toHaveValue('bravo');
    expect(await screen.findByRole('region', { name: 'Instance details' })).toHaveTextContent(
      'vm-2'
    );
  });

  it('keeps instance identity visible and moves secondary measurements into compact details', async () => {
    await mount();
    expect(await screen.findByRole('columnheader', { name: 'RAM' })).toHaveClass(
      'hidden',
      'md:table-cell'
    );
    expect(screen.getByRole('columnheader', { name: 'Instance' })).not.toHaveClass('hidden');
    expect(screen.getByText('More details for alpha (vm-1)')).toBeInTheDocument();
  });

  it('restores the full returned record and wake frames from a copied URL', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-11T10:10:30Z'));
    await mount('/dashboard/workers?instance=vm-1');
    const detail = await screen.findByRole('region', { name: 'Instance details' });
    const view = within(detail);
    for (const value of [
      'vm-1',
      'parked',
      'alpha',
      'app-1',
      'dep-1',
      'service',
      '10.0.1.2',
      '512 MB',
      '0',
      'oom',
      'wake-1',
      '5m 0s',
      '10m 30s',
    ])
      expect(await view.findByText(value, { exact: true })).toBeInTheDocument();
    for (const timestamp of [
      '2026-09-11T10:00:00Z',
      '2026-09-11T10:05:00Z',
      '2026-09-11T10:04:00Z',
    ])
      expect(detail.querySelector(`time[datetime="${timestamp}"]`)).toBeInTheDocument();
    expect(await view.findByText('vm.ready')).toBeInTheDocument();
    expect(view.getByText('+125 ms')).toBeInTheDocument();
    expect(view.queryByText(/CPU|network throughput/i)).not.toBeInTheDocument();
  });

  it.each(['pointer', 'keyboard'])(
    'selects with %s, preserves URL context, reveals detail and restores focus on Close/Back',
    async (input) => {
      rows = Array.from({ length: 50 }, (_, n) => ({ ...instance, id: `vm-${n + 1}` }));
      const reveal = vi.spyOn(Element.prototype, 'scrollIntoView');
      const router = await mount('/dashboard/workers?keep=yes#anchor');
      const row = await screen.findByRole('button', { name: /vm-1$/ });
      const select = async () => {
        if (input === 'pointer') await userEvent.click(row);
        else {
          row.focus();
          await userEvent.keyboard('{Enter}');
        }
      };
      await select();
      const detail = await screen.findByRole('region', { name: 'Instance details' });
      expect(detail).toHaveFocus();
      expect(reveal.mock.contexts).toContain(detail);
      expect(router.state.location.search).toMatchObject({ instance: 'vm-1', keep: 'yes' });
      expect(router.state.location.hash).toBe('anchor');
      await userEvent.click(within(detail).getByRole('button', { name: 'Close' }));
      await waitFor(() => expect(row).toHaveFocus());
      expect(router.state.location.search).toMatchObject({ keep: 'yes' });
      expect(router.state.location.search.instance).toBeUndefined();
      await select();
      await act(async () => router.history.back());
      await waitFor(() => expect(row).toHaveFocus());
      expect(screen.queryByRole('region', { name: 'Instance details' })).not.toBeInTheDocument();
      await act(async () => router.history.forward());
      expect(await screen.findByRole('region', { name: 'Instance details' })).toHaveFocus();
      const copied = router.state.location.href;
      cleanup();
      await mount(copied);
      expect(await screen.findByRole('region', { name: 'Instance details' })).toBeInTheDocument();
    }
  );

  it.each(['pointer', 'keyboard'])(
    'reveals the already selected row again with %s and retains Close/Back focus',
    async (input) => {
      const reveal = vi.spyOn(Element.prototype, 'scrollIntoView');
      const router = await mount('/dashboard/workers?keep=yes#anchor');
      const row = await screen.findByRole('button', { name: /vm-1$/ });
      const activate = async () => {
        row.focus();
        if (input === 'pointer') await userEvent.click(row);
        else await userEvent.keyboard('{Enter}');
      };
      for (const close of ['button', 'back']) {
        await activate();
        const detail = await screen.findByRole('region', { name: 'Instance details' });
        const selectedHref = router.state.location.href;
        reveal.mockClear();
        await activate();
        expect(detail).toHaveFocus();
        expect(reveal.mock.contexts).toContain(detail);
        expect(router.state.location.href).toBe(selectedHref);
        if (close === 'button')
          await userEvent.click(within(detail).getByRole('button', { name: 'Close' }));
        else await act(async () => router.history.back());
        await waitFor(() => expect(row).toHaveFocus());
        expect(screen.queryByRole('region', { name: 'Instance details' })).not.toBeInTheDocument();
      }
    }
  );

  it.each(['pending', 'error'] as const)(
    'shows independent app lookup recovery when it is %s and there is no wake ID',
    async (state) => {
      appState = state;
      rows = [{ ...instance, wake_id: undefined }];
      await mount('/dashboard/workers?instance=vm-1');
      const view = within(await screen.findByRole('region', { name: 'Instance details' }));
      expect(await view.findByText(/no wake ID was returned/i)).toBeInTheDocument();
      if (state === 'pending') expect(view.getByText(/resolving the app/i)).toBeInTheDocument();
      else {
        expect(await view.findByText('App lookup failed')).toBeInTheDocument();
        expect(view.queryByRole('link', { name: 'Open app' })).not.toBeInTheDocument();
        appState = 'ready';
        await userEvent.click(view.getByRole('button', { name: 'Retry app lookup' }));
        expect(await view.findByRole('link', { name: 'Open app' })).toHaveAttribute(
          'href',
          '/dashboard/workflows/alpha'
        );
        expect(view.getByRole('link', { name: 'App logs' })).toHaveAttribute(
          'href',
          '/dashboard/logs?app=alpha'
        );
        expect(view.queryByText('App lookup failed')).not.toBeInTheDocument();
      }
      expect(reads.filter((read) => read.includes('/wakes/'))).toEqual([]);
    }
  );

  it('offers only receiving route contracts for app, release, logs and debugger', async () => {
    await mount('/dashboard/workers?instance=vm-1');
    const view = within(await screen.findByRole('region', { name: 'Instance details' }));
    expect(await view.findByRole('link', { name: 'Open app' })).toHaveAttribute(
      'href',
      '/dashboard/workflows/alpha'
    );
    expect(view.getByRole('link', { name: 'Open release' })).toHaveAttribute(
      'href',
      '/dashboard/deployments?deployment=dep-1'
    );
    expect(view.getByRole('link', { name: 'App logs' })).toHaveAttribute(
      'href',
      '/dashboard/logs?app=alpha'
    );
    expect(view.getByRole('link', { name: 'App debugger' })).toHaveAttribute(
      'href',
      '/dashboard/workflows/alpha?tab=Debugger'
    );
    expect(view.queryByRole('link', { name: /request|wake/i })).not.toBeInTheDocument();
  });

  it.each(['missing', 'blank'])(
    'does not fetch nested resources for a %s selection',
    async (kind) => {
      await mount(`/dashboard/workers?instance=${kind === 'missing' ? 'unknown' : '%20%20'}`);
      await screen.findByText('vm-1');
      if (kind === 'missing') {
        expect(await screen.findByText(/not in the current instance list/i)).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Close' }));
        expect(screen.queryByRole('region', { name: 'Instance details' })).not.toBeInTheDocument();
      } else
        expect(screen.queryByRole('region', { name: 'Instance details' })).not.toBeInTheDocument();
      expect(reads.filter((read) => read.includes('/wakes/'))).toEqual([]);
    }
  );

  it('rejects non-string selection while preserving unrelated validated search', () => {
    const validate = Instances.options.validateSearch as (
      raw: Record<string, unknown>
    ) => Record<string, unknown>;
    expect(typeof validate).toBe('function');
    for (const instance of [[], {}, 42, true, '', '  ']) {
      expect(validate({ instance, keep: 'yes' })).toMatchObject({
        instance: undefined,
        keep: 'yes',
      });
    }
  });

  it('drops previous instance evidence when history selects an unknown ID', async () => {
    const router = await mount('/dashboard/workers?instance=vm-1');
    await screen.findByText('vm.ready');
    reads = [];
    await act(async () =>
      router.navigate({ to: '/dashboard/workers', search: { instance: 'unknown' } })
    );
    const view = within(await screen.findByRole('region', { name: 'Instance details' }));
    expect(view.getByText(/not in the current instance list/i)).toBeInTheDocument();
    expect(view.queryByText('vm.ready')).not.toBeInTheDocument();
    expect(view.queryAllByRole('link')).toHaveLength(0);
    expect(reads.filter((read) => read.includes('/wakes/'))).toEqual([]);
  });

  it('omits unavailable links and does not treat an app ID as a wake slug', async () => {
    apps = [];
    rows = [{ ...instance, deployment_id: '' }];
    await mount('/dashboard/workers?instance=vm-1');
    const view = within(await screen.findByRole('region', { name: 'Instance details' }));
    expect(await view.findByText(/app could not be resolved/i)).toBeInTheDocument();
    expect(view.queryAllByRole('link')).toHaveLength(0);
    expect(reads.filter((read) => read.includes('/wakes/'))).toEqual([]);
  });

  it('shows missing optional evidence without inventing durations or starting a wake read', async () => {
    rows = [{ id: 'vm-1', app_id: 'app-1', deployment_id: '', ram_mb: 256, state: 'waking' }];
    await mount('/dashboard/workers?instance=vm-1');
    const view = within(await screen.findByRole('region', { name: 'Instance details' }));
    expect(await view.findByText(/no wake ID was returned/i)).toBeInTheDocument();
    expect(view.getByText('Age since start').nextElementSibling).toHaveTextContent('Not reported');
    expect(view.getByText('Minimum instance target').nextElementSibling).toHaveTextContent(
      'Not reported'
    );
    expect(reads.filter((read) => read.includes('/wakes/'))).toEqual([]);
  });

  it.each(['pending', 'error'] as const)(
    'keeps a selected URL directional while the list is %s',
    async (state) => {
      instanceState = state;
      await mount('/dashboard/workers?instance=vm-1');
      const view = within(await screen.findByRole('region', { name: 'Instance details' }));
      if (state === 'pending') expect(view.getByText(/loading instances/i)).toBeInTheDocument();
      else {
        expect(await view.findByText('Instance read failed')).toBeInTheDocument();
        instanceState = 'ready';
        await userEvent.click(view.getByRole('button', { name: /retry/i }));
        expect(await view.findByText('10.0.1.2')).toBeInTheDocument();
      }
      expect(view.queryByText(/not in the current instance list/i)).not.toBeInTheDocument();
    }
  );

  it.each(['pending', 'error', 'empty'] as const)(
    'shows a directional %s wake timeline',
    async (state) => {
      wakeState = state;
      await mount('/dashboard/workers?instance=vm-1');
      const view = within(await screen.findByRole('region', { name: 'Instance details' }));
      if (state === 'pending')
        expect(await view.findByText('Reading the timeline…')).toBeInTheDocument();
      if (state === 'empty')
        expect(await view.findByText(/no frames recorded/i)).toBeInTheDocument();
      if (state === 'error') {
        expect(await view.findByText('Timeline read failed')).toBeInTheDocument();
        wakeState = 'ready';
        await userEvent.click(view.getByRole('button', { name: /retry timeline/i }));
        expect(await view.findByText('vm.ready')).toBeInTheDocument();
      }
    }
  );

  it('explains scaled-to-zero empty data and offers apps as the next step', async () => {
    rows = [];
    await mount();
    expect(await screen.findByText(/everything is parked/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View apps' })).toHaveAttribute(
      'href',
      '/dashboard/workflows'
    );
  });

  it('loads older live instances with the server cursor', async () => {
    paginationState = true;
    olderRows = [{ ...instance, id: 'vm-2', started_at: '2026-09-11T09:00:00Z' }];
    await mount();

    await userEvent.click(await screen.findByRole('button', { name: 'Load older instances' }));
    expect(await screen.findByRole('button', { name: /vm-2$/ })).toBeInTheDocument();
    expect(reads).toContain('/v1/instances:{}:{"limit":50,"before":"instances-cursor-1"}');
  });
});
