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
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route as Jobs } from './dashboard.jobs';
import { Route as Crons } from './dashboard.crons';
import { Route as Triggers } from './dashboard.triggers';
const lists = vi.hoisted(() => ({
  empty: false,
  appsRead: 'ready',
  historyError: false,
  jobsError: false,
  jobsHasNext: false,
  jobsNextError: false,
  retryApps: vi.fn(),
  retryHistory: vi.fn(),
  retryJobs: vi.fn(),
  fetchNextJobs: vi.fn(),
}));
beforeEach(() => {
  lists.empty = false;
  lists.appsRead = 'ready';
  lists.historyError = false;
  lists.jobsError = false;
  lists.jobsHasNext = false;
  lists.jobsNextError = false;
  lists.retryApps.mockReset();
  lists.retryHistory.mockReset();
  lists.retryJobs.mockReset();
  lists.fetchNextJobs.mockReset().mockResolvedValue(undefined);
});

vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/lib/api/queries', () => {
  const ok = (data: unknown) => ({ data, isPending: false, error: null, refetch: vi.fn() });
  const mutation = () => ({ mutateAsync: vi.fn(), isPending: false });
  const job = {
    id: 'job-1',
    name: 'nightly-export',
    kind: 'batch',
    status: 'active',
    image_ref: 'registry/export:v1',
    command: ['export'],
    ram_mb: 512,
    max_parallelism: 2,
    retry_max: 1,
    task_timeout_sec: 60,
    updated_at: '2026-09-11T00:00:00Z',
  };
  const run = {
    id: 'run-1',
    aggregate_status: 'succeeded',
    trigger_kind: 'manual',
    tasks: 1,
    tasks_succeeded: 1,
    tasks_failed: 0,
    tasks_running: 0,
    tasks_cancelled: 0,
    dead_letter_count: 0,
  };
  const trigger = {
    id: 'trigger-1',
    kind: 'kafka',
    slug: 'orders',
    app_id: 'app-1',
    enabled: true,
    batch_size_max: 10,
    batch_window_ms: 100,
    max_attempts: 3,
    config: { topic: 'orders' },
  };
  return {
    useJobs: () => ok({ jobs: lists.empty ? [] : [job] }),
    useInfiniteJobs: () => ({
      data: { pages: [{ jobs: lists.empty ? [] : [job] }] },
      isPending: false,
      error: lists.jobsError ? new Error('Workloads offline') : null,
      refetch: lists.retryJobs,
      hasNextPage: lists.jobsHasNext,
      isFetchingNextPage: false,
      isFetchNextPageError: lists.jobsNextError,
      fetchNextPage: lists.fetchNextJobs,
    }),
    useJob: () => ok(job),
    useJobRuns: () => ok({ runs: [run] }),
    useJobRun: () => ok(run),
    useCancelJobRun: mutation,
    useJobTasks: () =>
      ok({ tasks: [{ run_id: 'run-1', task_index: 0, status: 'succeeded', attempt: 1 }] }),
    useJobTaskLog: () => ok({ log_content: 'export complete', truncated: false, max_bytes: 65536 }),
    useApps: () => ({
      ...ok(
        lists.appsRead === 'ready'
          ? [{ id: 'app-1', slug: 'api' }]
          : lists.appsRead === 'empty'
            ? []
            : undefined
      ),
      isPending: lists.appsRead === 'pending',
      error: lists.appsRead === 'error' ? new Error('App lookup offline') : null,
      refetch: lists.retryApps,
    }),
    useCrons: () =>
      ok(
        lists.empty
          ? []
          : [
              {
                id: 'schedule-1',
                app_id: 'app-1',
                schedule: '*/15 * * * *',
                path: '/refresh',
                enabled: true,
              },
            ]
      ),
    useCronRuns: () => ({
      ...ok({
        runs: [
          {
            id: 'execution-1',
            outcome: 'success',
            started_at: '2026-09-11T00:00:00Z',
            duration_ms: 200,
            attempts: 1,
          },
        ],
      }),
      error: lists.historyError ? new Error('Run history offline') : null,
      refetch: lists.retryHistory,
    }),
    useCreateCron: mutation,
    useRunCron: mutation,
    useDeleteCron: mutation,
    useUpdateCron: mutation,
    useFireNowRequest: () => ok(undefined),
    useTriggers: () => ok(lists.empty ? [] : [trigger]),
    useTrigger: () => ok(trigger),
    useSetTriggerEnabled: mutation,
    useTriggerMetrics: () =>
      ok({
        pending_count: 0,
        claimed_count: 0,
        succeeded_count: 1,
        retry_count: 0,
        dead_letter_count: 0,
      }),
    useTriggerRecords: () => ok({ records: [] }),
    useTriggerDeadLetter: () => ok({ records: [] }),
  };
});

async function mount(entry = '/dashboard/jobs') {
  const root = createRootRoute({ component: Outlet });
  const dashboard = createRoute({
    getParentRoute: () => root,
    path: 'dashboard',
    component: Outlet,
  });
  const routes = [Jobs, Crons, Triggers].map((route, index) =>
    createRoute({
      getParentRoute: () => dashboard,
      path: ['jobs', 'crons', 'triggers'][index],
      component: route.options.component,
      validateSearch: route.options.validateSearch,
      beforeLoad: (context) => route.options.beforeLoad?.(context as never),
    })
  );
  const router = createRouter({
    routeTree: root.addChildren([dashboard.addChildren(routes)]),
    history: createMemoryHistory({ initialEntries: [entry] }),
  });
  await router.load();
  await act(async () => {
    render(<RouterProvider router={router} />);
  });
  return router;
}

describe('Jobs hub', () => {
  it.each(['pending', 'error'])(
    'does not mistake an %s app lookup for an empty app list',
    async (state) => {
      lists.empty = true;
      lists.appsRead = state;
      await mount('/dashboard/jobs?section=scheduled');
      expect(
        screen.getByText(state === 'pending' ? 'Loading apps…' : 'App lookup offline')
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add cron' })).toBeDisabled();
      expect(screen.queryByRole('link', { name: 'Create an app' })).not.toBeInTheDocument();
      if (state === 'error') {
        await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(lists.retryApps).toHaveBeenCalledOnce();
      }
    }
  );

  it('offers app creation only after an empty app lookup succeeds', async () => {
    lists.empty = true;
    lists.appsRead = 'empty';
    await mount('/dashboard/jobs?section=scheduled');
    expect(screen.getByRole('link', { name: 'Create an app' })).toHaveAttribute(
      'href',
      '/dashboard/workflows/new'
    );
  });

  it('keeps the run-history error and offers a retry', async () => {
    lists.historyError = true;
    await mount('/dashboard/jobs?section=scheduled&schedule=schedule-1');
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Run history offline');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Try again' }));
    expect(lists.retryHistory).toHaveBeenCalledOnce();
  });

  it.each(['workloads', 'triggers'])(
    'offers the CLI guide from the empty %s list',
    async (section) => {
      lists.empty = true;
      await mount(`/dashboard/jobs?section=${section}`);
      expect(screen.getByRole('link', { name: 'Read the CLI guide' })).toHaveAttribute(
        'href',
        '/docs/cli'
      );
    }
  );

  it('focuses schedule creation from an empty list', async () => {
    lists.empty = true;
    await mount('/dashboard/jobs?section=scheduled');
    await userEvent.click(
      screen.getByRole('button', { name: 'Create your first scheduled request' })
    );
    expect(screen.getByRole('textbox', { name: 'Schedule' })).toHaveFocus();
  });

  it('uses compact workload columns and discoverable schedule actions', async () => {
    await mount();
    expect(screen.getByRole('columnheader', { name: 'Image' })).toHaveClass(
      'hidden',
      'md:table-cell'
    );
    await userEvent.click(screen.getByRole('link', { name: 'Scheduled requests' }));
    expect(screen.getByRole('columnheader', { name: 'Last fired' })).toHaveClass(
      'hidden',
      'md:table-cell'
    );
    await userEvent.hover(screen.getByRole('button', { name: 'Run history for */15 * * * *' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Run history for */15 * * * *');
  });

  it('loads older workloads on demand', async () => {
    lists.jobsHasNext = true;
    await mount();

    await userEvent.click(await screen.findByRole('button', { name: 'Load older jobs' }));
    expect(lists.fetchNextJobs).toHaveBeenCalledOnce();
  });

  it('keeps loaded workloads visible when an older page fails and offers retry', async () => {
    lists.jobsError = true;
    lists.jobsNextError = true;
    await mount();

    expect(await screen.findByRole('button', { name: 'nightly-export' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Workloads offline');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(lists.fetchNextJobs).toHaveBeenCalledOnce();
  });

  it('composes model-specific sections with accessible navigation', async () => {
    const router = await mount('/dashboard/jobs?campaign=handoff#details');
    const navigation = screen.getByRole('navigation', { name: 'Jobs sections' });
    expect(within(navigation).getByRole('link', { name: 'Workloads' })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(screen.getByText(/CLI-defined container/)).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Image' })).toBeInTheDocument();
    await userEvent.click(within(navigation).getByRole('link', { name: 'Scheduled requests' }));
    expect(await screen.findByText(/HTTP requests on a Cron schedule/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Path' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Image' })).not.toBeInTheDocument();
    expect(router.state.location.search).toMatchObject({
      section: 'scheduled',
      campaign: 'handoff',
    });
    expect(router.state.location.hash).toBe('details');
    await userEvent.click(within(navigation).getByRole('link', { name: 'Triggers' }));
    expect(await screen.findByRole('button', { name: 'orders' })).toBeInTheDocument();
  });

  it.each([
    [
      '/dashboard/crons?schedule=schedule-1&execution=execution-1&campaign=handoff#history',
      'scheduled',
    ],
    ['/dashboard/triggers?trigger=trigger-1&campaign=handoff#config', 'triggers'],
  ])(
    'redirects the old bookmark %s without losing detail, search or hash',
    async (entry, section) => {
      const router = await mount(entry);
      expect(router.state.location.pathname).toBe('/dashboard/jobs');
      expect(router.state.location.search).toMatchObject({ section, campaign: 'handoff' });
      expect(router.state.location.hash).toBe(entry.split('#')[1]);
      if (section === 'scheduled')
        expect(
          await screen.findByRole('heading', { name: 'Execution execution-1' })
        ).toBeInTheDocument();
      else expect(await screen.findByText('Configuration')).toBeInTheDocument();
    }
  );

  it('restores workload, run and task from a copied URL, refresh, Back and Forward', async () => {
    const router = await mount('/dashboard/jobs?campaign=handoff');
    await userEvent.click(screen.getByRole('button', { name: 'nightly-export' }));
    await userEvent.click(await screen.findByRole('button', { name: 'run-1' }));
    await userEvent.click(await screen.findByRole('button', { name: 'task 0' }));
    expect(router.state.location.search).toMatchObject({
      job: 'job-1',
      run: 'run-1',
      task: 0,
      campaign: 'handoff',
    });
    const copied = router.state.location.href;
    expect(screen.getByText('export complete')).toBeInTheDocument();
    await act(async () => router.history.back());
    await waitFor(() => expect(screen.queryByText('export complete')).not.toBeInTheDocument());
    await act(async () => router.history.forward());
    expect(await screen.findByText('export complete')).toBeInTheDocument();
    cleanup();
    await mount(copied);
    expect(await screen.findByText('export complete')).toBeInTheDocument();
  });

  it('records schedule and execution selection in history and closes through Back', async () => {
    const router = await mount('/dashboard/jobs?section=scheduled');
    await userEvent.click(screen.getByRole('button', { name: 'Run history for */15 * * * *' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Execution execution-1' }));
    expect(router.state.location.search).toMatchObject({
      schedule: 'schedule-1',
      execution: 'execution-1',
    });
    expect(screen.getByRole('heading', { name: 'Execution execution-1' })).toBeInTheDocument();
    await act(async () => router.history.back());
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: 'Execution execution-1' })
      ).not.toBeInTheDocument()
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('restores section and trigger selection through history', async () => {
    const router = await mount('/dashboard/jobs');
    await userEvent.click(screen.getByRole('link', { name: 'Triggers' }));
    await userEvent.click(await screen.findByRole('button', { name: 'orders' }));
    expect(router.state.location.search).toMatchObject({
      section: 'triggers',
      trigger: 'trigger-1',
    });
    expect(screen.getByText('Configuration')).toBeInTheDocument();
    await act(async () => router.history.back());
    await waitFor(() => expect(screen.queryByText('Configuration')).not.toBeInTheDocument());
    await act(async () => router.history.back());
    expect(await screen.findByRole('button', { name: 'nightly-export' })).toBeInTheDocument();
    await act(async () => router.history.forward());
    expect(await screen.findByRole('button', { name: 'orders' })).toBeInTheDocument();
  });

  it.each([
    ['job=missing&run=run-1&task=0', 'Workload not found'],
    ['job=job-1&run=missing&task=0', 'Run not found'],
    ['job=job-1&run=run-1&task=9', 'Task not found'],
    ['section=scheduled&schedule=missing', 'Scheduled request not found'],
    ['section=scheduled&schedule=schedule-1&execution=missing', 'Execution not found'],
    ['section=triggers&trigger=missing', 'Trigger not found'],
  ])('falls back safely for unknown IDs: %s', async (search, message) => {
    const router = await mount(`/dashboard/jobs?${search}&campaign=handoff`);
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByText('export complete')).not.toBeInTheDocument();
    expect(router.state.location.search.campaign).toBe('handoff');
  });

  it('validates malformed section and detail parameters without losing unrelated search', async () => {
    const router = await mount(
      '/dashboard/jobs?section=bogus&job=123&run=false&task=-1&campaign=handoff'
    );
    expect(screen.getByRole('link', { name: 'Workloads' })).toHaveAttribute('aria-current', 'page');
    expect(router.state.matches.at(-1)?.search).toMatchObject({ campaign: 'handoff' });
    expect(router.state.matches.at(-1)?.search).toMatchObject({
      task: undefined,
      job: undefined,
      run: undefined,
    });
  });
});
