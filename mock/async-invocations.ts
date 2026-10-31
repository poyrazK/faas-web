import { randomBytes } from 'node:crypto';
import type { components } from '../src/lib/api/schema';

type S = components['schemas'];
type Invocation = S['Invocation'];
type WorkPolicy = S['WorkPolicyResponse'];

/** A refusal with the problem code apid returns; plugin.ts turns it into a Problem. */
export class Refusal extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail?: string
  ) {
    super(detail ?? code);
  }
}

export interface AsyncMock {
  invocations: Invocation[];
  policies: Map<string, WorkPolicy[]>;
  /** parent id → its one replay (ADR-609 / ADR-612). */
  children: Map<string, string>;
  /** id → when a row the mock created completes. */
  settleAt: Map<string, number>;
}

const HOUR = 3_600_000;
/** The Pro plan's MaxAsyncInvocationDeadlineSeconds (faas pkg/api/limits.go:5955). */
const DEADLINE_CEILING = 6 * HOUR;
const SETTLE_MS = 3_000;
const newId = () => randomBytes(16).toString('hex');
const at = (ms: number) => new Date(ms).toISOString();

function policy(name: string, revision: number, extra: Partial<WorkPolicy>, now: number) {
  return {
    name,
    revision,
    max_running_per_key: 1 as const,
    max_running_per_fairness_key: 0,
    pending_updates: 'all' as const,
    debounce_ms: 0,
    expires_after_ms: 0,
    created_at: at(now - 20 * 24 * HOUR),
    updated_at: at(now - 2 * 24 * HOUR),
    ...extra,
  };
}

/**
 * Gives a third of the non-cron history, and half its failed rows, a work policy, with on-failure (and
 * sometimes on-success) webhook destinations, and every row the deadline apid
 * stamps. `ordered-orders` has a pending expiry, so its failed rows show the
 * `keyed_replay_expired` refusal; `document-index` rows replay.
 */
export function seedAsyncInvocations(
  rows: Invocation[],
  apps: { id: string; slug: string }[],
  hooks: Map<string, { id: string }[]>,
  now: number
): Map<string, WorkPolicy[]> {
  const slugOf = new Map(apps.map((a) => [a.id, a.slug]));
  const keyedApps = new Set<string>();
  let keyed = 0;
  rows.forEach((row, i) => {
    const created = Date.parse(row.created_at);
    row.deadline_at = at(created + HOUR);
    const keyedRow = i % 3 === 0 || (row.state === 'failed' && i % 2 === 0);
    if (!keyedRow || row.source === 'cron') return;
    const slug = slugOf.get(row.app_id);
    if (!slug) return;
    const ordered = keyed++ % 2 === 1;
    row.work_policy_name = ordered ? 'ordered-orders' : 'document-index';
    row.work_policy_revision = ordered ? 1 : 2;
    if (ordered) row.work_expires_at = at(created + 30 * 60_000);
    const appHooks = hooks.get(slug) ?? [];
    if (appHooks[0]) row.on_failure_destination_id = appHooks[0].id;
    if (appHooks[1] && i % 2 === 0) row.on_success_destination_id = appHooks[1].id;
    keyedApps.add(slug);
  });
  return new Map(
    [...keyedApps].map((slug) => [
      slug,
      [
        policy(
          'document-index',
          2,
          { pending_updates: 'keep_latest', debounce_ms: 3000, max_running_per_fairness_key: 2 },
          now
        ),
        policy('ordered-orders', 1, { expires_after_ms: 30 * 60_000 }, now),
      ],
    ])
  );
}

/** `POST /v1/invocations/{id}/replay` and `/replay-keyed`, with apid's refusals. */
export function replay(mock: AsyncMock, id: string, kind: 'plain' | 'keyed', now: number) {
  const parent = mock.invocations.find((r) => r.id === id);
  if (!parent) throw new Refusal(404, 'invocation_not_found');
  if (kind === 'plain') {
    if (parent.state !== 'failed' && parent.state !== 'dead_letter')
      throw new Refusal(409, 'invocation_not_replayable', `invocation is ${parent.state}`);
    if (parent.queue_name)
      throw new Refusal(409, 'queue_replay_requires_binding', 'use the app queue replay');
    if (parent.work_policy_name)
      throw new Refusal(409, 'keyed_replay_requires_policy', 'use replay-keyed');
  } else if (parent.state !== 'failed' || !parent.work_policy_name || parent.queue_name) {
    throw new Refusal(
      409,
      'keyed_replay_not_allowed',
      'only failed keyed work without a queue binding can use this recovery path'
    );
  }
  const existing = mock.children.get(id);
  if (existing) {
    const child = mock.invocations.find((r) => r.id === existing);
    if (!child)
      throw new Refusal(409, `${kind === 'keyed' ? 'keyed' : 'invocation'}_replay_unavailable`);
    return child;
  }
  if (kind === 'keyed' && parent.work_expires_at && Date.parse(parent.work_expires_at) <= now)
    throw new Refusal(409, 'keyed_replay_expired', 'the original pending deadline has elapsed');
  const child: Invocation = {
    ...parent,
    id: newId(),
    source: 'replay',
    state: 'pending',
    attempts: 0,
    created_at: at(now),
    completed_at: null,
    last_error: null,
    result: null,
    instance_id: null,
    deadline_at: at(now + DEADLINE_CEILING),
  };
  mock.invocations.unshift(child);
  mock.children.set(id, child.id);
  mock.settleAt.set(child.id, now + SETTLE_MS);
  return child;
}

function scalar(value: unknown): boolean {
  return (
    (typeof value === 'string' && value !== '') ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

/** `POST /v1/apps/{slug}/invoke/async` (faas handlers_invocations.go:55). */
export function createAsyncInvocation(
  mock: AsyncMock,
  app: { id: string; slug: string; account_id?: string },
  hooks: { id: string }[],
  body: Record<string, unknown>,
  now: number
): Invocation {
  const ceiling = now + DEADLINE_CEILING;
  let deadline = ceiling;
  if (typeof body.deadline_at === 'string') {
    const requested = Date.parse(body.deadline_at);
    if (!(requested > now))
      throw new Refusal(422, 'validation', 'deadline_at must be in the future');
    deadline = Math.min(requested, ceiling);
  }
  const work = body.work as { policy?: string; key?: unknown; fairness_key?: unknown } | undefined;
  let named: WorkPolicy | undefined;
  if (work) {
    named = mock.policies.get(app.slug)?.find((p) => p.name === work.policy);
    if (!named) throw new Refusal(422, 'validation', 'unknown work policy');
    if (!scalar(work.key))
      throw new Refusal(422, 'validation', 'work key must be a bounded string, number, or boolean');
    if (work.fairness_key !== undefined && !scalar(work.fairness_key))
      throw new Refusal(
        422,
        'validation',
        'work fairness_key must be a bounded string, number, or boolean'
      );
  }
  const destinations = (body.destinations ?? {}) as { on_success?: string; on_failure?: string };
  for (const field of ['on_success', 'on_failure'] as const) {
    const hook = destinations[field];
    if (hook && !hooks.some((h) => h.id === hook))
      throw new Refusal(
        422,
        'validation',
        `destinations.${field} must reference a webhook owned by this app`
      );
  }
  const inv: Invocation = {
    id: newId(),
    app_id: app.id,
    account_id: app.account_id ?? '',
    source: 'async_invoke',
    state: 'pending',
    method: typeof body.method === 'string' ? body.method : 'POST',
    path: typeof body.path === 'string' ? body.path : '/',
    payload: (body.payload as Invocation['payload']) ?? {},
    created_at: at(now),
    attempts: 0,
    deadline_at: at(deadline),
    ...(named
      ? {
          work_policy_name: named.name,
          work_policy_revision: named.revision,
          ...(named.expires_after_ms ? { work_expires_at: at(now + named.expires_after_ms) } : {}),
        }
      : {}),
    ...(destinations.on_success ? { on_success_destination_id: destinations.on_success } : {}),
    ...(destinations.on_failure ? { on_failure_destination_id: destinations.on_failure } : {}),
  };
  mock.invocations.unshift(inv);
  mock.settleAt.set(inv.id, now + SETTLE_MS);
  return inv;
}

/** Work the mock created completes a few seconds later, so polling ends. */
export function settle(mock: AsyncMock, inv: Invocation, now: number): Invocation {
  const due = mock.settleAt.get(inv.id);
  if (due !== undefined && now >= due && inv.state === 'pending') {
    inv.state = 'completed';
    inv.attempts = 1;
    inv.completed_at = at(due);
    inv.result = { ok: true };
    mock.settleAt.delete(inv.id);
  }
  return inv;
}
