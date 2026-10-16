import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { ApiError, errorMessage } from './errors';
import { keys, useOrgs } from './queries';
import type { components } from './schema';
import { useActiveOrg } from '../workspace';

/**
 * Apps and the selected workspace (ADR-061).
 *
 * An organization is chosen through the URL here, not the `X-Active-Org`
 * header: `POST /v1/orgs/{slug}/apps` records the workspace on the new app,
 * and `GET /v1/orgs/{slug}/apps` lists what a workspace has. `/v1/apps` stays
 * the signed-in account's own list, and every `/v1/apps/{slug}/…` route stays
 * with the app's creator — which is why the workspace inventory is a small
 * summary rather than links into app settings.
 */

export type OrgApp = components['schemas']['OrgAppSummary'];
type CreateAppRequest = components['schemas']['CreateAppRequest'];

export interface WorkspaceTarget {
  /** The shared organization new apps are attributed to; null for personal. */
  org: string | null;
  /** What the person picked in the switcher, for saying where an app goes. */
  label: string;
}

/**
 * The workspace the switcher has selected, as a creation target. No choice is
 * the personal workspace, which `/v1/apps` already serves. A stored slug that
 * the org list says is personal is treated as personal too; one the list has
 * not confirmed yet is still the person's explicit choice (the switcher drops
 * it once the list says it is gone), so it is not silently swapped for
 * personal while `/v1/orgs` loads.
 */
export function useWorkspaceTarget(): WorkspaceTarget {
  const active = useActiveOrg();
  const orgs = useOrgs({ enabled: Boolean(active) });
  const listed = active ? orgs.data?.orgs.find((org) => org.slug === active) : undefined;
  if (!active || listed?.personal) return { org: null, label: 'Personal' };
  return { org: active, label: listed?.name || active };
}

export const orgAppsKey = (org: string) => ['orgs', org, 'apps'] as const;

/** Creates through the workspace when one is chosen, so the app is attributed to it. */
export function createWorkspaceApp(
  org: string | null,
  body: CreateAppRequest,
  idempotencyKey?: string
) {
  const headers = idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined;
  return org
    ? unwrap(
        api.POST('/v1/orgs/{slug}/apps', {
          params: { path: { slug: org } },
          body,
          ...(headers ? { headers } : {}),
        })
      )
    : unwrap(api.POST('/v1/apps', { body, ...(headers ? { headers } : {}) }));
}

export function useCreateWorkspaceApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ org, body }: { org: string | null; body: CreateAppRequest }) =>
      createWorkspaceApp(org, body),
    onSuccess: (_app, { org }) => {
      void qc.invalidateQueries({ queryKey: keys.apps });
      if (org) void qc.invalidateQueries({ queryKey: orgAppsKey(org) });
    },
  });
}

/** The workspace's app inventory; disabled for the personal workspace. */
export function useOrgApps(org: string | null) {
  return useQuery({
    queryKey: orgAppsKey(org ?? ''),
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/orgs/{slug}/apps', { params: { path: { slug: org! } }, signal })),
    enabled: Boolean(org),
  });
}

/** A refused workspace creation, said in terms of the workspace; anything else as the API put it. */
export function workspaceCreateError(error: unknown, target: WorkspaceTarget): string {
  if (target.org && error instanceof ApiError) {
    if (error.code === 'org_role_forbidden')
      return `Your role in ${target.label} cannot create apps — owners, admins, and developers can. Switch to Personal to create it under your own account.`;
    if (error.code === 'org_not_found')
      return `${target.label} is no longer available. Choose another workspace in the switcher.`;
  }
  return errorMessage(error);
}
