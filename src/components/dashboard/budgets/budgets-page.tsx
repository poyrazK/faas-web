import { useMemo, useState } from 'react';
import { MoreHoriz, Plus } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { useBudgets, useDeleteBudget, useOperationKey } from '@/lib/api/budgets';
import { useCapability } from '@/lib/api/capabilities';
import { useWorkspaceTarget } from '@/lib/api/workspace-apps';
import { useAuth } from '@/lib/auth';
import { BUDGET_LIMITS, budgetLevel, budgetRefusal, type Budget } from '@/lib/budgets';
import { formatMillicents } from '@/lib/money';
import { MaturityLabel } from '../maturity-label';
import { PageHeader, Panel } from '../primitives';
import { ResourceTable, type Column } from '../resource-table';
import {
  BudgetStatus,
  LevelLabel,
  budgetTone,
  useScopeLabel,
  type ScopeLabel,
} from './budget-bits';
import { BudgetDetail } from './budget-detail';
import { BudgetForm } from './budget-form';
import { budgetsAnswer, type BudgetsTone } from './budget-words';

const TONE_COLOR: Record<BudgetsTone, string> = {
  good: 'var(--status-good)',
  warning: 'var(--status-warning)',
  critical: 'var(--status-critical)',
  none: 'var(--muted-foreground)',
};

interface Row {
  id: string;
  name: string;
  scope: string;
  limit: number;
  known: number;
  level: string;
  status: string;
  budget: Budget;
}

/** The confirm for a delete: what stops, what is released, what is kept. */
function deleteDescription(budget: Budget): string {
  const level = budgetLevel(budget.spec);
  const parts = ['Gregale stops evaluating it, and no further alert is sent.'];
  if (budget.runtime?.stops?.length)
    parts.push(
      'The stop it placed on previews is released; a teardown already under way may finish.'
    );
  if (level === 'strict')
    parts.push(
      "Its hold is released. This month's committed funding is kept: a new cap must still cover it."
    );
  parts.push('Its revision history stays readable.');
  return parts.join(' ');
}

/** Deletes at the budget's current revision, after a confirm that says what changes. */
function useDeleteFlow(accountId: string, onDeleted: (budget: Budget) => void) {
  const remove = useDeleteBudget(accountId);
  const { keyFor, settle } = useOperationKey();
  const confirm = useConfirm();
  const { toast } = useToast();
  return async (budget: Budget) => {
    const ok = await confirm({
      title: `Delete ${budget.spec.name}?`,
      description: deleteDescription(budget),
      confirmLabel: 'Delete budget',
      destructive: true,
    });
    if (!ok) return;
    try {
      const gone = await remove.mutateAsync({
        id: budget.id,
        revision: budget.revision,
        key: keyFor(JSON.stringify([budget.id, budget.revision])),
      });
      settle();
      toast({ kind: 'success', title: `${budget.spec.name} deleted` });
      onDeleted(gone);
    } catch (error) {
      settle(error);
      toast({
        kind: 'error',
        title: 'Could not delete the budget',
        description: budgetRefusal(error, budget.spec).message,
        error,
      });
    }
  };
}

/** The personal account's budgets: create, list, and one in detail. */
export function BudgetsBody({ accountId }: { accountId: string }) {
  const budgets = useBudgets(accountId, true);
  const [selected, setSelected] = useState<string | null>(null);
  // The create form is long, so it waits behind "New budget".
  const [creating, setCreating] = useState(false);
  // apid's 422 is the only signal that strict caps are not released here
  // (the flag is not in /v1/capabilities); once seen, the page stops offering
  // to turn one on.
  const [strictRefused, setStrictRefused] = useState(false);
  const list = useMemo(() => budgets.data ?? [], [budgets.data]);
  const specs = useMemo(() => list.map((b) => b.spec), [list]);
  const scopeLabel: ScopeLabel = useScopeLabel(accountId, specs);
  const askDelete = useDeleteFlow(accountId, (gone) => setSelected(gone.id));

  const rows: Row[] = list.map((budget) => ({
    id: budget.id,
    name: budget.spec.name,
    scope: budget.spec.scope.kind === 'account' ? 'Whole account' : scopeLabel(budget.spec.scope),
    limit: budget.spec.limit_millicents,
    known: budget.runtime?.evaluation?.known_millicents ?? -1,
    level: budgetLevel(budget.spec),
    status: budgetTone(budget).label,
    budget,
  }));

  const columns: Column<Row>[] = [
    {
      key: 'name',
      label: 'Budget',
      render: (row) => (
        <span className="flex min-w-0 flex-col">
          <span className="break-words">{row.name}</span>
          <span className="text-xs break-words text-muted-foreground">{row.scope}</span>
        </span>
      ),
    },
    {
      key: 'level',
      label: 'Response',
      priority: 'secondary',
      render: (row) => <LevelLabel spec={row.budget.spec} />,
    },
    {
      key: 'limit',
      label: 'Limit',
      numeric: true,
      width: 'w-28',
      // At phone width the name and status keep the row; the rest folds into Details.
      priority: 'secondary',
      render: (row) => (
        <span className="whitespace-nowrap [font-variant-numeric:tabular-nums]">
          {formatMillicents(row.limit)}
        </span>
      ),
    },
    {
      key: 'known',
      label: 'This month',
      numeric: true,
      width: 'w-40',
      priority: 'secondary',
      render: (row) => {
        const evaluation = row.budget.runtime?.evaluation;
        if (evaluation?.known_millicents === undefined)
          return <span className="text-xs text-muted-foreground">Not evaluated</span>;
        return (
          <span className="flex flex-col items-end [font-variant-numeric:tabular-nums]">
            <span>{formatMillicents(evaluation.known_millicents)}</span>
            {evaluation.projected_millicents !== undefined && (
              <span className="text-xs text-muted-foreground">
                → {formatMillicents(evaluation.projected_millicents)} projected
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: 'status',
      label: 'Status',
      width: 'w-40',
      render: (row) => <BudgetStatus budget={row.budget} />,
    },
  ];

  const answer = budgets.data ? budgetsAnswer(list) : null;

  return (
    <div className="flex flex-col gap-6">
      <section
        aria-label="Budgets now"
        className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
      >
        <p
          role="status"
          aria-label="Budgets status"
          className="flex max-w-[44rem] items-start gap-2.5 text-lg leading-7 font-semibold tracking-[-0.01em] text-balance"
        >
          {answer && (
            <>
              <span
                aria-hidden
                className="mt-2.5 inline-block size-2 shrink-0 rounded-full"
                style={{ background: TONE_COLOR[answer.tone] }}
              />
              {answer.sentence}
            </>
          )}
        </p>
        {!creating && (
          <Button
            size="sm"
            className="shrink-0 gap-1.5 self-start"
            onClick={() => setCreating(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            New budget
          </Button>
        )}
      </section>

      {creating && (
        <Panel
          title="New budget"
          actions={
            <Button size="xs" variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
          }
        >
          <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
            {
              'Preview it against this month first. An alert never stops anything; stopping previews and strict caps do, and say exactly what before they turn on.'
            }
          </p>

          <BudgetForm
            accountId={accountId}
            scopeLabel={scopeLabel}
            strictRefused={strictRefused}
            onStrictRefused={() => setStrictRefused(true)}
            onSaved={(budget) => {
              setCreating(false);
              setSelected(budget.id);
            }}
          />
        </Panel>
      )}

      <ResourceTable
        rows={rows}
        columns={columns}
        initialSort={{ key: 'name', dir: 'asc' }}
        searchKeys={['name', 'scope']}
        searchPlaceholder="Filter budgets…"
        emptyMessage={`No budgets yet. An account can have up to ${BUDGET_LIMITS.perAccount}.`}
        desktopMinWidth="md:min-w-[760px]"
        loading={budgets.isPending}
        error={budgets.error}
        onRetry={() => void budgets.refetch()}
        onRowClick={(row) => setSelected(row.id)}
        rowActions={(row) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="xs"
                variant="ghost"
                aria-label={`Actions for ${row.name}`}
                className="px-1.5"
              >
                <MoreHoriz aria-hidden className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => setSelected((cur) => (cur === row.id ? null : row.id))}
              >
                {selected === row.id ? 'Hide details' : 'Show details'}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => void askDelete(row.budget)}
                className="text-[color:var(--status-critical)] data-[highlighted]:text-[color:var(--status-critical)]"
              >
                Delete budget
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      />

      {selected && (
        <BudgetDetail
          key={selected}
          accountId={accountId}
          id={selected}
          scopeLabel={scopeLabel}
          strictRefused={strictRefused}
          onStrictRefused={() => setStrictRefused(true)}
          onDelete={(budget) => void askDelete(budget)}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

/**
 * Billing › Budgets. Budgets belong to the signed-in account: apid has no
 * organization budget routes and `/v1/billing/budgets` ignores X-Active-Org,
 * so a company workspace says so instead of showing personal budgets.
 */
export function BudgetsPage() {
  const { capability } = useCapability('budgets');
  const workspace = useWorkspaceTarget();
  const { account } = useAuth();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Budgets"
        help="Limits on this month's usage that alert you, stop previews, or hold workloads at a funded cap."
        actions={<MaturityLabel capability={capability} />}
      />
      {!workspace.ready ? null : workspace.org ? (
        <Panel title="Budgets">
          <p role="status" className="text-sm text-muted-foreground">
            Budgets belong to your personal account, and Gregale has none for an organization, so{' '}
            {workspace.label} has no budgets to show. Switch to Personal to manage yours;{' '}
            {workspace.label}&apos;s spend cap is on{' '}
            <a className="text-brand underline" href="/dashboard/usage">
              Usage
            </a>
            .
          </p>
        </Panel>
      ) : (
        <BudgetsBody accountId={account?.id ?? ''} />
      )}
    </div>
  );
}
