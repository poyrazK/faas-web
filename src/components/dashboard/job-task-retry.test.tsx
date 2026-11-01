import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/ui/toast';
import { spyApi } from '@/test/api';
import type { JobTask } from '@/lib/api/job-detail';

const confirm = vi.fn();
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));

const { JobTaskRetry } = await import('./job-task-retry');

const ok = (data: unknown) => Promise.resolve({ data, response: new Response() });
const problem = (status: number, code: string, detail: string) =>
  Promise.resolve({
    error: { type: 'about:blank', title: code, status, code, detail },
    response: new Response(null, { status }),
  });

const task = (over: Record<string, unknown> = {}) =>
  ({
    run_id: 'run-1',
    task_index: 3,
    status: 'failed',
    attempt: 2,
    created_at: '2026-11-01T09:00:00Z',
    ...over,
  }) as JobTask;

function mount(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => confirm.mockReset().mockResolvedValue(true));
afterEach(() => vi.restoreAllMocks());

describe('JobTaskRetry', () => {
  it.each(['succeeded', 'queued', 'claimed'])('offers no retry for a %s task', (status) => {
    mount(<JobTaskRetry name="nightly-export" runId="run-1" task={task({ status })} />);
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });

  it.each(['failed', 'timeout', 'oom', 'cancelled'])('offers a retry for a %s task', (status) => {
    mount(<JobTaskRetry name="nightly-export" runId="run-1" task={task({ status })} />);
    expect(screen.getByRole('button', { name: 'Retry task 3' })).toBeInTheDocument();
  });

  it('names the task and its next attempt before re-queuing it, with an idempotency key', async () => {
    const post = spyApi('POST').mockImplementation(() =>
      ok({
        task: task({ status: 'queued', attempt: 3 }),
        run: {},
        retried_at: '2026-11-01T10:00:00Z',
        next_attempt_at: '2026-11-01T10:00:10Z',
      })
    );
    mount(<JobTaskRetry name="nightly-export" runId="run-1" task={task()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Retry task 3' }));
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Retry task 3 of this run?',
        description: expect.stringMatching(/attempt 3/),
      })
    );
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/v1/jobs/{name}/runs/{id}/tasks/{idx}/retry', {
        params: {
          path: { name: 'nightly-export', id: 'run-1', idx: 3 },
          header: { 'Idempotency-Key': expect.any(String) },
        },
      })
    );
    expect(await screen.findByText('Task 3 queued')).toBeInTheDocument();
  });

  it('does nothing when the confirm is dismissed', async () => {
    confirm.mockResolvedValue(false);
    const post = spyApi('POST');
    mount(<JobTaskRetry name="nightly-export" runId="run-1" task={task()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Retry task 3' }));
    expect(post).not.toHaveBeenCalled();
  });

  it('points at replay when the retry budget is spent', async () => {
    spyApi('POST').mockImplementation(() =>
      problem(409, 'job_task_max_retries_reached', 'task 3 in run run-1 has used 6 attempts')
    );
    mount(<JobTaskRetry name="nightly-export" runId="run-1" task={task()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Retry task 3' }));
    expect(await screen.findByText('Retry budget used up')).toBeInTheDocument();
    expect(screen.getByText(/replay failed tasks/i)).toBeInTheDocument();
  });

  it('explains a task that moved on before the retry landed', async () => {
    spyApi('POST').mockImplementation(() =>
      problem(409, 'job_task_not_retriable', 'task 3 in run run-1 is in status queued')
    );
    mount(<JobTaskRetry name="nightly-export" runId="run-1" task={task()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Retry task 3' }));
    expect(await screen.findByText('Task already moved on')).toBeInTheDocument();
  });

  it('reuses the key after a network failure so a second click cannot queue twice', async () => {
    const post = spyApi('POST')
      .mockImplementationOnce(() => Promise.reject(new TypeError('Failed to fetch')))
      .mockImplementation(() =>
        ok({ task: task({ attempt: 3 }), run: {}, retried_at: '', next_attempt_at: '' })
      );
    mount(<JobTaskRetry name="nightly-export" runId="run-1" task={task()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Retry task 3' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole('button', { name: 'Retry task 3' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    const key = (call: unknown[]) =>
      (call[1] as { params: { header: Record<string, string> } }).params.header['Idempotency-Key'];
    expect(key(post.mock.calls[1]!)).toBe(key(post.mock.calls[0]!));
  });
});
