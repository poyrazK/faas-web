import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { ApiError } from './errors';
import type { components } from './schema';
import { keys, retryPolicy } from './queries';

/**
 * Release approvals (faas ADR-20261020085706, apidserver/release_approvals.go):
 * an app's policy makes each production release wait in a canary stage until
 * enough eligible people approve it. A rejection is final and aborts the
 * rollout; the timeout aborts it too. An approval needs a signed-in session,
 * which the console has; a key or token may only reject.
 */
export type ApprovalPolicy = components['schemas']['ReleaseApprovalPolicy'];
export type SetApprovalPolicy = components['schemas']['SetReleaseApprovalPolicyRequest'];
export type ApprovalStatus = components['schemas']['ReleaseApprovalStatus'];
export type ApprovalDecision = components['schemas']['ReleaseApprovalDecision'];

/** api.ReleaseApproval* limits (faas pkg/api/release_approvals.go:59-92). */
export const APPROVAL_LIMITS = {
  required: [1, 5],
  stage: [1, 10],
  timeoutMinutes: [10, 10080],
  channels: 5,
  comment: 200,
} as const;

export const APPROVAL_STATES: Record<ApprovalStatus['state'], string> = {
  not_required: 'No approval needed',
  waiting: 'Waiting for approval',
  approved: 'Approved',
  rejected: 'Rejected',
  expired: 'Timed out',
};

/** The approval page Slack and email buttons open (release_approvals.go:461-468). */
export const approvalPath = (deploymentId: string) =>
  `/dashboard/releases/${encodeURIComponent(deploymentId)}/approval`;

const root = ['release-approvals'] as const;
const policyKey = (slug: string) => [...keys.app(slug), 'release-approval-policy'] as const;

/** The app's policy, or null when it does not require approvals. */
export function useApprovalPolicy(slug: string, enabled = true) {
  return useQuery({
    queryKey: policyKey(slug),
    queryFn: async ({ signal }) => {
      try {
        return await unwrap(
          api.GET('/v1/apps/{slug}/release-approval-policy', {
            params: { path: { slug } },
            signal,
          })
        );
      } catch (err) {
        if (err instanceof ApiError && err.code === 'release_approval_policy_not_found')
          return null;
        throw err;
      }
    },
    enabled: enabled && Boolean(slug),
    retry: retryPolicy,
  });
}

/** The app's releases waiting for approval, and those past their timeout about to abort. */
export function useWaitingApprovals(slug: string, enabled = true) {
  return useQuery({
    queryKey: [...root, 'app', slug],
    queryFn: async ({ signal }) =>
      (
        await unwrap(
          api.GET('/v1/apps/{slug}/release-approvals', { params: { path: { slug } }, signal })
        )
      ).items,
    enabled: enabled && Boolean(slug),
    retry: retryPolicy,
    refetchInterval: 30_000,
  });
}

/** One release's approval state and the decisions so far. */
export function useReleaseApproval(id: string, enabled = true) {
  return useQuery({
    queryKey: [...root, 'deployment', id],
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/deployments/{id}/approvals', { params: { path: { id } }, signal })),
    enabled: enabled && Boolean(id),
    retry: retryPolicy,
    // A waiting release times out, and teammates decide, on their own clock.
    refetchInterval: (query) => (query.state.data?.state === 'waiting' ? 15_000 : false),
  });
}

function useApprovalRefresh(slug?: string) {
  const cache = useQueryClient();
  return () => {
    void cache.invalidateQueries({ queryKey: root });
    void cache.invalidateQueries({ queryKey: keys.deployments });
    if (slug) void cache.invalidateQueries({ queryKey: policyKey(slug) });
  };
}

export function useSetApprovalPolicy(slug: string) {
  const refresh = useApprovalRefresh(slug);
  return useMutation({
    retry: false,
    mutationFn: (body: SetApprovalPolicy) =>
      unwrap(
        api.PUT('/v1/apps/{slug}/release-approval-policy', { params: { path: { slug } }, body })
      ),
    onSettled: refresh,
  });
}

export function useRemoveApprovalPolicy(slug: string) {
  const refresh = useApprovalRefresh(slug);
  return useMutation({
    retry: false,
    mutationFn: () =>
      unwrap(api.DELETE('/v1/apps/{slug}/release-approval-policy', { params: { path: { slug } } })),
    onSettled: refresh,
  });
}

/** Approve or reject; a rejection needs a comment and aborts the rollout. */
export function useDecideRelease() {
  const refresh = useApprovalRefresh();
  return useMutation({
    retry: false,
    mutationFn: ({
      id,
      decision,
      comment,
    }: {
      id: string;
      decision: 'approve' | 'reject';
      comment?: string;
    }) =>
      unwrap(
        api.POST('/v1/deployments/{id}/approvals', {
          params: { path: { id } },
          body: { decision, ...(comment ? { comment } : {}) },
        })
      ),
    onSettled: refresh,
  });
}
