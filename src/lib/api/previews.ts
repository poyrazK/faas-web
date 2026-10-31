import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { capabilityKey } from './capabilities';
import type { components } from './schema';
import { useWorkspaceTarget } from './workspace-apps';
import { useAuth } from '../auth';

export type Preview = components['schemas']['Preview'];

export const previewsKey = (org: string | null) => ['previews', org ?? 'personal'] as const;

/**
 * Platform previews the workspace can join (faas ADR-20261021080640): the
 * account's own in the personal workspace, the organization's in a company one.
 */
export function usePreviews() {
  const { org } = useWorkspaceTarget();
  return useQuery({
    queryKey: previewsKey(org),
    queryFn: ({ signal }) =>
      org
        ? unwrap(api.GET('/v1/orgs/{slug}/previews', { params: { path: { slug: org } }, signal }))
        : unwrap(api.GET('/v1/previews', { signal })),
  });
}

function usePreviewChange(join: boolean) {
  const { org } = useWorkspaceTarget();
  const { account } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => {
      if (org) {
        const opts = { params: { path: { slug: org, key } } };
        return unwrap(
          join
            ? api.PUT('/v1/orgs/{slug}/previews/{key}', opts)
            : api.DELETE('/v1/orgs/{slug}/previews/{key}', opts)
        );
      }
      const opts = { params: { path: { key } } };
      return unwrap(
        join ? api.PUT('/v1/previews/{key}', opts) : api.DELETE('/v1/previews/{key}', opts)
      );
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: previewsKey(org) });
      // Joining or leaving changes hidden_capabilities; the gate must re-read.
      if (account?.id) void qc.invalidateQueries({ queryKey: capabilityKey(account.id) });
    },
  });
}
export const useJoinPreview = () => usePreviewChange(true);
export const useLeavePreview = () => usePreviewChange(false);
