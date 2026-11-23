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
import {
  useBudgets,
  useDeleteBudget,
  useOperationKey,
  type BudgetSubject,
} from '@/lib/api/budgets';
import { useCapability } from '@/lib/api/capabilities';
import { useWorkspaceTarget } from '@/lib/api/workspace-apps';
import { useAuth } from '@/lib/auth';
import {
  BUDGET_LIMITS,
  COMPUTE_BUDGET_RATE,
  budgetLevel,
  budgetRefusal,
  budgetUnit,
  formatBudgetAmount,
  type Budget,
} from '@/lib/budgets';
import { formatMillicentRate } from '@/lib/money';
import { MaturityLabel } from '../maturity-label';
import { Panel } from '../primitives';
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
import { refusalSubject } from './use-budget-save';
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
function useDeleteFlow(subject: BudgetSubject, onDeleted: (budget: Budget) => void) {
  const remove = useDeleteBudget(subject);
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
        description: budgetRefusal(error, budget.spec, refusalSubject(subject)).message,
        error,
      });
    }
  };
}

/** One subject's budgets (the account's or an organization's): create, list, and one in detail. */
export function BudgetsBody({ subject }: { subject: BudgetSubject }) {
  const budgets = useBudgets(subject, true);
  const [selected, setSelected] = useState<string | null>(null);
  // The create form is long, so it waits behind "New budget".
  const [creating, setCreating] = useState(false);
  // apid's 422 is the only signal that strict caps are not released here
  // (the flag is not in /v1/capabilities); once seen, the page stops offering
  // to turn one on.
  const [strictRefused, setStrictRefused] = useState(false);
  const list = useMemo(() => budgets.data ?? [], [budgets.data]);
  const specs = useMemo(() => list.map((b) => b.spec), [list]);
  const scopeLabel: ScopeLabel = useScopeLabel(subject, specs);
  const askDelete = useDeleteFlow(subject, (gone) => setSelected(gone.id));

  const rows: Row[] = list.map((budget) => ({
    id: budget.id,
    name: budget.spec.name,
    scope:
      budget.spec.scope.kind === 'account'
        ? subject.kind === 'org'
          ? 'Whole organization'
          : 'Whole account'
        : scopeLabel(budget.spec.scope),
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
          {formatBudgetAmount(row.limit, budgetUnit(row.budget.spec.meters))}
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
        const unit = budgetUnit(row.budget.spec.meters);
        if (evaluation?.known_millicents === undefined)
          return <span className="text-xs text-muted-foreground">Not evaluated</span>;
        return (
          <span className="flex flex-col items-end [font-variant-numeric:tabular-nums]">
            <span>{formatBudgetAmount(evaluation.known_millicents, unit)}</span>
            {evaluation.projected_millicents !== undefined && (
              <span className="text-xs text-muted-foreground">
                → {formatBudgetAmount(evaluation.projected_millicents, unit)} projected
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
            subject={subject}
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

      {list.some(({ spec }) => budgetUnit(spec.meters) === 'GB-hours') && (
        <p className="text-xs text-muted-foreground">
          Compute-only amounts are GB-hour equivalents at {formatMillicentRate(COMPUTE_BUDGET_RATE)}{' '}
          per GB-hour.
        </p>
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
          subject={subject}
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
 * Alerts and budgets, a section of Billing › Spending limits: the signed-in
 * account's budgets, or in a company workspace the organization's own
 * (`/v1/orgs/{slug}/billing/budgets`), never the other subject's.
 */
export function BudgetsSection() {
  const { capability } = useCapability('budgets');
  const workspace = useWorkspaceTarget();
  const { account } = useAuth();
  return (
    <section
      id="budgets"
      aria-labelledby="budgets-heading"
      className="flex scroll-mt-24 flex-col gap-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="budgets-heading" className="text-base font-semibold tracking-tight">
            Alerts and budgets
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Limits on this month’s usage that alert you, stop previews, or hold workloads at a
            funded cap.
          </p>
        </div>
        <MaturityLabel capability={capability} />
      </div>
      {!workspace.ready ? null : workspace.org ? (
        // An organization that owns its resources has budgets of its own
        // (ADR-20261031211500); one that doesn't is told so by apid on save.
        <BudgetsBody
          key={`org:${workspace.org}`}
          subject={{
            kind: 'org',
            slug: workspace.org,
            accountId: account?.id ?? '',
            label: workspace.label,
          }}
        />
      ) : (
        <BudgetsBody key="account" subject={{ kind: 'account', accountId: account?.id ?? '' }} />
      )}
    </section>
  );
}
