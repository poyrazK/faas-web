/**
 * Who can reach one bucket, and the names an app's code reads to reach it.
 *
 * A bucket is reachable three ways: the owning app's runtime through a compute
 * binding (credentials injected as sealed env vars), an account API key with a
 * grant, or a standalone S3 key for tools outside Gregale. A binding's
 * credential is an ordinary S3 credential too, and the S3-credential list
 * returns it, so it is drawn once, as the app's connection.
 */

export type Permission = 'read' | 'write' | 'read_write';
export type AccessLane = 'app' | 'api-key' | 's3-key';

export interface AccessConnection {
  id: string;
  lane: AccessLane;
  label: string;
  permission: Permission;
  /** A binding whose previous key is still valid during a rolling refresh. */
  pending?: boolean;
}

interface CredentialLike {
  id: string;
  label: string;
  permission: Permission;
  status: string;
}

interface BindingLike {
  id: string;
  prefix: string;
  credential: CredentialLike;
  rotation_pending?: boolean;
}

interface GrantLike {
  key_id: string;
  key_label: string;
  key_status: string;
  permission: Permission;
}

export function accessModel(input: {
  bindings: readonly BindingLike[];
  grants: readonly GrantLike[];
  credentials: readonly CredentialLike[];
}): AccessConnection[] {
  const boundCredentials = new Set(input.bindings.map((b) => b.credential.id));
  return [
    ...input.bindings.map((b) => ({
      id: `binding:${b.id}`,
      lane: 'app' as const,
      label: b.prefix,
      permission: b.credential.permission,
      ...(b.rotation_pending ? { pending: true } : {}),
    })),
    ...input.grants
      .filter((g) => g.key_status !== 'revoked')
      .map((g) => ({
        id: `grant:${g.key_id}`,
        lane: 'api-key' as const,
        label: g.key_label,
        permission: g.permission,
      })),
    ...input.credentials
      .filter((c) => c.status === 'active' && !boundCredentials.has(c.id))
      .map((c) => ({
        id: `s3:${c.id}`,
        lane: 's3-key' as const,
        label: c.label,
        permission: c.permission,
      })),
  ];
}

/**
 * The prefix apid uses when a binding names none: `GREGALE_S3_` plus the
 * bucket name upper-cased, other characters as `_`, trailing `_` trimmed,
 * capped at 48 (poyrazK/faas pkg/apid/object/storage_compute_binding.go).
 */
export function defaultBindingPrefix(bucketName: string): string {
  const raw = `GREGALE_S3_${bucketName.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`.replace(
    /_+$/,
    ''
  );
  return raw.length > 48 ? raw.slice(0, 48).replace(/_+$/, '') : raw;
}

/** The six sealed secrets a binding writes, by the names the app reads. */
export function bindingEnvNames(prefix: string) {
  return {
    endpoint: `${prefix}_ENDPOINT`,
    region: `${prefix}_REGION`,
    bucket: `${prefix}_BUCKET`,
    access_key_id: `${prefix}_ACCESS_KEY_ID`,
    secret_access_key: `${prefix}_SECRET_ACCESS_KEY`,
    addressing_style: `${prefix}_ADDRESSING_STYLE`,
  };
}
