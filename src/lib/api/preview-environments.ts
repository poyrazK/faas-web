import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { ApiError } from './errors';
import { retryPolicy } from './queries';
import type { components } from './schema';
export type PreviewSet = components['schemas']['PreviewEnvironmentStatusResponse'];
export type PreviewApp = components['schemas']['AppResponse'];
class BackoffError extends ApiError {
  readonly retryAt: number;
  constructor(error: ApiError, retryAt: number) {
    super(error.problem);
    this.retryAt = retryAt;
  }
}
function retryAt(response: Response) {
  const value = response.headers.get('Retry-After');
  if (!value) return 0;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0
    ? Date.now() + seconds * 1000
    : Math.max(Date.now(), Date.parse(value) || 0);
}
async function waitForBackoff(error: unknown, signal: AbortSignal) {
  if (!(error instanceof BackoffError) || error.retryAt <= Date.now()) return;
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(
      () => {
        signal.removeEventListener('abort', abort);
        resolve();
      },
      Math.min(error.retryAt - Date.now(), 2_147_483_647)
    );
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}
export function usePreviewSet(accountId: string, root: string, pr: number) {
  const queryKey = ['preview-set', accountId, root, pr] as const;
  return useQuery({
    queryKey,
    queryFn: async ({ signal, client }) => {
      await waitForBackoff(client.getQueryState(queryKey)?.error, signal);
      const result = await api.GET('/v1/preview/{slug}/environment', {
        params: { path: { slug: root } },
        signal,
      });
      let data: PreviewSet;
      try {
        data = await unwrap(Promise.resolve(result));
      } catch (error) {
        if (error instanceof ApiError && error.isRetryable)
          throw new BackoffError(error, retryAt(result.response));
        throw error;
      }
      if (data.root_slug !== root || data.pr_number !== pr || !data.commit_sha)
        throw new ApiError({
          status: 409,
          code: 'preview_context_mismatch',
          title: 'Preview evidence does not match this selection',
        });
      return data;
    },
    enabled: Boolean(accountId && root && pr > 0),
    retry: retryPolicy,
    retryDelay: (attempt, error) =>
      Math.max(
        Math.min(1000 * 2 ** attempt, 30_000),
        error instanceof BackoffError ? error.retryAt - Date.now() : 0
      ),
    refetchInterval: (query) => {
      const error = query.state.error;
      if (error instanceof ApiError && !error.isRetryable) return false;
      if (query.state.data?.phase === 'closed') return false;
      if (
        query.state.data?.members.length &&
        query.state.data.members.every((member) => member.preview_state === 'torn_down')
      )
        return false;
      const interval = query.state.data?.phase === 'building' ? 10_000 : 30_000;
      return Math.max(interval, error instanceof BackoffError ? error.retryAt - Date.now() : 0);
    },
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    staleTime: 0,
  });
}
export function usePreviewApp(accountId: string, slug: string) {
  return useQuery({
    queryKey: ['preview-app', accountId, slug],
    queryFn: async ({ signal }) => {
      const app = await unwrap(api.GET('/v1/apps/{slug}', { params: { path: { slug } }, signal }));
      if (app.slug !== slug)
        throw new ApiError({
          status: 409,
          code: 'preview_context_mismatch',
          title: 'App evidence does not match this selection',
        });
      return app;
    },
    enabled: Boolean(accountId && slug),
    retry: retryPolicy,
    staleTime: 30_000,
  });
}
export function useProjectPreviewApps(accountId: string, projectSlug: string, enabled: boolean) {
  return useQuery({
    queryKey: ['projects', accountId, projectSlug, 'preview-apps'],
    queryFn: ({ signal }) => unwrap(api.GET('/v1/apps', { signal })),
    enabled: Boolean(enabled && accountId && projectSlug),
    retry: retryPolicy,
    staleTime: 30_000,
  });
}
