import { describe, expect, it } from 'vitest';
import { accessModel, bindingEnvNames, defaultBindingPrefix } from './storage-access';

// Mirrors poyrazK/faas pkg/apid/object/storage_compute_binding.go
// (defaultObjectStorageBindingPrefix and ObjectStorageBindingSecretKeys).
describe('defaultBindingPrefix', () => {
  it('upper-cases the bucket name under GREGALE_S3_', () => {
    expect(defaultBindingPrefix('assets')).toBe('GREGALE_S3_ASSETS');
  });

  it('turns every other character into an underscore and trims trailing ones', () => {
    expect(defaultBindingPrefix('user-uploads-')).toBe('GREGALE_S3_USER_UPLOADS');
  });

  it('caps the prefix at 48 characters without a trailing underscore', () => {
    const prefix = defaultBindingPrefix(`a${'-b'.repeat(40)}`);
    expect(prefix.length).toBeLessThanOrEqual(48);
    expect(prefix.endsWith('_')).toBe(false);
  });
});

describe('bindingEnvNames', () => {
  it('names the six variables the platform injects', () => {
    expect(bindingEnvNames('MEDIA')).toEqual({
      endpoint: 'MEDIA_ENDPOINT',
      region: 'MEDIA_REGION',
      bucket: 'MEDIA_BUCKET',
      access_key_id: 'MEDIA_ACCESS_KEY_ID',
      secret_access_key: 'MEDIA_SECRET_ACCESS_KEY',
      addressing_style: 'MEDIA_ADDRESSING_STYLE',
    });
  });
});

const credential = (id: string, permission: 'read' | 'write' | 'read_write', label = id) => ({
  id,
  bucket_id: 'b',
  access_key_id: `GRGA${id.toUpperCase().padEnd(16, 'A')}`,
  label,
  permission,
  status: 'active' as const,
  created_at: '2026-10-01T00:00:00Z',
});

describe('accessModel', () => {
  it('groups everything that can reach a bucket into app, API key and S3 key lanes', () => {
    const model = accessModel({
      bindings: [
        {
          id: 'bind1',
          prefix: 'GREGALE_S3_ASSETS',
          credential: credential('c-bind', 'read_write', 'compute'),
        },
      ],
      grants: [{ key_id: 'k1', key_label: 'deploy', key_status: 'active', permission: 'write' }],
      credentials: [
        credential('c-bind', 'read_write', 'compute'),
        credential('c-ci', 'read', 'ci'),
      ],
    });
    expect(model.map((c) => [c.lane, c.label, c.permission])).toEqual([
      ['app', 'GREGALE_S3_ASSETS', 'read_write'],
      ['api-key', 'deploy', 'write'],
      ['s3-key', 'ci', 'read'],
    ]);
  });

  it('does not count a binding’s own credential a second time as an S3 key', () => {
    const model = accessModel({
      bindings: [{ id: 'b1', prefix: 'P', credential: credential('same', 'read') }],
      grants: [],
      credentials: [credential('same', 'read')],
    });
    expect(model.filter((c) => c.lane === 's3-key')).toHaveLength(0);
  });

  it('leaves out grants on revoked keys, which grant nothing', () => {
    const model = accessModel({
      bindings: [],
      grants: [{ key_id: 'k', key_label: 'old', key_status: 'revoked', permission: 'read' }],
      credentials: [],
    });
    expect(model).toEqual([]);
  });

  it('marks a binding mid-rotation', () => {
    const model = accessModel({
      bindings: [
        { id: 'b', prefix: 'P', credential: credential('c', 'read'), rotation_pending: true },
      ],
      grants: [],
      credentials: [],
    });
    expect(model[0].pending).toBe(true);
  });
});
