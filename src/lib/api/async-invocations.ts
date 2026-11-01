import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { ApiError } from './errors';
import { keys, retryPolicy } from './queries';
import type { components } from './schema';

export type Invocation = components['schemas']['Invocation'];
type InvokeRequest = components['schemas']['InvokeRequest'];

/**
 * Which recovery route an invocation takes. faas splits replay by work
 * identity (ADR-609, ADR-612): unkeyed work uses `/replay`, keyed work uses
 * `/replay-keyed` so the copy joins its captured policy lane instead of
 * bypassing the per-key fence, and each route refuses the other's work with
 * 409 (handlers_keyed_invocation_replay.go:13-26). Both are deduplicated by
 * the parent: asking twice returns the same replay. So this is not a choice
 * to offer — the invocation decides it.
 */
export type ReplayPath =
  { kind: 'plain' } | { kind: 'keyed'; policy: string } | { kind: 'none'; reason: string };

export function replayPath(
  inv: Pick<Invocation, 'state' | 'work_policy_name' | 'queue_name'>
): ReplayPath {
  const failed = inv.state === 'failed';
  if (inv.queue_name) {
    // queue_replay_requires_binding: only the queue keeps the original binding.
    return {
      kind: 'none',
      reason: 'Named-queue work is replayed from that queue’s dead-letter list.',
    };
  }
  if (inv.work_policy_name) {
    if (failed) return { kind: 'keyed', policy: inv.work_policy_name };
    return {
      kind: 'none',
      reason:
        inv.state === 'dead_letter'
          ? 'Dead-lettered keyed work is replayed from the app’s dead-letter queue.'
          : 'Only failed keyed work can be replayed.',
    };
  }
  if (failed || inv.state === 'dead_letter') return { kind: 'plain' };
  return { kind: 'none', reason: 'Only failed or dead-lettered work can be replayed.' };
}

/** `POST /v1/invocations/{id}/replay-keyed` — recover failed keyed work in its lane. */
export function useReplayKeyedInvocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.POST('/v1/invocations/{id}/replay-keyed', { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.invocations }),
  });
}

/**
 * An app's named work policies, for the async invoke form. The route belongs
 * to the `work-policies` capability (catalog.json:5738), so callers pass
 * whether it is on; a hidden capability answers 404.
 */
export function useAppWorkPolicies(slug: string, enabled = true) {
  return useQuery({
    queryKey: ['apps', slug, 'work-policies'],
    queryFn: async ({ signal }) =>
      (
        await unwrap(
          api.GET('/v1/apps/{slug}/work-policies', { params: { path: { slug } }, signal })
        )
      ).policies,
    enabled: enabled && Boolean(slug),
    retry: retryPolicy,
  });
}

/**
 * Replay refusals worth more than the server's one-line detail. The toast
 * still gets the error, so its code and help show underneath.
 */
const REPLAY_ERRORS: Record<string, string> = {
  keyed_replay_expired:
    'Its original pending lifetime has passed, so it cannot be replayed. Send the work again to give it a fresh lifetime.',
  keyed_replay_unavailable:
    'Its earlier replay is no longer retained, and an invocation is only ever replayed once.',
  invocation_replay_unavailable:
    'Its earlier replay is no longer retained, and an invocation is only ever replayed once.',
  event_delivery_capacity_exhausted:
    'Event delivery capacity is full. Try again once pending deliveries drain.',
};

export function replayErrorDescription(error: unknown): string | undefined {
  return error instanceof ApiError ? REPLAY_ERRORS[error.code] : undefined;
}

/**
 * A work key is a JSON string, number or boolean, and the type is part of the
 * lane: `"1"` and `1` are different keys (faas pkg/workpolicy/key.go:77).
 * Text that is not JSON is taken as a string, which is what people type.
 */
export function parseWorkKey(text: string, label: string): string | number | boolean {
  const trimmed = text.trim();
  let value: unknown = trimmed;
  try {
    value = JSON.parse(trimmed);
  } catch {
    // Not JSON: keep the text as a string key.
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string' && value !== '') return value;
  throw new Error(`${label} must be a non-empty string, number, or boolean.`);
}

export interface AsyncInvokeOptions {
  policy: string;
  key: string;
  fairnessKey: string;
  /** A `datetime-local` value, in the browser's time zone. */
  deadline: string;
  onSuccess: string;
  onFailure: string;
}

export const NO_ASYNC_OPTIONS: AsyncInvokeOptions = {
  policy: '',
  key: '',
  fairnessKey: '',
  deadline: '',
  onSuccess: '',
  onFailure: '',
};

/** The async-only part of an invoke body. Throws a readable error on bad input. */
export function asyncInvokeExtras(
  options: AsyncInvokeOptions
): Pick<InvokeRequest, 'work' | 'deadline_at' | 'destinations'> {
  const body: Pick<InvokeRequest, 'work' | 'deadline_at' | 'destinations'> = {};
  if (options.policy) {
    body.work = { policy: options.policy, key: parseWorkKey(options.key, 'Work key') };
    if (options.fairnessKey.trim())
      body.work.fairness_key = parseWorkKey(options.fairnessKey, 'Fairness key');
  }
  if (options.deadline) {
    const at = new Date(options.deadline);
    if (Number.isNaN(at.getTime()) || at.getTime() <= Date.now())
      throw new Error('The deadline must be in the future.');
    body.deadline_at = at.toISOString();
  }
  if (options.onSuccess || options.onFailure) {
    body.destinations = {
      ...(options.onSuccess ? { on_success: options.onSuccess } : {}),
      ...(options.onFailure ? { on_failure: options.onFailure } : {}),
    };
  }
  return body;
}
