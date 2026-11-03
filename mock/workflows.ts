import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { components } from '../src/lib/api/schema';
import * as db from './data';
import { runs, steps } from './automations';

/**
 * Dev-mock answers for App › Automate › Workflows: durable workflow runs and
 * their controls (faas handlers_workflows.go, handlers_workflow_resume.go,
 * handlers_workflow_diagnostics.go, handlers_workflow_queued_cancel.go).
 *
 * Runs share the automations mock's store, so the run list, run read, steps
 * and attempts routes in plugin.ts answer for both. Every app gets one run in
 * each state the page has to show: waiting on an event (a code-first run),
 * waiting on a callback, failed and resumable with a retryable step, dead and
 * blocked, queued (twice, for the bulk cancel), running and succeeded. A
 * resumed, retried, signalled or started run walks pending → running →
 * succeeded over ~6 s, computed from its age on each read like
 * deploy-lifecycle.ts; seeded runs never move on their own.
 */

type S = components['schemas'];
type Run = S['WorkflowRunResponse'];
type Step = S['WorkflowStepResponse'];
type DiagStep = S['WorkflowDiagnosticStep'];
interface MockCtx {
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  req: IncomingMessage;
}
type ProblemCtor = new (status: number, code: string, detail?: string) => Error;

const iso = (ms: number) => new Date(ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;

/** Per-run facts the API derives from the captured definition and the planner. */
interface RunMeta {
  kinds: Record<string, DiagStep['kind']>;
  /** The step a `wait_for_event` (or SDK waitForEvent) is parked on, and its event. */
  waiting?: { step: string; event: string };
  callbacks: { id: string; step_name: string; expires_at?: string; payload?: string }[];
  resume?: { eligible: boolean; reopened: string[]; blockers: S['WorkflowDiagnosticBlocker'][] };
  retryable?: Record<string, string[]>;
  resumes: S['WorkflowResumeResponse'][];
  /** Set by a write; the run then advances by age. */
  movedAt?: number;
  code?: boolean;
}
export const meta = new Map<string, RunMeta>();
/** Workflow names each app's live deployment declares, so a manual start resolves. */
export const declared = new Map<string, Set<string>>();

function step(name: string, status: Step['status'], at: number, extra: Partial<Step> = {}): Step {
  const done = ['succeeded', 'failed', 'dead', 'skipped'].includes(status);
  return {
    step_name: name,
    status,
    attempt: status === 'pending' || status === 'skipped' ? 0 : 1,
    created_at: iso(at),
    started_at: status === 'pending' || status === 'skipped' ? null : iso(at),
    finished_at: done && status !== 'skipped' ? iso(at + 4_000) : null,
    input: {},
    ...extra,
  };
}

function seed(app: (typeof db.apps)[number]) {
  const now = db.NOW;
  const base = (
    name: string,
    status: Run['status'],
    at: number,
    extra: Partial<Run> = {}
  ): Run => ({
    id: randomUUID(),
    app_id: app.id,
    workflow_name: name,
    status,
    created_at: iso(at),
    updated_at: iso(at + MIN),
    scheduled_for: iso(at),
    started_at: status === 'pending' ? null : iso(at + 1_000),
    finished_at: ['succeeded', 'failed', 'dead'].includes(status) ? iso(at + 2 * MIN) : null,
    deployment_id: randomUUID(),
    resume_count: 0,
    input: { order_id: 'ord_1042' },
    ...extra,
  });
  const out: { run: Run; steps: Step[]; meta: RunMeta }[] = [];

  // Code-first, parked on waitForEvent('refund_approval', { event: 'approved' }).
  const waiting = base('order_followup', 'awaiting_event', now - 3 * HOUR, {
    current_step: 'refund_approval',
  });
  out.push({
    run: waiting,
    steps: [
      step('$driver', 'succeeded', now - 3 * HOUR),
      step('charge', 'succeeded', now - 3 * HOUR),
      step('delivery_delay', 'succeeded', now - 3 * HOUR, { finished_at: iso(now - HOUR) }),
      step('check_delivery', 'succeeded', now - HOUR),
      step('refund_approval', 'awaiting_event', now - HOUR),
    ],
    meta: {
      code: true,
      kinds: {
        $driver: 'action',
        charge: 'action',
        delivery_delay: 'timer',
        check_delivery: 'action',
        refund_approval: 'event',
      },
      waiting: { step: 'refund_approval', event: 'approved' },
      callbacks: [],
      resumes: [],
    },
  });

  // YAML, parked on a callback a reviewer completes.
  const review = base('kyc-review', 'awaiting_event', now - 5 * HOUR, {
    current_step: 'manual_review',
    input: { customer: 'cus_77' },
  });
  out.push({
    run: review,
    steps: [
      step('collect', 'succeeded', now - 5 * HOUR),
      step('manual_review', 'awaiting_event', now - 5 * HOUR),
      step('activate', 'pending', now - 5 * HOUR),
    ],
    meta: {
      kinds: { collect: 'action', manual_review: 'callback', activate: 'action' },
      callbacks: [
        { id: randomUUID(), step_name: 'manual_review', expires_at: iso(now + 43 * HOUR) },
      ],
      resumes: [],
    },
  });

  // YAML, failed at `push`: resumable, and `push` alone is retryable.
  const failed = base('invoice-sync', 'failed', now - 2 * HOUR, {
    current_step: 'push',
    last_error: 'step push failed after 3 attempts: HTTP 502 from POST /invoices/push',
  });
  out.push({
    run: failed,
    steps: [
      step('fetch', 'succeeded', now - 2 * HOUR),
      step('push', 'failed', now - 2 * HOUR, {
        attempt: 3,
        error: 'HTTP 502 from POST /invoices/push',
      }),
      step('notify', 'skipped', now - 2 * HOUR, { skip_reason: 'dependency_failed' }),
    ],
    meta: {
      kinds: { fetch: 'action', push: 'action', notify: 'action' },
      callbacks: [],
      resume: { eligible: true, reopened: ['push'], blockers: [] },
      retryable: { push: ['notify'] },
      resumes: [],
    },
  });

  // Dead after its failure handler ran: the planner refuses to resume it.
  const dead = base('invoice-sync', 'dead', now - 26 * HOUR, {
    current_step: 'push',
    last_error: 'step push exhausted retries; on_failure handler ran',
  });
  out.push({
    run: dead,
    steps: [
      step('fetch', 'succeeded', now - 26 * HOUR),
      step('push', 'dead', now - 26 * HOUR, { attempt: 3, error: 'HTTP 500' }),
      step('on_failure', 'succeeded', now - 26 * HOUR),
    ],
    meta: {
      kinds: { fetch: 'action', push: 'action', on_failure: 'action' },
      callbacks: [],
      resume: {
        eligible: false,
        reopened: [],
        blockers: [
          {
            code: 'handler_executed',
            message: 'A failure or timeout handler already ran for this run.',
          },
        ],
      },
      resumes: [],
    },
  });

  // Two queued runs that never started, for the bulk cancel.
  for (const offset of [2 * MIN, 4 * MIN]) {
    const queued = base('invoice-sync', 'pending', now - offset, {
      scheduled_for: iso(now - offset),
    });
    out.push({
      run: queued,
      steps: [],
      meta: {
        kinds: {},
        callbacks: [],
        resumes: [],
      },
    });
  }

  const running = base('nightly-report', 'running', now - 6 * MIN, { current_step: 'render' });
  out.push({
    run: running,
    steps: [step('gather', 'succeeded', now - 6 * MIN), step('render', 'running', now - 5 * MIN)],
    meta: { kinds: { gather: 'action', render: 'action' }, callbacks: [], resumes: [] },
  });

  const ok = base('nightly-report', 'succeeded', now - 30 * HOUR, { output: { pages: 12 } });
  out.push({
    run: ok,
    steps: [
      step('gather', 'succeeded', now - 30 * HOUR),
      step('render', 'succeeded', now - 30 * HOUR),
    ],
    meta: { kinds: { gather: 'action', render: 'action' }, callbacks: [], resumes: [] },
  });

  return out;
}

for (const app of db.apps) {
  declared.set(
    app.slug,
    new Set(['order_followup', 'kyc-review', 'invoice-sync', 'nightly-report'])
  );
  if (db.EMPTY) continue;
  const seeded = seed(app);
  const list = runs.get(app.slug) ?? [];
  for (const { run, steps: s, meta: m } of seeded) {
    list.push(run);
    steps.set(run.id, s);
    meta.set(run.id, m);
  }
  list.sort((a, b) => b.created_at.localeCompare(a.created_at));
  runs.set(app.slug, list);
}

export function findRun(id: string): Run | undefined {
  for (const list of runs.values()) {
    const run = list.find((r) => r.id === id);
    if (run) return run;
  }
  return undefined;
}

const terminal = (r: Run) => ['succeeded', 'failed', 'dead'].includes(r.status);

/** A run a write touched walks pending → running → succeeded by age. */
export function advance(run: Run): Run {
  const m = meta.get(run.id);
  if (!m?.movedAt) return run;
  const age = Date.now() - m.movedAt;
  const s = steps.get(run.id) ?? [];
  if (age >= 6_000) {
    run.status = 'succeeded';
    run.finished_at ??= iso(m.movedAt + 6_000);
    run.current_step = null;
    run.last_error = null;
    for (const st of s)
      if (st.status !== 'succeeded') {
        st.attempt += 1;
        st.status = 'succeeded';
        st.error = null;
        st.skip_reason = undefined;
        st.finished_at = iso(m.movedAt + 6_000);
      }
    m.movedAt = undefined;
    m.waiting = undefined;
    m.resume = undefined;
    m.retryable = undefined;
  } else if (age >= 2_000) {
    run.status = 'running';
    run.started_at ??= iso(m.movedAt + 2_000);
  }
  run.updated_at = new Date().toISOString();
  return run;
}

function stateReason(run: Run): S['WorkflowRunDiagnosticsResponse']['state_reason'] {
  if (run.cancelled_at) return 'cancelled';
  switch (run.status) {
    case 'pending':
      return 'ready';
    case 'awaiting_event':
      return 'parked_wait';
    default:
      return run.status;
  }
}

export function diagnostics(run: Run): S['WorkflowRunDiagnosticsResponse'] {
  const m = meta.get(run.id);
  const s = steps.get(run.id) ?? [];
  const failed = run.status === 'failed' || run.status === 'dead';
  const blockers: S['WorkflowDiagnosticBlocker'][] = [];
  if (!failed)
    blockers.push({ code: 'run_not_failed', message: 'Only failed or dead runs can be resumed.' });
  else if (run.cancelled_at)
    blockers.push({ code: 'cancelled', message: 'The run was cancelled.' });
  else if (m?.code)
    blockers.push({
      code: 'code_workflow',
      message: 'Code-first runs cannot be resumed; start a new run.',
    });
  else if (m?.resume && !m.resume.eligible) blockers.push(...m.resume.blockers);
  else if (!m?.resume)
    blockers.push({
      code: 'no_failed_actions',
      message: 'The run has no failed actions to reopen.',
    });
  const eligible = blockers.length === 0;
  const reopened = eligible ? (m?.resume?.reopened ?? []) : [];
  return {
    run_id: run.id,
    workflow_name: run.workflow_name,
    status: run.status,
    observed_at: new Date().toISOString(),
    deployment_id: run.deployment_id,
    legacy_unpinned: !run.deployment_id,
    state_reason: stateReason(run),
    due_age_seconds:
      run.status === 'pending' ? (Date.now() - Date.parse(run.scheduled_for)) / 1000 : 0,
    stale_lease: false,
    steps: s
      .map((st) => {
        const retry = failed && !run.cancelled_at ? m?.retryable?.[st.step_name] : undefined;
        return {
          step_name: st.step_name,
          status: st.status,
          kind: m?.kinds[st.step_name] ?? 'unknown',
          attempt: st.attempt,
          retry_base: st.retry_base ?? 0,
          ...(retry ? { retry_eligible: true } : {}),
          ...(retry?.length ? { retry_reopened_steps: retry } : {}),
        };
      })
      .sort((a, b) => a.step_name.localeCompare(b.step_name)),
    resume: {
      eligible,
      expected_resume_count: run.resume_count ?? 0,
      reopened_steps: reopened,
      preserved_steps: s
        .filter((st) => !reopened.includes(st.step_name))
        .map((st) => st.step_name)
        .sort(),
      blockers,
    },
  };
}

function header(req: IncomingMessage, name: string): string {
  const value = req.headers[name];
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

/**
 * Handlers for plugin.ts to register at top level, so the spec-drift test sees
 * every path these answer.
 */
export function workflowHandlers(Problem: ProblemCtor) {
  const owned = (id: string) => {
    const run = findRun(id);
    if (!run)
      throw new Problem(404, 'workflow_run_not_found', 'the requested workflow run was not found.');
    return advance(run);
  };
  const eventKeys = new Set<string>();

  const classify = (slug: string, ids: string[]): S['WorkflowQueuedRunCancelOutcome'][] =>
    ids.map((id) => {
      const run = findRun(id);
      if (!run || !(runs.get(slug) ?? []).includes(run))
        return { run_id: id, outcome: 'not_found' };
      const facts = {
        run_id: id,
        workflow_name: run.workflow_name,
        status: run.status,
        created_at: run.created_at,
        scheduled_for: run.scheduled_for,
        ...(run.started_at ? { started_at: run.started_at } : {}),
        ...(run.cancelled_at ? { cancelled_at: run.cancelled_at } : {}),
      };
      if (run.cancelled_at) return { ...facts, outcome: 'already_cancelled' };
      if (run.started_at) return { ...facts, outcome: 'already_started' };
      if (run.status !== 'pending') return { ...facts, outcome: 'not_queued' };
      return { ...facts, outcome: 'eligible' };
    });
  const selection = (body: unknown) => {
    const ids = (body as { run_ids?: unknown } | undefined)?.run_ids;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 20)
      throw new Problem(400, 'validation_failed', 'run_ids must contain 1 to 20 run IDs');
    return ids.map(String);
  };

  return {
    run: ({ params }: MockCtx) => owned(params.id),

    diagnostics: ({ params }: MockCtx) => diagnostics(owned(params.id)),

    resumes: ({ params }: MockCtx) => ({ resumes: meta.get(owned(params.id).id)?.resumes ?? [] }),

    callbacks: ({ params }: MockCtx) => ({
      callbacks: (meta.get(owned(params.id).id)?.callbacks ?? []).map(
        ({ payload: _p, ...cb }) => cb
      ),
    }),

    completeCallback: ({ params, body }: MockCtx) => {
      const run = owned(params.id);
      const m = meta.get(run.id);
      const cb = m?.callbacks.find((c) => c.id === params.callback_id);
      if (!m || !cb)
        throw new Problem(
          404,
          'workflow_step_not_found',
          'the requested workflow step was not found.'
        );
      const payload = JSON.stringify(body ?? null);
      if (cb.payload !== undefined) {
        if (cb.payload === payload) return { status: 'received', duplicate: true };
        throw new Problem(
          409,
          'workflow_callback_payload_conflict',
          'this callback was already completed with a different payload.'
        );
      }
      if (terminal(run))
        throw new Problem(
          409,
          'workflow_callback_closed',
          'the callback step or its workflow run is terminal.'
        );
      if (cb.expires_at && Date.parse(cb.expires_at) < Date.now())
        throw new Problem(
          410,
          'workflow_callback_expired',
          'the callback wait deadline has elapsed.'
        );
      cb.payload = payload;
      const st = steps.get(run.id)?.find((x) => x.step_name === cb.step_name);
      if (st) {
        st.status = 'succeeded';
        st.output = body ?? null;
        st.finished_at = new Date().toISOString();
      }
      run.status = 'pending';
      m.movedAt = Date.now();
      return { status: 'received', duplicate: false };
    },

    event: ({ params, body, req }: MockCtx) => {
      const run = owned(params.id);
      const b = (body ?? {}) as { event_name?: string; payload?: unknown };
      if (!b.event_name) throw new Problem(400, 'validation_failed', 'event_name is required');
      if (terminal(run))
        throw new Problem(
          409,
          'workflow_not_running',
          'the workflow run is not in running or awaiting_event status.'
        );
      const key = `${run.id}/${header(req, 'idempotency-key')}`;
      if (!eventKeys.has(key)) {
        eventKeys.add(key);
        const m = meta.get(run.id);
        if (m?.waiting && m.waiting.event === b.event_name) {
          const st = steps.get(run.id)?.find((x) => x.step_name === m.waiting?.step);
          if (st) {
            st.status = 'succeeded';
            st.output = b.payload ?? null;
            st.finished_at = new Date().toISOString();
          }
          run.status = 'pending';
          m.movedAt = Date.now();
        }
      }
      return { status: 'received', event_name: b.event_name };
    },

    cancel: ({ params }: MockCtx) => {
      const run = owned(params.id);
      if (terminal(run)) return run;
      const now = new Date().toISOString();
      run.status = 'failed';
      run.cancelled_at = now;
      run.finished_at = now;
      run.last_error = 'cancelled by operator';
      for (const st of steps.get(run.id) ?? [])
        if (['pending', 'running', 'awaiting_event'].includes(st.status)) st.status = 'skipped';
      const m = meta.get(run.id);
      if (m) m.movedAt = undefined;
      return run;
    },

    resume: ({ params, body }: MockCtx) => {
      const run = owned(params.id);
      const expected = (body as { expected_resume_count?: number } | undefined)
        ?.expected_resume_count;
      if (typeof expected !== 'number')
        throw new Problem(400, 'validation_failed', 'request must contain expected_resume_count');
      if (
        !(run.status === 'failed' || run.status === 'dead') ||
        expected !== (run.resume_count ?? 0)
      )
        throw new Problem(
          409,
          'workflow_resume_conflict',
          'run must be failed or dead and expected_resume_count must match the current run'
        );
      const d = diagnostics(run);
      if (!d.resume.eligible)
        throw new Problem(
          409,
          'workflow_resume_unsafe',
          'run has no replayable failed actions, was cancelled, has active waits or calls, or has executed a failure or timeout handler'
        );
      const m = meta.get(run.id)!;
      const count = (run.resume_count ?? 0) + 1;
      m.resumes.push({
        run_id: run.id,
        resume_number: count,
        account_id: db.account.id,
        previous_status: run.status as 'failed' | 'dead',
        previous_error: run.last_error ?? undefined,
        resumed_steps: d.resume.reopened_steps,
        created_at: new Date().toISOString(),
      });
      for (const st of steps.get(run.id) ?? [])
        if (d.resume.reopened_steps.includes(st.step_name)) {
          st.status = 'pending';
          st.retry_base = st.attempt;
        }
      run.status = 'pending';
      run.resume_count = count;
      run.finished_at = null;
      m.movedAt = Date.now();
      return run;
    },

    retryStep: ({ params }: MockCtx) => {
      const run = owned(params.id);
      const m = meta.get(run.id);
      const reopen = m?.retryable?.[params.step];
      if (!m || !reopen || !(run.status === 'failed' || run.status === 'dead') || run.cancelled_at)
        throw new Problem(
          409,
          'workflow_step_retry_not_allowed',
          'retry requires a terminal failed or dead HTTP step with no other active, failed, or dead steps and no completed downstream work.'
        );
      for (const st of steps.get(run.id) ?? [])
        if (st.step_name === params.step || reopen.includes(st.step_name)) {
          st.status = 'pending';
          st.skip_reason = undefined;
        }
      run.status = 'pending';
      run.finished_at = null;
      m.movedAt = Date.now();
      return run;
    },

    cancelPreview: ({ params, body }: MockCtx) => ({
      outcomes: classify(params.slug, selection(body)),
    }),

    cancelQueued: ({ params, body }: MockCtx) => ({
      outcomes: classify(params.slug, selection(body)).map((o) => {
        if (o.outcome !== 'eligible') return o;
        const run = findRun(o.run_id)!;
        const now = new Date().toISOString();
        run.status = 'failed';
        run.cancelled_at = now;
        run.finished_at = now;
        run.last_error = 'cancelled before start';
        return {
          ...o,
          outcome: 'cancelled' as const,
          status: 'failed' as const,
          cancelled_at: now,
        };
      }),
    }),
  };
}

/** A manual start of a declared workflow: a fresh run that walks to succeeded. */
export function startDeclaredRun(
  slug: string,
  appId: string,
  name: string,
  input: unknown
): Run | undefined {
  if (!declared.get(slug)?.has(name)) return undefined;
  const now = new Date().toISOString();
  const run: Run = {
    id: randomUUID(),
    app_id: appId,
    workflow_name: name,
    status: 'pending',
    created_at: now,
    updated_at: now,
    scheduled_for: now,
    deployment_id: randomUUID(),
    resume_count: 0,
    input,
  };
  const list = runs.get(slug) ?? [];
  list.unshift(run);
  runs.set(slug, list);
  steps.set(run.id, [step('main', 'pending', Date.now())]);
  meta.set(run.id, { kinds: { main: 'action' }, callbacks: [], resumes: [], movedAt: Date.now() });
  return run;
}
