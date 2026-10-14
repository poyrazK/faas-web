import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from './client';
import type { components } from './schema';

export type Companion = components['schemas']['CompanionDeclaration'];
export type CompanionView = components['schemas']['DeploymentCompanionsResponse'];
export type CompanionChoices = {
  appId: string;
  items: { id: string; status: string; createdAt: string }[];
  nextBefore?: string;
};

async function context(accountId: string, slug: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const account = await unwrap(api.GET('/v1/account', { signal }));
  if (account.id !== accountId) throw new Error('The account context changed. Refresh this app.');
  const app = await unwrap(api.GET('/v1/apps/{slug}', { params: { path: { slug } }, signal }));
  signal?.throwIfAborted();
  if (typeof app.id !== 'string' || !app.id || app.slug !== slug)
    throw new Error('The app identity could not be confirmed.');
  return app.id;
}
async function fence(accountId: string, slug: string, appId: string, signal?: AbortSignal) {
  if ((await context(accountId, slug, signal)) !== appId)
    throw new Error('The app context changed. Refresh this app.');
}
function invalid(): never {
  throw new Error('Declaration metadata identity or shape could not be confirmed.');
}
function companion(row: Companion): Companion {
  if (
    !row ||
    !/^[a-z0-9][a-z0-9-]{0,62}$/.test(row.name) ||
    !['init', 'sidecar'].includes(row.type) ||
    !Array.isArray(row.depends_on) ||
    row.depends_on.length > 6 ||
    !Array.isArray(row.environment_keys) ||
    row.environment_keys.some((k) => typeof k !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(k))
  )
    invalid();
  for (const value of [row.ram_mb, row.cpu_millicores, row.scratch_mb, row.port])
    if (!Number.isSafeInteger(value) || value < 0) invalid();
  if (row.port > 65535 || typeof row.primary_ingress !== 'boolean') invalid();
  // Match the immutable backend companion image predicate; accepted registry
  // and repository casing must survive inspection without permitting userinfo.
  if (
    row.image !== undefined &&
    !/^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*(:[0-9]+)?\/[A-Za-z0-9_./-]+@sha256:[0-9a-f]{64}$/.test(
      row.image
    )
  )
    invalid();
  if (
    row.preset !== undefined &&
    !['opentelemetry', 'sentry', 'datadog-dogstatsd'].includes(row.preset)
  )
    invalid();
  if (
    row.disk_io_profile !== undefined &&
    !['low', 'standard', 'high'].includes(row.disk_io_profile)
  )
    invalid();
  return {
    name: row.name,
    type: row.type,
    ram_mb: row.ram_mb,
    cpu_millicores: row.cpu_millicores,
    scratch_mb: row.scratch_mb,
    port: row.port,
    primary_ingress: row.primary_ingress,
    ...(row.image ? { image: row.image } : {}),
    ...(row.preset ? { preset: row.preset } : {}),
    ...(row.disk_io_profile ? { disk_io_profile: row.disk_io_profile } : {}),
    ...(typeof row.essential === 'boolean' ? { essential: row.essential } : {}),
    environment_keys: [...new Set(row.environment_keys)].sort(),
    depends_on: row.depends_on.map((d) => {
      if (
        !d ||
        !/^[a-z0-9][a-z0-9-]{0,62}$/.test(d.name) ||
        (d.condition !== undefined &&
          !['started', 'healthy', 'completed_successfully'].includes(d.condition))
      )
        invalid();
      return { name: d.name, condition: d.condition ?? 'started' };
    }),
  };
}
export async function readCompanions(
  accountId: string,
  slug: string,
  id: string,
  signal?: AbortSignal
): Promise<CompanionView> {
  const appId = await context(accountId, slug, signal);
  const raw = await unwrap(
    api.GET('/v1/deployments/{id}/companions', { params: { path: { id } }, signal })
  );
  await fence(accountId, slug, appId, signal);
  if (
    raw.account_id !== accountId ||
    raw.app_id !== appId ||
    raw.app_slug !== slug ||
    raw.deployment_id !== id ||
    typeof raw.scope !== 'string' ||
    !raw.scope ||
    !['available', 'unavailable'].includes(raw.state) ||
    !Array.isArray(raw.companions) ||
    raw.companions.length > 5
  )
    invalid();
  return {
    account_id: accountId,
    app_id: appId,
    app_slug: slug,
    deployment_id: id,
    scope: raw.scope,
    state: raw.state,
    ...(raw.state === 'unavailable' ? { reason: 'declaration_metadata_unavailable' as const } : {}),
    companions: raw.state === 'available' ? raw.companions.map(companion) : [],
  };
}
export async function readCompanionChoices(
  accountId: string,
  slug: string,
  before?: string,
  signal?: AbortSignal
): Promise<CompanionChoices> {
  const appId = await context(accountId, slug, signal);
  const raw = await unwrap(
    api.GET('/v1/apps/{slug}/deployments', {
      params: { path: { slug }, query: { limit: 25, ...(before ? { before } : {}) } },
      signal,
    })
  );
  await fence(accountId, slug, appId, signal);
  if (!Array.isArray(raw.items) || raw.items.length > 25) invalid();
  const items = raw.items.map((row) => {
    if (
      row.app_id !== appId ||
      typeof row.id !== 'string' ||
      !row.id ||
      typeof row.status !== 'string' ||
      typeof row.created_at !== 'string' ||
      !Number.isFinite(Date.parse(row.created_at))
    )
      invalid();
    return { id: row.id, status: row.status, createdAt: row.created_at };
  });
  if (raw.next_before && !Number.isFinite(Date.parse(raw.next_before))) invalid();
  return { appId, items, ...(raw.next_before ? { nextBefore: raw.next_before } : {}) };
}
export function useCompanions(accountId: string, slug: string, id: string) {
  return useQuery({
    queryKey: ['account', accountId, 'app', slug, 'companion-declarations', id],
    queryFn: ({ signal }) => readCompanions(accountId, slug, id, signal),
    enabled: Boolean(accountId && slug && id),
    retry: false,
    staleTime: 0,
  });
}
export function useCompanionChoices(accountId: string, slug: string, before?: string) {
  return useQuery({
    queryKey: ['account', accountId, 'app', slug, 'companion-choices', before ?? null],
    queryFn: ({ signal }) => readCompanionChoices(accountId, slug, before, signal),
    enabled: Boolean(accountId && slug),
    retry: false,
    staleTime: 0,
  });
}
