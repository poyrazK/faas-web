import { createHash, randomUUID } from 'node:crypto';
import type { components } from '../src/lib/api/schema';

/**
 * Binding release policy, durable verification runs and queue canaries for
 * the dev mock. Mirrors faas handlers_binding_release_policy.go,
 * pkg/apid/bindings/verification_runs.go and queue_canary.go closely enough
 * to walk every console state: admitted resources settle over a few seconds,
 * computed from their age on each read, the way deploy-lifecycle.ts does.
 */

type S = components['schemas'];
type Policy = S['BindingReleasePolicy'];
type Run = S['BindingVerificationRun'];
type Step = S['BindingVerificationRunStep'];
type PlanStep = S['BindingVerificationPlanStep'];
type Canary = S['QueueBindingCanary'];
type Item = S['AppBindingInventoryItem'];

/** Thrown here; plugin.ts turns it into its own RFC 7807 Problem. */
export class BindingMockProblem extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail?: string
  ) {
    super(detail ?? code);
  }
}
const fail = (status: number, code: string, detail?: string): never => {
  throw new BindingMockProblem(status, code, detail);
};

interface MockApp {
  id: string;
  slug: string;
  /** The app's live deployment, which reviews and canaries select. */
  live?: string;
}
interface AppState {
  policies: Map<string, Policy>;
  runs: Map<string, Run & { admittedAt: Record<number, number> }>;
  canaries: Map<string, Canary & { at: number; cancelled?: boolean }>;
}
const states = new Map<string, AppState>();
const SEEDED = 'api-gateway';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const iso = (ms: number) => new Date(ms).toISOString();
const offPolicy = (a: MockApp, scope: string): Policy => ({
  app_id: a.id,
  scope,
  mode: 'off',
  revision: 0,
  max_verification_age: '10m0s',
  require_application_ack: false,
});

/** Go's time.Duration.String() for whole seconds. */
export function goDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h) return `${h}h${m}m${s}s`;
  if (m) return `${m}m${s}s`;
  return `${s}s`;
}
function parseAge(text: string): number | null {
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(text);
  if (!match || !text) return null;
  const seconds = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  return seconds >= 1 && seconds <= 86400 ? seconds : null;
}

function plan(policy: Policy): PlanStep[] {
  const steps: PlanStep[] = [
    {
      type: 'service',
      name: 'billing',
      binding: 'BILLING_URL',
      scope: 'app',
      action: 'probe',
      reason: 'verification_unknown',
    },
    {
      type: 'postgres',
      name: 'main',
      binding: 'DATABASE_URL',
      scope: 'default',
      action: 'reuse',
      reason: 'evidence_current',
    },
    {
      type: 'object_storage',
      name: 'media',
      binding: 'MEDIA',
      scope: 'default',
      action: 'skip',
      reason: 'not_required',
    },
  ];
  for (const [name, evidence] of Object.entries(policy.queue_requirements ?? {}))
    steps.push({
      type: 'queue',
      name,
      binding: name,
      scope: 'default',
      queue_environment: 'default',
      action: evidence === 'handler_completion' ? 'queue-canary' : 'observe',
      reason: evidence,
      required_evidence: evidence,
    });
  return steps;
}
/** A frozen step: reused evidence is recorded with its earlier task, unowned. */
const frozen = (p: PlanStep): Step =>
  p.action === 'reuse'
    ? {
        plan: p,
        resource_id: randomUUID(),
        resource_kind: 'task',
        owned: false,
        status: 'succeeded',
      }
    : { plan: p, owned: false, status: 'planned' };

const digest = (a: MockApp, policy: Policy) =>
  createHash('sha256').update(`${a.id}:${policy.scope}:${policy.revision}`).digest('hex');

function stateFor(a: MockApp): AppState {
  let state = states.get(a.id);
  if (state) return state;
  state = { policies: new Map(), runs: new Map(), canaries: new Map() };
  states.set(a.id, state);
  if (a.slug !== SEEDED) return state;
  const now = Date.now();
  const policy: Policy = {
    ...offPolicy(a, 'default'),
    mode: 'enforce',
    revision: 3,
    queue_requirements: { orders: 'handler_completion' },
    updated_at: iso(now - 26 * 3600e3),
    reason: 'Require queue handler proof before promotion',
  };
  state.policies.set('default', policy);
  const deployment = a.live ?? randomUUID();
  const run = (id: string, createdAgo: number, status: Run['status'], extra: Partial<Run> = {}) => {
    const created = now - createdAgo;
    const steps = plan(policy).map(frozen);
    const record = {
      id,
      app: a.slug,
      deployment_id: deployment,
      scope: 'default',
      status,
      created_at: iso(created),
      expires_at: iso(created + 600e3),
      object_storage_write: false,
      queue_publish: true,
      review_digest: digest(a, policy),
      max_concurrency: 2,
      policy,
      inventory: { app: a.slug, generated_at: iso(created), complete: true, bindings: [] },
      steps,
      admittedAt: {},
      ...extra,
    };
    state!.runs.set(id, record);
    return record;
  };
  // Pending for ten minutes after the mock first serves this app.
  run(randomUUID(), 60e3, 'pending');
  const passed = run(randomUUID(), 2 * 3600e3, 'passed');
  passed.steps = passed.steps.map((s) =>
    s.plan.action === 'probe' || s.plan.action === 'queue-canary'
      ? {
          ...s,
          resource_id: randomUUID(),
          resource_kind: s.plan.action === 'probe' ? 'task' : 'queue',
          owned: true,
          status: 'succeeded',
        }
      : s
  );
  run(randomUUID(), 3 * 3600e3, 'pending'); // reads as expired
  run(randomUUID(), 24 * 3600e3, 'cancelled', { reason: 'cancelled' });
  const old: Canary & { at: number } = {
    id: randomUUID(),
    binding: 'orders',
    deployment_id: deployment,
    scope: 'default',
    status: 'succeeded',
    published_at: iso(now - 2 * 3600e3),
    expires_at: iso(now - 2 * 3600e3 + 600e3),
    delivered_at: iso(now - 2 * 3600e3 + 1800),
    completed_at: iso(now - 2 * 3600e3 + 2600),
    at: 0,
  };
  state.canaries.set(old.id, old);
  return state;
}

// --- Resource progression ---------------------------------------------------

function canaryView(c: Canary & { at: number; cancelled?: boolean }): Canary {
  const { at, cancelled, ...out } = c;
  if (!at) return out;
  if (cancelled) return { ...out, status: 'cancelled', reason: 'cancelled' };
  const age = Date.now() - at;
  if (age < 2500) return { ...out, status: 'published' };
  if (age < 5000) return { ...out, status: 'dispatching', delivered_at: iso(at + 2500) };
  return {
    ...out,
    status: 'succeeded',
    delivered_at: iso(at + 2500),
    completed_at: iso(at + 5000),
  };
}
function taskStatus(admitted: number, cancelled: boolean): string {
  if (cancelled) return 'cancelled';
  const age = Date.now() - admitted;
  return age < 2000 ? 'queued' : age < 4500 ? 'running' : 'succeeded';
}

function runView(a: MockApp, r: Run & { admittedAt: Record<number, number> }): Run {
  const { admittedAt, ...run } = r;
  const state = stateFor(a);
  run.steps = run.steps.map((step, i) => {
    if (!step.resource_id || !step.owned || !admittedAt[i]) return step;
    if (step.resource_kind === 'queue') {
      const c = state.canaries.get(step.resource_id);
      return { ...step, status: c ? canaryView(c).status : 'missing' };
    }
    return { ...step, status: taskStatus(admittedAt[i], run.status === 'cancelled') };
  });
  if (run.status !== 'cancelled' && Date.parse(run.expires_at) <= Date.now())
    return { ...run, status: 'expired', reason: 'run_expired' };
  if (run.status === 'pending' || run.status === 'passed') {
    const current = policyFor(a, run.scope);
    if (current.revision !== run.policy.revision || current.mode !== 'enforce')
      return { ...run, status: 'blocked', reason: 'review_changed_or_evidence_expired' };
  }
  return run;
}

// --- Release policy ---------------------------------------------------------

function policyFor(a: MockApp, scope: string): Policy {
  return stateFor(a).policies.get(scope) ?? offPolicy(a, scope);
}
export function readReleasePolicy(a: MockApp, scope: string | null) {
  return policyFor(a, scope || 'default');
}

/** handlers_binding_release_policy.go:56-88 and bindings/release_policy.go. */
export function writeReleasePolicy(
  a: MockApp,
  scope: string | null,
  route: 'base' | 'storage' | 'queues',
  body: Record<string, unknown>
): Policy {
  const queue = body.queue_requirements as Record<string, string> | undefined;
  const storage = body.object_storage_requirements as Record<string, string> | undefined;
  const mode = body.mode;
  const expected = body.expected_revision;
  const reason = typeof body.reason === 'string' ? body.reason : '';
  if (mode !== 'off' && mode !== 'enforce')
    fail(
      400,
      'validation_failed',
      'supply mode off or enforce and expected_revision (0 initially)'
    );
  if (typeof expected !== 'number' || expected < 0)
    fail(
      400,
      'validation_failed',
      'supply mode off or enforce and expected_revision (0 initially)'
    );
  if (mode === 'off' && !reason.trim())
    fail(400, 'validation_failed', 'a reason is required to disable release enforcement');
  const ageText = typeof body.max_verification_age === 'string' ? body.max_verification_age : '';
  const age = ageText ? parseAge(ageText) : 600;
  if (age === null)
    fail(
      400,
      'validation_failed',
      'max_verification_age must be a whole number of seconds between 1s and 24h'
    );
  for (const [name, evidence] of Object.entries(queue ?? {}))
    if (
      !/^[a-z][a-z0-9-]{0,62}$/.test(name) ||
      !['consumer_readiness', 'handler_completion'].includes(evidence)
    )
      fail(
        400,
        'validation_failed',
        'queue requirements must map valid binding names to consumer_readiness or handler_completion'
      );
  for (const [prefix, m] of Object.entries(storage ?? {}))
    if (!/^[A-Z][A-Z0-9_]{0,47}$/.test(prefix) || !['read', 'write', 'read_write'].includes(m))
      fail(
        400,
        'validation_failed',
        'object-storage requirements must map valid environment prefixes to read, write or read_write'
      );
  const target = scope || 'default';
  const current = policyFor(a, target);
  if ((route === 'queues') !== (queue !== undefined))
    fail(
      400,
      'validation_failed',
      'use release-policy-with-queues with explicit queue_requirements (an empty object clears them)'
    );
  if (route !== 'queues' && (route === 'storage') !== (storage !== undefined))
    fail(
      400,
      'validation_failed',
      'use release-policy-with-object-storage with explicit object_storage_requirements (an empty object clears them)'
    );
  if (Object.keys(current.queue_requirements ?? {}).length && queue === undefined)
    fail(
      400,
      'validation_failed',
      'this policy has queue requirements; use release-policy-with-queues to retain or explicitly clear them'
    );
  if (Object.keys(current.object_storage_requirements ?? {}).length && storage === undefined)
    fail(
      400,
      'validation_failed',
      'this policy has object-storage requirements; use release-policy-with-object-storage or release-policy-with-queues to retain or explicitly clear them'
    );
  if (expected !== current.revision)
    fail(
      409,
      'bindings_release_policy_changed',
      'Read the current policy revision before updating it.'
    );
  const next: Policy = {
    app_id: a.id,
    scope: target,
    mode: mode as Policy['mode'],
    revision: current.revision + 1,
    max_verification_age: goDuration(age as number),
    require_application_ack: body.require_application_ack === true,
    updated_at: new Date().toISOString(),
    ...(reason.trim() ? { reason: reason.trim() } : {}),
    ...(queue && Object.keys(queue).length
      ? { queue_requirements: queue as Policy['queue_requirements'] }
      : {}),
    ...(storage && Object.keys(storage).length
      ? { object_storage_requirements: storage as Policy['object_storage_requirements'] }
      : {}),
  };
  stateFor(a).policies.set(target, next);
  return next;
}

// --- Verification runs ------------------------------------------------------

export function listRuns(a: MockApp, query: URLSearchParams): S['BindingVerificationRunList'] {
  const status = query.get('status');
  const runs = [...stateFor(a).runs.values()]
    .map((r) => runView(a, r))
    .sort((x, y) => Date.parse(y.created_at) - Date.parse(x.created_at))
    .map((r) => ({
      id: r.id,
      app: r.app,
      deployment_id: r.deployment_id,
      scope: r.scope,
      // Summaries carry stored state; "blocked" is only ever a live recheck.
      status: (r.status === 'blocked'
        ? 'pending'
        : r.status) as S['BindingVerificationRunSummary']['status'],
      created_at: r.created_at,
      expires_at: r.expires_at,
    }))
    .filter((r) => !status || r.status === status);
  return {
    runs: runs.slice(0, Number(query.get('limit') ?? 20)),
    observed_at: new Date().toISOString(),
  };
}

function storedRun(a: MockApp, id: string) {
  return (
    stateFor(a).runs.get(id) ??
    fail(404, 'not_found', 'No owned run or eligible deployment was found.')
  );
}
const changed = () =>
  fail(
    409,
    'binding_verification_run_changed',
    'The reviewed plan, policy, configuration, deadline or evidence changed; inspect status and review a new run.'
  );

export function getRun(a: MockApp, id: string) {
  return runView(a, storedRun(a, id));
}

function activeRun(a: MockApp, id: string) {
  const r = storedRun(a, id);
  const view = runView(a, r);
  if (view.status !== 'pending') changed();
  return { r, view };
}

export function reviewRun(
  a: MockApp,
  liveDeployment: string | undefined,
  body: Record<string, unknown>
) {
  if (body.deployment_id !== undefined && !UUID.test(String(body.deployment_id)))
    fail(400, 'validation_failed', 'invalid verification run or missing write/publication consent');
  const deployment = (body.deployment_id as string | undefined) ?? liveDeployment;
  if (!deployment) fail(404, 'not_found', 'No owned run or eligible deployment was found.');
  const policy = policyFor(a, 'default');
  // validVerificationRunInventory: an enforced policy with a revision.
  if (policy.mode !== 'enforce' || policy.revision < 1) changed();
  const steps = plan(policy);
  return {
    app: a.slug,
    deployment_id: deployment as string,
    scope: 'default',
    service_targets: {},
    reviewed_at: new Date().toISOString(),
    ready: true,
    review_digest: digest(a, policy),
    object_storage_write_required: false,
    queue_publish_required: steps.some((s) => s.action === 'queue-canary'),
    inventory: {
      app: a.slug,
      generated_at: new Date().toISOString(),
      complete: true,
      bindings: [],
    },
    policy,
    plan: steps,
    blockers: [],
  } satisfies S['BindingVerificationReview'];
}

export function createRun(a: MockApp, body: Record<string, unknown>): Run {
  const state = stateFor(a);
  const id = String(body.id ?? '');
  const ttl = Number(body.ttl_seconds);
  const concurrency = body.max_concurrency === undefined ? 2 : Number(body.max_concurrency);
  if (!UUID.test(id) || !(ttl >= 1 && ttl <= 600) || !(concurrency >= 1 && concurrency <= 8))
    fail(400, 'validation_failed', 'invalid verification run or missing write/publication consent');
  const existing = state.runs.get(id);
  if (existing) return runView(a, existing);
  const policy = policyFor(a, 'default');
  if (policy.mode !== 'enforce' || body.review_digest !== digest(a, policy)) changed();
  const steps = plan(policy);
  if (steps.some((s) => s.action === 'queue-canary') && body.queue_publish !== true)
    fail(400, 'validation_failed', 'invalid verification run or missing write/publication consent');
  const unfinished = [...state.runs.values()].filter((r) => runView(a, r).status === 'pending');
  if (unfinished.length >= 8)
    fail(
      429,
      'binding_verification_run_limit',
      'Cancel an unfinished run or wait for its original deadline.'
    );
  const now = Date.now();
  const record = {
    id,
    app: a.slug,
    deployment_id: String(body.deployment_id),
    scope: 'default',
    status: 'pending' as const,
    created_at: iso(now),
    expires_at: iso(now + ttl * 1000),
    object_storage_write: body.object_storage_write === true,
    queue_publish: body.queue_publish === true,
    review_digest: String(body.review_digest),
    max_concurrency: concurrency,
    policy,
    inventory: { app: a.slug, generated_at: iso(now), complete: true, bindings: [] },
    steps: steps.map(frozen),
    admittedAt: {},
  };
  state.runs.set(id, record);
  return runView(a, record);
}

export function admitRunStep(a: MockApp, id: string, index: number): Step {
  const { r, view } = activeRun(a, id);
  const step =
    r.steps[index] ??
    fail(400, 'validation_failed', 'invalid verification run or missing write/publication consent');
  if (step.resource_id) return view.steps[index];
  if (step.plan.action !== 'probe' && step.plan.action !== 'queue-canary') changed();
  const active = view.steps.filter(
    (s) =>
      s.owned &&
      s.resource_id &&
      !['succeeded', 'failed', 'cancelled', 'missing', 'timed_out'].includes(s.status)
  ).length;
  const limit = r.max_concurrency ?? 2;
  if (active >= limit)
    fail(
      429,
      'binding_verification_budget_full',
      'Observe the original run and retry admission after unfinished resources settle.'
    );
  const now = Date.now();
  if (step.plan.action === 'queue-canary') {
    const canary = publishCanary(
      a,
      r.deployment_id,
      step.plan.binding,
      Math.floor((Date.parse(r.expires_at) - now) / 1000)
    );
    r.steps[index] = {
      ...step,
      resource_id: canary.id,
      resource_kind: 'queue',
      owned: true,
      status: 'published',
    };
  } else {
    r.steps[index] = {
      ...step,
      resource_id: randomUUID(),
      resource_kind: 'task',
      owned: true,
      status: 'queued',
    };
  }
  r.admittedAt[index] = now;
  return runView(a, r).steps[index];
}

export function resumeRun(a: MockApp, id: string) {
  return activeRun(a, id).view;
}

export function completeRun(a: MockApp, id: string) {
  const { r, view } = activeRun(a, id);
  for (const step of view.steps) {
    if (
      (step.plan.action === 'probe' || step.plan.action === 'queue-canary') &&
      (!step.resource_id || !step.owned)
    )
      fail(409, 'binding_verification_run_changed', 'reviewed step has no owned admission');
    if (step.owned && step.status !== 'succeeded')
      fail(409, 'binding_verification_run_changed', 'owned resource did not succeed');
  }
  r.status = 'passed';
  return runView(a, r);
}

export function cancelRun(a: MockApp, id: string) {
  const r = storedRun(a, id);
  r.status = 'cancelled';
  r.reason = 'cancelled';
  for (const step of r.steps)
    if (step.resource_kind === 'queue' && step.owned && step.resource_id) {
      const c = stateFor(a).canaries.get(step.resource_id);
      if (c && ['published', 'dispatching'].includes(canaryView(c).status)) c.cancelled = true;
    }
  return runView(a, r);
}

export function runDiagnostics(a: MockApp, id: string): S['BindingVerificationRunDiagnostics'] {
  const r = storedRun(a, id);
  const view = runView(a, r);
  const blockers: S['BindingVerificationDiagnosticBlocker'][] = [];
  view.steps.forEach((step, index) => {
    const admittable = step.plan.action === 'probe' || step.plan.action === 'queue-canary';
    if (admittable && !step.resource_id)
      blockers.push({
        code: step.plan.action === 'probe' ? 'verification_unknown' : 'queue_completion_unverified',
        message: `${step.plan.name} has no current evidence; its step has not been admitted.`,
        recovery: 'resume',
        step_index: index,
        type: step.plan.type,
        name: step.plan.name,
      });
    else if (step.owned && step.status !== 'succeeded')
      blockers.push({
        code: 'resource_unfinished',
        message: `${step.plan.name}: the admitted ${step.resource_kind} is ${step.status}.`,
        recovery: 'wait',
        step_index: index,
        resource_id: step.resource_id,
        resource_kind: step.resource_kind,
        status: step.status,
      });
  });
  const current = policyFor(a, r.scope);
  const changes =
    current.revision !== r.policy.revision
      ? [
          {
            field: 'policy_revision',
            reviewed: String(r.policy.revision),
            current: String(current.revision),
          },
        ]
      : [];
  const active = view.steps.filter(
    (s) =>
      s.owned &&
      s.resource_id &&
      !['succeeded', 'failed', 'cancelled', 'missing'].includes(s.status)
  ).length;
  const waiting = view.steps.filter(
    (s) => (s.plan.action === 'probe' || s.plan.action === 'queue-canary') && !s.resource_id
  ).length;
  const max = r.max_concurrency ?? 2;
  const recovery: S['BindingVerificationRecoveryAction'][] =
    view.status === 'pending'
      ? [
          {
            action: 'resume',
            message: 'Continue the original run: admit the waiting steps, then complete it.',
          },
        ]
      : view.status === 'passed'
        ? []
        : [{ action: 'review_new_run', message: 'This run can no longer pass. Review a new run.' }];
  return {
    run_id: r.id,
    app: a.slug,
    deployment_id: r.deployment_id,
    scope: r.scope,
    status: view.status,
    checked_at: new Date().toISOString(),
    expires_at: r.expires_at,
    complete: true,
    check_passed: blockers.length === 0 && changes.length === 0,
    blockers,
    changes,
    recovery,
    budget: {
      run_id: r.id,
      max_concurrency: max,
      active_resources: active,
      waiting_steps: waiting,
      full: active >= max,
    },
  };
}

// --- Queue canaries ---------------------------------------------------------

function publishCanary(a: MockApp, deployment: string, binding: string, ttl: number): Canary {
  const state = stateFor(a);
  for (const c of state.canaries.values())
    if (c.binding === binding && ['published', 'dispatching'].includes(canaryView(c).status))
      fail(
        409,
        'queue_canary_changed',
        'Another canary is active or the consumer changed. Cancel the previous canary and verify the selected push consumer.'
      );
  const now = Date.now();
  const canary = {
    id: randomUUID(),
    binding,
    deployment_id: deployment,
    scope: 'default',
    status: 'published' as const,
    published_at: iso(now),
    expires_at: iso(now + ttl * 1000),
    at: now,
  };
  state.canaries.set(canary.id, canary);
  return canaryView(canary);
}

const QUEUES = [
  { name: 'orders', access: 'push', supported: true },
  { name: 'emails', access: 'push', supported: false, reason: 'queue_handler_unsupported' },
];

/** Queue rows for the seeded app's binding inventory, with the latest canary. */
export function queueInventoryItems(a: MockApp): Item[] {
  if (a.slug !== SEEDED) return [];
  const canaries = [...stateFor(a).canaries.values()].sort((x, y) =>
    y.published_at.localeCompare(x.published_at)
  );
  return QUEUES.map((q) => {
    const latest = canaries.find((c) => c.binding === q.name);
    return {
      type: 'queue',
      name: q.name,
      binding: q.name,
      scope: 'default',
      queue_environment: 'default',
      access: q.access,
      state: 'enabled',
      runtime_status: 'healthy',
      verification_status:
        latest && canaryView(latest).status === 'succeeded' ? 'passed' : 'unknown',
      queue_canary_supported: q.supported,
      ...(q.reason ? { queue_canary_reason: q.reason } : {}),
      ...(latest ? { queue_canary: canaryView(latest) } : {}),
    };
  });
}

export function createQueueCanaryMock(
  a: MockApp,
  liveDeployment: string | undefined,
  body: Record<string, unknown>
) {
  const ttl = Number(body.ttl_seconds);
  const binding = String(body.binding ?? '');
  const queue = QUEUES.find((q) => q.name === binding);
  if (
    body.publish_consent !== true ||
    !(ttl >= 1 && ttl <= 600) ||
    body.deployment_id !== liveDeployment ||
    !queue ||
    !queue.supported ||
    a.slug !== SEEDED
  )
    fail(
      400,
      'validation_failed',
      'Supply an exact deployment, binding, publication consent and 1–600 second TTL. The deployment must declare this binding in GREGALE_QUEUE_CANARY_BINDINGS as a JSON array in override_env or its frozen reviewed variables.'
    );
  return publishCanary(a, String(body.deployment_id), binding, ttl);
}

export function getQueueCanaryMock(a: MockApp, id: string) {
  const c =
    stateFor(a).canaries.get(id) ??
    fail(404, 'not_found', 'Queue canary or eligible deployment/consumer not found.');
  return canaryView(c);
}

export function cancelQueueCanaryMock(a: MockApp, id: string) {
  const c =
    stateFor(a).canaries.get(id) ??
    fail(404, 'not_found', 'Queue canary or eligible deployment/consumer not found.');
  if (['published', 'dispatching'].includes(canaryView(c).status)) c.cancelled = true;
  return canaryView(c);
}
