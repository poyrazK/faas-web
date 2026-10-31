import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { projectKeys, type ProjectDetail } from './projects';
import { retryPolicy, useOrgs } from './queries';
import type { components } from './schema';
import { useWorkspaceTarget } from './workspace-apps';

/**
 * Change and delete a project (faas handlers_projects.go:67, :180).
 *
 * Both follow the workspace the way `useProject` reads: a company workspace
 * goes through `/v1/orgs/{organization}/projects/{slug}` (faas
 * org_project_routes.go:43, :47), which owners and admins may use
 * (OrgActionManageProjectSecurity, OrgActionDeleteProject); anyone else gets
 * `org_role_forbidden`. The personal route is never called in a company
 * workspace, because it resolves the slug under the signed-in account.
 */
export type ProjectDeletePreview = components['schemas']['ProjectDeletePreviewResponse'];
export type UpdateProjectRequest = components['schemas']['UpdateProjectRequest'];

/** The cache key `useProject` keeps this project's detail under. */
function detailKey(accountId: string, slug: string, org: string | null) {
  return org
    ? [...projectKeys.detail(accountId, slug), 'org', org]
    : projectKeys.detail(accountId, slug);
}

/**
 * What deleting the project touches (faas handlers_projects.go:142): the
 * workloads it detaches, and the domains, env values and crons that stay on
 * those apps. Kept under the detail key so an update refreshes it too.
 */
export function useProjectDeletePreview(accountId: string, slug: string) {
  const { org, ready } = useWorkspaceTarget();
  return useQuery({
    queryKey: [...detailKey(accountId, slug, org), 'delete-preview'],
    queryFn: ({ signal }) =>
      org
        ? unwrap(
            api.GET('/v1/orgs/{organization}/projects/{slug}/delete-preview', {
              params: { path: { organization: org, slug } },
              signal,
            })
          )
        : unwrap(
            api.GET('/v1/projects/{slug}/delete-preview', { params: { path: { slug } }, signal })
          ),
    enabled: Boolean(accountId && slug) && ready,
    retry: retryPolicy,
    staleTime: 30_000,
  });
}

/** Repository and production branch; a field left out keeps its value. */
export function useUpdateProject(accountId: string, slug: string) {
  const { org } = useWorkspaceTarget();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateProjectRequest): Promise<ProjectDetail> =>
      org
        ? unwrap(
            api.PATCH('/v1/orgs/{organization}/projects/{slug}', {
              params: { path: { organization: org, slug } },
              body,
            })
          )
        : unwrap(api.PATCH('/v1/projects/{slug}', { params: { path: { slug } }, body })),
    onSuccess: (project) => {
      qc.setQueryData(detailKey(accountId, slug, org), project);
      void qc.invalidateQueries({ queryKey: projectKeys.list(accountId) });
    },
  });
}

/**
 * Deletes the project row. Its apps are detached and stay live (the
 * `apps.project_id` foreign key is ON DELETE SET NULL, faas migration
 * 00074:74); there is no grace window or restore.
 */
export function useDeleteProject(accountId: string, slug: string) {
  const { org } = useWorkspaceTarget();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await (org
        ? unwrap(
            api.DELETE('/v1/orgs/{organization}/projects/{slug}', {
              params: { path: { organization: org, slug } },
            })
          )
        : unwrap(api.DELETE('/v1/projects/{slug}', { params: { path: { slug } } })));
    },
    onSuccess: () => {
      qc.removeQueries({ queryKey: detailKey(accountId, slug, org) });
      void qc.invalidateQueries({ queryKey: projectKeys.list(accountId) });
    },
  });
}

/**
 * The company a project belongs to, when that is not the person's own
 * organization. `org_id` is the persisted owner (faas projectaccess.Summary);
 * a personal project carries the personal org's id, which says nothing. Such
 * a project is administered by the company's roles even when it is reached
 * through the personal list (faas projectaccess/access.go:117).
 */
export function useOwningCompany(orgId: string | undefined) {
  const orgs = useOrgs({ enabled: Boolean(orgId) });
  const org = orgId ? orgs.data?.orgs.find((item) => item.id === orgId) : undefined;
  return org && !org.personal ? org : undefined;
}
