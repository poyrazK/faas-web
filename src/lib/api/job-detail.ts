import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { keys, retryPolicy } from './queries';
import type { components } from './schema';

/**
 * The job-detail operations #208 left to the CLI: retry one task, replay a
 * run's failed tasks, download an output artifact, a job's private-registry
 * credentials, and its schedule (faas handlers_jobs.go,
 * handlers_job_registry_auth.go, job_managed_objects.go).
 */

export type JobTask = components['schemas']['JobTaskResponse'];

/** Statuses apid re-queues on an explicit retry (handlers_jobs.go retryJobTask). */
export const RETRIABLE_TASK = new Set(['failed', 'timeout', 'oom', 'cancelled']);

/**
 * Re-queue one task of a run while its retry budget remains. The server applies
 * the same capped backoff as an automatic retry, so the answer says when the
 * next attempt may start rather than that it has.
 */
export function useRetryJobTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      name,
      runId,
      taskIndex,
      idempotencyKey,
    }: {
      name: string;
      runId: string;
      taskIndex: number;
      idempotencyKey: string;
    }) =>
      unwrap(
        api.POST('/v1/jobs/{name}/runs/{id}/tasks/{idx}/retry', {
          params: {
            path: { name, id: runId, idx: taskIndex },
            header: { 'Idempotency-Key': idempotencyKey },
          },
        })
      ),
    onSettled: (_d, _e, { name }) => qc.invalidateQueries({ queryKey: [...keys.jobs, name] }),
  });
}

/**
 * Start a linked run with only the failed, timed-out, out-of-memory and
 * cancelled tasks of a finished run, each with a fresh retry budget. apid
 * refuses (409 `validation_failed`) a run still in flight, one with nothing to
 * replay, or one whose image no longer resolves to the same digest; it answers
 * 404 while the job is paused (pgstore_jobs.go JobRunReplayFailed).
 *
 * The route is idempotent-wrapped but the spec does not declare the header, so
 * it goes as a plain request header.
 */
export function useReplayFailedJobRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      name,
      runId,
      idempotencyKey,
    }: {
      name: string;
      runId: string;
      idempotencyKey: string;
    }) =>
      unwrap(
        api.POST('/v1/jobs/{name}/runs/{id}/replay-failed', {
          params: { path: { name, id: runId } },
          headers: { 'Idempotency-Key': idempotencyKey },
        })
      ),
    // Awaited so the run list already holds the linked run when it is selected.
    onSuccess: (_run, { name }) => qc.invalidateQueries({ queryKey: [...keys.jobs, name] }),
  });
}

export interface JobArtifact {
  name: string;
  uri: string;
  size_bytes: number;
  sha256: string;
}

/**
 * The artifacts a successful task published, read defensively: the manifest
 * is the image's own JSON (pkg/jobresult), validated by apid but typed loosely
 * in the spec. Anything malformed is left out rather than half-rendered.
 */
export function artifactsOf(task: Pick<JobTask, 'output_manifest'>): JobArtifact[] {
  const manifest = task.output_manifest as { artifacts?: unknown } | undefined;
  if (!manifest || !Array.isArray(manifest.artifacts)) return [];
  return manifest.artifacts.filter(
    (a): a is JobArtifact =>
      typeof a === 'object' &&
      a !== null &&
      typeof (a as JobArtifact).name === 'string' &&
      typeof (a as JobArtifact).uri === 'string' &&
      typeof (a as JobArtifact).size_bytes === 'number' &&
      typeof (a as JobArtifact).sha256 === 'string'
  );
}

/** Only `obj://` artifacts live in Gregale object storage; apid signs nothing else. */
export const isManagedArtifact = (artifact: JobArtifact) => artifact.uri.startsWith('obj://');

/**
 * Verify a managed artifact and get a five-minute signed GET for it. apid reads
 * the object and checks its size and SHA-256 against the manifest first: a
 * missing object is 404, changed bytes are 422 (job_managed_objects.go).
 * The caller needs job read and storage read, which a session has.
 */
export function useJobArtifactDownload() {
  return useMutation({
    mutationFn: ({
      name,
      runId,
      taskIndex,
      artifact,
    }: {
      name: string;
      runId: string;
      taskIndex: number;
      artifact: string;
    }) =>
      unwrap(
        api.GET('/v1/jobs/{name}/runs/{id}/tasks/{idx}/artifacts/{artifact}/download', {
          params: { path: { name, id: runId, idx: taskIndex, artifact } },
        })
      ),
  });
}

/**
 * Private-registry Basic Auth for one job's image pulls. Jobs are account-wide,
 * so credentials are per job and registry host, not per app. The list carries
 * metadata only; apid seals the password and never returns it
 * (handlers_job_registry_auth.go). Registries are named by bare host in
 * answers but must be sent with an explicit `https://`, including on delete.
 */
export const jobRegistryKey = (name: string) => [...keys.jobs, name, 'registry-credentials'];

export function useJobRegistryCredentials(name: string) {
  return useQuery({
    queryKey: jobRegistryKey(name),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/jobs/{name}/registry-credentials', { params: { path: { name } }, signal })
      ),
    retry: retryPolicy,
  });
}

export function useSetJobRegistryCredential(name: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: components['schemas']['PutJobRegistryCredentialRequest']) =>
      unwrap(api.PUT('/v1/jobs/{name}/registry-credentials', { params: { path: { name } }, body })),
    onSettled: () => qc.invalidateQueries({ queryKey: jobRegistryKey(name) }),
  });
}

export function useDeleteJobRegistryCredential(name: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (host: string) =>
      unwrap(
        api.DELETE('/v1/jobs/{name}/registry-credentials', {
          params: { path: { name }, query: { registry: `https://${host}` } },
        })
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: jobRegistryKey(name) }),
  });
}

/**
 * Change a job's schedule: the cron, its IANA zone and the schedule policy.
 * `schedule: ''` removes it and returns the job to batch; a schedule on a batch
 * job makes it recurring. apid refuses any update while a task is queued or
 * claimed (409 `validation_failed`) and edits of an image run
 * (`image_run_managed`) (handlers_jobs.go updateJob).
 */
export function useUpdateJobSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      name,
      ...body
    }: { name: string } & Pick<
      components['schemas']['UpdateJobRequest'],
      'schedule' | 'timezone' | 'schedule_policy'
    >) => unwrap(api.PATCH('/v1/jobs/{name}', { params: { path: { name } }, body })),
    onSuccess: (job) => {
      qc.setQueryData([...keys.jobs, job.name], job);
      // The kind may have changed between batch and recurring, which the list shows.
      return qc.invalidateQueries({ queryKey: keys.jobs });
    },
  });
}
