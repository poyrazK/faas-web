import { useState } from 'react';
import { Plus, Send, Trash } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { FIELD, FieldError, fieldErrorProps, useFormValidation } from '@/components/ui/field';
import { Timestamp } from '@/components/ui/timestamp';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { useCapability } from '@/lib/api/capabilities';
import { ApiError, errorMessage } from '@/lib/api/errors';
import {
  useCreateNotificationChannel,
  useDeleteNotificationChannel,
  useNotificationChannels,
  useTestNotificationChannel,
  type NotificationChannel,
} from '@/lib/api/notification-channels';
import { useWorkspaceTarget } from '@/lib/api/workspace-apps';
import { useAuth } from '@/lib/auth';
import {
  channelDraftBody,
  channelDraftErrors,
  type ChannelDraft,
  type ChannelKind,
} from '@/lib/alert-rules';
import { Labelled } from './alert-rule-form';
import { CapabilityGate } from './capability-gate';
import { InlinePhase, Panel, queryPhase } from './primitives';
import { ProblemHelp } from './problem-help';
import { Pill } from './resource-table';

const KIND_LABEL: Record<string, string> = {
  slack: 'Slack',
  pagerduty: 'PagerDuty',
  email: 'Email',
};

/** The rule fields the delete warning needs. */
export interface ChannelRuleRef {
  id: string;
  name: string;
  channel_ids?: string[];
}

/**
 * Slack, PagerDuty and email destinations for alert rules (faas ADR-749).
 *
 * Channels are the signed-in account's own, whatever app the page is on, and
 * the API answers for that account even in a company workspace. So a company
 * workspace gets an explanation, never the personal list: a company app's
 * rule delivers to a webhook unless its creator binds their own channels
 * (ADR-20261026151103).
 */
export function NotificationChannels({ rules = [] }: { rules?: ChannelRuleRef[] }) {
  const { org, label } = useWorkspaceTarget();
  const { capability } = useCapability('notification-channels');
  const maturity =
    capability?.maturity === 'beta' ? 'Beta' : capability?.maturity === 'preview' ? 'Preview' : '';
  const description =
    'Deliver alerts to Slack, PagerDuty or your email without a webhook receiver. Destinations are sealed on save and never shown again.';

  if (org)
    return (
      <Panel
        title="Notification channels"
        description={description}
        actions={maturity && <Pill label={maturity} />}
      >
        <p role="status" className="text-sm text-muted-foreground">
          Notification channels belong to your own account, not to {label}. Rules on {label}
          ’s apps deliver to a webhook; switch to your personal workspace to manage your channels.
        </p>
      </Panel>
    );

  return (
    <CapabilityGate capability="notification-channels" title="Notification channels">
      <Panel
        title="Notification channels"
        description={description}
        actions={maturity && <Pill label={maturity} />}
        padded={false}
      >
        <ChannelList rules={rules} />
        <AddChannel />
      </Panel>
    </CapabilityGate>
  );
}

function ChannelList({ rules }: { rules: ChannelRuleRef[] }) {
  const channels = useNotificationChannels(true);
  const items = channels.data ?? [];
  const phase = queryPhase({
    loading: channels.isPending,
    error: channels.error,
    isEmpty: items.length === 0,
  });
  if (phase !== 'ready')
    return (
      <div className="px-5 py-4">
        <InlinePhase
          phase={phase}
          error={channels.error}
          emptyMessage="No channels yet. Add one below, then choose it on a rule."
          onRetry={() => void channels.refetch()}
        />
      </div>
    );
  return (
    <ul className="flex flex-col divide-y divide-border">
      {items.map((channel) => (
        <ChannelRow
          key={channel.id}
          channel={channel}
          usedBy={rules.filter((r) => r.channel_ids?.includes(channel.id))}
        />
      ))}
    </ul>
  );
}

/** The newer of the last delivery and the last error is the channel's state. */
function LastOutcome({ channel }: { channel: NotificationChannel }) {
  const delivered = channel.last_delivered_at ? Date.parse(channel.last_delivered_at) : NaN;
  const failed = channel.last_error_at ? Date.parse(channel.last_error_at) : NaN;
  if (channel.last_error && !(delivered > failed))
    return (
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-xs">
        <span style={{ color: 'var(--status-critical)' }}>Failed</span>
        <span className="truncate font-mono text-muted-foreground" title={channel.last_error}>
          {channel.last_error}
        </span>
        <Timestamp value={channel.last_error_at} className="text-muted-foreground" />
      </span>
    );
  if (channel.last_delivered_at)
    return (
      <span className="text-xs text-muted-foreground">
        Delivered <Timestamp value={channel.last_delivered_at} />
      </span>
    );
  return <span className="text-xs text-muted-foreground">Nothing sent yet</span>;
}

function ChannelRow({
  channel,
  usedBy,
}: {
  channel: NotificationChannel;
  usedBy: ChannelRuleRef[];
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const test = useTestNotificationChannel();
  const remove = useDeleteNotificationChannel();
  const [deleteError, setDeleteError] = useState<unknown>(null);
  const kind =
    KIND_LABEL[channel.kind] +
    (channel.kind === 'pagerduty' && channel.pagerduty_region
      ? ` · ${channel.pagerduty_region.toUpperCase()}`
      : '');

  const onTest = () =>
    void test
      .mutateAsync(channel.id)
      .then((res) =>
        res.delivered
          ? toast({ kind: 'success', title: `Test delivered to ${channel.name}` })
          : toast({
              kind: 'error',
              title: `${channel.name} did not accept the test`,
              description: res.error ?? 'The destination refused it.',
            })
      )
      .catch((err: unknown) =>
        toast(
          err instanceof ApiError && err.code === 'notification_channel_test_rate_limited'
            ? {
                kind: 'error',
                title: 'Too many test sends',
                description:
                  'An account can send 10 test messages a minute across its channels. Try again shortly.',
              }
            : { kind: 'error', title: 'Could not send the test', error: err }
        )
      );

  const onDelete = async () => {
    const here = usedBy.length
      ? ` On this app it delivers ${usedBy.length === 1 ? 'rule' : 'rules'} ${usedBy
          .map((r) => r.name)
          .join(', ')}; ${usedBy.length === 1 ? 'that rule stops' : 'they stop'} sending here.`
      : '';
    if (
      !(await confirm({
        title: `Delete ${channel.name}?`,
        description: `The channel is removed from every rule that delivers to it.${here} A rule with no other destination keeps the channel until it gets one.`,
        confirmLabel: 'Delete channel',
        destructive: true,
      }))
    )
      return;
    setDeleteError(null);
    void remove
      .mutateAsync(channel.id)
      .then(() => toast({ kind: 'success', title: `${channel.name} deleted` }))
      .catch((err: unknown) => setDeleteError(err));
  };

  return (
    <li aria-label={channel.name} className="flex flex-col gap-2 px-5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">{channel.name}</span>
            <span className="text-xs text-muted-foreground">{kind}</span>
          </span>
          <span className="truncate font-mono text-xs text-muted-foreground">{channel.target}</span>
          <LastOutcome channel={channel} />
        </div>
        <span className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            className="gap-1.5"
            busy={test.isPending}
            aria-label={`Send a test to ${channel.name}`}
            onClick={onTest}
          >
            <Send className="h-3.5 w-3.5" />
            Test
          </Button>
          <button
            type="button"
            aria-label={`Delete ${channel.name}`}
            onClick={() => void onDelete()}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <Trash className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>
      {deleteError !== null && (
        <div role="alert" className="flex flex-col gap-1 text-sm">
          <span style={{ color: 'var(--status-critical)' }}>
            {deleteError instanceof ApiError && deleteError.code === 'notification_channel_in_use'
              ? `Not deleted. ${errorMessage(deleteError)}`
              : `Could not delete: ${errorMessage(deleteError)}`}
          </span>
          <ProblemHelp error={deleteError} />
        </div>
      )}
    </li>
  );
}

function AddChannel() {
  const { account } = useAuth();
  const { toast } = useToast();
  const create = useCreateNotificationChannel();
  const validation = useFormValidation<'name' | 'slackUrl' | 'routingKey' | 'email'>();
  const [draft, setDraft] = useState<ChannelDraft>({
    name: '',
    kind: 'slack',
    slackUrl: '',
    routingKey: '',
    region: 'us',
    email: account?.email ?? '',
  });
  const [error, setError] = useState<unknown>(null);
  const set = (patch: Partial<ChannelDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const errors = channelDraftErrors(draft, account?.email);
  const shown = (field: keyof typeof errors) =>
    validation.submitAttempted ? errors[field] : undefined;

  return (
    <form
      noValidate
      className="grid gap-4 border-t border-border p-5 sm:grid-cols-2 lg:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!validation.validate(errors, e.currentTarget) || create.isPending) return;
        setError(null);
        void create
          .mutateAsync(channelDraftBody(draft))
          .then((channel) => {
            // The destination is write-only: clear it as soon as it is sealed.
            set({ name: '', slackUrl: '', routingKey: '' });
            validation.resetValidation();
            toast({
              kind: 'success',
              title: `${channel.name} added`,
              description: 'Send a test to confirm it reaches you.',
            });
          })
          .catch((err: unknown) => setError(err));
      }}
    >
      <Labelled
        label="Name"
        after={shown('name') && <FieldError id="channel-name-error">{shown('name')}</FieldError>}
      >
        <input
          name="name"
          value={draft.name}
          onChange={(e) => set({ name: e.target.value })}
          {...fieldErrorProps(shown('name'), 'channel-name-error')}
          placeholder="ops-slack"
          spellCheck={false}
          className={`${FIELD} font-mono`}
        />
      </Labelled>
      <label className="flex flex-col gap-1.5">
        <span className="label-mono text-muted-foreground">Kind</span>
        <select
          value={draft.kind}
          onChange={(e) => set({ kind: e.target.value as ChannelKind })}
          className={FIELD}
        >
          <option value="slack">Slack</option>
          <option value="pagerduty">PagerDuty</option>
          <option value="email">Email</option>
        </select>
      </label>
      {draft.kind === 'slack' && (
        <Labelled
          label="Slack webhook URL"
          className="sm:col-span-2"
          after={
            shown('slackUrl') && (
              <FieldError id="channel-slack-error">{shown('slackUrl')}</FieldError>
            )
          }
        >
          <input
            name="slackUrl"
            type="password"
            value={draft.slackUrl}
            onChange={(e) => set({ slackUrl: e.target.value })}
            {...fieldErrorProps(shown('slackUrl'), 'channel-slack-error')}
            placeholder="https://hooks.slack.com/services/…"
            autoComplete="off"
            className={`${FIELD} font-mono`}
          />
        </Labelled>
      )}
      {draft.kind === 'pagerduty' && (
        <>
          <Labelled
            label="Routing key"
            after={
              shown('routingKey') && (
                <FieldError id="channel-key-error">{shown('routingKey')}</FieldError>
              )
            }
          >
            <input
              name="routingKey"
              type="password"
              value={draft.routingKey}
              onChange={(e) => set({ routingKey: e.target.value })}
              {...fieldErrorProps(shown('routingKey'), 'channel-key-error')}
              placeholder="Events API v2 key"
              autoComplete="off"
              className={`${FIELD} font-mono`}
            />
          </Labelled>
          <label className="flex flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">Region</span>
            <select
              value={draft.region}
              onChange={(e) => set({ region: e.target.value as ChannelDraft['region'] })}
              className={FIELD}
            >
              <option value="us">US</option>
              <option value="eu">EU</option>
            </select>
          </label>
        </>
      )}
      {draft.kind === 'email' && (
        <Labelled
          label="Email"
          className="sm:col-span-2"
          after={
            shown('email') && <FieldError id="channel-email-error">{shown('email')}</FieldError>
          }
        >
          <input
            name="email"
            type="email"
            value={draft.email}
            readOnly
            {...fieldErrorProps(shown('email'), 'channel-email-error')}
            title="Email channels send to your account's own address for now."
            className={`${FIELD} text-muted-foreground`}
          />
        </Labelled>
      )}
      <div className="flex flex-col gap-2 sm:col-span-2 lg:col-span-4">
        {error !== null && (
          <div role="alert" className="flex flex-col gap-1 text-sm">
            <span style={{ color: 'var(--status-critical)' }}>
              {error instanceof ApiError && error.code === 'notification_channel_limit_reached'
                ? `An account can have at most ${error.problem.limit ?? 20} channels. Delete one to add another.`
                : errorMessage(error)}
            </span>
            <ProblemHelp error={error} />
          </div>
        )}
        <div>
          <Button type="submit" size="sm" className="gap-1.5" busy={create.isPending}>
            <Plus className="h-3.5 w-3.5" />
            Add channel
          </Button>
        </div>
      </div>
    </form>
  );
}
