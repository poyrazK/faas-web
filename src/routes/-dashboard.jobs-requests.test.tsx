import { act, render, screen } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route as Jobs } from './dashboard.jobs';

const api = vi.hoisted(() => ({ GET: vi.fn() }));
vi.mock('@/lib/api/client', async (original) => ({ ...(await original<object>()), api }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => vi.fn() }));
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
beforeEach(() => {
  api.GET.mockReset().mockImplementation(
    async (path: string, options: { params?: { query?: { before?: string } } }) => {
      const data: Record<string, unknown> = {
        '/v1/jobs': { jobs: [job], next_offset: -1 },
        '/v1/jobs/{name}': job,
        '/v1/jobs/{name}/runs': { runs: [run], next_offset: -1 },
        '/v1/jobs/{name}/runs/{id}': run,
        '/v1/jobs/{name}/runs/{id}/tasks': {
          tasks: [{ run_id: 'run-1', task_index: 0, status: 'succeeded', attempt: 1 }],
          next_offset: -1,
        },
        '/v1/jobs/{name}/runs/{id}/tasks/{idx}/logs': {
          log_content: 'export complete',
          truncated: false,
          max_bytes: 65536,
        },
        '/v1/apps': [{ id: 'app-1', slug: 'api' }],
        '/v1/crons': [
          {
            id: 'schedule-1',
            app_id: 'app-1',
            schedule: '*/15 * * * *',
            path: '/refresh',
            enabled: true,
          },
        ],
        '/v1/crons/{id}/runs': {
          runs: options.params?.query?.before ? [] : [{ id: 'execution-1', outcome: 'success' }],
        },
      };
      if (!(path in data)) throw new Error(`Unexpected request: ${path}`);
      return { data: data[path], response: new Response() };
    }
  );
});

async function mount(search: string) {
  const root = createRootRoute({ component: Outlet });
  const dashboard = createRoute({
    getParentRoute: () => root,
    path: 'dashboard',
    component: Outlet,
  });
  const jobs = createRoute({
    getParentRoute: () => dashboard,
    path: 'jobs',
    component: Jobs.options.component,
    validateSearch: Jobs.options.validateSearch,
  });
  const router = createRouter({
    routeTree: root.addChildren([dashboard.addChildren([jobs])]),
    history: createMemoryHistory({ initialEntries: [`/dashboard/jobs?${search}`] }),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await router.load();
  await act(async () => {
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    );
  });
}

describe('Jobs validates nested selections before requesting details', () => {
  it.each([
    [
      'job=missing&run=run-1&task=0',
      'Workload not found',
      [
        '/v1/jobs/{name}',
        '/v1/jobs/{name}/runs',
        '/v1/jobs/{name}/runs/{id}',
        '/v1/jobs/{name}/runs/{id}/tasks',
        '/v1/jobs/{name}/runs/{id}/tasks/{idx}/logs',
      ],
    ],
    [
      'job=job-1&run=missing&task=0',
      'Run not found',
      [
        '/v1/jobs/{name}/runs/{id}',
        '/v1/jobs/{name}/runs/{id}/tasks',
        '/v1/jobs/{name}/runs/{id}/tasks/{idx}/logs',
      ],
    ],
    [
      'job=job-1&run=run-1&task=9',
      'Task not found',
      ['/v1/jobs/{name}/runs/{id}/tasks/{idx}/logs'],
    ],
    [
      'section=scheduled&schedule=missing&execution=execution-1',
      'Scheduled request not found',
      ['/v1/crons/{id}/runs'],
    ],
    ['section=scheduled&schedule=schedule-1&execution=missing', 'Execution not found', []],
  ] as const)('withholds invalid requests for %s', async (search, message, forbidden) => {
    await mount(search);
    expect(await screen.findByText(message)).toBeInTheDocument();
    for (const path of forbidden) expect(api.GET).not.toHaveBeenCalledWith(path, expect.anything());
    for (const [, options] of api.GET.mock.calls) {
      const path = options.params?.path;
      expect(Object.values(path ?? {})).not.toContain('missing');
      expect(path?.idx).not.toBe(9);
    }
    expect(screen.queryByText('export complete')).not.toBeInTheDocument();
  });

  it('requests logs with the validated job name, run ID and task index', async () => {
    await mount('job=job-1&run=run-1&task=0');
    expect(await screen.findByText('export complete')).toBeInTheDocument();
    expect(api.GET).toHaveBeenCalledWith('/v1/jobs/{name}/runs/{id}/tasks/{idx}/logs', {
      params: { path: { name: 'nightly-export', id: 'run-1', idx: 0 } },
    });
  });
});
