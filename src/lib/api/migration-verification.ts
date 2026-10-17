import { api, unwrap } from './client';
import type { components } from './schema';

export type MigrationVerification = components['schemas']['MigrationVerification'];
export type MigrationVerificationRequest =
  components['schemas']['CreateMigrationVerificationRequest'];

export function listMigrationVerifications(slug: string, signal?: AbortSignal) {
  return unwrap(
    api.GET('/v1/apps/{slug}/migration-verifications', {
      params: { path: { slug } },
      signal,
    })
  );
}
export function createMigrationVerification(slug: string, body: MigrationVerificationRequest) {
  return unwrap(
    api.POST('/v1/apps/{slug}/migration-verifications', {
      params: { path: { slug } },
      body,
    })
  );
}
export function advanceMigrationVerification(slug: string, run: string) {
  return unwrap(
    api.POST('/v1/apps/{slug}/migration-verifications/{run}/advance', {
      params: { path: { slug, run } },
    })
  );
}

export function cancelMigrationVerification(slug: string, run: string) {
  return unwrap(
    api.POST('/v1/apps/{slug}/migration-verifications/{run}/cancel', {
      params: { path: { slug, run } },
    })
  );
}
