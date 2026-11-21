import { useMemo, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { MoreHoriz, OpenNewWindow, Plus } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useConfirm } from '@/components/ui/confirm';
import { Timestamp } from '@/components/ui/timestamp';
import { useToast } from '@/components/ui/toast';
import {
  useAgentApprovalChannels,
  useAgentApprovals,
  useAgentBudgets,
  useAgentConnections,
  useDisconnectAgent,
  useDisconnectAllAgents,
  useSetAgentApprovalChannels,
  type AgentApproval,
  type AgentConnection,
  type AgentWorkspace,
} from '@/lib/api/agents';
import { ApiError } from '@/lib/api/client';
import { errorMessage } from '@/lib/api/errors';
import { useNotificationChannels } from '@/lib/api/notification-channels';
import { useWorkspaceTarget } from '@/lib/api/workspace-apps';
import {
  accessLevel,
  agentName,
  agentsAnswer,
  approvalSentence,
  asksBefore,
  kindWords,
  reachWords,
  timeLeft,
} from '@/lib/agents';
import { parseTime } from '@/lib/time';
import { WhenCapable } from '../capability-gate';
import { channelKindLabel } from '../notification-channels';
import { InlinePhase, PageHeader, Panel, queryPhase } from '../primitives';
import { ResourceTable, type Column } from '../resource-table';
import { Answer, BudgetMeter, ConnectAgentDialog } from './agent-bits';

const CRITICAL =
  'text-[color:var(--status-critical)] data-[highlighted]:text-[color:var(--status-critical)]';

/** Disconnects one agent after a confirm that says what stops. */
export function useDisconnectFlow(org: AgentWorkspace, onDone?: () => void) {
  const disconnect = useDisconnectAgent(org);
  const confirm = useConfirm();
  const { toast } = useToast();
  return async (agent: AgentConnection) => {
    const name = agentName(agent);
    const ok = await confirm({
      title: `Disconnect ${name}?`,
      description:
        'Its key stops working at once, so it can no longer read or change anything. What it already changed stays as it is. To use it again, connect it again.',
      confirmLabel: 'Disconnect',
      destructive: true,
    });
    if (!ok) return;
    try {
      await disconnect.mutateAsync(agent.id);
      toast({ kind: 'success', title: `${name} disconnected` });
      onDone?.();
    } catch (error) {
      toast({
        kind: 'error',
        title: `Could not disconnect ${name}`,
        description: errorMessage(error),
        error,
      });
    }
  };
}

/** One request waiting for a person: what, why in the agent's words, and how long is left. */
function ApprovalRow({ approval, primary }: { approval: AgentApproval; primary: boolean }) {
  const left = timeLeft(approval.expires_at);
  return (
    <li className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-sm font-medium">{approvalSentence(approval)}</p>
        {approval.reason && (
          <p className="text-sm text-muted-foreground">
            It says: <q className="text-foreground">{approval.reason}</q>
          </p>
        )}
        <p className="font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">
          {approval.method} {approval.path}
        </p>
        <p className="text-xs text-muted-foreground">
          Asked <Timestamp value={approval.created_at} />
          {left && ` · ${left}`}
        </p>
      </div>
      {approval.review_url ? (
        <Button
          asChild
          size="sm"
          variant={primary ? 'default' : 'outline'}
          className="shrink-0 gap-1.5 self-start"
        >
          <a href={approval.review_url} target="_blank" rel="noreferrer">
            Review
            <OpenNewWindow aria-hidden className="h-3.5 w-3.5" />
            <span className="sr-only">
              {approvalSentence(approval)} (opens the review page in a new tab)
            </span>
          </a>
        </Button>
      ) : (
        <p className="shrink-0 text-xs text-muted-foreground">
          Open the review link the agent gave you.
        </p>
      )}
    </li>
  );
}

/** The requests the signed-in person may decide, across their workspaces. */
function WaitingPanel({ approvals }: { approvals: AgentApproval[] }) {
  return (
    <Panel
      title="Waiting for you"
      help="Requests from your agents, and from agents in organizations you own or administer, in every workspace. You decide on a review page that shows the exact request; what the agent says it is for is its own words."
      padded={false}
    >
      <ul aria-label="Approval requests" className="divide-y divide-border">
        {approvals.map((approval, index) => (
          <ApprovalRow key={approval.id} approval={approval} primary={index === 0} />
        ))}
      </ul>
    </Panel>
  );
}

/** Where approval requests also go, besides the email to whoever connected the agent. */
function ApprovalChannels() {
  const saved = useAgentApprovalChannels();
  const channels = useNotificationChannels();
  const save = useSetAgentApprovalChannels();
  const { toast } = useToast();
  const [draft, setDraft] = useState<string[] | null>(null);
  const chosen = draft ?? saved.data ?? [];
  const dirty =
    draft !== null && [...draft].sort().join('\n') !== [...(saved.data ?? [])].sort().join('\n');
  const phase = queryPhase({
    error: saved.error ?? channels.error,
    loading: saved.isPending || channels.isPending,
    isEmpty: (channels.data ?? []).length === 0,
  });

  const toggle = (name: string, on: boolean) =>
    setDraft(on ? [...chosen, name] : chosen.filter((item) => item !== name));

  const onSave = async () => {
    try {
      await save.mutateAsync(chosen);
      setDraft(null);
      toast({ kind: 'success', title: 'Approval notifications saved' });
    } catch (error) {
      toast({
        kind: 'error',
        title: 'Could not save approval notifications',
        description: errorMessage(error),
        error,
      });
    }
  };

  return (
    <Panel
      title="Where requests reach you"
      help="Each new approval request is emailed to the person who connected the agent. Pick notification channels to send it there too."
      actions={
        dirty && (
          <Button size="xs" busy={save.isPending} onClick={() => void onSave()}>
            Save
          </Button>
        )
      }
    >
      <p className="text-sm text-muted-foreground">
        Email always goes to whoever connected the agent.
      </p>
      <div className="mt-3">
        {phase === 'ready' ? (
          <ul className="flex flex-col gap-2">
            {(channels.data ?? []).map((channel) => (
              <li key={channel.id}>
                <label className="flex items-center gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--brand)]"
                    checked={chosen.includes(channel.name)}
                    onChange={(event) => toggle(channel.name, event.target.checked)}
                  />
                  <span>{channel.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {channelKindLabel(channel.kind)}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        ) : phase === 'empty' ? (
          <p className="text-sm text-muted-foreground">
            To also get requests in Slack or PagerDuty,{' '}
            <Link
              to="/dashboard/alerts"
              search={{ view: 'channels' }}
              className="text-brand underline underline-offset-4"
            >
              add a notification channel
            </Link>
            .
          </p>
        ) : (
          <InlinePhase
            phase={phase}
            error={saved.error ?? channels.error}
            onRetry={() => {
              void saved.refetch();
              void channels.refetch();
            }}
          />
        )}
      </div>
    </Panel>
  );
}

interface Row {
  id: string;
  name: string;
  member: string;
  reach: string;
  asks: string;
  spent: number;
  lastUsed: number;
  agent: AgentConnection;
}

/** The workspace's agents, what waits for the person, and where requests go. */
function AgentsBody({
  org,
  label,
  onConnect,
}: {
  org: AgentWorkspace;
  label: string;
  onConnect: () => void;
}) {
  const navigate = useNavigate();
  const connections = useAgentConnections(org);
  const approvals = useAgentApprovals();
  const list = useMemo(() => connections.data ?? [], [connections.data]);
  const budgets = useAgentBudgets(useMemo(() => list.map((agent) => agent.id), [list]));
  const askDisconnect = useDisconnectFlow(org);
  const disconnectAll = useDisconnectAllAgents(org);
  const confirm = useConfirm();
  const { toast } = useToast();
  const pending = approvals.data ?? [];

  const open = (id: string) =>
    void navigate({ to: '/dashboard/agents/$agentId', params: { agentId: id } });

  const askDisconnectAll = async () => {
    const ok = await confirm({
      title: `Disconnect all ${list.length} agents?`,
      description:
        'Every key stops working at once. What the agents already changed stays as it is. Each has to be connected again before it can act.',
      confirmLabel: 'Disconnect all',
      destructive: true,
    });
    if (!ok) return;
    try {
      const { revoked } = await disconnectAll.mutateAsync();
      toast({
        kind: 'success',
        title: `${revoked} ${revoked === 1 ? 'agent' : 'agents'} disconnected`,
      });
    } catch (error) {
      toast({
        kind: 'error',
        title: 'Could not disconnect the agents',
        description: errorMessage(error),
        error,
      });
    }
  };

  const rows: Row[] = list.map((agent) => ({
    id: agent.id,
    name: agentName(agent),
    member: agent.member ?? '',
    reach: reachWords(agent),
    asks: asksBefore(agent.approvals),
    spent: budgets.get(agent.id)?.spent_cents ?? -1,
    lastUsed: parseTime(agent.last_used_at) ?? 0,
    agent,
  }));

  const columns: Column<Row>[] = [
    {
      key: 'name',
      label: 'Agent',
      render: (row) => (
        <span className="flex min-w-0 flex-col">
          <span className="break-words">{row.name}</span>
          <span className="text-xs break-words text-muted-foreground">
            <span title={kindWords(row.agent.kind).help}>{kindWords(row.agent.kind).label}</span>
            {' · '}
            {accessLevel(row.agent.scopes)}
            {row.member && ` · ${row.member}`}
          </span>
        </span>
      ),
    },
    {
      key: 'reach',
      label: 'Works in',
      priority: 'secondary',
      render: (row) => <span className="break-words">{row.reach}</span>,
    },
    {
      key: 'asks',
      label: 'Asks you before',
      priority: 'secondary',
      render: (row) =>
        row.asks ? (
          <span className="break-words">{row.asks}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'spent',
      label: 'Always-on budget',
      width: 'w-44',
      priority: 'secondary',
      render: (row) => {
        const budget = budgets.get(row.id);
        // No budget to show: still loading, or another member's agent (404).
        if (!budget) return <span className="text-muted-foreground">—</span>;
        return <BudgetMeter compact budget={budget} label={`${row.name}'s budget used`} />;
      },
    },
    {
      key: 'lastUsed',
      label: 'Last used',
      width: 'w-28',
      render: (row) =>
        row.lastUsed ? (
          <Timestamp value={row.lastUsed} className="whitespace-nowrap" />
        ) : (
          <span className="text-muted-foreground">Never</span>
        ),
    },
  ];

  const forbidden =
    connections.error instanceof ApiError && connections.error.code === 'org_role_forbidden';
  const answer = connections.data
    ? agentsAnswer(list, approvals.data ? pending.length : undefined)
    : null;

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Agents now" className="flex items-start justify-between gap-4">
        {answer ? (
          <Answer label="Agents status" tone={answer.tone}>
            {answer.sentence}
          </Answer>
        ) : (
          <span />
        )}
        {list.length > 1 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" aria-label="More actions" className="self-start">
                <MoreHoriz aria-hidden className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void askDisconnectAll()} className={CRITICAL}>
                Disconnect all agents
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </section>

      {pending.length > 0 && <WaitingPanel approvals={pending} />}

      {forbidden ? (
        <Panel title="Connected agents">
          <p role="status" className="text-sm text-muted-foreground">
            Only owners and admins of {label} can see the agents acting in it. Switch to Personal to
            see the agents you connected for yourself.
          </p>
        </Panel>
      ) : (
        <ResourceTable
          rows={rows}
          columns={columns}
          initialSort={{ key: 'lastUsed', dir: 'desc' }}
          searchKeys={list.length > 5 ? ['name', 'member', 'reach'] : undefined}
          searchPlaceholder="Filter agents…"
          emptyMessage={
            org
              ? `No agents act in ${label}.`
              : 'No agents yet. Connect Claude Code, Codex, Cursor or any MCP client to let it deploy and look after your apps.'
          }
          emptyAction={
            <Button size="sm" className="gap-1.5" onClick={onConnect}>
              <Plus className="h-3.5 w-3.5" />
              Connect an agent
            </Button>
          }
          desktopMinWidth="md:min-w-[820px]"
          loading={connections.isPending}
          error={connections.error}
          onRetry={() => void connections.refetch()}
          onRowClick={(row) => open(row.id)}
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
                <DropdownMenuItem onSelect={() => open(row.id)}>
                  See what it changed
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => void askDisconnect(row.agent)}
                  className={CRITICAL}
                >
                  Disconnect
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        />
      )}

      {/* The account's own setting: a company's channels are part of its agent policy. */}
      {!org && (
        <WhenCapable capability="notification-channels">
          <ApprovalChannels />
        </WhenCapable>
      )}
    </div>
  );
}

/**
 * Account › Agents: the coding agents connected to the workspace, the
 * requests waiting for the person, and each agent's reach and budget.
 */
export function AgentsPage() {
  const workspace = useWorkspaceTarget();
  const [connecting, setConnecting] = useState(false);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Agents"
        help="Coding agents such as Claude Code, Codex and Cursor that deploy and look after your apps. See what each may do, what it changed, and what is waiting for your approval."
        actions={
          // Quiet here: when a request is waiting, reviewing it is the one action.
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => setConnecting(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            Connect an agent
          </Button>
        }
      />
      {workspace.ready && (
        <AgentsBody
          key={workspace.org ?? 'personal'}
          org={workspace.org}
          label={workspace.label}
          onConnect={() => setConnecting(true)}
        />
      )}
      <ConnectAgentDialog open={connecting} onClose={() => setConnecting(false)} />
    </div>
  );
}
