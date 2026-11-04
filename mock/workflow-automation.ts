import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { components } from '../src/lib/api/schema';
import * as db from './data';
import { runs } from './automations';
import { startDeclaredRun } from './workflows';

/**
 * Dev-mock answers for App › Automate › Workflow schedules and Recovery
 * policy (faas handlers_workflow_schedules.go, _schedule_preview.go,
 * _schedule_history.go, _schedule_replay.go; appevents/workflow_recovery_policy.go).
 *
 * Every app deploys two schedules: `invoice-sync` every 15 minutes in UTC
 * (overlap skip, missed fires skipped) and `nightly-report` at 02:00
 * Istanbul (catch up the latest within 6 h). Its fire history has two skipped
 * minutes — one replayable, one from before the last deploy — one already
 * replayed, and enough older started minutes to need a second page.
 *
 * Recovery policies: api-gateway retries saved failures automatically,
 * webhook-router's automatic retries are paused, every other app has none.
 * Writes are version-fenced like apid's and answer 409 `conflict` when stale.
 */

type S = components['schemas'];
interface MockCtx {
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  req: IncomingMessage;
}
type ProblemCtor = new (status: number, code: string, detail?: string) => Error;

const MIN = 60_000;
const HOUR = 60 * MIN;
const iso = (ms: number) => new Date(ms).toISOString();
const LIVE_DEPLOYMENT = new Map<string, string>();

/** Next instant at a multiple of `step` ms after `from`. */
const nextMultiple = (from: number, step: number) => Math.floor(from / step) * step + step;

function schedulesFor(slug: string): S['WorkflowScheduleResponse'][] {
  const deployment = LIVE_DEPLOYMENT.get(slug)!;
  const now = Date.now();
  const nightlyRun = (runs.get(slug) ?? []).find(
    (r) => r.workflow_name === 'nightly-report' && r.status === 'succeeded'
  );
  // 02:00 in Istanbul (UTC+3) is 23:00 UTC.
  const nightly = nextMultiple(now - 23 * HOUR, 24 * HOUR) + 23 * HOUR;
  return [
    {
      workflow_name: 'invoice-sync',
      deployment_id: deployment,
      schedule: '*/15 * * * *',
      timezone: 'UTC',
      overlap: 'skip',
      catch_up: 'skip',
      enabled: true,
      next_fire_at: iso(nextMultiple(now, 15 * MIN)),
      last_evaluated_at: iso(nextMultiple(now, 15 * MIN) - 15 * MIN),
      last_scheduled_for: iso(nextMultiple(now, 15 * MIN) - 15 * MIN),
      last_status: 'skipped_overlap',
    },
    {
      workflow_name: 'nightly-report',
      deployment_id: deployment,
      schedule: '0 2 * * *',
      timezone: 'Europe/Istanbul',
      overlap: 'skip',
      catch_up: 'latest',
      catch_up_window: '6h0m0s',
      enabled: true,
      next_fire_at: iso(nightly),
      last_evaluated_at: iso(nightly - 24 * HOUR),
      last_scheduled_for: iso(nightly - 24 * HOUR),
      last_status: 'started',
      ...(nightlyRun ? { last_run_id: nightlyRun.id } : {}),
    },
  ];
}

const occurrences = new Map<string, S['WorkflowScheduleOccurrenceResponse'][]>();

function seedOccurrences(app: (typeof db.apps)[number]) {
  const deployment = LIVE_DEPLOYMENT.get(app.slug)!;
  const list = runs.get(app.slug) ?? [];
  const runOf = (name: string, status: string) =>
    list.find((r) => r.workflow_name === name && r.status === status)?.id;
  const quarter = nextMultiple(Date.now(), 15 * MIN) - 15 * MIN;
  const at = (ms: number) => ({ scheduled_for: iso(ms), evaluated_at: iso(ms + 900) });
  const base = (name: string, ms: number, deploymentId = deployment) => ({
    id: randomUUID(),
    app_id: app.id,
    workflow_name: name,
    deployment_id: deploymentId,
    ...at(ms),
  });
  const out: S['WorkflowScheduleOccurrenceResponse'][] = [
    { ...base('invoice-sync', quarter), status: 'skipped_overlap' },
    // From before the last deploy: replay refuses it as deployment_changed.
    { ...base('invoice-sync', quarter - 15 * MIN, randomUUID()), status: 'skipped_quota' },
    {
      ...base('invoice-sync', quarter - 30 * MIN),
      status: 'skipped_overlap',
      replay_run_id: runOf('invoice-sync', 'failed'),
      replayed_at: iso(quarter - 20 * MIN),
    },
    {
      ...base('invoice-sync', quarter - 2 * HOUR),
      status: 'started',
      run_id: runOf('invoice-sync', 'failed'),
    },
  ];
  // Older started minutes whose runs have expired; enough for a second page.
  for (let i = 0; i < 60; i++)
    out.push({
      ...base('invoice-sync', quarter - 3 * HOUR - i * 15 * MIN),
      status: 'started',
      run_id: randomUUID(),
    });
  const nightly = runOf('nightly-report', 'succeeded');
  out.push({
    ...base('nightly-report', Date.now() - 30 * HOUR),
    status: 'started',
    ...(nightly ? { run_id: nightly } : {}),
  });
  out.sort((a, b) => b.scheduled_for.localeCompare(a.scheduled_for));
  occurrences.set(app.slug, db.EMPTY ? [] : out);
}

/* --- Recovery policy -------------------------------------------------------- */

const policies = new Map<string, S['WorkflowRecoveryPolicyResponse']>();

function seedPolicy(app: (typeof db.apps)[number]) {
  const updated = iso(db.NOW - 2 * 86_400_000);
  const automatic: S['WorkflowRecoveryPolicy'] = {
    enabled: true,
    mode: 'automatic_retry',
    workflow_names: ['invoice-sync'],
    triggers: ['saved_failure'],
    failure_statuses: ['failed', 'dead'],
    max_resume_count: 3,
    cooldown_seconds: 300,
    hourly_action_budget: 10,
    hourly_execution_budget: 3,
    pause_after_failures: 2,
    rate_per_second: 1,
    reason: 'Retry invoice pushes after provider blips',
  };
  const empty: S['WorkflowRecoveryPolicy'] = {
    enabled: false,
    mode: 'preview',
    workflow_names: [],
    triggers: [],
    failure_statuses: [],
    max_resume_count: 0,
    cooldown_seconds: 0,
    hourly_action_budget: 0,
    rate_per_second: 0,
    reason: '',
  };
  const base = { app_id: app.id, actor_kind: 'account', actor_id: db.account.id };
  if (!db.EMPTY && app.slug === 'api-gateway')
    policies.set(app.slug, {
      ...base,
      version: 2,
      policy: automatic,
      updated_at: updated,
      last_evaluation_at: iso(Date.now() - 40_000),
      status: 'monitoring',
      automatic_execution: { consecutive_failures: 0, pause_reason: '' },
    });
  else if (!db.EMPTY && app.slug === 'webhook-router')
    policies.set(app.slug, {
      ...base,
      version: 4,
      policy: { ...automatic, workflow_names: ['invoice-sync', 'kyc-review'] },
      updated_at: updated,
      last_evaluation_at: iso(Date.now() - 50_000),
      status: 'paused',
      automatic_execution: {
        consecutive_failures: 2,
        paused_at: iso(db.NOW - 3 * HOUR),
        pause_reason: 'paused after 2 consecutive failed automatic retries',
      },
    });
  else
    policies.set(app.slug, {
      ...base,
      version: 0,
      policy: empty,
      updated_at: iso(0),
      status: 'disabled',
    });
}

for (const app of db.apps) {
  LIVE_DEPLOYMENT.set(app.slug, randomUUID());
  seedOccurrences(app);
  seedPolicy(app);
}

const automatic = (mode: string) => mode === 'automatic_retry' || mode === 'automatic_initial';

function queue(slug: string): S['WorkflowRecoveryAutomaticQueue'] {
  const policy = policies.get(slug)!;
  const auto = policy.policy.enabled && automatic(policy.policy.mode);
  const budget = policy.policy.hourly_execution_budget ?? 0;
  return {
    policy,
    observed_at: new Date().toISOString(),
    pending: auto ? 1 : 0,
    outstanding: 0,
    hourly_executions: auto ? 1 : 0,
    remaining_budget: auto ? Math.max(0, budget - 1) : 0,
    entries: [],
    truncated: false,
  };
}

export function workflowAutomationHandlers(Problem: ProblemCtor) {
  const app = (slug: string) => {
    const found = db.appBySlug(slug);
    if (!found) throw new Problem(404, 'app_not_found', 'app not found');
    return found;
  };
  const selection = (body: unknown) => {
    const ids = (body as { occurrence_ids?: unknown } | undefined)?.occurrence_ids;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 20)
      throw new Problem(400, 'validation_failed', 'occurrence_ids must contain 1 to 20 UUIDs');
    return ids.map(String);
  };
  const classify = (slug: string, id: string): S['WorkflowScheduleReplayOutcome'] => {
    const o = occurrences.get(slug)?.find((x) => x.id === id);
    if (!o) return { occurrence_id: id, outcome: 'occurrence_not_found' };
    const facts = {
      occurrence_id: id,
      workflow_name: o.workflow_name,
      scheduled_for: o.scheduled_for,
    };
    if (o.replay_run_id)
      return { ...facts, outcome: 'already_replayed', replay_run_id: o.replay_run_id };
    if (o.status === 'started') return { ...facts, outcome: 'not_skipped' };
    if (o.deployment_id !== LIVE_DEPLOYMENT.get(slug))
      return { ...facts, outcome: 'deployment_changed' };
    return { ...facts, outcome: 'eligible' };
  };
  const policyOf = (slug: string) => {
    app(slug);
    return policies.get(slug)!;
  };
  const fence = (slug: string, expected: unknown) => {
    const current = policyOf(slug);
    if (expected !== current.version)
      throw new Problem(409, 'conflict', 'recovery policy version changed');
    return current;
  };
  const policyBody = (body: unknown) => {
    const b = body as S['SetWorkflowRecoveryPolicyRequest'] | undefined;
    const p = b?.policy;
    if (!p || !p.reason?.trim() || !p.workflow_names?.length || !p.triggers?.length)
      throw new Problem(400, 'validation_failed', 'invalid recovery policy filters or limits');
    return b;
  };

  return {
    schedules: ({ params }: MockCtx) => {
      app(params.slug);
      return {
        runtime_enabled: true,
        schedules: db.EMPTY ? [] : schedulesFor(params.slug),
      } satisfies S['ListWorkflowSchedulesResponse'];
    },

    schedulePreview: ({ params, query }: MockCtx) => {
      const schedule = schedulesFor(params.slug).find((s) => s.workflow_name === params.name);
      if (!schedule) throw new Problem(404, 'not_found', 'workflow schedule not found');
      const count = Number(query.get('count') ?? 5);
      const step = params.name === 'invoice-sync' ? 15 * MIN : 24 * HOUR;
      const first = Date.parse(schedule.next_fire_at!);
      const offset = schedule.timezone === 'UTC' ? 0 : 3 * HOUR;
      const local = (ms: number) =>
        `${new Date(ms + offset).toISOString().slice(0, 19)}${offset ? '+03:00' : 'Z'}`;
      return {
        workflow_name: schedule.workflow_name,
        deployment_id: schedule.deployment_id,
        schedule: schedule.schedule,
        timezone: schedule.timezone,
        overlap: schedule.overlap,
        enabled: schedule.enabled,
        observed_at: new Date().toISOString(),
        evaluation_at: new Date().toISOString(),
        dst_behavior:
          step === 15 * MIN
            ? {
                mode: 'interval',
                spring_gap: 'follow_cron_interval',
                fall_fold: 'repeat_as_clock_falls_back',
              }
            : {
                mode: 'fixed_wall_time',
                spring_gap: 'shift_to_first_valid_minute',
                fall_fold: 'run_once_at_first_occurrence',
              },
        upcoming: Array.from({ length: count }, (_, i) => ({
          scheduled_for: iso(first + i * step),
          local_time: local(first + i * step),
        })),
        catch_up: {
          policy: schedule.catch_up ?? 'skip',
          ...(schedule.catch_up_window ? { window: schedule.catch_up_window } : {}),
          outcome: 'no_new_evaluation',
          eligible_occurrences: 0,
          coalesced_occurrences: 0,
          missed_occurrences_not_recovered: false,
          missed_outside_window: false,
        },
      } satisfies S['WorkflowSchedulePreviewResponse'];
    },

    occurrences: ({ params, query }: MockCtx) => {
      app(params.slug);
      const list = occurrences.get(params.slug) ?? [];
      const limit = Number(query.get('limit') ?? 100);
      const cursor = query.get('cursor');
      const start = cursor ? list.findIndex((o) => o.id === cursor) + 1 : 0;
      if (cursor && start === 0) return { occurrences: [] };
      const page = list.slice(start, start + limit);
      return {
        occurrences: page,
        ...(start + limit < list.length ? { next_cursor: page[page.length - 1].id } : {}),
      };
    },

    replayPreview: ({ params, body }: MockCtx) => ({
      outcomes: selection(body).map((id) => classify(params.slug, id)),
    }),

    replay: ({ params, body }: MockCtx) => ({
      outcomes: selection(body).map((id) => {
        const outcome = classify(params.slug, id);
        if (outcome.outcome !== 'eligible') return outcome;
        const o = occurrences.get(params.slug)!.find((x) => x.id === id)!;
        const run = startDeclaredRun(params.slug, app(params.slug).id, o.workflow_name, {});
        if (!run) return { ...outcome, outcome: 'target_unavailable' as const };
        o.replay_run_id = run.id;
        o.replayed_at = new Date().toISOString();
        return { ...outcome, outcome: 'replayed' as const, replay_run_id: run.id };
      }),
    }),

    policy: ({ params }: MockCtx) => policyOf(params.slug),

    health: ({ params }: MockCtx) => {
      const policy = policyOf(params.slug);
      const status: S['WorkflowRecoveryPolicyHealth']['status'] =
        policy.status === 'paused' ? 'paused' : policy.policy.enabled ? 'healthy' : 'inactive';
      return {
        status,
        reason:
          status === 'paused'
            ? 'automatic_paused'
            : status === 'healthy'
              ? 'no_blocker_observed'
              : 'policy_disabled',
        stall_after_seconds: 900,
        queue: queue(params.slug),
        overview: {
          status: status === 'paused' ? 'paused' : status === 'healthy' ? 'healthy' : 'inactive',
          monitoring_status: 'no_observed_failure',
          observed_at: new Date().toISOString(),
          monitoring_only: true,
          manual_awaiting_approval: policy.version ? 1 : 0,
          manual_unresolved: 0,
          manual_polling_failures: 0,
          manual_attention: 0,
          truncated: false,
          issues: [],
        },
      } satisfies S['WorkflowRecoveryPolicyHealth'];
    },

    changePreview: ({ params, body }: MockCtx) => {
      const b = policyBody(body);
      const current = fence(params.slug, b.expected_version);
      const auto = b.policy.enabled && automatic(b.policy.mode);
      const wasAuto = current.policy.enabled && automatic(current.policy.mode);
      return {
        current,
        proposed: b.policy,
        observed_at: new Date().toISOString(),
        next_version: current.version + 1,
        pending_suppressed: wasAuto ? 1 : 0,
        outstanding_retained: 0,
        entries: [],
        entries_truncated: false,
        automatic_execution_enabled: auto,
        hourly_executions: wasAuto ? 1 : 0,
        remaining_execution_budget: auto
          ? Math.max(0, (b.policy.hourly_execution_budget ?? 0) - 1)
          : 0,
        hourly_prepared_actions: 1,
        remaining_preparation_budget: Math.max(0, b.policy.hourly_action_budget - 1),
        inspected_jobs: 2,
        jobs_truncated: false,
        candidates: [
          {
            job_id: randomUUID(),
            decision: {
              position: 1,
              run_id: randomUUID(),
              resume_count: 0,
              trigger: 'saved_failure',
              action: 'retry',
              outcome: b.policy.enabled ? 'would_prepare' : 'policy_disabled',
            },
          },
        ],
        candidates_truncated: false,
      } satisfies S['WorkflowRecoveryPolicyChangePreview'];
    },

    setPolicy: ({ params, body }: MockCtx) => {
      const b = policyBody(body);
      const current = fence(params.slug, b.expected_version);
      const next: S['WorkflowRecoveryPolicyResponse'] = {
        ...current,
        version: current.version + 1,
        policy: b.policy,
        updated_at: new Date().toISOString(),
        status: b.policy.enabled ? 'monitoring' : 'disabled',
        // A replacement clears the automatic pause and failure streak.
        automatic_execution: automatic(b.policy.mode)
          ? { consecutive_failures: 0, pause_reason: '' }
          : undefined,
      };
      policies.set(params.slug, next);
      return next;
    },

    control: ({ params, body }: MockCtx) => {
      const b = body as S['ControlWorkflowRecoveryPolicyRequest'] | undefined;
      if (!b?.reason?.trim() || !b.operation)
        throw new Problem(
          400,
          'validation_failed',
          'control requires observed version, update time, pause time, operation and reason'
        );
      const current = fence(params.slug, b.expected_version);
      if (
        b.expected_updated_at !== current.updated_at ||
        (b.expected_paused_at ?? undefined) !== current.automatic_execution?.paused_at
      )
        throw new Problem(409, 'conflict', 'recovery policy control state changed');
      const now = new Date().toISOString();
      const next: S['WorkflowRecoveryPolicyResponse'] =
        b.operation === 'pause'
          ? {
              ...current,
              updated_at: now,
              status: 'paused',
              automatic_execution: {
                consecutive_failures: current.automatic_execution?.consecutive_failures ?? 0,
                paused_at: now,
                pause_reason: b.reason,
              },
            }
          : {
              ...current,
              updated_at: now,
              status: 'monitoring',
              automatic_execution: { consecutive_failures: 0, pause_reason: '' },
            };
      policies.set(params.slug, next);
      return next;
    },
  };
}
