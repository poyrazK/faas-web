import {
  useAgentBudgetReads,
  useAgentConnections,
  useAgentPolicy,
  type AgentBudget,
  type AgentConnection,
} from '@/lib/api/agents';
import { ApiError } from '@/lib/api/client';
import { useWorkspaceTarget } from '@/lib/api/workspace-apps';
import { agentName } from '@/lib/agents';
import type { AgentFact } from '@/lib/limits';

export interface AgentBudgetRow {
  agent: AgentConnection;
  budget?: AgentBudget;
  /** Another member's agent: apid finds only the caller's own keys (404). */
  notMine: boolean;
  /** The read failed for another reason. */
  failed: boolean;
  pending: boolean;
  retry: () => void;
}

/**
 * The workspace's connected agents and their budgets, for the Agents section
 * and the status strip. Only mounted while the `agents` build flag is on.
 */
export function useAgentFacts() {
  const workspace = useWorkspaceTarget();
  const org = workspace.org;
  const connections = useAgentConnections(org, workspace.ready);
  const agents = connections.data ?? [];
  const reads = useAgentBudgetReads(agents.map((agent) => agent.id));
  const policy = useAgentPolicy(org, workspace.ready);
  const rows: AgentBudgetRow[] = agents.map((agent) => {
    const read = reads.get(agent.id);
    const notMine = read?.error instanceof ApiError && read.error.status === 404;
    return {
      agent,
      budget: read?.data,
      notMine,
      failed: Boolean(read?.error) && !notMine,
      pending: read?.isPending ?? true,
      retry: () => void read?.refetch(),
    };
  });
  const facts: AgentFact[] = rows.flatMap((row) =>
    row.budget
      ? [
          {
            name: agentName(row.agent),
            spentCents: row.budget.spent_cents,
            limitCents: row.budget.monthly_cents,
          },
        ]
      : []
  );
  return {
    org,
    label: workspace.label,
    connections,
    rows,
    policy,
    facts,
    /** Every read answered (or failed): the strip may count agents. */
    settled: workspace.ready && !connections.isPending && rows.every((row) => !row.pending),
  };
}
