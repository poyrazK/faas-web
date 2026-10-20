import { api, unwrap } from './client';
import type { components } from './schema';

export type MigrationCutover = components['schemas']['MigrationCutover'];
export type MigrationCutoverRequest = components['schemas']['CreateMigrationCutoverRequest'];
export type MigrationCutoverAction = components['schemas']['MigrationCutoverActionRequest'];

export function listMigrationCutovers(slug: string, signal?: AbortSignal) {
  return unwrap(
    api.GET('/v1/apps/{slug}/migration-cutovers', { params: { path: { slug } }, signal })
  );
}
export function createMigrationCutover(slug: string, body: MigrationCutoverRequest) {
  return unwrap(
    api.POST('/v1/apps/{slug}/migration-cutovers', { params: { path: { slug } }, body })
  );
}
export function actOnMigrationCutover(slug: string, plan: string, body: MigrationCutoverAction) {
  return unwrap(
    api.POST('/v1/apps/{slug}/migration-cutovers/{plan}/actions', {
      params: { path: { slug, plan } },
      body,
    })
  );
}
export function connectMigrationDomain(slug: string, domain: string) {
  return unwrap(api.POST('/v1/domains', { body: { app_id: slug, domain } }));
}
