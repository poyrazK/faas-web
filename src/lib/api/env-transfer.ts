import { api, unwrap } from './client';
import type { EnvEntry } from '../env-parse';
import { errorMessage } from './errors';
import { ENV_SCOPE, serializeEnvExport } from '../env-transfer';

export interface EnvBatchResult {
  saved: string[];
  failed: { key: string; message: string }[];
}
/** The current API has single-key writes: one confirmed batch may partially succeed. */
export async function applyEnvImport(
  slug: string,
  scope: string,
  entries: EnvEntry[],
  signal?: AbortSignal
): Promise<EnvBatchResult> {
  if (!slug || !ENV_SCOPE.test(scope)) throw new Error('Choose a valid app and scope.');
  const result: EnvBatchResult = { saved: [], failed: [] };
  for (const { key, value } of entries) {
    if (signal?.aborted) break;
    try {
      await unwrap(
        api.PUT('/v1/apps/{slug}/env/{key}', {
          params: { path: { slug, key }, query: { scope } },
          body: { value },
          signal,
        })
      );
      result.saved.push(key);
    } catch (error) {
      if (signal?.aborted) break;
      result.failed.push({ key, message: errorMessage(error) });
    }
  }
  return result;
}

/** Plaintext lives only in this request and the explicit download, never a query/mutation cache. */
export async function fetchEnvExport(
  slug: string,
  scope: string,
  signal?: AbortSignal
): Promise<string> {
  if (!slug || !ENV_SCOPE.test(scope)) throw new Error('Choose a valid app and scope.');
  const response = await unwrap(
    api.POST('/v1/apps/{slug}/env-export', {
      params: { path: { slug }, query: { scope } },
      body: { acknowledge_sensitive_values: true },
      cache: 'no-store',
      signal,
    })
  );
  if (response.app_slug !== slug || response.scope !== scope)
    throw new Error('The export belongs to a different app or scope.');
  return serializeEnvExport(response.values);
}
