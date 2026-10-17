import { api, unwrap } from './client';
import type { components } from './schema';

export type MigrationPlan = components['schemas']['PlanResponse'];
export type MigrationSource = { repo: string; ref: string; projectSlug: string };

export async function scanMigrationProject(
  source: MigrationSource,
  only: string[] = [],
  signal?: AbortSignal,
  appSlugs?: Record<string, string>
): Promise<MigrationPlan> {
  return unwrap(
    api.POST('/v1/projects/scan/source-ref', {
      body: {
        repo: source.repo,
        ref: source.ref,
        project_slug: source.projectSlug,
        only,
        migration: true,
        ...(appSlugs ? { app_slugs: appSlugs } : {}),
      },
      signal,
    })
  );
}

// Deliberately outside TanStack mutations: initial secret values must never
// enter a mutation cache, query key, URL, or persistent browser storage.
export async function applyMigrationPlan(
  request: components['schemas']['ApplyCachedProjectPlanRequest'],
  idempotencyKey: string
): Promise<components['schemas']['ApplyResponse']> {
  return unwrap(
    api.POST('/v1/projects/apply-plan', {
      body: request,
      headers: { 'Idempotency-Key': idempotencyKey },
    })
  );
}

export type SavedProjectMigration = components['schemas']['ProjectMigration'];
export async function createProjectMigration(
  request: components['schemas']['CreateProjectMigrationRequest']
): Promise<SavedProjectMigration> {
  return unwrap(api.POST('/v1/project-migrations', { body: request }));
}
export async function getProjectMigration(id: string, signal?: AbortSignal) {
  return unwrap(
    api.GET('/v1/project-migrations/{migration}', { params: { path: { migration: id } }, signal })
  );
}
export async function listProjectMigrations(project: string, signal?: AbortSignal) {
  return unwrap(api.GET('/v1/project-migrations', { params: { query: { project } }, signal }));
}
export async function resumeProjectMigration(
  id: string,
  request: components['schemas']['ResumeProjectMigrationRequest']
) {
  return unwrap(
    api.POST('/v1/project-migrations/{migration}/resume', {
      params: { path: { migration: id } },
      body: request,
    })
  );
}
