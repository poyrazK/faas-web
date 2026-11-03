import { randomUUID } from 'node:crypto';
import type { components } from '../src/lib/api/schema';
import { GuardProblem } from './release-freezes';

type S = components['schemas'];
type Rule = S['MirrorRuleResponse'];

/** api.MirrorAlwaysStrippedHeaders (faas pkg/api/dto.go:4109). */
export const ALWAYS_STRIPPED = [
  'Authorization',
  'Cookie',
  'Set-Cookie',
  'X-API-Key',
  'Proxy-Authorization',
  'WWW-Authenticate',
];
const WINDOW_SECONDS: Record<string, number> = { '1h': 3600, '24h': 86400, '7d': 604800 };
const SAFE = ['GET', 'HEAD', 'OPTIONS'];
const UNSAFE = ['POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * The comparison ledger over a window (handlers_mirror.go:394-446), every
 * count the API reports: drift proportional to the window and the mirrored
 * share, so switching windows visibly changes it.
 */
export function summary(rule: Rule, window: string): S['MirrorSummaryResponse'] {
  const seconds = WINDOW_SECONDS[window];
  if (!seconds)
    throw new GuardProblem(422, 'invalid_mirror_window', 'window must be 1h, 24h or 7d.');
  const total = rule.enabled ? Math.round((seconds / 3600) * rule.percent * 4.2) : 0;
  const status = Math.round(total * 0.012);
  const schema = Math.round(total * 0.004);
  const body = rule.include_body ? Math.round(total * 0.03) : 0;
  const timeouts = Math.round(total * 0.002);
  const rejected = Math.round(total * 0.001);
  const incomplete = timeouts + rejected + Math.round(total * 0.003);
  const changed = Math.min(status + schema + body, total - incomplete);
  const complete = total - incomplete;
  return {
    total_invocations: total,
    changed_response_count: changed,
    changed_response_percent: complete > 0 ? (100 * changed) / complete : 0,
    status_diff_count: status,
    schema_diff_count: schema,
    body_diff_count: body,
    mean_latency_diff_ms: total === 0 ? 0 : 12,
    p99_latency_diff_ms: total === 0 ? 0 : -8,
    crash_count: Math.round(total * 0.0005),
    incomplete_comparison_count: incomplete,
    scheduler_admission_timeout_count: timeouts,
    scheduler_admission_rejected_count: rejected,
    scheduler_admission_error_count: 0,
    window_seconds: seconds,
  };
}

/** POST /v1/apps/{slug}/mirrors/{id}/replay (handlers_mirror.go:448-560). */
export function replay(rule: Rule, body: Record<string, unknown>): S['MirrorReplayBatchResponse'] {
  if (!rule.enabled)
    throw new GuardProblem(
      409,
      'debug_replay_unsupported',
      'enable the mirror rule before replaying a corpus'
    );
  const requests = body.requests;
  if (!Array.isArray(requests) || requests.length < 1 || requests.length > 100)
    throw new GuardProblem(
      400,
      'validation_failed',
      'requests must contain between 1 and 100 items'
    );
  const allowUnsafe = body.allow_unsafe_methods === true;
  const invocations = requests.map((raw: Record<string, unknown>, i) => {
    const method = String(raw?.method ?? '').toUpperCase();
    if (UNSAFE.includes(method) && !allowUnsafe)
      throw new GuardProblem(
        400,
        'validation_failed',
        `requests[${i}]: method ${method} requires allow_unsafe_methods=true`
      );
    if (!SAFE.includes(method) && !UNSAFE.includes(method))
      throw new GuardProblem(
        400,
        'validation_failed',
        `requests[${i}]: unsupported method "${String(raw?.method)}"`
      );
    const path = typeof raw.path === 'string' ? raw.path.trim() : '';
    if (!path.startsWith('/') || path.startsWith('//'))
      throw new GuardProblem(
        400,
        'validation_failed',
        `requests[${i}]: path must be an absolute request path with an optional query`
      );
    const id =
      typeof raw.request_id === 'string' && raw.request_id.trim()
        ? raw.request_id.trim()
        : randomUUID();
    return { request_id: id, mirror_invocation_id: randomUUID(), status: 'queued' as const };
  });
  return { queued: invocations.length, invocations };
}
