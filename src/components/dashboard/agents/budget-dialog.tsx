import { useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import {
  useSetAgentBudget,
  type AgentBudget,
  type AgentBudgetRequest,
  type AgentConnection,
} from '@/lib/api/agents';
import { errorMessage } from '@/lib/api/errors';
import { AGENT_BUDGET_MAX_CENTS, agentName } from '@/lib/agents';
import { formatCents, parseUsdMillicents } from '@/lib/money';

type BudgetChoice = 'amount' | 'unlimited' | 'default';

/**
 * Set a monthly amount, lift the limit, or go back to the plan's default.
 * Shared by the agent page and Spending limits.
 */
export function BudgetDialog({
  agent,
  budget,
  onClose,
}: {
  agent: AgentConnection;
  budget: AgentBudget;
  onClose: () => void;
}) {
  const save = useSetAgentBudget(agent.id);
  const { toast } = useToast();
  const id = useId();
  const [choice, setChoice] = useState<BudgetChoice>(
    budget.key_unlimited
      ? 'unlimited'
      : budget.key_monthly_cents !== undefined
        ? 'amount'
        : 'default'
  );
  const [amount, setAmount] = useState(
    budget.key_monthly_cents !== undefined ? (budget.key_monthly_cents / 100).toFixed(2) : ''
  );
  const [error, setError] = useState<string>();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    let body: AgentBudgetRequest;
    if (choice === 'amount') {
      const millicents = parseUsdMillicents(amount);
      const cents = millicents === undefined ? undefined : millicents / 1000;
      if (cents === undefined || cents > AGENT_BUDGET_MAX_CENTS) {
        setError(
          `Enter a dollar amount from $0 to ${formatCents(AGENT_BUDGET_MAX_CENTS)}, such as 40 or 12.50.`
        );
        return;
      }
      body = { monthly_cents: cents };
    } else body = choice === 'unlimited' ? { unlimited: true } : { default: true };
    try {
      await save.mutateAsync(body);
      toast({ kind: 'success', title: `Budget for ${agentName(agent)} saved` });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const option = (value: BudgetChoice, title: string, detail: string) => (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border p-3 has-[:checked]:border-brand">
      <input
        type="radio"
        name={`${id}-choice`}
        className="mt-1 accent-[var(--brand)]"
        checked={choice === value}
        onChange={() => {
          setChoice(value);
          setError(undefined);
        }}
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{detail}</span>
      </span>
    </label>
  );

  return (
    <Modal
      open
      onClose={onClose}
      title="Change budget"
      description={`How much always-on cost ${agentName(agent)} may add each month before it has to ask you.`}
    >
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
        {option('amount', 'A monthly amount', 'Past it, each such change waits for your approval.')}
        {choice === 'amount' && (
          <div className="flex flex-col gap-1.5 pl-7">
            <label htmlFor={`${id}-amount`} className="text-sm font-medium">
              Dollars a month
            </label>
            <Input
              id={`${id}-amount`}
              inputMode="decimal"
              placeholder="40"
              value={amount}
              autoFocus
              aria-invalid={error ? true : undefined}
              onChange={(event) => {
                setAmount(event.target.value);
                setError(undefined);
              }}
            />
          </div>
        )}
        {option('default', "The plan's default", "Half your plan's default spend cap; $0 on Free.")}
        {option(
          'unlimited',
          'No limit',
          budget.org_max_cents !== undefined
            ? `Never held for cost, up to your organization's ceiling of ${formatCents(budget.org_max_cents)}.`
            : 'Never held for cost. Your spend cap still bounds what you pay.'
        )}
        {error && (
          <p role="alert" className="text-sm text-[color:var(--status-critical)]">
            {error}
          </p>
        )}
        <div className="mt-1 flex justify-end gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" busy={save.isPending}>
            Save budget
          </Button>
        </div>
      </form>
    </Modal>
  );
}
