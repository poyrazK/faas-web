import type { components } from '../src/lib/api/schema';
import * as db from './data';
type Project = components['schemas']['ProjectResponse'];
export const projects: Project[] = db.EMPTY
  ? []
  : ['acme-shop', 'internal-tools'].map((slug, index) => {
      const apps = db.apps.slice(index * 3, index * 3 + 3);
      return {
        id: db.id(),
        slug,
        scan_source: 'workspace',
        repo_full_name: index === 0 ? 'acme/shop' : undefined,
        production_branch: index === 0 ? 'main' : undefined,
        workload_count: apps.length,
        created_at: db.iso(10 * 24 * 3600000),
        updated_at: db.iso(3600000),
        exclusions: [],
        workloads: apps.map((app) => {
          const deployment = db.deployments.find((item) => item.app_id === app.id);
          const build = deployment?.build_id
            ? db.builds.find((item) => item.id === deployment.build_id)
            : undefined;
          return {
            slug: app.slug,
            workload_name: app.slug,
            status: app.status,
            deployment_status: deployment?.status,
            build_status: build?.status,
          };
        }),
      };
    });
export function projectSummaries() {
  return projects.map(({ workloads, exclusions, ...project }) => ({
    ...project,
    workload_count: workloads.length,
  }));
}
