import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { keys, retryPolicy } from './queries';
import type { components } from './schema';

/**
 * Job recovery, results, private registries and schedules — the parts of
 * `/v1/jobs` past starting, pausing and reading runs (faas
 * apidserver/handlers_jobs.go, job_managed_objects.go,
 * handlers_job_registry_auth.go).
 */

export type JobTaskRetry = components['schemas']['JobTaskRetryResponse'];
export type JobArtifactDownload = components['schemas']['JobArtifactDownloadResponse'];
export type SchedulePolicy = components['schemas']['SchedulePolicy'];
export type JobArtifact = NonNullable<
  NonNullable<components['schemas']['JobTaskResponse']['output_manifest']>['artifacts']
>[number];

/**
 * Re-queue one failed, timed-out, OOM or cancelled task while its retry budget
 * remains (handlers_jobs.go:1529). The server applies the automatic retries'
 * capped backoff, so the answer says when the attempt starts, not that it ran.
 * The key is the caller's, so a repeat of the same intent replays the first
 * answer rather than spending a second attempt.
 */
export function useRetryJobTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      name,
      runId,
      index,
      idempotencyKey,
    }: {
      name: string;
      runId: string;
      index: number;
      idempotencyKey: string;
    }) =>
      unwrap(
        api.POST('/v1/jobs/{name}/runs/{id}/tasks/{idx}/retry', {
          params: {
            path: { name, id: runId, idx: index },
            header: { 'Idempotency-Key': idempotencyKey },
          },
        })
      ),
    onSettled: (_data, _error, { name }) =>
      qc.invalidateQueries({ queryKey: [...keys.jobs, name] }),
  });
}

/**
 * Create a linked run from a terminal run's failed, timed-out, OOM and
 * cancelled inputs, with a fresh attempt budget (handlers_jobs.go:688;
 * pgstore_jobs.go:1038). The answer is the new run.
 */
export function useReplayFailedJobRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, runId }: { name: string; runId: string }) =>
      unwrap(
        api.POST('/v1/jobs/{name}/runs/{id}/replay-failed', {
          params: { path: { name, id: runId } },
        })
      ),
    // Awaited, so the run list already holds the replay when it is selected.
    onSuccess: (_run, { name }) => qc.invalidateQueries({ queryKey: [...keys.jobs, name] }),
  });
}

/**
 * Verify a managed (`obj://`) artifact against its manifest and get a
 * five-minute signed GET (job_managed_objects.go:169). A mutation, not a
 * query: it runs on a click and its URL must not be cached.
 */
export function useDownloadJobArtifact() {
  return useMutation({
    mutationFn: ({
      name,
      runId,
      index,
      artifact,
    }: {
      name: string;
      runId: string;
      index: number;
      artifact: string;
    }) =>
      unwrap(
        api.GET('/v1/jobs/{name}/runs/{id}/tasks/{idx}/artifacts/{artifact}/download', {
          params: { path: { name, id: runId, idx: index, artifact } },
        })
      ),
  });
}

/** Only `obj://` artifacts are Gregale-managed; `s3://` and `gs://` stay the customer's. */
export const isManagedArtifact = (uri: string) => uri.startsWith('obj://');

const registryKey = (name: string) => [...keys.jobs, name, 'registry-credentials'] as const;

/** A job's sealed private-registry credentials: metadata only, never a password. */
export function useJobRegistryCredentials(name: string) {
  return useQuery({
    queryKey: registryKey(name),
    queryFn: () =>
      unwrap(api.GET('/v1/jobs/{name}/registry-credentials', { params: { path: { name } } })),
    enabled: Boolean(name),
  });
}

export function useSetJobRegistryCredential(name: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: components['schemas']['PutJobRegistryCredentialRequest']) =>
      unwrap(api.PUT('/v1/jobs/{name}/registry-credentials', { params: { path: { name } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: registryKey(name) }),
  });
}

export function useDeleteJobRegistryCredential(name: string) {
  const qc = useQueryClient();
  return useMutation({
    // The list answers the bare host; DELETE goes through the same
    // normalizeRegistryHost as PUT, which wants https:// (handlers_job_registry_auth.go:152).
    mutationFn: (registry: string) =>
      unwrap(
        api.DELETE('/v1/jobs/{name}/registry-credentials', {
          params: {
            path: { name },
            query: { registry: /^https:\/\//i.test(registry) ? registry : `https://${registry}` },
          },
        })
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: registryKey(name) }),
  });
}

/**
 * Change a job's schedule (`PATCH /v1/jobs/{name}`). An empty `schedule`
 * removes it, and a timezone cannot be sent with that; a policy can be
 * replaced but not removed (handlers_jobs.go:1057-1104). apid refuses any
 * update while a task is queued or claimed (409 "Job has active runs").
 */
export function useUpdateJobSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      name,
      ...body
    }: {
      name: string;
      schedule?: string;
      timezone?: string;
      schedule_policy?: SchedulePolicy;
    }) => unwrap(api.PATCH('/v1/jobs/{name}', { params: { path: { name } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.jobs }),
  });
}

export type FailureRules = components['schemas']['FailureRules'];
export type JobTaskAttempt = components['schemas']['JobTaskAttemptResponse'];
export type JobOccurrence = components['schemas']['ScheduleOccurrenceResponse'];
export type UpdateJobDefinition = Pick<
  components['schemas']['UpdateJobRequest'],
  | 'image_ref'
  | 'command'
  | 'env_overrides'
  | 'ram_mb'
  | 'task_timeout_sec'
  | 'max_parallelism'
  | 'retry_max'
  | 'failure_rules'
>;

/**
 * Change what a job runs (`PATCH /v1/jobs/{name}`): only the fields sent
 * change. A new `image_ref` is pulled and prepared again before any task
 * starts; `env_overrides` replaces the whole map; `failure_rules` replaces
 * the stored policy and cannot remove it. Each value is checked against the
 * plan's ceilings (403 `job_quota_exceeded`), and apid refuses any update
 * while a task is queued or claimed (409 "Job has active runs")
 * (handlers_jobs.go:976-1150; pgstore_jobs.go:335-399).
 */
export function useUpdateJobDefinition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, ...body }: UpdateJobDefinition & { name: string }) =>
      unwrap(api.PATCH('/v1/jobs/{name}', { params: { path: { name } }, body })),
    onSuccess: (job) => {
      qc.setQueryData([...keys.jobs, job.name], job);
      return qc.invalidateQueries({ queryKey: keys.jobs });
    },
  });
}

const ATTEMPT_PAGE = 50;

/**
 * The immutable outcome of each finished attempt of one task, in attempt
 * order, each with its own log tail and classifier decision
 * (handlers_jobs.go:625-686). An attempt still running is not a row yet.
 */
export function useJobTaskAttempts(name: string, runId: string, index: number | null) {
  return useInfiniteQuery({
    queryKey: [...keys.jobs, name, 'runs', runId, 'tasks', index, 'attempts'],
    queryFn: ({ pageParam, signal }) =>
      unwrap(
        api.GET('/v1/jobs/{name}/runs/{id}/tasks/{idx}/attempts', {
          params: {
            path: { name, id: runId, idx: index! },
            query: { limit: ATTEMPT_PAGE, offset: pageParam },
          },
          signal,
        })
      ),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.next_offset > last.offset ? last.next_offset : undefined),
    enabled: index !== null,
    retry: retryPolicy,
  });
}

/** Occurrence statuses the scheduler has not settled yet. */
export const ACTIVE_JOB_OCCURRENCE: ReadonlySet<JobOccurrence['status']> = new Set([
  'pending',
  'queued',
  'running',
  'waiting_replacement',
]);

/**
 * The scheduler's durable decision for each nominal time of a recurring
 * job: started, skipped while a run was active, missed its start deadline,
 * coalesced, or waiting to replace one. Newest first, paged by occurrence id
 * (handlers_schedule_occurrences.go:53-80). Manual runs are not occurrences.
 */
export function useJobOccurrences(name: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: [...keys.jobs, name, 'occurrences'],
    queryFn: ({ pageParam, signal }) =>
      unwrap(
        api.GET('/v1/jobs/{name}/occurrences', {
          params: {
            path: { name },
            // A page of 20 keeps the panel short; older decisions load on request.
            query: { limit: 20, ...(pageParam ? { before: pageParam } : {}) },
          },
          signal,
        })
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_before ?? undefined,
    enabled: Boolean(name) && enabled,
    retry: retryPolicy,
    refetchInterval: (query) =>
      !query.state.error &&
      query.state.data?.pages[0]?.occurrences.some((o) => ACTIVE_JOB_OCCURRENCE.has(o.status))
        ? 5_000
        : false,
  });
}
