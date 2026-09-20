import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route as Jobs } from './dashboard.jobs';
import { ApiError } from '@/lib/api/errors';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
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
  api.POST.mockReset().mockResolvedValue({
    data: { ...job, id: 'job-new', name: 'daily-backup' },
    response: new Response(),
  });
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

describe('Workload creation', () => {
  it('keeps creation behind the API plan gate', async () => {
    api.GET.mockRejectedValue(
      new ApiError({
        status: 402,
        code: 'jobs_not_allowed',
        title: 'Jobs require Hobby or above',
        detail: 'Jobs require Hobby or above',
      })
    );
    await mount('section=workloads');
    expect(await screen.findByText('Jobs require Hobby or above')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New workload' })).not.toBeInTheDocument();
  });
  async function openForm() {
    await mount('section=workloads');
    await userEvent.click(await screen.findByRole('button', { name: 'New workload' }));
    return screen.getByRole('dialog', { name: 'New workload' });
  }

  async function fillForm(dialog: HTMLElement) {
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'daily-backup');
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Container image' }),
      'ghcr.io/acme/backup:v1'
    );
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Executable' }), 'python');
  }

  it('creates a workload with exact command arguments and opens the returned definition', async () => {
    const dialog = await openForm();
    await fillForm(dialog);
    await userEvent.clear(within(dialog).getByRole('textbox', { name: 'Executable' }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Executable' }), '/bin/sh');
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Arguments' }), {
      target: { value: '-c\necho "backup complete"' },
    });
    // The next list response includes the newly created job.
    const previous = api.GET.getMockImplementation()!;
    api.GET.mockImplementation((path, options) =>
      path === '/v1/jobs'
        ? Promise.resolve({
            data: { jobs: [job, { ...job, id: 'job-new', name: 'daily-backup' }], next_offset: -1 },
            response: new Response(),
          })
        : previous(path, options)
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create workload' }));
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith('/v1/jobs', {
        body: {
          name: 'daily-backup',
          kind: 'batch',
          image_ref: 'ghcr.io/acme/backup:v1',
          command: ['/bin/sh', '-c', 'echo "backup complete"'],
        },
      })
    );
    expect(
      await screen.findByRole('heading', { name: 'Definition — daily-backup' })
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('validates the name before sending anything', async () => {
    const dialog = await openForm();
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'INVALID');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create workload' }));
    expect(within(dialog).getByRole('textbox', { name: 'Name' })).toHaveAttribute(
      'aria-invalid',
      'true'
    );
    expect(within(dialog).getByRole('textbox', { name: 'Name' })).toHaveFocus();
    expect(api.POST).not.toHaveBeenCalled();
  });

  it('keeps the draft and reports API failures, then allows retry using plan defaults', async () => {
    api.POST.mockRejectedValueOnce(new Error('This workload name is already in use.'));
    const dialog = await openForm();
    await fillForm(dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create workload' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This workload name is already in use.'
    );
    expect(within(dialog).getByRole('textbox', { name: 'Name' })).toHaveValue('daily-backup');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create workload' }));
    await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(2));
    expect(api.POST).toHaveBeenLastCalledWith('/v1/jobs', {
      body: {
        name: 'daily-backup',
        kind: 'batch',
        image_ref: 'ghcr.io/acme/backup:v1',
        command: ['python'],
      },
    });
  });

  it('prevents duplicate submissions while creation is pending', async () => {
    api.POST.mockImplementation(() => new Promise(() => {}));
    const dialog = await openForm();
    await fillForm(dialog);
    const submit = within(dialog).getByRole('button', { name: 'Create workload' });
    await userEvent.click(submit);
    expect(submit).toBeDisabled();
    expect(api.POST).toHaveBeenCalledTimes(1);
  });

  it('submits recurring workloads with custom resource limits', async () => {
    const dialog = await openForm();
    await fillForm(dialog);
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Kind' }),
      'recurring'
    );
    await userEvent.click(within(dialog).getByText('Resource limits', { exact: false }));
    for (const [label, value] of [
      ['Memory (MB)', '256'],
      ['Task timeout (seconds)', '60'],
      ['Parallel tasks', '2'],
      ['Maximum retries', '1'],
    ]) {
      await userEvent.type(within(dialog).getByRole('spinbutton', { name: label }), value);
    }
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create workload' }));
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith('/v1/jobs', {
        body: {
          name: 'daily-backup',
          kind: 'recurring',
          image_ref: 'ghcr.io/acme/backup:v1',
          command: ['python'],
          ram_mb: 256,
          task_timeout_sec: 60,
          max_parallelism: 2,
          retry_max: 1,
        },
      })
    );
  });

  it('rejects arguments without an executable and invalid resource values', async () => {
    const dialog = await openForm();
    await fillForm(dialog);
    await userEvent.clear(within(dialog).getByRole('textbox', { name: 'Executable' }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Arguments' }), '-m');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create workload' }));
    expect(within(dialog).getByRole('textbox', { name: 'Executable' })).toHaveFocus();
    await userEvent.clear(within(dialog).getByRole('textbox', { name: 'Arguments' }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Executable' }), 'python');
    await userEvent.click(within(dialog).getByText('Resource limits', { exact: false }));
    await userEvent.type(within(dialog).getByRole('spinbutton', { name: 'Parallel tasks' }), '-1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create workload' }));
    expect(within(dialog).getByRole('spinbutton', { name: 'Parallel tasks' })).toHaveAttribute(
      'aria-invalid',
      'true'
    );
    expect(api.POST).not.toHaveBeenCalled();
  });

  it('requires an executable because the job runtime cannot boot an empty command', async () => {
    const dialog = await openForm();
    await fillForm(dialog);
    await userEvent.clear(within(dialog).getByRole('textbox', { name: 'Executable' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create workload' }));
    expect(within(dialog).getByRole('textbox', { name: 'Executable' })).toHaveAttribute(
      'aria-invalid',
      'true'
    );
    expect(api.POST).not.toHaveBeenCalled();
  });
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
