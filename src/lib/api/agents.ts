import {
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api, unwrap } from './client';
import { retryPolicy } from './queries';
import type { components } from './schema';

/**
 * Connected agents (faas pkg/apid/agentconnections): the coding agents that
 * act on the account through the hosted MCP server or an agent key, what is
 * waiting for a person's approval, each agent's always-on budget, what it
 * changed, and undo.
 *
 * A connected agent is the API key it uses, so its id is a key id and
 * disconnecting it revokes that key.
 *
 * A company workspace reads its own agents: list, activity, undo and
 * disconnect have `/v1/orgs/{slug}/…` variants for owners and admins
 * (org.go). The budget does not: `/v1/agent-connections/{id}/budget` finds
 * only the caller's own keys (budget.go budgetConnection), so another member's
 * agent answers 404 and the page shows no budget for it.
 *
 * `/v1/agent-approvals` is not workspace-scoped: a person gets every pending
 * request they may decide, their own agents' and those of organizations they
 * own or administer (approvals.go ListApprovals). A person decides only on
 * apid's review page, `review_url`.
 */
export type AgentConnection = components['schemas']['AgentConnectionResponse'];
export type AgentApproval = components['schemas']['AgentApprovalResponse'];
export type AgentBudget = components['schemas']['AgentBudgetResponse'];
export type AgentBudgetRequest = components['schemas']['AgentBudgetRequest'];
export type AgentActivityEntry = components['schemas']['AgentActivityEntry'];
export type AgentUndoRequest = components['schemas']['AgentUndoRequest'];
export type AgentUndoPlan = components['schemas']['AgentUndoPlan'];
export type AgentUndoItem = components['schemas']['AgentUndoItem'];
export type AgentUndoResult = components['schemas']['AgentUndoResult'];

/** The workspace the page reads: null for the personal account, else the org slug. */
export type AgentWorkspace = string | null;

const scope = (org: AgentWorkspace) => org ?? 'personal';

export const agentKeys = {
  all: ['agents'] as const,
  connections: (org: AgentWorkspace) => ['agents', scope(org), 'connections'] as const,
  approvals: ['agents', 'approvals'] as const,
  channels: ['agents', 'approval-channels'] as const,
  budget: (id: string) => ['agents', 'budget', id] as const,
  activity: (org: AgentWorkspace, id: string) => ['agents', scope(org), 'activity', id] as const,
};

export function useAgentConnections(org: AgentWorkspace, enabled = true) {
  return useQuery({
    queryKey: agentKeys.connections(org),
    queryFn: async ({ signal }) => {
      const page = org
        ? await unwrap(
            api.GET('/v1/orgs/{slug}/agent-connections', {
              params: { path: { slug: org } },
              signal,
            })
          )
        : await unwrap(api.GET('/v1/agent-connections', { signal }));
      return page.items;
    },
    enabled,
    retry: retryPolicy,
  });
}

/**
 * The requests waiting for this person. Polled: a request is made while the
 * agent works and expires 30 minutes later, so a page left open has to notice
 * both without a reload.
 */
export function useAgentApprovals(enabled = true) {
  return useQuery({
    queryKey: agentKeys.approvals,
    queryFn: async ({ signal }) => (await unwrap(api.GET('/v1/agent-approvals', { signal }))).items,
    enabled,
    retry: retryPolicy,
    refetchInterval: 30_000,
  });
}

const budgetQuery = (id: string) => ({
  queryKey: agentKeys.budget(id),
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    unwrap(api.GET('/v1/agent-connections/{id}/budget', { params: { path: { id } }, signal })),
  // A 404 is an answer here (another member's agent), not a fault to retry.
  retry: false,
});

export function useAgentBudget(id: string, enabled = true) {
  return useQuery({ ...budgetQuery(id), enabled: enabled && Boolean(id) });
}

/** One budget per listed agent, in list order; a failed read leaves its slot undefined. */
export function useAgentBudgets(ids: readonly string[]) {
  return useQueries({
    queries: ids.map((id) => budgetQuery(id)),
    combine: (results) => new Map(ids.map((id, index) => [id, results[index]?.data])),
  });
}

export function useSetAgentBudget(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AgentBudgetRequest) =>
      unwrap(api.PUT('/v1/agent-connections/{id}/budget', { params: { path: { id } }, body })),
    onSuccess: (budget) => qc.setQueryData(agentKeys.budget(id), budget),
  });
}

export function useAgentActivity(org: AgentWorkspace, id: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: agentKeys.activity(org, id),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => {
      const query = { limit: 50, before: pageParam };
      return org
        ? unwrap(
            api.GET('/v1/orgs/{slug}/agent-connections/{id}/activity', {
              params: { path: { slug: org, id }, query },
              signal,
            })
          )
        : unwrap(
            api.GET('/v1/agent-connections/{id}/activity', {
              params: { path: { id }, query },
              signal,
            })
          );
    },
    getNextPageParam: (page, _pages, lastCursor, cursors) => {
      // A repeated cursor must never offer an endless duplicate-page loop.
      const next = page.next_before;
      return next && next !== lastCursor && !cursors.includes(next) ? next : undefined;
    },
    enabled: enabled && Boolean(id),
    retry: retryPolicy,
  });
}

/**
 * What undoing would do. A POST that changes nothing: it reads the agent's
 * changes and answers a plan with the `plan_digest` an apply must repeat.
 */
export function usePlanAgentUndo(org: AgentWorkspace, id: string) {
  return useMutation({
    mutationFn: (body: AgentUndoRequest) =>
      org
        ? unwrap(
            api.POST('/v1/orgs/{slug}/agent-connections/{id}/undo/plan', {
              params: { path: { slug: org, id } },
              body,
            })
          )
        : unwrap(
            api.POST('/v1/agent-connections/{id}/undo/plan', { params: { path: { id } }, body })
          ),
  });
}

/** Applies a reviewed plan; 409 when the changes differ from it. */
export function useApplyAgentUndo(org: AgentWorkspace, id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AgentUndoRequest) =>
      org
        ? unwrap(
            api.POST('/v1/orgs/{slug}/agent-connections/{id}/undo', {
              params: { path: { slug: org, id } },
              body,
            })
          )
        : unwrap(api.POST('/v1/agent-connections/{id}/undo', { params: { path: { id } }, body })),
    // Undo runs through the same API as any change, so most of the console's
    // cached reads may be stale afterwards.
    onSettled: () => qc.invalidateQueries(),
  });
}

export function useDisconnectAgent(org: AgentWorkspace) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      org
        ? unwrap(
            api.DELETE('/v1/orgs/{slug}/agent-connections/{id}', {
              params: { path: { slug: org, id } },
            })
          )
        : unwrap(api.DELETE('/v1/agent-connections/{id}', { params: { path: { id } } })),
    onSettled: () => qc.invalidateQueries({ queryKey: agentKeys.all }),
  });
}

export function useDisconnectAllAgents(org: AgentWorkspace) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      org
        ? unwrap(
            api.POST('/v1/orgs/{slug}/agent-connections/revoke_all', {
              params: { path: { slug: org } },
            })
          )
        : unwrap(api.POST('/v1/agent-connections/revoke_all')),
    onSettled: () => qc.invalidateQueries({ queryKey: agentKeys.all }),
  });
}

/** Where the personal account's approval requests also go, besides email. */
export function useAgentApprovalChannels(enabled = true) {
  return useQuery({
    queryKey: agentKeys.channels,
    queryFn: async ({ signal }) =>
      (await unwrap(api.GET('/v1/agent-approvals/channels', { signal }))).channels,
    enabled,
    retry: retryPolicy,
  });
}

export function useSetAgentApprovalChannels() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (channels: string[]) =>
      unwrap(api.PUT('/v1/agent-approvals/channels', { body: { channels } })),
    onSuccess: (saved) => qc.setQueryData(agentKeys.channels, saved.channels),
  });
}
