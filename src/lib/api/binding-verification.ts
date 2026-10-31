import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { retryPolicy } from './queries';
import type { components } from './schema';

/**
 * Binding release policy, durable verification runs and queue canaries
 * (faas ADR-1355, ADR-598, ADR-1352). The server records and checks; it never
 * drives a run on its own, so the console is one of the runners.
 */

type S = components['schemas'];
export type ReleasePolicy = S['BindingReleasePolicy'];
export type SetReleasePolicyBody = S['SetBindingReleasePolicyRequest'];
export type VerificationRun = S['BindingVerificationRun'];
export type VerificationRunStep = S['BindingVerificationRunStep'];
export type VerificationPlanStep = S['BindingVerificationPlanStep'];
export type VerificationReview = S['BindingVerificationReview'];
export type VerificationRunSummary = S['BindingVerificationRunSummary'];
export type VerificationDiagnostics = S['BindingVerificationRunDiagnostics'];
export type CreateVerificationRunBody = S['CreateBindingVerificationRunRequest'];
export type QueueCanary = S['QueueBindingCanary'];
export type QueueEvidence = 'consumer_readiness' | 'handler_completion';
export type StorageMode = 'read' | 'write' | 'read_write';

/** pkg/api/limits.go */
export const RUN_MAX_TTL_SECONDS = 600; // BindingVerificationRunMaxTTLSeconds
export const RUN_MAX_CONCURRENCY = 8; // BindingVerificationRunnerMaxConcurrency
export const RUN_DEFAULT_CONCURRENCY = 2; // BindingVerificationRunnerDefaultConcurrency
export const RUN_MAX_ACTIVE = 8; // BindingVerificationRunMaxActive
export const REQUIREMENTS_MAX = 32; // QueueReleaseRequirementsMax, ObjectStorageRequirementsMax
export const REASON_MAX_BYTES = 256; // BindingReleasePolicyReasonMaxBytes
export const QUEUE_CANARY_MAX_TTL_SECONDS = 600; // QueueCanaryMaxTTLSeconds

/** pkg/api/queue_bindings.go:9 and object_storage_binding_probe.go:5 */
export const QUEUE_BINDING_NAME = /^[a-z][a-z0-9-]{0,62}$/;
export const STORAGE_PREFIX = /^[A-Z][A-Z0-9_]{0,47}$/;
/** api.EnvScopePattern, as the spec states it for the scope query. */
export const SCOPE_PATTERN = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/;

export interface PolicyForm {
  mode: 'off' | 'enforce';
  maxAge: string;
  requireAck: boolean;
  reason: string;
  queue: Record<string, string>;
  storage: Record<string, string>;
}

const BASE = '/v1/apps/{slug}/bindings/release-policy' as const;
const WITH_QUEUES = '/v1/apps/{slug}/bindings/release-policy-with-queues' as const;
const WITH_STORAGE = '/v1/apps/{slug}/bindings/release-policy-with-object-storage' as const;
type PolicyRoute = typeof BASE | typeof WITH_QUEUES | typeof WITH_STORAGE;

/**
 * Which of the three PUT routes a policy write must use, and its body.
 *
 * The routes exist so an older server or client can never silently drop a
 * requirement (faas pkg/apid/bindings/release_policy.go:11-25): queue
 * requirements only travel on `-with-queues`, storage-only requirements on
 * `-with-object-storage`, and a policy that already holds either kind refuses
 * a write that omits it. So a map is sent whenever the stored policy or the
 * form has one, as `{}` to clear, and the route follows the Go client's
 * choice (pkg/api/binding_release_policy.go:86-96).
 */
export function policyWrite(
  current: ReleasePolicy,
  form: PolicyForm
): { route: PolicyRoute; body: SetReleasePolicyBody } {
  const body: SetReleasePolicyBody = {
    mode: form.mode,
    expected_revision: current.revision,
    max_verification_age: form.maxAge.trim(),
    require_application_ack: form.requireAck,
  };
  const reason = form.reason.trim();
  if (reason) body.reason = reason;
  const hasQueue =
    Object.keys(current.queue_requirements ?? {}).length > 0 || Object.keys(form.queue).length > 0;
  const hasStorage =
    Object.keys(current.object_storage_requirements ?? {}).length > 0 ||
    Object.keys(form.storage).length > 0;
  if (hasQueue) body.queue_requirements = form.queue as SetReleasePolicyBody['queue_requirements'];
  if (hasStorage)
    body.object_storage_requirements =
      form.storage as SetReleasePolicyBody['object_storage_requirements'];
  const route = hasQueue ? WITH_QUEUES : hasStorage ? WITH_STORAGE : BASE;
  return { route, body };
}

/**
 * Seconds in a Go duration of hours, minutes and seconds, or null. The server
 * takes whole seconds from 1s through 24h (ValidateBindingReleasePolicyRequest).
 */
export function parseVerificationAge(text: string): number | null {
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(text.trim());
  if (!match || !text.trim()) return null;
  const [, h = '0', m = '0', s = '0'] = match;
  const seconds = Number(h) * 3600 + Number(m) * 60 + Number(s);
  return seconds >= 1 && seconds <= 86400 ? seconds : null;
}

/**
 * Only probe and queue-canary steps admit work; the store refuses the rest
 * (memstore_binding_verification_run.go:172-206), and a step's resource is
 * immutable once recorded.
 */
export function stepAdmittable(run: Pick<VerificationRun, 'status'>, step: VerificationRunStep) {
  return (
    run.status === 'pending' &&
    !step.resource_id &&
    (step.plan.action === 'probe' || step.plan.action === 'queue-canary')
  );
}

const TERMINAL_FAIL = new Set([
  'failed',
  'timed_out',
  'cancelled',
  'missing',
  'expired',
  'blocked',
]);

export type CompleteBlocker =
  { kind: 'failed'; steps: number[]; status: string } | { kind: 'admit' | 'wait'; steps: number[] };

/**
 * Why Complete would be refused before its final policy check, or null. faas
 * Complete (bindings/verification_runs.go:239-246) answers 409 when a probe or
 * queue-canary step has no resource this run owns, or an owned resource has
 * not succeeded. Step numbers are 1-based. A failure comes first: no later
 * admission can rescue the run.
 */
export function completeBlocker(run: Pick<VerificationRun, 'steps'>): CompleteBlocker | null {
  const failed: number[] = [];
  const admit: number[] = [];
  const wait: number[] = [];
  let failedStatus = '';
  run.steps.forEach((step, i) => {
    const admits = step.plan.action === 'probe' || step.plan.action === 'queue-canary';
    if (step.owned && step.resource_id) {
      if (TERMINAL_FAIL.has(step.status)) {
        failed.push(i + 1);
        failedStatus ||= step.status;
      } else if (step.status !== 'succeeded') wait.push(i + 1);
    } else if (admits) admit.push(i + 1);
  });
  if (failed.length) return { kind: 'failed', steps: failed, status: failedStatus };
  if (admit.length) return { kind: 'admit', steps: admit };
  if (wait.length) return { kind: 'wait', steps: wait };
  return null;
}

/** Why a step is in its state, in one sentence, from the plan and its resource. */
export function stepExplanation(step: VerificationRunStep): string {
  const { action, reason } = step.plan;
  if (step.resource_id) {
    const what = step.resource_kind === 'queue' ? 'canary message' : 'probe task';
    if (step.status === 'succeeded')
      return step.owned
        ? `This run’s ${what} succeeded.`
        : `An earlier ${what} succeeded; this run reuses it.`;
    if (TERMINAL_FAIL.has(step.status))
      return `The ${what} ended ${step.status}. It cannot be replaced; review a new run.`;
    if (step.resource_kind === 'queue')
      return step.status === 'dispatching'
        ? 'The canary is being handled. Delivery is not proof until the handler completes.'
        : 'The canary is published but not yet delivered to the consumer.';
    return `The probe task is ${step.status}.`;
  }
  switch (action) {
    case 'probe':
      return `No current evidence (${reason ?? 'unknown'}). Waiting for you to admit a probe.`;
    case 'queue-canary':
      return 'Handler completion is required. Waiting for you to admit one canary message.';
    case 'reuse':
      return 'Current evidence is fresh enough; nothing to run.';
    case 'wait':
    case 'wait-queue':
      return 'An earlier compatible probe is still running; this run observes it.';
    case 'observe':
      return 'Observes the consumer’s next healthy poll. Sends no messages.';
    case 'skip':
      return `Not checked under this policy (${reason ?? 'not applicable'}).`;
    case 'blocked':
      return `Blocked: ${reason ?? 'unsupported'}. Fix the binding, then review a new run.`;
    default:
      return reason ?? action;
  }
}

// --- Keys -------------------------------------------------------------------

const appKey = (accountId: string, slug: string) => ['account', accountId, 'app', slug] as const;
export const releasePolicyKey = (accountId: string, slug: string, scope: string) =>
  [...appKey(accountId, slug), 'binding-release-policy', scope] as const;
export const verificationRunsKey = (accountId: string, slug: string) =>
  [...appKey(accountId, slug), 'binding-verification-runs'] as const;
export const verificationRunKey = (accountId: string, slug: string, run: string) =>
  [...verificationRunsKey(accountId, slug), run] as const;
export const runDiagnosticsKey = (accountId: string, slug: string, run: string) =>
  [...verificationRunKey(accountId, slug, run), 'diagnostics'] as const;
export const queueCanaryKey = (accountId: string, slug: string, canary: string) =>
  [...appKey(accountId, slug), 'queue-canary', canary] as const;

// --- Release policy ---------------------------------------------------------

export function useReleasePolicy(accountId: string, slug: string, scope: string) {
  return useQuery({
    queryKey: releasePolicyKey(accountId, slug, scope),
    queryFn: ({ signal }) =>
      unwrap(api.GET(BASE, { params: { path: { slug }, query: { scope } }, signal })),
    enabled: Boolean(accountId && slug && scope),
    retry: retryPolicy,
  });
}

function putPolicy(slug: string, scope: string, route: PolicyRoute, body: SetReleasePolicyBody) {
  const params = { path: { slug }, query: { scope } };
  if (route === WITH_QUEUES)
    return unwrap(
      api.PUT(WITH_QUEUES, {
        params,
        body: body as S['SetQueueBindingReleasePolicyRequest'],
      })
    );
  if (route === WITH_STORAGE)
    return unwrap(
      api.PUT(WITH_STORAGE, {
        params,
        body: body as S['SetObjectStorageBindingReleasePolicyRequest'],
      })
    );
  return unwrap(api.PUT(BASE, { params, body }));
}

export function useSetReleasePolicy(accountId: string, slug: string, scope: string) {
  const client = useQueryClient();
  const key = releasePolicyKey(accountId, slug, scope);
  return useMutation({
    mutationFn: ({ current, form }: { current: ReleasePolicy; form: PolicyForm }) => {
      const { route, body } = policyWrite(current, form);
      return putPolicy(slug, scope, route, body);
    },
    onSuccess: (next) => client.setQueryData(key, next),
    // A revision conflict means the cache is stale too; reread either way.
    onSettled: () => void client.invalidateQueries({ queryKey: key }),
  });
}

// --- Verification runs ------------------------------------------------------

const RUNS = '/v1/apps/{slug}/bindings/verification-runs' as const;
const RUN = '/v1/apps/{slug}/bindings/verification-runs/{run}' as const;

export function useVerificationRuns(accountId: string, slug: string) {
  return useInfiniteQuery({
    queryKey: verificationRunsKey(accountId, slug),
    queryFn: ({ pageParam, signal }) =>
      unwrap(
        api.GET(RUNS, {
          params: {
            path: { slug },
            query: { limit: 20, ...(pageParam ? { cursor: pageParam } : {}) },
          },
          signal,
        })
      ),
    initialPageParam: '',
    getNextPageParam: (last) => last.next_cursor || undefined,
    enabled: Boolean(accountId && slug),
    retry: retryPolicy,
  });
}

/** Status re-validates the frozen review on every read, so poll while pending. */
export function useVerificationRun(accountId: string, slug: string, run: string) {
  return useQuery({
    queryKey: verificationRunKey(accountId, slug, run),
    queryFn: ({ signal }) => unwrap(api.GET(RUN, { params: { path: { slug, run } }, signal })),
    enabled: Boolean(accountId && slug && run),
    retry: retryPolicy,
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? 5_000 : false),
  });
}

/** Polled alongside the run while it is pending, and stopped with it. */
export function useRunDiagnostics(accountId: string, slug: string, run: string, live = false) {
  return useQuery({
    queryKey: runDiagnosticsKey(accountId, slug, run),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/bindings/verification-runs/{run}/diagnostics', {
          params: { path: { slug, run } },
          signal,
        })
      ),
    enabled: Boolean(accountId && slug && run),
    retry: retryPolicy,
    refetchInterval: live ? 5_000 : false,
  });
}

/** Side-effect free: no receipt, no task, no message (ADR-1357). */
export function reviewVerification(slug: string, deploymentId?: string) {
  return unwrap(
    api.POST('/v1/apps/{slug}/bindings/verification-runs/review', {
      params: { path: { slug } },
      body: deploymentId ? { deployment_id: deploymentId } : {},
    })
  );
}

export function createVerificationRun(slug: string, body: CreateVerificationRunBody) {
  return unwrap(api.POST(RUNS, { params: { path: { slug } }, body }));
}

export type RunAction = 'resume' | 'complete' | 'cancel';

export function runAction(slug: string, run: string, action: RunAction) {
  const params = { params: { path: { slug, run } } };
  if (action === 'cancel') return unwrap(api.DELETE(RUN, params));
  if (action === 'complete')
    return unwrap(api.POST('/v1/apps/{slug}/bindings/verification-runs/{run}/complete', params));
  return unwrap(api.POST('/v1/apps/{slug}/bindings/verification-runs/{run}/resume', params));
}

export function admitStep(slug: string, run: string, step: number) {
  return unwrap(
    api.POST('/v1/apps/{slug}/bindings/verification-runs/{run}/steps/{step}/admit', {
      params: { path: { slug, run, step } },
    })
  );
}

/** Every write changes the run, its diagnostics and the list's stored status. */
export function useRunWrites(accountId: string, slug: string) {
  const client = useQueryClient();
  return () => void client.invalidateQueries({ queryKey: verificationRunsKey(accountId, slug) });
}

// --- Queue canaries ---------------------------------------------------------

const CANARY = '/v1/apps/{slug}/bindings/queue-canaries/{canary}' as const;

export function useQueueCanary(accountId: string, slug: string, canary: string, live: boolean) {
  return useQuery({
    queryKey: queueCanaryKey(accountId, slug, canary),
    queryFn: ({ signal }) =>
      unwrap(api.GET(CANARY, { params: { path: { slug, canary } }, signal })),
    enabled: Boolean(accountId && slug && canary),
    retry: retryPolicy,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return live && (status === 'published' || status === 'dispatching') ? 3_000 : false;
    },
  });
}

export function createQueueCanary(
  slug: string,
  body: { deployment_id: string; binding: string; ttl_seconds: number }
) {
  return unwrap(
    api.POST('/v1/apps/{slug}/bindings/queue-canaries', {
      params: { path: { slug } },
      body: { ...body, publish_consent: true },
    })
  );
}

export function cancelQueueCanary(slug: string, canary: string) {
  return unwrap(api.DELETE(CANARY, { params: { path: { slug, canary } } }));
}
