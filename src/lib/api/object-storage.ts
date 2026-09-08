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

/** Direct provider request: never use the authenticated Gregale client. */
export async function uploadSignedObject(
  signed: components['schemas']['ObjectSignedRequest'],
  file: File
) {
  const headers = new Headers(signed.headers);
  // fetch sets this forbidden header from the File body, matching the signature.
  headers.delete('Content-Length');
  const response = await fetch(signed.url, {
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

/** Account-wide object-storage accounting, with the policy caps it is measured against. */
export function useObjectStorageUsage() {
  return useQuery({
    queryKey: ['account', 'object-storage-usage'],
    queryFn: () => unwrap(api.GET('/v1/account/object-storage-usage', {})),
  });
}
