import { beforeEach, expect, it, vi } from 'vitest';
import {
  cancelQueuedRuns,
  cancelWorkflowRun,
  completeWorkflowCallback,
  previewQueuedCancel,
  resumeWorkflowRun,
  retryWorkflowStep,
  sendWorkflowEvent,
  startWorkflowRun,
} from './workflows';

const calls = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('./client', () => ({
  api: { POST: calls.post },
  unwrap: async (value: unknown) => value,
}));
beforeEach(() => vi.clearAllMocks());

it('resumes at the inspected resume_count under the caller key', async () => {
  await resumeWorkflowRun('run-1', 2, 'resume-key');
  expect(calls.post).toHaveBeenCalledWith('/v1/workflows/runs/{id}/resume', {
    params: { path: { id: 'run-1' } },
    headers: { 'Idempotency-Key': 'resume-key' },
    body: { expected_resume_count: 2 },
  });
});

it('retries one named step and cancels a run with no body', async () => {
  await retryWorkflowStep('run-1', 'push', 'retry-key');
  expect(calls.post).toHaveBeenCalledWith('/v1/workflows/runs/{id}/steps/{step}/retry', {
    params: { path: { id: 'run-1', step: 'push' } },
    headers: { 'Idempotency-Key': 'retry-key' },
  });
  await cancelWorkflowRun('run-1');
  expect(calls.post).toHaveBeenLastCalledWith('/v1/workflows/runs/{id}/cancel', {
    params: { path: { id: 'run-1' } },
  });
});

it('sends an event under one key so a resend after a lost response is recorded once', async () => {
  for (let i = 0; i < 2; i++)
    await sendWorkflowEvent('run-1', 'approved', { ok: true }, 'event-key');
  expect(calls.post).toHaveBeenNthCalledWith(1, '/v1/workflows/runs/{id}/events', {
    params: { path: { id: 'run-1' } },
    headers: { 'Idempotency-Key': 'event-key' },
    body: { event_name: 'approved', payload: { ok: true } },
  });
  expect(calls.post.mock.calls[1]).toEqual(calls.post.mock.calls[0]);
  await sendWorkflowEvent('run-1', 'approved', undefined, 'other');
  expect(calls.post.mock.lastCall?.[1]).toMatchObject({ body: { event_name: 'approved' } });
  expect(calls.post.mock.lastCall?.[1].body).not.toHaveProperty('payload');
});

it('completes a callback with its JSON result, or with no body at all', async () => {
  await completeWorkflowCallback('run-1', 'cb-1', { approved: true });
  expect(calls.post).toHaveBeenLastCalledWith('/v1/workflows/runs/{id}/callbacks/{callback_id}', {
    params: { path: { id: 'run-1', callback_id: 'cb-1' } },
    body: { approved: true },
  });
  await completeWorkflowCallback('run-1', 'cb-1', undefined);
  expect(calls.post.mock.lastCall?.[1]).not.toHaveProperty('body');
});

it('starts a declared workflow with the form key as its idempotency key', async () => {
  await startWorkflowRun('billing', 'invoice-sync', { id: 1 }, 'start-key');
  expect(calls.post).toHaveBeenCalledWith('/v1/apps/{slug}/workflows/{name}/runs', {
    params: {
      path: { slug: 'billing', name: 'invoice-sync' },
      header: { 'Idempotency-Key': 'start-key' },
    },
    body: { id: 1 },
  });
});

it('previews then cancels the same queued selection', async () => {
  await previewQueuedCancel('billing', ['a', 'b']);
  await cancelQueuedRuns('billing', ['a']);
  expect(calls.post).toHaveBeenNthCalledWith(1, '/v1/apps/{slug}/workflows/runs:cancel-preview', {
    params: { path: { slug: 'billing' } },
    body: { run_ids: ['a', 'b'] },
  });
  expect(calls.post).toHaveBeenNthCalledWith(2, '/v1/apps/{slug}/workflows/runs:cancel-queued', {
    params: { path: { slug: 'billing' } },
    body: { run_ids: ['a'] },
  });
});
