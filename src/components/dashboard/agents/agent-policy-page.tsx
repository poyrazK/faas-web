import { useId, useMemo, useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { NavArrowLeft } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Timestamp } from '@/components/ui/timestamp';
import { useToast } from '@/components/ui/toast';
import {
  useAgentConnections,
  useAgentPolicy,
  useSetAgentPolicy,
  type AgentConnection,
  type AgentPolicy,
} from '@/lib/api/agents';
import { ApiError } from '@/lib/api/client';
import { errorMessage } from '@/lib/api/errors';
import { useNotificationChannels } from '@/lib/api/notification-channels';
import { useWorkspaceTarget } from '@/lib/api/workspace-apps';
import {
  POLICY_APPROVALS,
  agentName,
  listWords,
  policyAnswer,
  policyCapabilities,
  policyChange,
  policyDisconnects,
  policyDraft,
  type PolicyDraft,
} from '@/lib/agents';
import { useDocumentTitle } from '@/lib/seo';
import { WhenCapable } from '../capability-gate';
import { channelKindLabel } from '../notification-channels';
import { InlinePhase, PageHeader, Panel, queryPhase } from '../primitives';
import { Answer, BACK_LINK, ToneLabel } from './agent-bits';

/** apid's api.MaxAgentApprovalChannels. */
const MAX_CHANNELS = 5;

const toggled = (list: readonly string[], item: string, on: boolean) =>
  on ? [...list.filter((other) => other !== item), item] : list.filter((other) => other !== item);

/** One tickable line: the plain words, a line of detail, and the exact name on the right. */
function Tick({
  label,
  detail,
  term,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  detail?: string;
  term?: string;
  checked: boolean;
  disabled?: boolean;
  onChange?: (on: boolean) => void;
}) {
  return (
    <li className="flex items-start justify-between gap-4">
      <label className="flex min-w-0 items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 size-4 shrink-0 accent-[var(--brand)]"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange?.(event.target.checked)}
        />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="font-medium">{label}</span>
          {detail && <span className="text-xs text-muted-foreground">{detail}</span>}
        </span>
      </label>
      {term && term !== label && (
        <code className="mt-0.5 hidden shrink-0 font-mono text-xs text-muted-foreground sm:block">
          {term}
        </code>
      )}
    </li>
  );
}

/** The person's own channels that also get this company's agents' requests. */
function ChannelsPanel({
  label,
  chosen,
  onChange,
}: {
  label: string;
  chosen: string[];
  onChange: (channels: string[]) => void;
}) {
  const channels = useNotificationChannels();
  const list = channels.data ?? [];
  const phase = queryPhase({
    error: channels.error,
    loading: channels.isPending,
    isEmpty: list.length === 0,
  });
  return (
    <Panel
      title="Where requests reach you"
      help={`Each approval request is emailed to the person who connected the agent. Tick your notification channels to also get the requests of agents in ${label}. This is your own setting: other owners and admins choose theirs.`}
    >
      {phase === 'ready' ? (
        <ul aria-label="Your notification channels" className="flex flex-col gap-3">
          {list.map((channel) => (
            <Tick
              key={channel.id}
              label={channel.name}
              detail={channelKindLabel(channel.kind)}
              checked={chosen.includes(channel.name)}
              // apid takes at most five.
              disabled={!chosen.includes(channel.name) && chosen.length >= MAX_CHANNELS}
              onChange={(on) => onChange(toggled(chosen, channel.name, on))}
            />
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
        <InlinePhase phase={phase} error={channels.error} onRetry={() => void channels.refetch()} />
      )}
    </Panel>
  );
}

/** "Cursor", "Cursor and Codex", or "3 agents". */
const agentsWords = (agents: readonly AgentConnection[]) =>
  agents.length <= 2 ? listWords(agents.map(agentName)) : `${agents.length} agents`;

function PolicyForm({
  org,
  label,
  policy,
  connections,
  canEdit,
}: {
  org: string;
  label: string;
  policy: AgentPolicy;
  /** The company's agents; undefined when the list could not be read. */
  connections: AgentConnection[] | undefined;
  canEdit: boolean;
}) {
  const id = useId();
  const save = useSetAgentPolicy(org);
  const confirm = useConfirm();
  const { toast } = useToast();
  const base = useMemo(() => policyDraft(policy), [policy]);
  const [edited, setEdited] = useState<PolicyDraft | null>(null);
  const [error, setError] = useState<string>();
  const draft = edited ?? base;
  const set = (patch: Partial<PolicyDraft>) => {
    setEdited({ ...draft, ...patch });
    setError(undefined);
  };

  const { change, error: invalid } = policyChange(policy, draft);
  const dirty = canEdit && Boolean(change ?? invalid);
  const leaving = change && connections ? policyDisconnects(change, connections) : [];
  const answer = policyAnswer(policy, label);
  const capabilities = policyCapabilities([...policy.allowed_scopes, ...draft.scopes]);

  const onSave = async () => {
    if (invalid) return setError(invalid);
    if (!change) return;
    // Without the list, a stricter policy may still disconnect someone's agent.
    const stricter =
      !change.agents_allowed ||
      policy.allowed_scopes.some((scope) => !change.allowed_scopes.includes(scope));
    if (leaving.length > 0 || (connections === undefined && stricter)) {
      const ok = await confirm({
        title:
          leaving.length > 0 ? `Save and disconnect ${agentsWords(leaving)}?` : 'Save this policy?',
        description:
          leaving.length === 1
            ? `The new policy no longer allows this agent. Its key stops working at once. What it already changed stays as it is. To act in ${label} again, it has to be connected again.`
            : `${
                leaving.length > 1
                  ? 'The new policy no longer allows these agents.'
                  : 'Agents the new policy no longer allows are disconnected.'
              } Their keys stop working at once. What they already changed stays as it is. To act in ${label} again, each has to be connected again.`,
        confirmLabel: leaving.length > 0 ? 'Save and disconnect' : 'Save policy',
        destructive: true,
      });
      if (!ok) return;
    }
    try {
      const saved = await save.mutateAsync(change);
      setEdited(null);
      const revoked = saved.revoked ?? 0;
      toast({
        kind: 'success',
        title: 'Agent policy saved',
        description:
          revoked > 0
            ? `${revoked} ${revoked === 1 ? 'agent was' : 'agents were'} disconnected.`
            : undefined,
      });
    } catch (err) {
      const forbidden = err instanceof ApiError && err.code === 'org_role_forbidden';
      toast({
        kind: 'error',
        title: 'Could not save the agent policy',
        description: forbidden
          ? `Only owners and admins of ${label} can change it.`
          : errorMessage(err),
        error: err,
      });
    }
  };

  const option = (value: PolicyDraft['ceiling'], title: string, detail: ReactNode) => (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border p-3 has-[:checked]:border-brand has-[:disabled]:cursor-default">
      <input
        type="radio"
        name={`${id}-ceiling`}
        className="mt-1 accent-[var(--brand)]"
        checked={draft.ceiling === value}
        disabled={!canEdit}
        onChange={() => set({ ceiling: value })}
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{detail}</span>
      </span>
    </label>
  );

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Policy now" className="flex flex-col gap-1.5">
        <Answer label="Agent policy" tone={answer.tone}>
          {answer.sentence}
        </Answer>
        <p className="pl-[1.125rem] text-sm text-muted-foreground">
          {policy.updated_at ? (
            <>
              Last changed <Timestamp value={policy.updated_at} />.
            </>
          ) : (
            `This is the default: nobody has set a policy for ${label}.`
          )}
          {!canEdit && ` Only owners and admins of ${label} can change it.`}
        </p>
      </section>

      <Panel title={`Agents in ${label}`}>
        <div className="flex items-start justify-between gap-6">
          <div className="flex min-w-0 flex-col gap-0.5">
            <p id={`${id}-allow`} className="text-sm font-medium">
              Allow agents
            </p>
            <p className="text-sm text-muted-foreground">
              {draft.allowed
                ? `Members can connect agents that act in ${label}. An agent never gets more than the role of the member who connected it.`
                : `No agent can act in ${label}, and none can be connected to it.`}
            </p>
          </div>
          <Switch
            checked={draft.allowed}
            disabled={!canEdit}
            onCheckedChange={(on) => set({ allowed: on })}
            aria-labelledby={`${id}-allow`}
            className="mt-0.5 data-[state=checked]:bg-brand"
          />
        </div>
      </Panel>

      {draft.allowed && (
        <>
          {/* Two columns on a wide screen: what agents may do beside its two limits. */}
          <div className="grid items-start gap-6 lg:grid-cols-2">
            <Panel
              title="What agents may do"
              help="An agent that connects gets only what is ticked here, even if it asks for more. Unticking a capability disconnects the agents that have it."
            >
              <ul aria-label="Capabilities" className="flex flex-col gap-3">
                <Tick
                  label="Inspect apps"
                  detail="Apps, deployments, logs and metrics. Always allowed."
                  term="apps:read"
                  checked
                  disabled
                />
                {capabilities.map((capability) => (
                  <Tick
                    key={capability.scope}
                    label={capability.label}
                    detail={capability.detail}
                    term={capability.scope}
                    checked={draft.scopes.includes(capability.scope)}
                    disabled={!canEdit}
                    onChange={(on) => set({ scopes: toggled(draft.scopes, capability.scope, on) })}
                  />
                ))}
              </ul>
            </Panel>

            <div className="flex flex-col gap-6">
              <Panel
                title="What every agent asks a person before"
                help={`Whatever is ticked here waits for a person's approval, for every agent in ${label}. It adds to what was chosen when each agent was connected; it never removes from it.`}
              >
                <ul aria-label="Required approvals" className="flex flex-col gap-3">
                  {POLICY_APPROVALS.map((approval) => (
                    <Tick
                      key={approval.kind}
                      label={approval.label}
                      detail={approval.detail}
                      checked={draft.approvals.includes(approval.kind)}
                      disabled={!canEdit}
                      onChange={(on) =>
                        set({ approvals: toggled(draft.approvals, approval.kind, on) })
                      }
                    />
                  ))}
                </ul>
              </Panel>

              <Panel
                title="Budget ceiling"
                help="An agent's always-on budget is what it may add to the bill each month without any traffic: warm instances, always-running services, databases that never sleep. Past it, each such change waits for approval."
              >
                <div className="flex flex-col gap-3">
                  {option('none', 'No ceiling', 'Each agent keeps the budget its member set.')}
                  {option(
                    'amount',
                    'A monthly ceiling',
                    "No agent's budget can pass it. An agent's own budget applies when it is lower."
                  )}
                  {draft.ceiling === 'amount' && (
                    <div className="flex flex-col gap-1.5 pl-7">
                      <label htmlFor={`${id}-amount`} className="text-sm font-medium">
                        Dollars a month
                      </label>
                      <Input
                        id={`${id}-amount`}
                        inputMode="decimal"
                        placeholder="100"
                        className="max-w-40"
                        value={draft.amount}
                        disabled={!canEdit}
                        aria-invalid={error ? true : undefined}
                        onChange={(event) => set({ amount: event.target.value })}
                      />
                    </div>
                  )}
                </div>
              </Panel>
            </div>
          </div>

          {canEdit && (
            <WhenCapable capability="notification-channels">
              <ChannelsPanel
                label={label}
                chosen={draft.channels}
                onChange={(channels) => set({ channels })}
              />
            </WhenCapable>
          )}
        </>
      )}

      {dirty && (
        <div
          role="region"
          aria-label="Unsaved policy changes"
          className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 surface rounded-2xl bg-card px-5 py-3"
        >
          <div className="flex min-w-0 flex-1 basis-60 flex-col gap-1">
            {error ? (
              <p role="alert" className="text-sm text-[color:var(--status-critical)]">
                {error}
              </p>
            ) : leaving.length > 0 ? (
              <p className="text-sm">
                <ToneLabel tone="warning">
                  <span className="text-sm text-foreground">
                    Saving disconnects {agentsWords(leaving)}.
                  </span>
                </ToneLabel>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">You have unsaved changes.</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={save.isPending}
              onClick={() => {
                setEdited(null);
                setError(undefined);
              }}
            >
              Discard
            </Button>
            <Button size="sm" busy={save.isPending} onClick={() => void onSave()}>
              Save policy
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function PolicyBody({ org, label }: { org: string; label: string }) {
  const policy = useAgentPolicy(org);
  // The list needs the same role as saving (org.go: OrgActionRevokeApiKey), so
  // its refusal says this member can read the policy but not change it.
  const connections = useAgentConnections(org);
  const readOnly =
    connections.error instanceof ApiError && connections.error.code === 'org_role_forbidden';
  const phase = queryPhase({
    error: policy.error,
    loading: policy.isPending || connections.isPending,
  });
  if (phase !== 'ready' || !policy.data)
    return (
      <Panel>
        <InlinePhase phase={phase} error={policy.error} onRetry={() => void policy.refetch()} />
      </Panel>
    );
  return (
    <PolicyForm
      org={org}
      label={label}
      policy={policy.data}
      connections={connections.data}
      canEdit={!readOnly}
    />
  );
}

/**
 * Agents › Policy: whether agents may act in the company, what they may do,
 * what every one of them asks a person about, and the ceiling on their budgets.
 */
export function AgentPolicyPage() {
  const workspace = useWorkspaceTarget();
  useDocumentTitle('Agent policy');
  return (
    <div className="flex flex-col gap-6">
      <Link to="/dashboard/agents" className={BACK_LINK}>
        <NavArrowLeft className="size-4" />
        All agents
      </Link>
      <PageHeader
        title="Agent policy"
        help="What coding agents may do in an organization, whoever connected them. Owners and admins set it; every member can read it."
      />
      {workspace.ready &&
        (workspace.org ? (
          <PolicyBody key={workspace.org} org={workspace.org} label={workspace.label} />
        ) : (
          <Panel>
            <p role="status" className="text-sm text-muted-foreground">
              An agent policy belongs to an organization. In your personal account you choose what
              each agent may do when you connect it. Switch to an organization to see its policy.
            </p>
          </Panel>
        ))}
    </div>
  );
}
