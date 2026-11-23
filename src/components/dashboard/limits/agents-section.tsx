import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { agentName, budgetWords } from '@/lib/agents';
import { formatCents } from '@/lib/money';
import { BudgetDialog } from '../agents/budget-dialog';
import { InlinePhase, Panel, queryPhase } from '../primitives';
import { LimitRow } from './limit-row';
import { StatusStrip } from './status-strip';
import type { BillData } from './use-bill-facts';
import { useAgentFacts, type AgentBudgetRow } from './use-agent-facts';

/** What happens at an agent's budget, in a plain sentence. */
function budgetSentence(monthlyCents: number | undefined): string {
  if (monthlyCents === undefined) return 'No limit: changes are never held for cost.';
  if (monthlyCents === 0) return 'Every always-on change waits for your approval.';
  return `Past ${formatCents(monthlyCents)} a month, each always-on change waits for your approval.`;
}

function AgentRow({ row, onChange }: { row: AgentBudgetRow; onChange: () => void }) {
  const name = agentName(row.agent);
  if (row.notMine)
    return (
      <LimitRow
        name={name}
        sentence={`Only ${row.agent.member ?? 'the member who connected it'} can see and change its budget.`}
      />
    );
  if (row.failed)
    return (
      <LimitRow
        name={name}
        tone="neutral"
        sentence="Couldn’t read this budget."
        action={
          <Button size="xs" variant="outline" onClick={row.retry}>
            Retry
          </Button>
        }
      />
    );
  if (!row.budget)
    return (
      <LimitRow name={name} sentence={<span className="shimmer-text">Reading its budget…</span>} />
    );
  const words = budgetWords(row.budget);
  const limit = row.budget.monthly_cents;
  return (
    <LimitRow
      name={name}
      sentence={budgetSentence(limit)}
      note={words.source}
      meter={
        limit !== undefined && limit > 0
          ? { used: row.budget.spent_cents, limit, label: words.amount }
          : undefined
      }
      action={
        <Button size="xs" variant="outline" onClick={onChange}>
          Change
        </Button>
      }
    />
  );
}

/**
 * Spending limits › Agents: each connected agent's always-on budget this
 * month, and a company's ceiling on them. Past its budget an agent's changes
 * wait for a person. Hidden when the workspace has no agents. Behind the
 * `agents` build flag (limits-page.tsx).
 */
export function AgentsSection() {
  const data = useAgentFacts();
  const [editing, setEditing] = useState<string | null>(null);
  const { connections, rows, policy, org, label } = data;
  if (connections.isPending || (connections.data && rows.length === 0)) return null;
  const open = rows.find((row) => row.agent.id === editing);
  const ceiling = policy.data?.max_agent_budget_cents;
  return (
    <div id="agents" className="scroll-mt-24">
      <Panel
        title="Agents"
        help="What each connected agent may add to the bill each month without any traffic: warm instances, always-running services, frequent crons. Past its budget, each such change waits for a person’s approval. Lowering cost never asks."
      >
        {connections.error ? (
          <InlinePhase
            phase={queryPhase({ error: connections.error })}
            error={connections.error}
            onRetry={() => void connections.refetch()}
          />
        ) : (
          <div className="flex flex-col">
            {org && policy.data && (
              <LimitRow
                name="Agent ceiling"
                sentence={
                  ceiling !== undefined
                    ? `No agent acting in ${label} may have a budget above ${formatCents(ceiling)} a month.`
                    : 'No ceiling: each agent’s own budget applies.'
                }
                action={
                  <Button asChild size="xs" variant="outline">
                    <Link to="/dashboard/agents/policy">Change</Link>
                  </Button>
                }
              />
            )}
            {rows.map((row) => (
              <AgentRow key={row.agent.id} row={row} onChange={() => setEditing(row.agent.id)} />
            ))}
          </div>
        )}
      </Panel>
      {open?.budget && (
        <BudgetDialog agent={open.agent} budget={open.budget} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

/** The status strip, also counting an agent at its budget. */
export function AgentAwareStrip({
  data,
  onAction,
}: {
  data: BillData;
  onAction: (action: 'cap' | 'egress') => void;
}) {
  const agents = useAgentFacts();
  return (
    <StatusStrip
      data={data}
      onAction={onAction}
      agents={agents.facts}
      agentsSettled={agents.settled}
    />
  );
}
