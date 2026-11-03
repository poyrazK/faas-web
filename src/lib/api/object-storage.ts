import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from './client';
import type { components } from './schema';

export type ObjectBucket = components['schemas']['ObjectBucket'];
export const bucketKey = (slug: string) => ['object-buckets', slug] as const;
export const objectKey = (slug: string, bucket: string) =>
  ['bucket-objects', slug, bucket] as const;

export function useObjectBuckets(slug: string) {
  return useQuery({
    queryKey: bucketKey(slug),
    queryFn: () => unwrap(api.GET('/v1/apps/{slug}/buckets', { params: { path: { slug } } })),
    enabled: !!slug,
    retry: false,
  });
}

export function useBucketObjects(slug: string, bucket: string, prefix: string, cursor: string) {
  return useQuery({
    queryKey: [...objectKey(slug, bucket), prefix, cursor],
    queryFn: () =>
      unwrap(
        api.GET('/v1/apps/{slug}/buckets/{bucket}/objects', {
          params: { path: { slug, bucket }, query: { prefix, cursor, limit: 100 } },
        })
      ),
    enabled: !!slug && !!bucket,
    retry: false,
  });
}

export function createObjectBucket(slug: string, name: string, scope: string, region: string) {
  return unwrap(
    api.POST('/v1/apps/{slug}/buckets', {
      params: { path: { slug } },
      body: { name, scope, region },
    })
  );
}

export function deleteObjectBucket(slug: string, bucket: string) {
  return unwrap(
    api.DELETE('/v1/apps/{slug}/buckets/{bucket}', { params: { path: { slug, bucket } } })
  );
}

export function deleteStoredObject(slug: string, bucket: string, key: string) {
  return unwrap(
    api.DELETE('/v1/apps/{slug}/buckets/{bucket}/objects', {
      params: { path: { slug, bucket }, query: { key } },
    })
  );
}

export function signStoredObject(
  slug: string,
  bucket: string,
  body: components['schemas']['ObjectSignRequest']
) {
  return unwrap(
    api.POST('/v1/apps/{slug}/buckets/{bucket}/signed-url', {
      params: { path: { slug, bucket } },
      body,
    })
  );
}

/**
 * A request to a signed URL goes to the storage host, not to the API, so a
 * network failure there is not "could not reach the API": the API just
 * answered with the URL. `errorMessage` shows this message as it is.
 */
export class StorageUnreachableError extends Error {
  constructor() {
    super('Could not reach the storage endpoint. Check your connection and try again.');
    this.name = 'StorageUnreachableError';
  }
}

/** fetch against a signed URL, with its network failures named for the storage host. */
async function fetchSigned(url: string, init: RequestInit) {
  try {
    return await fetch(url, init);
  } catch (error) {
    // fetch rejects with a TypeError for CORS, DNS and dropped connections.
    if (error instanceof TypeError) throw new StorageUnreachableError();
    throw error;
  }
}

/** Direct provider request: never use the authenticated Gregale client. */
export async function uploadSignedObject(
  signed: components['schemas']['ObjectSignedRequest'],
  file: Blob
) {
  const headers = new Headers(signed.headers);
  // fetch sets this forbidden header from the File body, matching the signature.
  headers.delete('Content-Length');
  const response = await fetchSigned(signed.url, {
    method: 'PUT',
    headers,
    body: file,
    credentials: 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
  });
  // Provider error bodies may contain infrastructure details. Do not display them.
  if (!response.ok)
    throw new Error(`Upload failed (${response.status}). Request a new upload and try again.`);
}

/** Read an object through a signed GET URL, with the same provider hygiene as uploads. */
export async function downloadSignedObject(signed: components['schemas']['ObjectSignedRequest']) {
  const response = await fetchSigned(signed.url, {
    method: 'GET',
    headers: new Headers(signed.headers),
    credentials: 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
  });
  if (!response.ok) throw new Error(`Download failed (${response.status}). Try again in a moment.`);
  return response.blob();
}

/* ------------------------------------------------------------------ *
 * Bucket access: API-key grants and S3 credentials
 * ------------------------------------------------------------------ */

export const grantKey = (slug: string, bucket: string) =>
  ['apps', slug, 'buckets', bucket, 'access-grants'] as const;
export const s3CredentialKey = (slug: string, bucket: string) =>
  ['apps', slug, 'buckets', bucket, 's3-credentials'] as const;

/** Which of the account's API keys may read or write this bucket. */
export function useBucketAccessGrants(slug: string, bucket: string) {
  return useQuery({
    queryKey: grantKey(slug, bucket),
    queryFn: () =>
      unwrap(
        api.GET('/v1/apps/{slug}/buckets/{bucket}/access-grants', {
          params: { path: { slug, bucket } },
        })
      ),
    enabled: Boolean(slug && bucket),
  });
}

export function setBucketAccessGrant(
  slug: string,
  bucket: string,
  key: string,
  permission: 'read' | 'write' | 'read_write'
) {
  return unwrap(
    api.PUT('/v1/apps/{slug}/buckets/{bucket}/access-grants/{key}', {
      params: { path: { slug, bucket, key } },
      body: { permission },
    })
  );
}

export function deleteBucketAccessGrant(slug: string, bucket: string, key: string) {
  return unwrap(
    api.DELETE('/v1/apps/{slug}/buckets/{bucket}/access-grants/{key}', {
      params: { path: { slug, bucket, key } },
    })
  );
}

/** Credentials for the S3-compatible endpoint; the secret is shown once. */
export function useBucketS3Credentials(slug: string, bucket: string) {
  return useQuery({
    queryKey: s3CredentialKey(slug, bucket),
    queryFn: () =>
      unwrap(
        api.GET('/v1/apps/{slug}/buckets/{bucket}/s3-credentials', {
          params: { path: { slug, bucket } },
        })
      ),
    enabled: Boolean(slug && bucket),
  });
}

export function createBucketS3Credential(
  slug: string,
  bucket: string,
  label: string,
  permission: 'read' | 'write' | 'read_write'
) {
  return unwrap(
    api.POST('/v1/apps/{slug}/buckets/{bucket}/s3-credentials', {
      params: { path: { slug, bucket } },
      body: { label, permission },
    })
  );
}

export function revokeBucketS3Credential(slug: string, bucket: string, credential: string) {
  return unwrap(
    api.DELETE('/v1/apps/{slug}/buckets/{bucket}/s3-credentials/{credential}', {
      params: { path: { slug, bucket, credential } },
    })
  );
}

/* ------------------------------------------------------------------ *
 * Compute bindings: the owning app's runtime reaching its bucket
 * ------------------------------------------------------------------ */

export type BucketBinding = components['schemas']['ObjectStorageComputeBinding'];
export type BindingPermission =
  components['schemas']['CreateObjectStorageComputeBindingRequest']['permission'];

export const bindingKey = (slug: string, bucket: string) =>
  ['apps', slug, 'buckets', bucket, 'compute-bindings'] as const;

/** Bindings for one bucket. Secret values are never returned, only their names. */
export function useBucketBindings(slug: string, bucket: string) {
  return useQuery({
    queryKey: bindingKey(slug, bucket),
    queryFn: () =>
      unwrap(
        api.GET('/v1/apps/{slug}/buckets/{bucket}/compute-bindings', {
          params: { path: { slug, bucket } },
        })
      ),
    enabled: Boolean(slug && bucket),
    // A rotation keeps the previous key until the rolling refresh drains; poll until it settles.
    refetchInterval: (query) =>
      query.state.data?.items.some((b) => b.rotation_pending) ? 5_000 : false,
  });
}

/**
 * Inject a least-privilege credential for this bucket into the app as sealed
 * secrets. Without a prefix, apid names them GREGALE_S3_<BUCKET>_*.
 */
export function createBucketBinding(
  slug: string,
  bucket: string,
  input: { permission: BindingPermission; prefix?: string }
) {
  return unwrap(
    api.POST('/v1/apps/{slug}/buckets/{bucket}/compute-bindings', {
      params: { path: { slug, bucket } },
      body: { permission: input.permission, ...(input.prefix ? { prefix: input.prefix } : {}) },
    })
  );
}

export function rotateBucketBinding(slug: string, bucket: string, binding: string) {
  return unwrap(
    api.POST('/v1/apps/{slug}/buckets/{bucket}/compute-bindings/{binding}/rotate', {
      params: { path: { slug, bucket, binding } },
    })
  );
}

export function revokeBucketBinding(slug: string, bucket: string, binding: string) {
  return unwrap(
    api.DELETE('/v1/apps/{slug}/buckets/{bucket}/compute-bindings/{binding}', {
      params: { path: { slug, bucket, binding } },
    })
  );
}

/* ------------------------------------------------------------------ *
 * Versioning: the bucket setting, its retained versions, and restore
 * ------------------------------------------------------------------ */

export type BucketVersioning = components['schemas']['ObjectBucketVersioning'];
export type ObjectVersion = components['schemas']['ObjectVersion'];
export type VersioningStatus = components['schemas']['ObjectBucketVersioningRequest']['status'];

export const versioningKey = (slug: string, bucket: string) =>
  ['apps', slug, 'buckets', bucket, 'versioning'] as const;
export const versionsKey = (slug: string, bucket: string) =>
  ['apps', slug, 'buckets', bucket, 'versions'] as const;

export function useBucketVersioning(slug: string, bucket: string) {
  return useQuery({
    queryKey: versioningKey(slug, bucket),
    queryFn: () =>
      unwrap(
        api.GET('/v1/apps/{slug}/buckets/{bucket}/versioning', {
          params: { path: { slug, bucket } },
        })
      ),
    enabled: Boolean(slug && bucket),
    retry: false,
    // A change drains writes, propagates for at least fifteen minutes and then
    // inventories every version; follow it until apid reports it ready.
    refetchInterval: (query) =>
      query.state.data && query.state.data.state !== 'ready' ? 10_000 : false,
  });
}

/** Ask apid to turn versioning on or suspend it. It answers 202 and the change runs on. */
export function setBucketVersioning(slug: string, bucket: string, status: VersioningStatus) {
  return unwrap(
    api.PUT('/v1/apps/{slug}/buckets/{bucket}/versioning', {
      params: { path: { slug, bucket } },
      body: { status },
    })
  );
}

/** Where a page of versions starts: both markers come from the previous page. */
export interface VersionMarker {
  key: string;
  version: string;
}

/**
 * Retained versions and delete markers under a prefix, one folder level at a
 * time: the `/` delimiter turns deeper keys into common prefixes.
 */
export function useObjectVersions(
  slug: string,
  bucket: string,
  prefix: string,
  marker: VersionMarker | null
) {
  return useQuery({
    queryKey: [...versionsKey(slug, bucket), prefix, marker?.key ?? '', marker?.version ?? ''],
    queryFn: () =>
      unwrap(
        api.GET('/v1/apps/{slug}/buckets/{bucket}/objects/versions', {
          params: {
            path: { slug, bucket },
            query: {
              prefix,
              delimiter: '/',
              limit: 100,
              ...(marker ? { key_marker: marker.key, version_id_marker: marker.version } : {}),
            },
          },
        })
      ),
    enabled: Boolean(slug && bucket),
    retry: false,
  });
}

/** Permanently delete one version or delete marker. Removing a marker can reveal older data. */
export function deleteObjectVersion(slug: string, bucket: string, key: string, versionId: string) {
  return unwrap(
    api.DELETE('/v1/apps/{slug}/buckets/{bucket}/objects/versions', {
      params: { path: { slug, bucket }, query: { key, version_id: versionId } },
    })
  );
}

/**
 * Make an older version current again by writing a copy of it on top. apid has
 * no server-side restore, so this reads the exact version through a signed GET
 * and writes it back through a signed PUT, both on the storage host. The
 * version being restored is left where it is.
 */
export async function restoreObjectVersion(slug: string, bucket: string, version: ObjectVersion) {
  const read = await signStoredObject(slug, bucket, {
    method: 'GET',
    expires_in: 300,
    key: version.key,
    version_id: version.version_id,
  });
  const body = await downloadSignedObject(read);
  const write = await signStoredObject(slug, bucket, {
    method: 'PUT',
    expires_in: 300,
    key: version.key,
    size_bytes: body.size,
    content_type: body.type || 'application/octet-stream',
  });
  await uploadSignedObject(write, body);
}

/* ------------------------------------------------------------------ *
 * Lifecycle rules
 * ------------------------------------------------------------------ */

export type LifecycleRule = components['schemas']['ObjectLifecycleRule'];
export const lifecycleKey = (slug: string, bucket: string) =>
  ['apps', slug, 'buckets', bucket, 'lifecycle'] as const;

export function useBucketLifecycle(slug: string, bucket: string) {
  return useQuery({
    queryKey: lifecycleKey(slug, bucket),
    queryFn: () =>
      unwrap(
        api.GET('/v1/apps/{slug}/buckets/{bucket}/lifecycle', {
          params: { path: { slug, bucket } },
        })
      ),
    enabled: Boolean(slug && bucket),
    retry: false,
  });
}

/** Replace the whole policy. apid takes one to a thousand rules; clearing is a DELETE. */
export function setBucketLifecycle(slug: string, bucket: string, rules: LifecycleRule[]) {
  return unwrap(
    api.PUT('/v1/apps/{slug}/buckets/{bucket}/lifecycle', {
      params: { path: { slug, bucket } },
      body: { rules },
    })
  );
}

/** Remove every rule. Deletions apid already admitted still finish. */
export function clearBucketLifecycle(slug: string, bucket: string) {
  return unwrap(
    api.DELETE('/v1/apps/{slug}/buckets/{bucket}/lifecycle', {
      params: { path: { slug, bucket } },
    })
  );
}

/* ------------------------------------------------------------------ *
 * Browser access (CORS)
 * ------------------------------------------------------------------ */

export type CorsRule = components['schemas']['ObjectBucketCORSRule'];
export const corsKey = (slug: string, bucket: string) =>
  ['apps', slug, 'buckets', bucket, 'cors'] as const;

export function useBucketCors(slug: string, bucket: string) {
  return useQuery({
    queryKey: corsKey(slug, bucket),
    queryFn: () =>
      unwrap(
        api.GET('/v1/apps/{slug}/buckets/{bucket}/cors', { params: { path: { slug, bucket } } })
      ),
    enabled: Boolean(slug && bucket),
    retry: false,
  });
}

/** Replace every rule; apid takes one to a hundred. Removing them all is a DELETE. */
export function setBucketCors(slug: string, bucket: string, rules: CorsRule[]) {
  return unwrap(
    api.PUT('/v1/apps/{slug}/buckets/{bucket}/cors', {
      params: { path: { slug, bucket } },
      body: { rules },
    })
  );
}

export function clearBucketCors(slug: string, bucket: string) {
  return unwrap(
    api.DELETE('/v1/apps/{slug}/buckets/{bucket}/cors', { params: { path: { slug, bucket } } })
  );
}

/* ------------------------------------------------------------------ *
 * Object tags
 * ------------------------------------------------------------------ */

export const tagsKey = (slug: string, bucket: string, key: string) =>
  ['apps', slug, 'buckets', bucket, 'tags', key] as const;

/** The current object's tags. Tags change in place; no new version is written. */
export function useObjectTags(slug: string, bucket: string, key: string) {
  return useQuery({
    queryKey: tagsKey(slug, bucket, key),
    queryFn: () =>
      unwrap(
        api.GET('/v1/apps/{slug}/buckets/{bucket}/objects/tags', {
          params: { path: { slug, bucket }, query: { key } },
        })
      ),
    enabled: Boolean(slug && bucket && key),
    retry: false,
  });
}

/** Replace the whole tag set (up to ten). An empty set is a DELETE. */
export function setObjectTags(
  slug: string,
  bucket: string,
  key: string,
  tags: Record<string, string>
) {
  return unwrap(
    api.PUT('/v1/apps/{slug}/buckets/{bucket}/objects/tags', {
      params: { path: { slug, bucket }, query: { key } },
      body: { tags },
    })
  );
}

export function clearObjectTags(slug: string, bucket: string, key: string) {
  return unwrap(
    api.DELETE('/v1/apps/{slug}/buckets/{bucket}/objects/tags', {
      params: { path: { slug, bucket }, query: { key } },
    })
  );
}

/* ------------------------------------------------------------------ *
 * Default encryption
 * ------------------------------------------------------------------ */

export type ObjectEncryption = components['schemas']['ObjectEncryption'];
export type BucketEncryption = components['schemas']['ObjectBucketEncryption'];
export const encryptionKey = (slug: string, bucket: string) =>
  ['apps', slug, 'buckets', bucket, 'encryption'] as const;

export function useBucketEncryption(slug: string, bucket: string) {
  return useQuery({
    queryKey: encryptionKey(slug, bucket),
    queryFn: () =>
      unwrap(
        api.GET('/v1/apps/{slug}/buckets/{bucket}/encryption', {
          params: { path: { slug, bucket } },
        })
      ),
    enabled: Boolean(slug && bucket),
    retry: false,
    // A new default is verified against storage before it applies; follow it.
    refetchInterval: (query) =>
      query.state.data && query.state.data.state !== 'ready' ? 5_000 : false,
  });
}

/** Which algorithms and owned key references this bucket's storage is enrolled for. */
export function useEncryptionCapabilities(slug: string, bucket: string) {
  return useQuery({
    queryKey: [...encryptionKey(slug, bucket), 'capabilities'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/apps/{slug}/buckets/{bucket}/encryption-capabilities', {
          params: { path: { slug, bucket } },
        })
      ),
    enabled: Boolean(slug && bucket),
    retry: false,
  });
}

export function setBucketEncryption(slug: string, bucket: string, encryption: ObjectEncryption) {
  return unwrap(
    api.PUT('/v1/apps/{slug}/buckets/{bucket}/encryption', {
      params: { path: { slug, bucket } },
      body: { encryption },
    })
  );
}

export function clearBucketEncryption(slug: string, bucket: string) {
  return unwrap(
    api.DELETE('/v1/apps/{slug}/buckets/{bucket}/encryption', {
      params: { path: { slug, bucket } },
    })
  );
}

/* ------------------------------------------------------------------ *
 * Object Lock, retention and legal holds
 * ------------------------------------------------------------------ */

export type BucketObjectLock = components['schemas']['ObjectBucketObjectLock'];
export type ObjectLockConfiguration = components['schemas']['ObjectBucketObjectLockConfiguration'];
export type VersionRetention = components['schemas']['ObjectVersionRetention'];
export type VersionProtection = components['schemas']['ObjectVersionProtection'];
export const objectLockKey = (slug: string, bucket: string) =>
  ['apps', slug, 'buckets', bucket, 'object-lock'] as const;
export const protectionKey = (slug: string, bucket: string, key: string, version: string) =>
  ['apps', slug, 'buckets', bucket, 'protection', key, version] as const;

export function useBucketObjectLock(slug: string, bucket: string) {
  return useQuery({
    queryKey: objectLockKey(slug, bucket),
    queryFn: () =>
      unwrap(
        api.GET('/v1/apps/{slug}/buckets/{bucket}/object-lock', {
          params: { path: { slug, bucket } },
        })
      ),
    enabled: Boolean(slug && bucket),
    retry: false,
    refetchInterval: (query) =>
      query.state.data && query.state.data.state !== 'ready' ? 10_000 : false,
  });
}

export function useObjectLockCapabilities(slug: string, bucket: string) {
  return useQuery({
    queryKey: [...objectLockKey(slug, bucket), 'capabilities'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/apps/{slug}/buckets/{bucket}/object-lock-capabilities', {
          params: { path: { slug, bucket } },
        })
      ),
    enabled: Boolean(slug && bucket),
    retry: false,
  });
}

/** Enabling is permanent; a configuration without defaults clears them and keeps the lock. */
export function setBucketObjectLock(
  slug: string,
  bucket: string,
  configuration: ObjectLockConfiguration
) {
  return unwrap(
    api.PUT('/v1/apps/{slug}/buckets/{bucket}/object-lock', {
      params: { path: { slug, bucket } },
      body: { configuration },
    })
  );
}

export function useVersionLegalHold(
  slug: string,
  bucket: string,
  key: string,
  version: string,
  enabled: boolean
) {
  return useQuery({
    queryKey: [...protectionKey(slug, bucket, key, version), 'legal-hold'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/apps/{slug}/buckets/{bucket}/objects/protection/legal-hold', {
          params: { path: { slug, bucket }, query: { key, version_id: version } },
        })
      ),
    enabled: enabled && Boolean(slug && bucket && key && version),
    retry: false,
  });
}

export function useVersionRetention(
  slug: string,
  bucket: string,
  key: string,
  version: string,
  enabled: boolean
) {
  return useQuery({
    queryKey: [...protectionKey(slug, bucket, key, version), 'retention'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/apps/{slug}/buckets/{bucket}/objects/protection/retention', {
          params: { path: { slug, bucket }, query: { key, version_id: version } },
        })
      ),
    enabled: enabled && Boolean(slug && bucket && key && version),
    retry: false,
  });
}

/**
 * Each change carries an operation ID the caller chooses, so a retry of the
 * same intent is safe. apid accepts it durably and a worker applies it.
 */
export function setVersionLegalHold(
  slug: string,
  bucket: string,
  key: string,
  version: string,
  status: 'ON' | 'OFF',
  id: string = crypto.randomUUID()
) {
  return unwrap(
    api.PUT('/v1/apps/{slug}/buckets/{bucket}/objects/protection/legal-hold', {
      params: { path: { slug, bucket }, query: { key, version_id: version } },
      body: { id, legal_hold: { status } },
    })
  );
}

export function setVersionRetention(
  slug: string,
  bucket: string,
  key: string,
  version: string,
  retention: VersionRetention,
  id: string = crypto.randomUUID()
) {
  return unwrap(
    api.PUT('/v1/apps/{slug}/buckets/{bucket}/objects/protection/retention', {
      params: { path: { slug, bucket }, query: { key, version_id: version } },
      body: { id, retention },
    })
  );
}

/** A protection change until a worker settles it as ready or failed. */
export function useProtectionOperation(slug: string, bucket: string, operation: string) {
  return useQuery({
    queryKey: ['apps', slug, 'buckets', bucket, 'protection-operations', operation],
    queryFn: () =>
      unwrap(
        api.GET('/v1/apps/{slug}/buckets/{bucket}/protection-operations/{operation}', {
          params: { path: { slug, bucket, operation } },
        })
      ),
    enabled: Boolean(slug && bucket && operation),
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.state === 'ready' || query.state.data?.state === 'failed' ? false : 3_000,
  });
}
