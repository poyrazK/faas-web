import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { safeMcpBase } from '../mcp-guidance';

export type McpApp = {
  accountId: string;
  appId: string;
  slug: string;
  streamingEnabled?: boolean;
  visibility?: 'public' | 'internal';
  executionMode?: string;
  publicUrl?: string;
};
async function verifyAccount(accountId: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const account = await unwrap(api.GET('/v1/account', { signal }));
  signal?.throwIfAborted();
  if (account.id !== accountId) throw new Error('The account changed. Refresh this app context.');
}
export async function readMcpApp(
  accountId: string,
  slug: string,
  signal?: AbortSignal
): Promise<McpApp> {
  await verifyAccount(accountId, signal);
  const app = await unwrap(api.GET('/v1/apps/{slug}', { params: { path: { slug } }, signal }));
  await verifyAccount(accountId, signal);
  if (!app.id || app.slug !== slug) throw new Error('The app identity was not confirmed.');
  return {
    accountId,
    appId: app.id,
    slug,
    ...(typeof app.streaming_enabled === 'boolean'
      ? { streamingEnabled: app.streaming_enabled }
      : {}),
    ...(app.visibility === 'public' || app.visibility === 'internal'
      ? { visibility: app.visibility }
      : {}),
    ...(typeof app.manifest?.execution_mode === 'string'
      ? { executionMode: app.manifest.execution_mode }
      : {}),
    ...(safeMcpBase(app.url) ? { publicUrl: safeMcpBase(app.url) } : {}),
  };
}
export function useMcpApp(accountId: string, slug: string) {
  return useQuery({
    queryKey: ['account', accountId, 'app', slug, 'mcp-guidance'],
    queryFn: ({ signal }) => readMcpApp(accountId, slug, signal),
    enabled: Boolean(accountId && slug),
    retry: false,
    staleTime: 0,
  });
}
