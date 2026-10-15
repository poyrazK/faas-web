import type { components } from '../src/lib/api/schema';
import * as db from './data';
import { projects } from './projects';
import { getStageQueueRecord } from './stage-queues';
type S = components['schemas'];
export function environmentInventory(slug: string): S['ProjectEnvironmentResponse'][] | undefined {
  const project = projects.find((item) => item.slug === slug);
  if (!project) return;
  return ['production', 'staging'].map((environment) => ({
    id: `${project.id}-${environment}`,
    project_id: project.id,
    slug: environment,
    protected: environment === 'production',
    created_at: project.created_at,
    updated_at: project.updated_at,
  }));
}
export function environmentState(
  slug: string,
  environment: string
): S['ProjectEnvironmentStateResponse'] | undefined {
  const registered = environmentInventory(slug)?.find((item) => item.slug === environment);
  if (!registered) return;
  const project = projects.find((item) => item.slug === slug)!;
  return {
    project_slug: slug,
    environment,
    protected: registered.protected,
    generated_at: db.iso(0),
    configuration: {
      project_slug: slug,
      environment,
      version: 1,
      config_hash: (environment === 'production' ? 'a' : 'b').repeat(64),
      values: { region: 'eu', stage: environment },
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
  const from = environmentState(slug, source),
    to = environmentState(slug, target);
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
      from_version: 1,
      to_version: 1,
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
