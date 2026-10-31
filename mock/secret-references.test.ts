import { expect, it } from 'vitest';
import * as db from './data';
import {
  readReferences,
  readRevocation,
  recordRevocation,
  removeReference,
  scopedSecrets,
  writeReference,
} from './secret-references';

const app = (slug: string) => db.apps.find((a) => a.slug === slug)!;
const ok = <T>(result: { ok: T } | { fail: unknown }) => {
  if (!('ok' in result)) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
  return result.ok;
};
const fail = (result: { ok: unknown } | { fail: { code: string } }) =>
  'fail' in result ? result.fail.code : 'ok';

it('lists the seeded references, suppressed keys and the shared quota of a project app', () => {
  const out = ok(readReferences(app('api-gateway'), 'production'));
  expect(out.environment).toBe('production');
  expect(out.environment_id).toBeTruthy();
  expect(out.references).toEqual({ DATABASE_URL: 'secret:DATABASE_PRIMARY' });
  expect(out.suppressed_keys).toEqual(['LEGACY_TOKEN']);
  expect(out.count).toBeGreaterThan(0);
  expect(out.quota).toBe(128);
});

it('answers not_found for an app outside every project, and validation for default', () => {
  // The seeded PR preview belongs to no project.
  const standalone = db.apps.find((a) => a.preview_of_slug)!;
  expect(fail(readReferences(standalone, 'production'))).toBe('not_found');
  expect(fail(readReferences(app('api-gateway'), 'qa'))).toBe('not_found');
  expect(fail(readReferences(app('api-gateway'), 'default'))).toBe('validation_failed');
  expect(fail(readReferences(app('api-gateway'), 'pr-preview'))).toBe('validation_failed');
});

it('offers only the secrets set in that exact environment as sources', () => {
  expect(scopedSecrets(app('api-gateway'), 'production').map((s) => s.key)).toEqual([
    'DATABASE_PRIMARY',
    'STRIPE_LIVE_KEY',
  ]);
  expect(scopedSecrets(app('api-gateway'), 'staging').map((s) => s.key)).toEqual([
    'DATABASE_PRIMARY',
  ]);
  for (const row of scopedSecrets(app('api-gateway'), 'staging')) expect(row.scope).toBe('staging');
});

it('sets a reference to a source in the same environment and clears its suppression', () => {
  const a = app('api-gateway');
  const out = ok(writeReference(a, 'production', 'LEGACY_TOKEN', 'secret:STRIPE_LIVE_KEY'));
  expect(out).toMatchObject({ key: 'LEGACY_TOKEN', reference: 'secret:STRIPE_LIVE_KEY' });
  const list = ok(readReferences(a, 'production'));
  expect(list.references.LEGACY_TOKEN).toBe('secret:STRIPE_LIVE_KEY');
  expect(list.suppressed_keys ?? []).not.toContain('LEGACY_TOKEN');
});

it('rejects a source missing from the environment, a plain-variable shadow, and Git ownership', () => {
  const a = app('api-gateway');
  expect(fail(writeReference(a, 'staging', 'PAYMENTS_KEY', 'secret:STRIPE_LIVE_KEY'))).toBe(
    'secret_not_found'
  );
  expect(fail(writeReference(a, 'production', 'REGION', 'secret:DATABASE_PRIMARY'))).toBe(
    'secret_reference_conflict'
  );
  expect(fail(writeReference(a, 'production', 'X', 'DATABASE_PRIMARY'))).toBe('validation_failed');
  expect(fail(writeReference(a, 'production', 'lower', 'secret:DATABASE_PRIMARY'))).toBe(
    'env_var_invalid_key'
  );
  expect(
    fail(writeReference(app('webhook-router'), 'production', 'API_KEY', 'secret:API_KEY'))
  ).toBe('environment_field_git_managed');
});

it('removing a reference suppresses its destination and keeps the sealed source', () => {
  const a = app('image-resize');
  ok(writeReference(a, 'staging', 'CACHE_URL', 'secret:CACHE_PRIMARY'));
  ok(removeReference(a, 'staging', 'CACHE_URL'));
  const list = ok(readReferences(a, 'staging'));
  expect(list.references.CACHE_URL).toBeUndefined();
  expect(list.suppressed_keys).toContain('CACHE_URL');
  expect(scopedSecrets(a, 'staging').map((s) => s.key)).toContain('CACHE_PRIMARY');
});

it('records a revocation whose targets acknowledge over time on a reload-enabled app', () => {
  const a = app('api-gateway');
  const start = Date.now();
  const made = recordRevocation(a, 'default', 'JWT_SIGNING_KEY', start);
  expect(made).toMatchObject({ key: 'JWT_SIGNING_KEY', scope: 'default', status: 'pending' });
  expect(made.target_count).toBe(2);
  expect(made.pending_count).toBe(2);
  const later = readRevocation(a, made.id, start + 60_000)!;
  expect(later.status).toBe('complete');
  expect(later.acknowledged_count).toBe(2);
  for (const t of later.targets) {
    expect(t.status).toBe('applied');
    expect(t.ack_revision).toMatch(/^[0-9a-f]{64}$/);
  }
});

it('blocks on a restart-only runtime, fails on an application error, and completes with none', () => {
  const now = Date.now();
  const blocked = recordRevocation(app('image-resize'), 'default', 'S3_SECRET', now);
  expect(readRevocation(app('image-resize'), blocked.id, now + 60_000)!.status).toBe('blocked');
  const failed = recordRevocation(app('webhook-router'), 'default', 'REDIS_URL', now);
  const settled = readRevocation(app('webhook-router'), failed.id, now + 60_000)!;
  expect(settled.status).toBe('failed');
  expect(settled.targets[0].error_code).toBe('application_reload_failed');
  const idle = recordRevocation(app('nightly-etl'), 'default', 'DATABASE_URL', now);
  expect(idle).toMatchObject({ status: 'complete', target_count: 0 });
});

it('never shows one app another app’s revocation', () => {
  const made = recordRevocation(app('api-gateway'), 'default', 'REDIS_URL');
  expect(readRevocation(app('image-resize'), made.id)).toBeUndefined();
});
