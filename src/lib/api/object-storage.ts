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
