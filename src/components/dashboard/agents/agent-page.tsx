import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { NavArrowLeft, Undo } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { CopyableId } from '@/components/ui/copyable-id';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Timestamp } from '@/components/ui/timestamp';
import { useToast } from '@/components/ui/toast';
import {
  useAgentActivity,
  useAgentBudget,
  useAgentConnections,
  useApplyAgentUndo,
  usePlanAgentUndo,
  useSetAgentBudget,
  type AgentActivityEntry,
  type AgentBudget,
  type AgentBudgetRequest,
  type AgentConnection,
  type AgentUndoItem,
  type AgentUndoPlan,
  type AgentUndoResult,
  type AgentWorkspace,
} from '@/lib/api/agents';
import { ApiError } from '@/lib/api/client';
import { errorMessage } from '@/lib/api/errors';
import { useWorkspaceTarget } from '@/lib/api/workspace-apps';
import {
  AGENT_BUDGET_MAX_CENTS,
  activityOutcome,
  activitySentence,
  agentName,
  asksBefore,
  budgetWords,
  kindWords,
  listWords,
  reachWords,
  scopePhrases,
  undoPlanWords,
  undoResultSentence,
  undoResultWords,
  type AgentTone,
} from '@/lib/agents';
import { formatCents, parseUsdMillicents } from '@/lib/money';
import { useDocumentTitle } from '@/lib/seo';
import { InlinePhase, PageHeader, Panel, RangeSelector, queryPhase } from '../primitives';
import { Pill } from '../resource-table';
import { Answer, BudgetMeter, ToneLabel } from './agent-bits';
import { useDisconnectFlow } from './agents-page';

/** What the agent may do and where, then what it has to ask about. */
function accessSentence(agent: AgentConnection): string {
  const name = agentName(agent);
  const can = scopePhrases(agent.scopes);
  const where =
    agent.kind === 'app_agent'
      ? 'in one app'
      : agent.projects === undefined
        ? 'in every project'
        : `in ${reachWords(agent)}`;
  const first = can.length ? `${name} can ${listWords(can)} ${where}.` : `${name} is connected.`;
  if (agent.approvals === undefined) return first;
  return agent.approvals.length
    ? `${first} It asks you before ${asksBefore(agent.approvals)}.`
    : `${first} It never asks you first.`;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-sm break-words">{children}</dd>
    </div>
  );
}

function ConnectionPanel({ agent }: { agent: AgentConnection }) {
  return (
    <Panel title="Connection">
      <dl className="divide-y divide-border">
        <Fact label="Connected">
          <Timestamp value={agent.created_at} mode="absolute" />
        </Fact>
        <Fact label="Last used">
          {agent.last_used_at ? <Timestamp value={agent.last_used_at} /> : 'Never'}
        </Fact>
        {agent.expires_at && (
          <Fact label="Signs out">
            <Timestamp value={agent.expires_at} />
          </Fact>
        )}
        {agent.member && <Fact label="Connected by">{agent.member}</Fact>}
        {agent.client_site && <Fact label="Verified at">{agent.client_site}</Fact>}
        <Fact label="Works in">{reachWords(agent)}</Fact>
      </dl>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          Show key and scopes
        </summary>
        <dl className="mt-2 divide-y divide-border">
          <Fact label="Key id">
            <CopyableId value={agent.id} label="agent key id" />
          </Fact>
          <Fact label="Key prefix">
            <span className="font-mono text-xs">{agent.prefix}</span>
          </Fact>
          <Fact label="Scopes">
            <span className="font-mono text-xs">{agent.scopes.join(' ')}</span>
          </Fact>
        </dl>
      </details>
    </Panel>
  );
}

type BudgetChoice = 'amount' | 'unlimited' | 'default';

/** Set a monthly amount, lift the limit, or go back to the plan's default. */
function BudgetDialog({
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

function BudgetPanel({ agent }: { agent: AgentConnection }) {
  const budget = useAgentBudget(agent.id);
  const [editing, setEditing] = useState(false);
  // apid finds only the caller's own keys here, so a colleague's agent is 404.
  const notMine = budget.error instanceof ApiError && budget.error.status === 404;
  const phase = queryPhase({
    error: notMine ? undefined : budget.error,
    loading: budget.isPending,
  });
  return (
    <Panel
      title="Always-on budget"
      help="What this agent may add to your bill each month without any traffic: warm instances, always-running services and workers, frequent crons, databases that never sleep. Past the budget, each such change waits for your approval. Lowering cost never asks."
      actions={
        budget.data && (
          <Button size="xs" variant="outline" onClick={() => setEditing(true)}>
            Change budget
          </Button>
        )
      }
    >
      {notMine ? (
        <p className="text-sm text-muted-foreground">
          Only {agent.member ?? 'the member who connected this agent'} can see and change its
          budget.
        </p>
      ) : budget.data ? (
        <div className="flex flex-col gap-3">
          <BudgetMeter budget={budget.data} label={`${agentName(agent)}'s budget used`} />
          <p className="text-sm text-muted-foreground">
            Committed in {budget.data.month} (UTC). {budgetWords(budget.data).source}
            {budget.data.org_max_cents !== undefined &&
              budget.data.source !== 'org_ceiling' &&
              ` Your organization caps agents at ${formatCents(budget.data.org_max_cents)} a month.`}
          </p>
        </div>
      ) : (
        <InlinePhase phase={phase} error={budget.error} onRetry={() => void budget.refetch()} />
      )}
      {editing && budget.data && (
        <BudgetDialog agent={agent} budget={budget.data} onClose={() => setEditing(false)} />
      )}
    </Panel>
  );
}

function ActivityRow({ entry }: { entry: AgentActivityEntry }) {
  const outcome = activityOutcome(entry.status);
  // A refused request changed nothing, so it gets no "Deployed api" sentence.
  const sentence = outcome.tone === 'good' ? activitySentence(entry) : undefined;
  const request = `${entry.method} ${entry.path}`;
  return (
    <li className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-sm">
          {sentence ?? <span className="font-mono text-xs">{request}</span>}
        </p>
        {entry.reason && (
          <p className="text-sm text-muted-foreground">
            It said: <q className="text-foreground">{entry.reason}</q>
          </p>
        )}
        <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <ToneLabel tone={outcome.tone}>{outcome.label}</ToneLabel>
          {entry.approval_id && (
            <span className="text-xs text-muted-foreground">After a person approved it</span>
          )}
          {sentence && (
            <span className="font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">
              {request}
            </span>
          )}
        </p>
      </div>
      <Timestamp
        value={entry.created_at}
        className="shrink-0 text-xs whitespace-nowrap text-muted-foreground"
      />
    </li>
  );
}

function ActivityPanel({ org, agent }: { org: AgentWorkspace; agent: AgentConnection }) {
  const activity = useAgentActivity(org, agent.id);
  const entries = activity.data?.pages.flatMap((page) => page.activity) ?? [];
  const phase = queryPhase({
    error: activity.error,
    loading: activity.isPending,
    isEmpty: entries.length === 0,
  });
  return (
    <Panel
      title="What it changed"
      help="Every change this agent made in the last 7 days, newest first, with how Gregale answered. Reading is not listed, and requests still waiting for approval are not either."
      padded={false}
    >
      {phase === 'ready' ? (
        <>
          <ul aria-label="Changes" className="divide-y divide-border">
            {entries.map((entry) => (
              <ActivityRow key={entry.id} entry={entry} />
            ))}
          </ul>
          {activity.hasNextPage && (
            <div className="border-t border-border px-5 py-3">
              <Button
                size="xs"
                variant="ghost"
                busy={activity.isFetchingNextPage}
                onClick={() => void activity.fetchNextPage()}
              >
                Show older changes
              </Button>
            </div>
          )}
        </>
      ) : (
        <div className="px-5 pt-2 pb-5">
          <InlinePhase
            phase={phase}
            error={activity.error}
            emptyMessage="No changes in the last 7 days."
            onRetry={() => void activity.refetch()}
          />
        </div>
      )}
    </Panel>
  );
}

type UndoRange = '2h' | '24h' | '7d';
const UNDO_RANGES: { key: UndoRange; label: string; ms: number }[] = [
  { key: '2h', label: 'Last 2 hours', ms: 2 * 3_600_000 },
  { key: '24h', label: 'Last 24 hours', ms: 24 * 3_600_000 },
  // A minute inside apid's 7-day bound, so clock skew cannot push it over.
  { key: '7d', label: 'Last 7 days', ms: 7 * 24 * 3_600_000 - 60_000 },
];

function UndoItemRow({
  item,
  words,
}: {
  item: AgentUndoItem;
  words: { label: string; tone: AgentTone };
}) {
  return (
    <li className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-sm break-words">{item.summary}</p>
        {(item.error ?? item.reason) && (
          <p className="text-xs text-muted-foreground">{item.error ?? item.reason}</p>
        )}
        <p className="font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">
          {item.method} {item.path}
        </p>
      </div>
      <span className="flex shrink-0 flex-col items-start gap-0.5 sm:items-end">
        <ToneLabel tone={words.tone}>{words.label}</ToneLabel>
        <Timestamp value={item.created_at} className="text-xs text-muted-foreground" />
      </span>
    </li>
  );
}

/**
 * Undo in three steps on the page: pick how far back, read what undoing each
 * change will do, then apply exactly that plan. A plan that no longer matches
 * (409) is planned again rather than applied blind.
 */
function UndoPanel({ org, agent }: { org: AgentWorkspace; agent: AgentConnection }) {
  const plan = usePlanAgentUndo(org, agent.id);
  const apply = useApplyAgentUndo(org, agent.id);
  const confirm = useConfirm();
  const { toast } = useToast();
  const name = agentName(agent);
  const [range, setRange] = useState<UndoRange>('24h');
  const [force, setForce] = useState(false);
  const [request, setRequest] = useState<{ since: string; force: boolean }>();
  const [reviewed, setReviewed] = useState<AgentUndoPlan>();
  const [result, setResult] = useState<AgentUndoResult>();

  const review = async (next: { since: string; force: boolean }) => {
    setResult(undefined);
    setRequest(next);
    try {
      setReviewed(await plan.mutateAsync(next));
    } catch {
      setReviewed(undefined);
    }
  };
  const start = (withForce = force) => {
    const ms = UNDO_RANGES.find((option) => option.key === range)!.ms;
    void review({ since: new Date(Date.now() - ms).toISOString(), force: withForce });
  };
  const reset = () => {
    setReviewed(undefined);
    setResult(undefined);
    setRequest(undefined);
    setForce(false);
    plan.reset();
    apply.reset();
  };

  const onApply = async () => {
    if (!reviewed || !request) return;
    const ok = await confirm({
      title: `Undo ${reviewed.undoable} ${reviewed.undoable === 1 ? 'change' : 'changes'} by ${name}?`,
      description:
        'Each one is reversed through the same API the agent used, newest first, as you. Anything marked as left stays as it is.',
      confirmLabel: 'Undo changes',
      destructive: true,
    });
    if (!ok) return;
    try {
      setResult(await apply.mutateAsync({ ...request, plan_digest: reviewed.plan_digest }));
      setReviewed(undefined);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        toast({
          kind: 'error',
          title: 'Something changed since you reviewed this',
          description: 'Nothing was undone. Here is the plan as it stands now.',
        });
        void review(request);
        return;
      }
      toast({
        kind: 'error',
        title: 'Could not undo the changes',
        description: errorMessage(error),
        error,
      });
    }
  };

  const hasChangedSince = reviewed?.items.some((item) => item.status === 'changed_since');

  return (
    <Panel
      title="Undo its changes"
      help="Puts back what this agent changed: settings, scaling, variables, deploys and rollbacks, traffic, and things it created or deleted. A secret it replaced, an app's first deploy and a deleted bucket cannot be undone; the plan says so. Changes are kept 7 days and each is undone once."
    >
      {result ? (
        <div className="flex flex-col gap-3">
          <p role="status" className="text-sm font-medium">
            {undoResultSentence(result)}
          </p>
          <ul aria-label="Undo result" className="divide-y divide-border">
            {result.items.map((item) => (
              <UndoItemRow key={item.activity_id} item={item} words={undoResultWords(item)} />
            ))}
          </ul>
          <div>
            <Button size="sm" variant="outline" onClick={reset}>
              Done
            </Button>
          </div>
        </div>
      ) : reviewed ? (
        <div className="flex flex-col gap-3">
          <p role="status" className="text-sm font-medium">
            {reviewed.items.length === 0
              ? `${name} changed nothing in this time.`
              : reviewed.undoable === 0
                ? 'Nothing here can be undone.'
                : `${reviewed.undoable} of ${reviewed.items.length} ${reviewed.items.length === 1 ? 'change' : 'changes'} will be undone.`}
          </p>
          {reviewed.items.length > 0 && (
            <ul aria-label="Undo plan" className="divide-y divide-border">
              {reviewed.items.map((item) => (
                <UndoItemRow key={item.activity_id} item={item} words={undoPlanWords(item)} />
              ))}
            </ul>
          )}
          {(hasChangedSince || force) && (
            <label className="flex items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-[var(--brand)]"
                checked={force}
                disabled={plan.isPending}
                onChange={(event) => {
                  setForce(event.target.checked);
                  if (request) void review({ ...request, force: event.target.checked });
                }}
              />
              Also undo what someone changed again since
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            {reviewed.undoable > 0 && (
              <Button
                size="sm"
                variant="destructive"
                className="gap-1.5"
                busy={apply.isPending}
                disabled={plan.isPending}
                onClick={() => void onApply()}
              >
                <Undo className="h-3.5 w-3.5" />
                Undo {reviewed.undoable} {reviewed.undoable === 1 ? 'change' : 'changes'}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={reset}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Nothing is undone until you have seen what will happen to each change.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <RangeSelector
              value={range}
              options={UNDO_RANGES.map(({ key, label }) => ({ key, label }))}
              onChange={setRange}
              disabled={plan.isPending}
            />
            <Button size="sm" variant="outline" busy={plan.isPending} onClick={() => start()}>
              See what undo would do
            </Button>
          </div>
          {plan.error && (
            <InlinePhase phase={queryPhase({ error: plan.error })} error={plan.error} />
          )}
        </div>
      )}
    </Panel>
  );
}

const BACK_LINK =
  'inline-flex items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground';

function AgentBody({ org, agentId }: { org: AgentWorkspace; agentId: string }) {
  const navigate = useNavigate();
  const connections = useAgentConnections(org);
  const agent = connections.data?.find((item) => item.id === agentId);
  const askDisconnect = useDisconnectFlow(org, () => void navigate({ to: '/dashboard/agents' }));
  useDocumentTitle(agent ? agentName(agent) : undefined);

  if (!agent) {
    const phase = queryPhase({
      error: connections.error,
      loading: connections.isPending,
      isEmpty: true,
    });
    return (
      <>
        <PageHeader title="Agent" />
        <Panel>
          <InlinePhase
            phase={phase}
            error={connections.error}
            emptyMessage="This agent is no longer connected. Its key was revoked or has expired, so it cannot act."
            onRetry={() => void connections.refetch()}
          />
        </Panel>
      </>
    );
  }

  const kind = kindWords(agent.kind);
  return (
    <>
      <PageHeader
        title={agentName(agent)}
        meta={
          <span title={kind.help}>
            <Pill label={kind.label} />
          </span>
        }
        actions={
          <Button size="sm" variant="outline" onClick={() => void askDisconnect(agent)}>
            Disconnect
          </Button>
        }
      />
      <Answer label="Agent access" tone="none">
        {accessSentence(agent)}
      </Answer>
      <div className="grid gap-6 lg:grid-cols-2">
        <BudgetPanel agent={agent} />
        <ConnectionPanel agent={agent} />
      </div>
      <ActivityPanel org={org} agent={agent} />
      <UndoPanel org={org} agent={agent} />
    </>
  );
}

/** Account › Agents › one agent: its access, budget, changes and undo. */
export function AgentPage({ agentId }: { agentId: string }) {
  const workspace = useWorkspaceTarget();
  return (
    <div className="flex flex-col gap-6">
      <Link to="/dashboard/agents" className={BACK_LINK}>
        <NavArrowLeft className="size-4" />
        All agents
      </Link>
      {workspace.ready && (
        <AgentBody key={workspace.org ?? 'personal'} org={workspace.org} agentId={agentId} />
      )}
    </div>
  );
}
