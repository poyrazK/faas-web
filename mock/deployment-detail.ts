import { createHash } from 'node:crypto';
import type { components } from '../src/lib/api/schema';

/**
 * Fixtures for the deployment drawer's newer reads and writes: release diff,
 * runtime base identity and upgrade preview, promotion, rollback operations
 * and worker rollout observation. Pure functions over the seeded rows, so the
 * routes in plugin.ts stay one line each and the behaviour is testable.
 */

type S = components['schemas'];
type Deployment = S['DeploymentResponse'];
type RuntimeRelease = S['RuntimeReleaseResponse'];

const sha = (seed: string) => createHash('sha256').update(seed).digest('hex');
const scopeOf = (d: Deployment) => d.scope ?? 'default';
const ms = (iso: string) => Date.parse(iso);

function side(d: Deployment): S['ReleaseDiffSide'] {
  return {
    deployment_id: d.id,
    ...(d.revision ? { revision: d.revision } : {}),
    created_at: d.created_at,
    deployed_by: 'design@gregale.dev',
    commit: sha(`commit:${d.id}`).slice(0, 40),
  };
}

const VARIABLES = ['LOG_LEVEL', 'FEATURE_CHECKOUT_V2', 'CACHE_TTL_SECONDS', 'REGION_HINT'];
const SECRETS = ['STRIPE_KEY', 'DATABASE_URL'];
const PACKAGES: [string, string, string][] = [
  ['express', '4.18.2', '4.19.2'],
  ['zod', '3.22.4', '3.23.8'],
  ['pino', '8.17.0', '9.4.0'],
];

/** Mirrors releasediff.Predecessor: the newest older release of the same app and scope. */
function predecessor(all: Deployment[], to: Deployment): Deployment | undefined {
  return all
    .filter(
      (d) =>
        d.app_id === to.app_id &&
        d.id !== to.id &&
        scopeOf(d) === scopeOf(to) &&
        ms(d.created_at) < ms(to.created_at) &&
        (d.status === 'live' || d.status === 'superseded')
    )
    .sort((a, b) => ms(b.created_at) - ms(a.created_at))[0];
}

export function releaseDiff(
  all: Deployment[],
  to: Deployment,
  against?: Deployment
): S['ReleaseDiff'] {
  const from = against ?? predecessor(all, to);
  const empty = {
    config: { known: false, note: "this is the app's first release", variables: [], secrets: [] },
    dependencies: {
      known: false,
      note: "this is the app's first release",
      added: [],
      removed: [],
      changed: [],
    },
  };
  if (!from)
    return {
      app: to.app_id,
      to: side(to),
      summary: 'first release',
      code: { changed: true, to_commit: side(to).commit, image_changed: false },
      ...empty,
      runtime: [],
      database: { changed: true, to_release_command: 'npm run migrate' },
    };
  const seed = parseInt(sha(`${from.id}:${to.id}`).slice(0, 6), 16);
  const variables: S['ReleaseDiffKey'][] = VARIABLES.slice(0, (seed % 3) + 1).map((key, i) => ({
    key,
    change: i === 0 ? 'changed' : 'added',
  }));
  const secrets: S['ReleaseDiffKey'][] =
    seed % 2 ? [{ key: SECRETS[seed % 2], change: 'changed' }] : [];
  // Tarball releases carry no build SBOM in the mock, like image releases.
  const sbom = to.kind !== 'tarball' && from.kind !== 'tarball';
  const changed = PACKAGES.slice(0, (seed % 3) + 1).map(([name, a, b]) => ({
    name,
    from: a,
    to: b,
  }));
  const runtime: S['ReleaseDiffField'][] =
    (from.min_instances ?? 0) !== (to.min_instances ?? 0)
      ? [
          {
            field: 'min_instances',
            from: String(from.min_instances ?? 0),
            to: String(to.min_instances ?? 0),
          },
        ]
      : seed % 4 === 0
        ? [{ field: 'handler', from: 'src/index.handler', to: 'dist/index.handler' }]
        : [];
  const database = seed % 5 === 0;
  const fromSide = side(from);
  const toSide = side(to);
  const keyCount = variables.length + secrets.length;
  return {
    app: to.app_id,
    from: fromSide,
    to: toSide,
    summary: [
      'new code',
      `${keyCount} config ${keyCount === 1 ? 'key' : 'keys'}`,
      sbom ? `${changed.length} ${changed.length === 1 ? 'package' : 'packages'}` : '',
      database ? 'new release command' : '',
    ]
      .filter(Boolean)
      .join(', '),
    code: {
      changed: true,
      from_commit: fromSide.commit,
      to_commit: toSide.commit,
      compare_url: `https://github.com/gregale-demo/api/compare/${fromSide.commit}...${toSide.commit}`,
      image_changed: from.image_digest !== to.image_digest,
    },
    config: { known: true, variables, secrets },
    dependencies: sbom
      ? { known: true, added: [], removed: [], changed }
      : {
          known: false,
          note: 'one of these builds has no SBOM',
          added: [],
          removed: [],
          changed: [],
        },
    runtime,
    database: {
      changed: database,
      from_release_command: 'npm run migrate',
      to_release_command: database ? 'npm run migrate && npm run backfill' : 'npm run migrate',
    },
  };
}

type ManagedRuntime = RuntimeRelease['runtime'];
const MANAGED = new Set<string>([
  'node22',
  'node24',
  'python312',
  'python313',
  'go124',
  'go124-alpine',
]);

function publishedBases(runtime: ManagedRuntime): RuntimeRelease[] {
  return ['2026-10-28T09:00:00Z', '2026-10-14T09:00:00Z', '2026-09-30T09:00:00Z'].map(
    (published, i) => ({
      id: sha(`base:${runtime}:${i}`),
      runtime,
      architecture: 'amd64',
      source_digest: `sha256:${sha(`src:${runtime}:${i % 2}`)}`,
      guest_init_digest: `sha256:${sha(`init:${i}`)}`,
      base_digest: `sha256:${sha(`bytes:${runtime}:${i}`)}`,
      layout_version: i === 2 ? '2' : '3',
      published_at: published,
      qualification: 'not_evaluated',
    })
  );
}

/** Mirrors deploymentRuntimeEvidence (handlers_runtime_releases.go:63). */
export function runtimeFor(
  appType: string,
  appRuntime: string | undefined,
  d: Deployment
): S['DeploymentRuntimeResponse'] {
  const runtime = (appRuntime ?? 'node22') as ManagedRuntime;
  if (appType !== 'function' || d.kind === 'image' || !MANAGED.has(runtime))
    return {
      deployment_id: d.id,
      status: 'unsupported',
      reason:
        'Runtime release pinning currently covers Gregale-managed function runtimes. Customer images and Dockerfiles retain their own runtime selection.',
      current: null,
      releases: [],
    };
  const releases = publishedBases(runtime);
  return {
    deployment_id: d.id,
    status: 'pinned',
    reason:
      'The artifact is bound to immutable runtime base bytes. The host kernel and function runner are separate components.',
    current: releases[1],
    releases,
  };
}

/** Mirrors runtimeUpgradePreview (handlers_runtime_releases.go:94). */
export function runtimePreview(
  current: S['DeploymentRuntimeResponse'],
  target: RuntimeRelease
): S['RuntimeUpgradePreviewResponse'] {
  const p: S['RuntimeUpgradePreviewResponse'] = {
    deployment_id: current.deployment_id,
    current: current.current,
    target,
    disposition: 'blocked',
    changes: [],
    blockers: [],
    required_steps: [],
    rebuild_required: false,
    cold_start_required: false,
    execution_available: false,
  };
  const c = current.current;
  if (!c) return { ...p, blockers: [current.reason] };
  if (c.runtime !== target.runtime)
    p.blockers.push('Changing runtime families requires an explicit application migration.');
  if (c.architecture !== target.architecture)
    p.blockers.push('Target architecture differs from the current artifact.');
  if (p.blockers.length) return p;
  if (c.id === target.id) return { ...p, disposition: 'no_change' };
  if (c.source_digest !== target.source_digest) p.changes.push('runtime_source');
  if (c.guest_init_digest !== target.guest_init_digest) p.changes.push('guest_init');
  if (c.layout_version !== target.layout_version) p.changes.push('base_layout');
  if (c.base_digest !== target.base_digest) p.changes.push('base_bytes');
  return {
    ...p,
    disposition: 'review_required',
    rebuild_required: true,
    cold_start_required: true,
    blockers: [
      'Target publication has not established upgrade compatibility or readiness.',
      'Runtime update execution is not available in this preview.',
    ],
    required_steps: [
      'Qualify the target runtime and guest-init on native hardware.',
      'Rebuild the same source against the target base and produce a new artifact.',
      'Cold-boot the candidate and collect fresh readiness evidence; existing snapshots cannot be reused across different backing bytes.',
      'Use the existing guarded rollout and rollback controls after candidate qualification.',
    ],
  };
}

/** The traffic write of a passed promotion: the release takes its scope, siblings drop to 0. */
export function promoteDeployment(
  all: Deployment[],
  d: Deployment
): Omit<S['BindingPromotionResponse'], 'bindings_check'> {
  const from = d.traffic_percent ?? 0;
  for (const other of all)
    if (other.app_id === d.app_id && scopeOf(other) === scopeOf(d) && other.status === 'live')
      other.traffic_percent = other.id === d.id ? 100 : 0;
  return { deployment: d, from_percent: from, to_percent: 100, already_promoted: from === 100 };
}

interface RollbackRecord {
  op: S['RollbackOperation'];
  requestedAt: number;
}
const rollbacks = new Map<string, RollbackRecord>();

/** Records a plain rollback the way release.Rollbacks.Record does. */
export function startRollback(
  appId: string,
  target: Deployment,
  current: Deployment | undefined,
  now = Date.now()
): S['RollbackOperation'] {
  const at = new Date(now).toISOString();
  const op: S['RollbackOperation'] = {
    id: crypto.randomUUID(),
    app_id: appId,
    scope: scopeOf(target),
    target_deployment_id: target.id,
    current_deployment_id: current?.id ?? target.id,
    status: 'preparing',
    service: false,
    trigger: 'manual',
    created_at: at,
    updated_at: at,
  };
  rollbacks.set(op.id, { op, requestedAt: now });
  return { ...op };
}

/**
 * The outcome sweep, computed from age: readiness for ~3 s, the traffic
 * switch for ~3 s more, then complete with the swap applied once.
 */
export function readRollback(
  all: Deployment[],
  id: string,
  now = Date.now()
): S['RollbackOperation'] | undefined {
  const record = rollbacks.get(id);
  if (!record) return undefined;
  const { op } = record;
  if (op.status === 'complete' || op.status === 'failed') return { ...op };
  const age = now - record.requestedAt;
  if (age < 3_000) return { ...op };
  if (age < 6_000) {
    op.status = 'routing';
    op.updated_at = new Date(now).toISOString();
    return { ...op };
  }
  const target = all.find((d) => d.id === op.target_deployment_id);
  if (!target) {
    Object.assign(op, {
      status: 'failed',
      code: 'rollback_target_missing',
      error: 'the rollback target deployment no longer exists',
      updated_at: new Date(now).toISOString(),
    });
    return { ...op };
  }
  const done = new Date(record.requestedAt + 6_000 + 400).toISOString();
  for (const d of all)
    if (d.app_id === target.app_id && scopeOf(d) === scopeOf(target) && d.status === 'live') {
      d.status = 'superseded';
      d.traffic_percent = 0;
    }
  Object.assign(target, { status: 'live', traffic_percent: 100, rollout_completed_at: done });
  Object.assign(op, {
    status: 'complete',
    recovery_ms: 6_400,
    completed_at: done,
    updated_at: done,
    audit_id: String(Math.floor(record.requestedAt / 1000)),
  });
  return { ...op };
}

/** A resident-generation snapshot for a worker release, steady per status. */
export function workerObservation(d: Deployment): S['WorkerRolloutObservation'] {
  const live = d.status === 'live';
  const moving = !live && d.status !== 'superseded' && d.status !== 'failed';
  return {
    app_id: d.app_id,
    deployment_id: d.id,
    scope: scopeOf(d),
    checked_at: new Date().toISOString(),
    basis: 'resident_generation_snapshot',
    selected_deployment_id: d.id,
    running: live ? 3 : moving ? 1 : 0,
    starting: moving ? 2 : 0,
    draining: moving ? 2 : 0,
    other_residents: moving ? 1 : 0,
    retired_residents: live ? 4 : moving ? 0 : 3,
    generation_converged: live,
    queue_processing_confirmed: false,
  };
}
