import { randomUUID } from 'node:crypto';
import type { components } from '../src/lib/api/schema';
import * as db from './data';
import * as channelMock from './notification-channels';

/**
 * Budgets (faas handlers_financial_budgets.go, handlers_financial_budget_channels.go,
 * billing/financial_budget_preview.go, financialbudgets/response.go).
 *
 * Seeded with an alerting account budget past its first threshold and
 * projected to overrun, a preview stop that has fired, and a strict app cap
 * kept as a draft. Strict caps are not released to the mock account, as the
 * `strict_budgets` flag is off by default: turning one on answers 422
 * `financial_budget_activation_unavailable`. `MOCK_STRICT_BUDGETS=1` releases
 * them. MOCK_EMPTY=1 starts with none.
 *
 * Spending is a fixed per-workload model, so a reload shows the same figures;
 * the projection scales it by how much of the UTC month has passed.
 */

type S = components['schemas'];
type Spec = S['FinancialBudgetSpec'];
type Budget = S['FinancialBudgetResponse'];
type Revision = S['FinancialBudgetRevisionResponse'];
type Target = S['FinancialBudgetTarget'];
type Evaluation = S['FinancialBudgetEvaluation'];

/** The workloads a scope can name, handed in by the plugin that owns them. */
export interface World {
  apps: {
    id: string;
    slug: string;
    project_id?: string;
    preview_of_slug?: string;
    workload_class?: string;
  }[];
  jobs: { id: string; name: string }[];
  projects: { id: string; slug: string }[];
  environments: () => { id: string; project_id: string; slug: string }[];
}

export class BudgetProblem extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    detail: string
  ) {
    super(detail);
  }
}

interface Stored {
  id: string;
  spec: Spec;
  revision: number;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
  revisions: Revision[];
  channels: string[];
}

const ACCOUNT_ID = db.account.id;
const ACTOR = `account:${ACCOUNT_ID}`;
const store: Stored[] = [];
const creationKeys = new Map<string, string>();
const released = () => process.env.MOCK_STRICT_BUDGETS === '1';
const invalid = (detail: string) => new BudgetProblem(400, 'validation_failed', detail);

function monthBounds(now = Date.now()) {
  const d = new Date(now);
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  return { start, end, elapsed: (now - start) / (end - start) };
}

// --- Spending model ----------------------------------------------------------

/** Gross compute this month, in millicents, per app (fixed per seed index). */
function appGross(world: World, appId: string): number {
  const index = world.apps.findIndex((app) => app.id === appId);
  return index < 0 ? 0 : 180_000 + index * 37_000;
}
const JOB_GROSS = 95_000;
const ALLOWANCE = 900_000;
const OBJECT_STORAGE = 210_000;

function members(world: World, scope: Spec['scope']) {
  const apps = world.apps.filter((app) => {
    if (scope.kind === 'account') return true;
    if (scope.kind === 'app') return app.id === scope.id;
    if (scope.kind === 'project') return app.project_id === scope.id;
    if (scope.kind === 'environment') {
      const env = world.environments().find((e) => e.id === scope.id);
      return Boolean(env && app.project_id === env.project_id);
    }
    return false;
  });
  const jobs =
    scope.kind === 'account'
      ? world.jobs
      : scope.kind === 'job'
        ? world.jobs.filter((job) => job.id === scope.id)
        : [];
  return { apps, jobs };
}

function known(world: World, spec: Spec): { amount: number; complete: boolean; reasons: string[] } {
  const { apps, jobs } = members(world, spec.scope);
  let gross = apps.reduce((sum, app) => sum + appGross(world, app.id), 0) + jobs.length * JOB_GROSS;
  // An environment cap counts its share of the project; capacity floors carry
  // no environment, so its coverage is partial (budget.go AttributionKnown).
  const environment = spec.scope.kind === 'environment';
  if (environment) gross = Math.round(gross * 0.4);
  let amount =
    spec.basis === 'net_usage' && spec.scope.kind === 'account' ? gross - ALLOWANCE : gross;
  if (spec.basis === 'net_usage' && spec.scope.kind !== 'account')
    amount = Math.round(gross * 0.35);
  if (spec.meters.includes('egress')) amount += Math.round(gross * 0.12);
  if (spec.meters.includes('object_storage')) amount += OBJECT_STORAGE;
  return {
    amount: Math.max(0, amount),
    complete: !environment,
    reasons: environment ? ['compute:missing_scope_attribution'] : [],
  };
}

function evaluate(world: World, spec: Spec, now = Date.now()): Evaluation {
  const { start, end, elapsed } = monthBounds(now);
  const k = known(world, spec);
  const day = new Date(now).getUTCDate();
  return {
    period_start: new Date(start).toISOString(),
    period_end: new Date(end).toISOString(),
    as_of: new Date(now - 90_000).toISOString(),
    evaluated_at: new Date(now - 30_000).toISOString(),
    evidence_through_id: 4182,
    known_millicents: k.amount,
    coverage_complete: k.complete,
    fresh: true,
    reasons: k.reasons,
    // ForecastMeter needs a day of uninterrupted coverage (ADR-20261019193500 §7).
    ...(day < 2 || !k.complete
      ? { projection_reason: !k.complete ? 'incomplete_evidence' : 'compute:insufficient_history' }
      : { projected_millicents: Math.round(k.amount / Math.max(elapsed, 0.01)) }),
  };
}

// --- Spec rules ----------------------------------------------------------------

const notifyOnly = (s: Spec) => s.mode === 'monitored' && s.action === 'notify';
const previewStopping = (s: Spec) =>
  s.mode === 'monitored' && s.action === 'stop_previews' && s.meters.join() === 'compute';
function strictCompute(s: Spec) {
  if (s.mode !== 'strict' || s.action !== 'suspend_workloads') return false;
  if (s.drain_seconds !== 0 || s.notify_millicents.length) return false;
  const meters = s.meters.join();
  return s.scope.kind === 'account'
    ? s.basis === 'net_usage' && (meters === 'compute' || meters === 'compute,egress')
    : s.basis === 'gross_usage' && meters === 'compute';
}

/** pkg/financial/budget.go ValidateBudget and state.ValidateFinancialBudgetSpec. */
function validate(world: World, raw: unknown): Spec {
  const s = raw as Spec;
  if (!s || typeof s !== 'object') throw invalid('expected one bounded budget spec');
  const fail = () => invalid('invalid financial policy or period');
  if (!s.name?.trim() || Buffer.byteLength(s.name) > 128 || s.currency !== 'USD') throw fail();
  if (!Number.isSafeInteger(s.limit_millicents) || s.limit_millicents < 0) throw fail();
  if (!Number.isInteger(s.drain_seconds) || s.drain_seconds < 0 || s.drain_seconds > 300)
    throw fail();
  if (!Array.isArray(s.meters) || !s.meters.length) throw fail();
  if (
    s.meters.some(
      (m, i) => !['compute', 'egress', 'object_storage'].includes(m) || (i && s.meters[i - 1] >= m)
    )
  )
    throw fail();
  if (
    s.meters.includes('object_storage') &&
    (s.scope?.kind !== 'account' || s.mode !== 'monitored')
  )
    throw fail();
  if (!['net_usage', 'gross_usage'].includes(s.basis) || !['monitored', 'strict'].includes(s.mode))
    throw fail();
  if (
    ![
      'notify',
      'reject_traffic',
      'suspend_background',
      'stop_previews',
      'suspend_workloads',
    ].includes(s.action)
  )
    throw fail();
  if (s.scope?.kind === 'job' && (s.action === 'reject_traffic' || s.action === 'stop_previews'))
    throw fail();
  if (s.action === 'notify' && s.drain_seconds !== 0) throw fail();
  if (!['manual', 'next_period'].includes(s.resume_rule)) throw fail();
  const notify = s.notify_millicents ?? [];
  if (
    notify.length > 8 ||
    notify.some((n, i) => n < 0 || n > s.limit_millicents || (i && n <= notify[i - 1]))
  )
    throw fail();
  if (s.mode === 'strict') {
    const accountEgress = strictCompute(s) && s.meters.join() === 'compute,egress';
    if (
      !accountEgress &&
      (s.meters.join() !== 'compute' || s.action === 'notify' || s.action === 'reject_traffic')
    )
      throw fail();
    if (s.scope?.kind !== 'account' && s.basis !== 'gross_usage') throw fail();
    if (s.action !== 'suspend_workloads' && s.scope?.kind !== 'app' && s.scope?.kind !== 'job')
      throw fail();
  }
  // Scope ownership: an id this account does not own is a 404.
  const kind = s.scope?.kind;
  const id = s.scope?.id;
  if (kind === 'account') {
    if (id) throw invalid('account scope has no resource id');
  } else {
    const owned =
      kind === 'app'
        ? world.apps.some((a) => a.id === id)
        : kind === 'job'
          ? world.jobs.some((j) => j.id === id)
          : kind === 'project'
            ? world.projects.some((p) => p.id === id)
            : kind === 'environment'
              ? world.environments().some((e) => e.id === id)
              : false;
    if (!owned)
      throw new BudgetProblem(
        404,
        'not_found',
        'The requested scope does not exist on this account.'
      );
  }
  return { ...s, notify_millicents: [...notify], meters: [...s.meters] };
}

/** handlers_financial_budgets.go:214-246: the release flag first, then activation. */
function checkActivation(spec: Spec, current?: Stored) {
  if (!spec.enabled) return;
  if (spec.mode === 'strict' && !released()) {
    const exempt =
      current && !current.deleted_at && current.spec.enabled && current.spec.mode === 'strict';
    if (!exempt)
      throw new BudgetProblem(
        422,
        'financial_budget_activation_unavailable',
        'Strict compute and egress budgets are not yet available to this account. Monitored budgets and alerts are unaffected, and strict budgets that are already enabled keep enforcing.'
      );
  }
  if (!notifyOnly(spec) && !previewStopping(spec) && !strictCompute(spec))
    throw new BudgetProblem(
      422,
      'financial_budget_activation_unavailable',
      'Activate monitored notify, monitored compute-only stop_previews, or strict suspend_workloads with zero drain and no alert thresholds. Other policies must remain disabled drafts.'
    );
}

// --- Reads ---------------------------------------------------------------------

function previewTargets(world: World, spec: Spec) {
  const { apps, jobs } = members(world, spec.scope);
  const effect = (background: boolean) =>
    spec.action === 'notify'
      ? 'notify_only'
      : spec.action === 'reject_traffic'
        ? 'reject_new_traffic'
        : background
          ? 'block_dispatch_then_terminate_at_drain_deadline'
          : spec.action === 'stop_previews'
            ? 'block_traffic_and_wakes_then_stop_at_drain_deadline'
            : 'block_traffic_and_wakes_then_park_at_drain_deadline';
  const targets: Target[] = [];
  const continuing: Target[] = [];
  const all = [
    ...apps.map((app) => ({
      target: { kind: 'app' as const, id: app.id, name: app.slug },
      preview: Boolean(app.preview_of_slug),
      background: app.workload_class === 'worker' || app.workload_class === 'job',
    })),
    ...jobs.map((job) => ({
      target: { kind: 'job' as const, id: job.id, name: job.name },
      preview: false,
      background: true,
    })),
  ];
  for (const member of all) {
    const selected =
      spec.enabled &&
      (spec.action === 'suspend_workloads' ||
        spec.action === 'notify' ||
        (spec.action === 'reject_traffic' && !member.background) ||
        (spec.action === 'stop_previews' && member.preview) ||
        (spec.action === 'suspend_background' && member.background));
    if (selected) targets.push({ ...member.target, effect: effect(member.background) });
    if (!selected || spec.action === 'notify' || spec.action === 'reject_traffic')
      continuing.push({ ...member.target, effect: 'compute_can_continue' });
  }
  return { targets, continuing };
}

export function preview(world: World, raw: unknown): S['FinancialBudgetPreviewResponse'] {
  const spec = validate(world, raw);
  const evaluation = evaluate(world, spec);
  const { targets, continuing } = previewTargets(world, spec);
  const reasons = [...evaluation.reasons];
  if (notifyOnly(spec)) reasons.push('notification_only_workloads_continue');
  else if (previewStopping(spec))
    reasons.push('monitored_preview_stopping', 'production_can_continue', 'overshoot_possible');
  else reasons.push('enforcement_integration_pending');
  let guarantee = notifyOnly(spec)
    ? 'notification_only_after_retained_evidence;workloads_continue'
    : 'monitored_after_retained_evidence; delayed_sources_and_drain_can_exceed_limit';
  let ready = previewStopping(spec);
  if (spec.mode === 'strict') {
    guarantee = 'strict_compute_pending_reservations_and_local_deadline_acceptance';
    if (strictCompute(spec)) {
      guarantee = `strict_${spec.scope.kind}_gross_compute_funded_windows;conservative_commitments;other_meters_excluded`;
      ready = released();
      if (!ready) reasons.push('requires_quiet_app_complete_accounting_native_owners');
    }
  }
  if (!spec.enabled) reasons.push('policy_disabled');
  else if (!targets.length) reasons.push('no_current_action_targets');
  return {
    spec,
    period_start: evaluation.period_start,
    period_end: evaluation.period_end,
    as_of: evaluation.as_of,
    known_millicents: evaluation.known_millicents ?? 0,
    known_limit_reached: (evaluation.known_millicents ?? 0) >= spec.limit_millicents,
    coverage_complete: evaluation.coverage_complete,
    fresh: true,
    reasons,
    enforcement_ready: ready,
    guarantee,
    targets,
    continuing_targets: continuing,
  };
}

/** financialbudgets.Response: intent plus the readiness and runtime it has now. */
function respond(world: World, row: Stored): Budget {
  const base: Budget = {
    id: row.id,
    account_id: ACCOUNT_ID,
    revision: row.revision,
    spec: row.spec,
    created_at: row.created_at,
    updated_at: row.updated_at,
    status: 'draft',
    enforcement_ready: false,
    reasons: ['enforcement_integration_pending'],
  };
  if (row.deleted_at) return { ...base, deleted_at: row.deleted_at, status: 'deleted' };
  if (!row.spec.enabled) return base;
  const spec = row.spec;
  const evaluation = evaluate(world, spec);
  const amount = evaluation.known_millicents ?? 0;
  if (strictCompute(spec)) {
    const committed = Math.round(known(world, { ...spec, basis: 'gross_usage' }).amount * 1.1);
    const reserved = 40_000;
    const remaining = Math.max(0, spec.limit_millicents - committed - reserved);
    const { start, end } = monthBounds();
    return {
      ...base,
      status: 'active',
      enforcement_ready: true,
      reasons: [
        `strict_${spec.scope.kind === 'account' ? 'account_net' : `${spec.scope.kind}_gross`}_compute`,
        'conservative_compute_commitments',
        'funded_execution_window_only',
        'subscription_storage_egress_tax_excluded',
        ...(remaining === 0 ? ['compute_budget_held'] : []),
      ],
      runtime: {
        alerts: [],
        evaluation,
        compute: {
          initialized: true,
          account_id: ACCOUNT_ID,
          scope_kind: spec.scope.kind,
          basis: spec.basis,
          period_start: new Date(start).toISOString(),
          period_end: new Date(end).toISOString(),
          committed_millicents: committed,
          reserved_millicents: reserved,
          remaining_millicents: remaining,
          unconfirmed_leases: 0,
          held: remaining === 0,
          observed_at: new Date(Date.now() - 20_000).toISOString(),
        },
      },
    };
  }
  if (!notifyOnly(spec) && !previewStopping(spec)) return { ...base, status: 'unavailable' };
  const thresholds = [...new Set([...spec.notify_millicents, spec.limit_millicents])].sort(
    (a, b) => a - b
  );
  const alert = (threshold: number, kind?: 'projection') => ({
    id: randomUUID(),
    ...(kind ? { kind } : {}),
    policy_revision: row.revision,
    threshold_millicents: threshold,
    evaluation,
    state: 'delivered' as const,
    attempts: 1,
    next_attempt_at: evaluation.evaluated_at,
    delivered_at: evaluation.evaluated_at,
  });
  const alerts = thresholds.filter((t) => t <= amount).map((t) => alert(t));
  const projected = evaluation.projected_millicents;
  const projection =
    projected !== undefined && projected >= spec.limit_millicents && amount < spec.limit_millicents
      ? alert(spec.limit_millicents, 'projection')
      : undefined;
  const stops =
    previewStopping(spec) && amount >= spec.limit_millicents
      ? [
          {
            id: randomUUID(),
            policy_id: row.id,
            revision: row.revision,
            period_start: evaluation.period_start,
            period_end: evaluation.period_end,
            requested_at: evaluation.evaluated_at,
            drain_deadline: new Date(
              Date.parse(evaluation.evaluated_at) + spec.drain_seconds * 1000
            ).toISOString(),
            resume_rule: spec.resume_rule,
            evaluation,
            targets: members(world, spec.scope)
              .apps.filter((app) => app.preview_of_slug)
              .map((app) => ({
                app_id: app.id,
                state: 'enforced' as const,
                observed_at: new Date(Date.now() - 45_000).toISOString(),
                resident_count: 0,
              })),
          },
        ]
      : undefined;
  return {
    ...base,
    status: 'active',
    notification_ready: true,
    enforcement_ready: previewStopping(spec),
    reasons: previewStopping(spec)
      ? ['monitored_preview_stopping', 'production_can_continue', 'overshoot_possible']
      : ['notification_only_workloads_continue'],
    runtime: {
      evaluation,
      alerts,
      ...(projection ? { projection } : {}),
      ...(stops ? { stops } : {}),
    },
  };
}

function find(id: string): Stored {
  const row = store.find((b) => b.id === id);
  if (!row) throw new BudgetProblem(404, 'not_found', 'Budget scope not found');
  return row;
}

function live(id: string): Stored {
  const row = find(id);
  if (row.deleted_at) throw new BudgetProblem(404, 'not_found', 'Budget scope not found');
  return row;
}

function requireKey(key: string) {
  if (!key.trim() || key.length > 255)
    throw invalid('budget mutations require an Idempotency-Key of 1..255 characters');
}

function expected(body: Record<string, unknown>): number {
  const revision = body.expected_revision;
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 1)
    throw invalid("expected_revision must be the policy's current revision");
  return revision;
}

function record(row: Stored, mutation: Revision['mutation']) {
  row.revisions.push({
    policy_id: row.id,
    revision: row.revision,
    actor: ACTOR,
    mutation,
    spec: row.spec,
    recorded_at: row.updated_at,
  });
}

export function list(world: World) {
  return { budgets: store.filter((b) => !b.deleted_at).map((b) => respond(world, b)) };
}

export const get = (world: World, id: string) => respond(world, find(id));

export function create(world: World, body: Record<string, unknown>, key: string): Budget {
  requireKey(key);
  const spec = validate(world, body.spec);
  checkActivation(spec);
  const prior = creationKeys.get(key);
  if (prior) {
    const old = find(prior);
    if (!old.deleted_at && old.revision === 1 && JSON.stringify(old.spec) === JSON.stringify(spec))
      return respond(world, old);
    throw new BudgetProblem(409, 'conflict', 'Read the current policy before retrying.');
  }
  if (store.filter((b) => !b.deleted_at).length >= 128)
    throw new BudgetProblem(
      422,
      'validation_failed',
      'Delete an unused policy before creating another.'
    );
  const now = new Date().toISOString();
  const row: Stored = {
    id: randomUUID(),
    spec,
    revision: 1,
    created_at: now,
    updated_at: now,
    revisions: [],
    channels: [],
  };
  record(row, 'created');
  store.push(row);
  creationKeys.set(key, row.id);
  return respond(world, row);
}

export function update(
  world: World,
  id: string,
  body: Record<string, unknown>,
  key: string
): Budget {
  requireKey(key);
  const revision = expected(body);
  const row = live(id);
  const spec = validate(world, body.spec);
  checkActivation(spec, row.revision === revision ? row : undefined);
  if (row.revision !== revision)
    throw new BudgetProblem(409, 'conflict', 'Read the current policy before retrying.');
  row.spec = spec;
  row.revision += 1;
  row.updated_at = new Date().toISOString();
  record(row, 'updated');
  return respond(world, row);
}

export function remove(
  world: World,
  id: string,
  body: Record<string, unknown>,
  key: string
): Budget {
  requireKey(key);
  const revision = expected(body);
  const row = live(id);
  if (row.revision !== revision)
    throw new BudgetProblem(409, 'conflict', 'Read the current policy before retrying.');
  row.revision += 1;
  row.updated_at = new Date().toISOString();
  row.deleted_at = row.updated_at;
  record(row, 'deleted');
  return respond(world, row);
}

export function revisions(id: string, query: URLSearchParams): S['FinancialBudgetHistoryResponse'] {
  const after = Number(query.get('after_revision') ?? 0);
  const limit = Number(query.get('limit') ?? 100);
  if (!Number.isInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100)
    throw invalid('expected after_revision >= 0 and limit between 1 and 100');
  const rows = find(id)
    .revisions.filter((r) => r.revision > after)
    .slice(0, limit);
  return {
    revisions: rows,
    ...(rows.length === limit ? { next_revision: rows[rows.length - 1].revision } : {}),
  };
}

export function channels(id: string): S['FinancialBudgetChannelsResponse'] {
  const row = live(id);
  return {
    policy_id: id,
    channels: channelMock.channels
      .filter((c) => row.channels.includes(c.id))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export function setChannels(id: string, body: Record<string, unknown>, key: string) {
  requireKey(key);
  const row = live(id);
  const ids = body.channel_ids;
  if (!Array.isArray(ids)) throw invalid('expected channel_ids');
  if (ids.length > 5) throw invalid('a budget can deliver to at most 5 channels');
  const seen = new Set<string>();
  for (const value of ids) {
    const channel = String(value);
    if (seen.has(channel)) throw invalid(`channel_ids contains ${channel} twice`);
    seen.add(channel);
    if (!channelMock.channels.some((c) => c.id === channel))
      throw invalid(`channel_ids: ${channel} is not one of this account's notification channels`);
  }
  row.channels = [...seen];
  return channels(id);
}

/** Seeds once the plugin's workloads exist. */
export function seed(world: World) {
  if (db.EMPTY || store.length) return;
  const at = (ms: number) => new Date(Date.now() - ms).toISOString();
  const add = (spec: Spec, edits: Partial<Spec>[], channelNames: string[] = []) => {
    const row: Stored = {
      id: randomUUID(),
      spec,
      revision: 1,
      created_at: at(9 * 86_400_000),
      updated_at: at(9 * 86_400_000),
      revisions: [],
      channels: channelMock.channels.filter((c) => channelNames.includes(c.name)).map((c) => c.id),
    };
    record(row, 'created');
    edits.forEach((edit, i) => {
      row.spec = { ...row.spec, ...edit };
      row.revision += 1;
      row.updated_at = at((6 - i * 3) * 86_400_000);
      record(row, 'updated');
    });
    store.push(row);
  };
  const base = {
    currency: 'USD',
    meters: ['compute'],
    basis: 'net_usage',
    drain_seconds: 0,
    resume_rule: 'next_period',
    enabled: true,
  } as const;
  add(
    {
      ...base,
      meters: ['compute'],
      name: 'Monthly compute',
      scope: { kind: 'account' },
      limit_millicents: 2_000_000,
      notify_millicents: [1_000_000],
      mode: 'monitored',
      action: 'notify',
    },
    [{ limit_millicents: 2_500_000, notify_millicents: [1_000_000, 2_000_000] }],
    ['ops-slack']
  );
  add(
    {
      ...base,
      meters: ['compute'],
      name: 'Preview spending',
      scope: { kind: 'account' },
      limit_millicents: 200_000,
      notify_millicents: [],
      mode: 'monitored',
      action: 'stop_previews',
      drain_seconds: 30,
      resume_rule: 'manual',
    },
    []
  );
  const first = world.apps[0];
  if (first)
    add(
      {
        ...base,
        meters: ['compute'],
        name: `${first.slug} cap`,
        scope: { kind: 'app', id: first.id },
        basis: 'gross_usage',
        limit_millicents: 4_000_000,
        notify_millicents: [],
        mode: 'strict',
        action: 'suspend_workloads',
        resume_rule: 'manual',
        enabled: false,
      },
      []
    );
}
