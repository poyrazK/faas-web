import type { components } from '../src/lib/api/schema';
import * as db from './data';
import { projects } from './projects';
import { getStageQueueRecord } from './stage-queues';
type S = components['schemas'];
type Project = S['ProjectResponse'];
type Env = S['ProjectEnvironmentResponse'];

/**
 * What the console changed (mock/environment-admin.ts), by project slug: every
 * project starts with production and staging, and these edits sit on top.
 */
interface Edits {
  added: Env[];
  removed: Set<string>;
  protection: Map<string, boolean>;
}
const edits = new Map<string, Edits>();
export function environmentEdits(project: string): Edits {
  if (!edits.has(project))
    edits.set(project, { added: [], removed: new Set(), protection: new Map() });
  return edits.get(project)!;
}
/** Each environment's latest shared configuration, by `project/environment`. */
export const environmentConfigs = new Map<
  string,
  { version: number; values: Record<string, unknown>; updated_at: string }
>();
export function environmentConfig(project: string, environment: string) {
  return (
    environmentConfigs.get(`${project}/${environment}`) ?? {
      version: 1,
      values: { region: 'eu', stage: environment },
      updated_at: '2026-10-20T09:00:00Z',
    }
  );
}
/** A stable 64-hex fingerprint of a configuration document, for the mock only. */
export function configHash(values: Record<string, unknown>) {
  const text = JSON.stringify(values);
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h.toString(16).padStart(8, '0').repeat(8);
}
export function inventoryFor(project: Project): Env[] {
  const edit = edits.get(project.slug);
  const base: Env[] = ['production', 'staging']
    .filter((environment) => !edit?.removed.has(environment))
    .map((environment) => ({
      id: `${project.id}-${environment}`,
      project_id: project.id,
      slug: environment,
      protected: environment === 'production',
      created_at: project.created_at,
      updated_at: project.updated_at,
    }));
  return [...base, ...(edit?.added ?? [])].map((env) => ({
    ...env,
    protected: edit?.protection.get(env.slug) ?? env.protected,
  }));
}
export function environmentInventory(slug: string): Env[] | undefined {
  const project = projects.find((item) => item.slug === slug);
  if (!project) return;
  return inventoryFor(project);
}
export function environmentState(
  slug: string,
  environment: string
): S['ProjectEnvironmentStateResponse'] | undefined {
  const project = projects.find((item) => item.slug === slug);
  return project && stateFor(project, environment);
}
export function stateFor(
  project: Project,
  environment: string
): S['ProjectEnvironmentStateResponse'] | undefined {
  const slug = project.slug;
  const registered = inventoryFor(project).find((item) => item.slug === environment);
  if (!registered) return;
  const config = environmentConfig(slug, environment);
  return {
    project_slug: slug,
    environment,
    protected: registered.protected,
    generated_at: db.iso(0),
    configuration: {
      project_slug: slug,
      environment,
      version: config.version,
      config_hash: configHash(config.values),
      values: config.values,
    },
    active_release_set: null,
    release_set_status: 'none',
    workloads: project.workloads.map((workload) => {
      const app = db.apps.find((item) => item.slug === workload.slug)!;
      const deployment =
        environment === 'production'
          ? db.deployments.find((item) => item.app_id === app.id && item.status === 'live')
          : undefined;
      const stageQueues = getStageQueueRecord({
        project: slug,
        environment,
        workload: workload.slug,
      });
      return {
        app_id: app.id,
        ...(stageQueues
          ? {
              workload_config_revision: stageQueues.workload_revision,
              workload_config_hash: stageQueues.config_hash,
            }
          : {}),
        workload_slug: workload.slug,
        workload_name: workload.workload_name,
        release: {
          workload_slug: workload.slug,
          workload_name: workload.workload_name,
          status: deployment ? 'live' : 'not_deployed',
          deployment_id: deployment?.id,
          image_digest: deployment?.image_digest,
          url: deployment ? app.url : undefined,
        },
        variables: [{ key: 'REGION', value: 'eu' }],
        secrets: [{ key: 'LEGACY_TOKEN' }],
        bindings: [],
        domains: [],
        routes: {
          ownership: 'application',
          only_allow_declared_routes: false,
          declared_routes: [],
        },
        policies: { ownership: 'application', rules: [] },
      };
    }),
    shared_resources: [
      {
        kind: 'policies',
        ownership: 'application',
        note: 'Other edge-rule kinds remain application-owned.',
      },
    ],
  };
}
export function environmentDiff(
  slug: string,
  source: string,
  target: string
): S['ProjectEnvironmentDiffResponse'] | undefined {
  const project = projects.find((item) => item.slug === slug);
  return project && diffFor(project, source, target);
}
export function diffFor(
  project: Project,
  source: string,
  target: string
): S['ProjectEnvironmentDiffResponse'] | undefined {
  const slug = project.slug;
  const from = stateFor(project, source),
    to = stateFor(project, target);
  if (!from || !to) return;
  return {
    project_slug: slug,
    from_environment: source,
    to_environment: target,
    generated_at: db.iso(0),
    configuration: {
      project_slug: slug,
      from_environment: source,
      to_environment: target,
      from_version: from.configuration.version,
      to_version: to.configuration.version,
      from_hash: from.configuration.config_hash,
      to_hash: to.configuration.config_hash,
      changes: [{ key: 'stage', kind: 'changed', before: source, after: target }],
    },
    shared_resources: to.shared_resources,
    workloads: to.workloads.map((after, index) => {
      const before = from.workloads[index];
      return {
        workload_slug: after.workload_slug,
        workload_name: after.workload_name,
        release: {
          kind:
            before.release.deployment_id === after.release.deployment_id ? 'unchanged' : 'changed',
          before: before.release,
          after: after.release,
        },
        variables: [],
        bindings: [],
        secrets: [
          {
            key: 'LEGACY_TOKEN',
            kind: 'unknown',
            before: { present: true },
            after: { present: true },
          },
        ],
        domains: { kind: 'unchanged', before: [], after: [] },
        routes: { kind: 'unchanged', before: before.routes, after: after.routes },
        policies: { kind: 'unchanged', before: before.policies, after: after.policies },
      };
    }),
  };
}
export function previewSet(slug: string): S['PreviewEnvironmentStatusResponse'] | undefined {
  const app = db.apps.find(
    (item) => item.slug === slug && item.preview_of_slug && item.preview_pr_number === 42
  );
  if (!app) return;
  const deployment = db.deployments.find(
    (item) => item.app_id === app.id && item.status === 'live'
  );
  const closed = app.preview_pr_state === 'closed' || app.preview_pr_state === 'torn_down';
  return {
    root_slug: app.slug,
    repo_full_name: 'acme/shop',
    pr_number: 42,
    commit_sha: 'a'.repeat(40),
    phase: closed ? 'closed' : deployment ? 'live' : 'building',
    ready: !closed && Boolean(deployment),
    summary: closed
      ? 'PR is closed.'
      : deployment
        ? 'All expected workloads are live for the current commit.'
        : 'Waiting for the current commit.',
    live_workloads: deployment ? 1 : 0,
    total_workloads: 1,
    members: [
      {
        app_id: app.id,
        slug: app.slug,
        workload_name: 'api',
        app_status: app.status,
        preview_state: app.preview_pr_state ?? 'unknown',
        deployment_id: deployment?.id ?? '',
        deployment_status: deployment?.status ?? 'missing',
        expires_at: app.preview_expires_at ?? undefined,
        links: {
          url: app.url ?? '',
          logs: `/v1/apps/${app.slug}/logs`,
          metrics: `/v1/apps/${app.slug}/metrics`,
          configuration: `/v1/apps/${app.slug}`,
        },
      },
    ],
  };
}
