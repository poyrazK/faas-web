import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import type { components } from './schema';

/**
 * Durable workflow runs (faas capability `workflows`, beta): the declarative
 * YAML workflows in `gregale.yaml` and the code-first SDK workflows share one
 * engine, so their runs, steps and controls are the same routes
 * (faas docs/code-workflows.md, ADR-20261021204307).
 *
 * Every control is the backend's own decision: the console offers resume and
 * step retry only where `/diagnostics` says the planner would accept them, and
 * each write rechecks state and quota anyway.
 */

type S = components['schemas'];
export type WorkflowRun = S['WorkflowRunResponse'];
export type WorkflowRunStatus = WorkflowRun['status'];
export type WorkflowStep = S['WorkflowStepResponse'];
export type WorkflowStepAttempt = S['WorkflowStepAttemptResponse'];
export type WorkflowDiagnostics = S['WorkflowRunDiagnosticsResponse'];
export type WorkflowDiagnosticStep = S['WorkflowDiagnosticStep'];
export type WorkflowCallback = S['WorkflowCallbackResponse'];
export type WorkflowResume = S['WorkflowResumeResponse'];
export type QueuedCancelOutcome = S['WorkflowQueuedRunCancelOutcome'];

export const WORKFLOW_RUN_STATUSES: readonly WorkflowRunStatus[] = [
  'pending',
  'running',
  'awaiting_event',
  'succeeded',
  'failed',
  'dead',
];

/** Runs that can still change on their own; terminal ones stop polling. */
export function isActiveRun(status: WorkflowRunStatus | undefined): boolean {
  return status === 'pending' || status === 'running' || status === 'awaiting_event';
}

/** Page size of the run list (the API allows 1–100, default 50). */
export const RUNS_PAGE = 25;
/** The bulk queued-cancel routes take at most 20 runs (WorkflowQueuedRunCancelRequest). */
export const QUEUED_CANCEL_MAX = 20;

const root = ['workflows'] as const;
const appKey = (slug: string) => [...root, 'app', slug] as const;
const runKey = (id: string) => [...root, 'run', id] as const;

export interface RunFilters {
  status?: WorkflowRunStatus;
  workflowName?: string;
  /** Inclusive RFC3339 bounds on `created_at`. */
  createdAfter?: string;
  createdBefore?: string;
  offset: number;
}

export function useWorkflowRuns(slug: string, filters: RunFilters) {
  return useQuery({
    queryKey: [...appKey(slug), 'runs', filters],
    queryFn: async ({ signal }) => {
      const data = await unwrap(
        api.GET('/v1/apps/{slug}/workflows/runs', {
          params: {
            path: { slug },
            query: {
              limit: RUNS_PAGE,
              offset: filters.offset,
              ...(filters.status ? { status: filters.status } : {}),
              ...(filters.workflowName ? { workflow_name: filters.workflowName } : {}),
              ...(filters.createdAfter ? { created_after: filters.createdAfter } : {}),
              ...(filters.createdBefore ? { created_before: filters.createdBefore } : {}),
            },
          },
          signal,
        })
      );
      // The list needs metadata only; input and output stay on the detail read.
      return { ...data, runs: data.runs.map(({ input: _i, output: _o, ...run }) => run) };
    },
    enabled: Boolean(slug),
    placeholderData: (previous) => previous,
    refetchInterval: (query) => (query.state.error ? false : 10_000),
  });
}

/** Polls every 5 s while the run can still move, and stops once it is terminal. */
function runPoll(active: boolean) {
  return (query: { state: { error: unknown } }) =>
    query.state.error || !active ? (false as const) : 5_000;
}

export function useWorkflowRun(id: string) {
  return useQuery({
    queryKey: runKey(id),
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/workflows/runs/{id}', { params: { path: { id } }, signal })),
    enabled: Boolean(id),
    refetchInterval: (query) =>
      query.state.error || !isActiveRun(query.state.data?.status) ? false : 5_000,
  });
}

export function useWorkflowSteps(id: string, active: boolean) {
  return useQuery({
    queryKey: [...runKey(id), 'steps'],
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/workflows/runs/{id}/steps', { params: { path: { id } }, signal })),
    enabled: Boolean(id),
    refetchInterval: runPoll(active),
  });
}

export function useWorkflowStepAttempts(id: string, step: string, enabled: boolean) {
  return useQuery({
    queryKey: [...runKey(id), 'attempts', step],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/workflows/runs/{id}/steps/{step}/attempts', {
          params: { path: { id, step } },
          signal,
        })
      ),
    enabled: Boolean(id && step && enabled),
  });
}

/**
 * The read-only snapshot faas computes with the same planner POST resume uses
 * (handlers_workflow_diagnostics.go): why the run is where it is, each step's
 * kind and manual-retry eligibility, and the resume preview with its blockers.
 * `no-store` upstream, so it is never cached long here either.
 */
export function useWorkflowDiagnostics(id: string, active: boolean) {
  return useQuery({
    queryKey: [...runKey(id), 'diagnostics'],
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/workflows/runs/{id}/diagnostics', { params: { path: { id } }, signal })),
    enabled: Boolean(id),
    refetchInterval: runPoll(active),
    gcTime: 0,
  });
}

export function useWorkflowResumes(id: string) {
  return useQuery({
    queryKey: [...runKey(id), 'resumes'],
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/workflows/runs/{id}/resumes', { params: { path: { id } }, signal })),
    enabled: Boolean(id),
  });
}

export function useWorkflowCallbacks(id: string, active: boolean) {
  return useQuery({
    queryKey: [...runKey(id), 'callbacks'],
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/workflows/runs/{id}/callbacks', { params: { path: { id } }, signal })),
    enabled: Boolean(id),
    refetchInterval: runPoll(active),
  });
}

/* --- Writes ---------------------------------------------------------------- */

export function cancelWorkflowRun(id: string) {
  return unwrap(api.POST('/v1/workflows/runs/{id}/cancel', { params: { path: { id } } }));
}

/**
 * Resume sends the `resume_count` it inspected, so a run another session
 * resumed in the meantime answers `workflow_resume_conflict` instead of being
 * resumed twice; the key lets a retried request replay the first answer.
 */
export function resumeWorkflowRun(id: string, expectedResumeCount: number, key: string) {
  return unwrap(
    api.POST('/v1/workflows/runs/{id}/resume', {
      params: { path: { id } },
      headers: { 'Idempotency-Key': key },
      body: { expected_resume_count: expectedResumeCount },
    })
  );
}

export function retryWorkflowStep(id: string, step: string, key: string) {
  return unwrap(
    api.POST('/v1/workflows/runs/{id}/steps/{step}/retry', {
      params: { path: { id, step } },
      headers: { 'Idempotency-Key': key },
    })
  );
}

/**
 * apid derives the stored event's id from the Idempotency-Key
 * (handlers_workflows.go injectWorkflowEventForRun), so resending one form's
 * event after a lost response records it once.
 */
export function sendWorkflowEvent(id: string, eventName: string, payload: unknown, key: string) {
  return unwrap(
    api.POST('/v1/workflows/runs/{id}/events', {
      params: { path: { id } },
      headers: { 'Idempotency-Key': key },
      body: payload === undefined ? { event_name: eventName } : { event_name: eventName, payload },
    })
  );
}

/** An identical retry answers `duplicate: true`; a different payload conflicts. */
export function completeWorkflowCallback(id: string, callbackId: string, payload: unknown) {
  return unwrap(
    api.POST('/v1/workflows/runs/{id}/callbacks/{callback_id}', {
      params: { path: { id, callback_id: callbackId } },
      ...(payload === undefined ? {} : { body: payload }),
    })
  );
}

/** The key is the form's: the same input and key return the first run (201). */
export function startWorkflowRun(slug: string, name: string, input: unknown, key: string) {
  return unwrap(
    api.POST('/v1/apps/{slug}/workflows/{name}/runs', {
      params: { path: { slug, name }, header: { 'Idempotency-Key': key } },
      body: input,
    })
  );
}

export function previewQueuedCancel(slug: string, runIds: string[]) {
  return unwrap(
    api.POST('/v1/apps/{slug}/workflows/runs:cancel-preview', {
      params: { path: { slug } },
      body: { run_ids: runIds },
    })
  );
}

export function cancelQueuedRuns(slug: string, runIds: string[]) {
  return unwrap(
    api.POST('/v1/apps/{slug}/workflows/runs:cancel-queued', {
      params: { path: { slug } },
      body: { run_ids: runIds },
    })
  );
}

/** Invalidates the run and every list of its app once a write settles. */
function useSettle(slug: string) {
  const qc = useQueryClient();
  return (id?: string) =>
    Promise.all([
      qc.invalidateQueries({ queryKey: appKey(slug) }),
      id ? qc.invalidateQueries({ queryKey: runKey(id) }) : undefined,
    ]);
}

export function useCancelWorkflowRun(slug: string) {
  const settle = useSettle(slug);
  return useMutation({
    mutationFn: (id: string) => cancelWorkflowRun(id),
    retry: false,
    onSettled: (_d, _e, id) => settle(id),
  });
}

export function useResumeWorkflowRun(slug: string) {
  const settle = useSettle(slug);
  return useMutation({
    mutationFn: (input: { id: string; expectedResumeCount: number; key: string }) =>
      resumeWorkflowRun(input.id, input.expectedResumeCount, input.key),
    retry: false,
    onSettled: (_d, _e, input) => settle(input.id),
  });
}

export function useRetryWorkflowStep(slug: string) {
  const settle = useSettle(slug);
  return useMutation({
    mutationFn: (input: { id: string; step: string; key: string }) =>
      retryWorkflowStep(input.id, input.step, input.key),
    retry: false,
    onSettled: (_d, _e, input) => settle(input.id),
  });
}

export function useSendWorkflowEvent(slug: string) {
  const settle = useSettle(slug);
  return useMutation({
    mutationFn: (input: { id: string; eventName: string; payload: unknown; key: string }) =>
      sendWorkflowEvent(input.id, input.eventName, input.payload, input.key),
    retry: false,
    onSettled: (_d, _e, input) => settle(input.id),
  });
}

export function useCompleteWorkflowCallback(slug: string) {
  const settle = useSettle(slug);
  return useMutation({
    mutationFn: (input: { id: string; callbackId: string; payload: unknown }) =>
      completeWorkflowCallback(input.id, input.callbackId, input.payload),
    retry: false,
    onSettled: (_d, _e, input) => settle(input.id),
  });
}

export function useStartWorkflowRun(slug: string) {
  const settle = useSettle(slug);
  return useMutation({
    mutationFn: (input: { name: string; input: unknown; key: string }) =>
      startWorkflowRun(slug, input.name, input.input, input.key),
    retry: false,
    onSettled: () => settle(),
  });
}

export function useCancelQueuedRuns(slug: string) {
  const settle = useSettle(slug);
  return useMutation({
    mutationFn: (runIds: string[]) => cancelQueuedRuns(slug, runIds),
    retry: false,
    onSettled: () => settle(),
  });
}
