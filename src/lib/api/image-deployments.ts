import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import type { components } from './schema';
import { keys } from './queries';
import type { ImageCreateRequest } from '../image-operation';
export function createImageApp(body: ImageCreateRequest, idempotencyKey: string) {
  return unwrap(
    api.POST('/v1/apps', {
      body: { cpu_millicores: 1000, head_wakes: false, crawler_policy: 'wake', ...body },
      headers: { 'Idempotency-Key': idempotencyKey },
    })
  );
}
export function deployImage(
  slug: string,
  request: components['schemas']['CreateDeploymentRequest'],
  idempotencyKey: string
) {
  return unwrap(
    api.POST('/v1/apps/{slug}/deployments', {
      params: { path: { slug } },
      body: request,
      headers: { 'Idempotency-Key': idempotencyKey },
    })
  );
}
export function useDeployImage(slug: string) {
  const cache = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: ({
      request,
      idempotencyKey,
    }: {
      request: components['schemas']['CreateDeploymentRequest'];
      idempotencyKey: string;
    }) => deployImage(slug, request, idempotencyKey),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: keys.apps });
      void cache.invalidateQueries({ queryKey: keys.deployments });
      void cache.invalidateQueries({ queryKey: keys.app(slug) });
    },
  });
}
