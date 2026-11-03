import { createHash } from 'node:crypto';
import type { components } from '../src/lib/api/schema';

/**
 * Release commands (faas ADR-1448): the `release` object GET
 * /v1/deployments/{id} carries for a deployment that declares one, and the
 * release task imaged admits for it, which GET /v1/apps/{slug}/tasks lists
 * (kind `release`, pinned to the deployment). webhook-router declares
 * `npm run migrate`: its serving release ran it, and one earlier release's
 * run failed, so both outcomes have a row to open.
 */

type S = components['schemas'];
type Deployment = S['DeploymentResponse'];
type App = S['AppResponse'];
type AppTask = S['AppTaskResponse'];

const uuid = (seed: string) => {
  const h = createHash('sha256').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const hex32 = (seed: string) => createHash('sha256').update(seed).digest('hex').slice(0, 32);
const plus = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();

export const releaseTasks: AppTask[] = [];

function task(d: Deployment, over: Partial<AppTask>): AppTask {
  const started = plus(d.created_at, 90_000);
  return {
    id: uuid(`release-task:${d.id}`),
    app_id: d.app_id,
    deployment_id: d.id,
    deployment_scope: d.scope ?? 'default',
    kind: 'release',
    command: ['npm', 'run', 'migrate'],
    command_shell: false,
    status: 'succeeded',
    timeout_seconds: 900,
    max_output_bytes: 65_536,
    attempt_count: 1,
    output_truncated: false,
    created_at: plus(d.created_at, 85_000),
    updated_at: started,
    started_at: started,
    ...over,
  };
}

function releaseOf(t: AppTask): NonNullable<Deployment['release']> {
  return {
    status: t.status,
    ...(t.started_at ? { started_at: t.started_at } : {}),
    ...(t.finished_at ? { finished_at: t.finished_at } : {}),
    migration_databases: [{ id: hex32('pg:orders'), name: 'orders' }],
  };
}

/** Seeds once over the generated rows; MOCK_EMPTY has none, so it adds none. */
export function seedReleaseCommands(deployments: Deployment[], apps: App[]) {
  const app = apps.find((a) => a.slug === 'webhook-router');
  const live = app && deployments.find((d) => d.app_id === app.id && d.status === 'live');
  if (!app || !live) return;

  const ok = task(live, {
    exit_code: 0,
    finished_at: plus(live.created_at, 102_000),
    stdout_tail: [
      '> webhook-router@2.4.0 migrate',
      '> node-pg-migrate up',
      '',
      '### MIGRATION 20261101_add_delivery_attempts (UP) ###',
      'ALTER TABLE "deliveries" ADD "attempts" integer DEFAULT 0 NOT NULL;',
      '### MIGRATION 20261102_index_delivery_status (UP) ###',
      'CREATE INDEX "deliveries_status_idx" ON "deliveries" ("status");',
      'Migrations complete!',
    ].join('\n'),
  });
  live.release = releaseOf(ok);

  const created = plus(live.created_at, -2 * 60 * 60 * 1000);
  const failed: Deployment = {
    ...live,
    id: hex32(`release-failed:${live.id}`),
    build_id: undefined,
    created_at: created,
    status: 'failed',
    traffic_percent: 0,
    revision: undefined,
    rollout_state: undefined,
    rollout_decision: undefined,
    error_code: 'release_command_failed',
    error: '',
    // Built and scanned; snapshot_prepare opened, then the command failed.
    stage_state: {
      current: '',
      history: ['source_download', 'dependency_restore', 'image_build', 'security_scan'].map(
        (name, i) => ({ name, status: 'completed', duration_ms: [1800, 9200, 41_000, 3100][i] })
      ),
    } as Deployment['stage_state'],
    error_hint: 'Fix the release command, then deploy again. The previous release kept serving.',
  };
  const bad = task(failed, {
    status: 'failed',
    exit_code: 1,
    finished_at: plus(created, 97_000),
    failure: { code: 'nonzero_exit', message: 'release command exited with status 1' },
    stdout_tail: '> webhook-router@2.4.0 migrate\n> node-pg-migrate up\n',
    stderr_tail: [
      '### MIGRATION 20261101_add_delivery_attempts (UP) ###',
      'Error executing:',
      'ALTER TABLE "deliveries" ADD "attempts" integer NOT NULL;',
      'error: column "attempts" of relation "deliveries" contains null values',
    ].join('\n'),
  });
  failed.error = `release task ${bad.id} ended with status failed: nonzero_exit: release command exited with status 1`;
  failed.release = releaseOf(bad);
  deployments.push(failed);
  deployments.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  releaseTasks.push(ok, bad);
}

/** GET /v1/apps/{slug}/tasks: newest first, `next_offset` -1 on the last page. */
export function listAppTasks(appId: string, limit: number, offset: number) {
  const rows = releaseTasks
    .filter((t) => t.app_id === appId)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const tasks = rows.slice(offset, offset + limit);
  return {
    tasks,
    limit,
    offset,
    next_offset: offset + tasks.length < rows.length ? offset + tasks.length : -1,
  } satisfies S['AppTaskListResponse'];
}
