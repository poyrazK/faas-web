import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/ui/toast';
import { spyApi } from '@/test/api';

const confirm = vi.fn();
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));

const { JobRunReplay } = await import('./job-run-replay');

const ok = (data: unknown) => Promise.resolve({ data, response: new Response() });
const problem = (status: number, code: string, detail: string, extra = {}) =>
  Promise.resolve({
    error: { type: 'about:blank', title: code, status, code, detail, ...extra },
    response: new Response(null, { status }),
  });

const run = (over: Record<string, unknown> = {}) => ({
  id: 'run-1',
  aggregate_status: 'failed',
  trigger_kind: 'manual',
  tasks: 24,
  tasks_succeeded: 20,
  tasks_failed: 3,
  tasks_cancelled: 1,
  tasks_running: 0,
  dead_letter_count: 0,
  created_at: '2026-11-01T09:00:00Z',
  finished_at: '2026-11-01T09:30:00Z',
  ...over,
});

function mount(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

function serveRun(data: Record<string, unknown>) {
  return spyApi('GET').mockImplementation((path: string) =>
    path === '/v1/jobs/{name}/runs/{id}' ? ok(data) : ok(undefined)
  );
}

beforeEach(() => confirm.mockReset().mockResolvedValue(true));
afterEach(() => vi.restoreAllMocks());

describe('JobRunReplay', () => {
  it('offers no replay while the run is still going', async () => {
    const get = serveRun(run({ aggregate_status: 'running', finished_at: undefined }));
    mount(
      <JobRunReplay name="nightly-export" runId="run-1" jobStatus="active" onReplayed={vi.fn()} />
    );
    await waitFor(() => expect(get).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole('button', { name: /replay/i })).not.toBeInTheDocument();
  });

  it('offers no replay when every task succeeded', async () => {
    serveRun(run({ aggregate_status: 'succeeded', tasks_failed: 0, tasks_cancelled: 0 }));
    mount(
      <JobRunReplay name="nightly-export" runId="run-1" jobStatus="active" onReplayed={vi.fn()} />
    );
    await screen.findByText(/nothing to replay/i);
    expect(screen.queryByRole('button', { name: /replay/i })).not.toBeInTheDocument();
  });

  it('asks to resume a paused workload first, since apid answers a replay of it with 404', async () => {
    serveRun(run());
    mount(
      <JobRunReplay name="nightly-export" runId="run-1" jobStatus="paused" onReplayed={vi.fn()} />
    );
    expect(await screen.findByRole('button', { name: 'Replay failed tasks' })).toBeDisabled();
    expect(screen.getByText(/resume the workload/i)).toBeInTheDocument();
  });

  it('names how many tasks run again, then opens the linked run', async () => {
    serveRun(run());
    const post = spyApi('POST').mockImplementation(() =>
      ok(run({ id: 'run-2', aggregate_status: 'queued', tasks: 4, source_run_id: 'run-1' }))
    );
    const onReplayed = vi.fn();
    mount(
      <JobRunReplay
        name="nightly-export"
        runId="run-1"
        jobStatus="active"
        onReplayed={onReplayed}
      />
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Replay failed tasks' }));
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Replay 4 tasks of this run?',
        description: expect.stringMatching(/succeeded do not run again/),
      })
    );
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/v1/jobs/{name}/runs/{id}/replay-failed', {
        params: { path: { name: 'nightly-export', id: 'run-1' } },
        headers: { 'Idempotency-Key': expect.any(String) },
      })
    );
    await waitFor(() => expect(onReplayed).toHaveBeenCalledWith('run-2'));
  });

  it('shows where a replay came from and opens the source run', async () => {
    serveRun(run({ id: 'run-2', source_run_id: 'run-1' }));
    const onSelectRun = vi.fn();
    mount(
      <JobRunReplay
        name="nightly-export"
        runId="run-2"
        jobStatus="active"
        onReplayed={vi.fn()}
        onSelectRun={onSelectRun}
      />
    );
    await userEvent.click(await screen.findByRole('button', { name: 'run-1' }));
    expect(onSelectRun).toHaveBeenCalledWith('run-1');
  });

  it("says the plan's cap when the source run is larger than the plan now allows", async () => {
    serveRun(run());
    spyApi('POST').mockImplementation(() =>
      problem(403, 'job_quota_exceeded', 'Pro plan caps jobs at 1000 for tasks_per_run', {
        limit: 1000,
        observed: 2000,
      })
    );
    mount(
      <JobRunReplay name="nightly-export" runId="run-1" jobStatus="active" onReplayed={vi.fn()} />
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Replay failed tasks' }));
    expect(await screen.findByText(/beyond what your plan allows now/i)).toBeInTheDocument();
  });

  it('passes on why the server refused the replay', async () => {
    serveRun(run());
    spyApi('POST').mockImplementation(() =>
      problem(
        409,
        'validation_failed',
        'the source must be terminal with failed inputs and the same ready image digest'
      )
    );
    mount(
      <JobRunReplay name="nightly-export" runId="run-1" jobStatus="active" onReplayed={vi.fn()} />
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Replay failed tasks' }));
    expect(await screen.findByText(/same ready image digest/)).toBeInTheDocument();
  });
});
