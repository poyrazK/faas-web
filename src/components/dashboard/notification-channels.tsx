import { useId, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  ChatBubble,
  CheckCircle,
  Clock,
  Mail,
  Plus,
  SendDiagonal,
  Trash,
  WarningTriangle,
} from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { FIELD, FieldError, fieldErrorProps } from '@/components/ui/field';
import { Timestamp } from '@/components/ui/timestamp';
import { useToast } from '@/components/ui/toast';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useCapability } from '@/lib/api/capabilities';
import {
  createNotificationChannelOnce,
  notificationChannelsKey,
  useDeleteNotificationChannel,
  useNotificationChannels,
  useTestNotificationChannel,
  type ChannelTestResult,
  type CreateNotificationChannel,
  type NotificationChannel,
} from '@/lib/api/notification-channels';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { MaturityLabel } from './maturity-label';
import { InlinePhase, Panel, queryPhase } from './primitives';
import { ProblemHelp } from './problem-help';
import { SegmentedControl } from './tabs';

type Kind = NotificationChannel['kind'];

/** apid caps (pkg/api/notification_channels.go, MaxChannelsPerAlertRule). */
export const MAX_CHANNELS_PER_RULE = 5;
const NAME_PATTERN = /^[a-z][a-z0-9_-]{0,62}$/;
const SLACK_PREFIX = 'https://hooks.slack.com/services/';
const ROUTING_KEY = /^[A-Za-z0-9]{32}$/;

const KIND: Record<Kind, { label: string; icon: typeof Bell }> = {
  slack: { label: 'Slack', icon: ChatBubble },
  pagerduty: { label: 'PagerDuty', icon: Bell },
  email: { label: 'Email', icon: Mail },
};

export function channelKindLabel(kind: string): string {
  return KIND[kind as Kind]?.label ?? kind;
}

/**
 * A channel's last outcome, as apid records it on every delivery and test
 * (handlers_notification_channel_test_send.go:51). An error newer than the
 * last success is a broken destination now; an older one has recovered.
 */
export function channelHealth(
  channel: Pick<NotificationChannel, 'last_delivered_at' | 'last_error' | 'last_error_at'>
): 'failing' | 'delivering' | 'unused' {
  const ok = channel.last_delivered_at ? Date.parse(channel.last_delivered_at) : NaN;
  const failed = channel.last_error_at ? Date.parse(channel.last_error_at) : NaN;
  if (channel.last_error && !Number.isNaN(failed) && (Number.isNaN(ok) || failed >= ok))
    return 'failing';
  if (!Number.isNaN(ok)) return 'delivering';
  return 'unused';
}

export function ChannelStatus({ channel }: { channel: NotificationChannel }) {
  const health = channelHealth(channel);
  if (health === 'failing')
    return (
      <span className="flex min-w-0 flex-col gap-0.5 text-xs">
        <span
          className="inline-flex items-center gap-1.5"
          style={{ color: 'var(--status-critical)' }}
        >
          <WarningTriangle aria-hidden className="h-3.5 w-3.5 shrink-0" />
          Failing · <Timestamp value={channel.last_error_at} />
        </span>
        <span className="break-words font-mono text-muted-foreground">{channel.last_error}</span>
      </span>
    );
  if (health === 'delivering')
    return (
      <span className="inline-flex items-center gap-1.5 text-xs">
        <CheckCircle
          aria-hidden
          className="h-3.5 w-3.5 shrink-0"
          style={{ color: 'var(--status-good)' }}
        />
        Delivered · <Timestamp value={channel.last_delivered_at} />
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <Clock aria-hidden className="h-3.5 w-3.5 shrink-0" />
      Nothing sent yet
    </span>
  );
}

/** A refusal the person can act on, in their words rather than the code's. */
function refusal(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'notification_channel_test_rate_limited')
      return 'This account has sent ten test messages in the last minute. Try again shortly.';
    if (err.code === 'plan_alert_rules_not_allowed')
      return 'Notification channels come with alert rules, on Hobby and above.';
  }
  return errorMessage(err);
}

/**
 * The account's notification channels: list with each one's last outcome,
 * add, send a test, delete (faas ADR-749, docs/alerts.md "Notification
 * channels"). Account-wide, so it never takes an app.
 */
export function NotificationChannels() {
  const channels = useNotificationChannels();
  const { capability } = useCapability('notification-channels');
  const remove = useDeleteNotificationChannel();
  const test = useTestNotificationChannel();
  const confirm = useConfirm();
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const [results, setResults] = useState<Record<string, ChannelTestResult | string>>({});
  const [refused, setRefused] = useState<{ id: string; error: unknown } | null>(null);

  const list = channels.data ?? [];
  const planGated =
    channels.error instanceof ApiError && channels.error.code === 'plan_alert_rules_not_allowed';
  const phase = queryPhase({
    error: channels.error,
    loading: channels.isPending,
    isEmpty: list.length === 0,
  });

  const sendTest = (channel: NotificationChannel) =>
    void test
      .mutateAsync(channel.id)
      .then((result) => {
        setResults((prev) => ({ ...prev, [channel.id]: result }));
        toast(
          result.delivered
            ? { kind: 'success', title: `Test sent to ${channel.name}` }
            : {
                kind: 'error',
                title: `${channel.name} did not accept the test`,
                description: result.error,
              }
        );
      })
      .catch((err: unknown) => {
        setResults((prev) => ({ ...prev, [channel.id]: refusal(err) }));
        toast({ kind: 'error', title: 'Could not send test', description: refusal(err) });
      });

  const askDelete = async (channel: NotificationChannel) => {
    setRefused(null);
    const ok = await confirm({
      title: `Delete ${channel.name}?`,
      description:
        'Alert rules stop delivering to it. A rule it is the only destination of keeps it until that rule gets a webhook or another channel.',
      confirmLabel: 'Delete channel',
      destructive: true,
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(channel.id);
      toast({ kind: 'success', title: `${channel.name} deleted` });
    } catch (err) {
      // 409 notification_channel_in_use names the rules that would deliver
      // nowhere; keep it on the row so the names stay readable.
      if (err instanceof ApiError && err.code === 'notification_channel_in_use')
        setRefused({ id: channel.id, error: err });
      else toast({ kind: 'error', title: 'Could not delete', error: err });
    }
  };

  return (
    <Panel
      title="Notification channels"
      description="Slack, PagerDuty and email destinations any alert rule can deliver to, without a webhook receiver of your own. They receive fires and resolves."
      actions={
        <div className="flex items-center gap-2">
          <MaturityLabel capability={capability} />
          {!planGated && (
            <Button
              size="xs"
              variant={adding ? 'ghost' : 'outline'}
              className="gap-1"
              onClick={() => setAdding((v) => !v)}
            >
              {adding ? (
                'Cancel'
              ) : (
                <>
                  <Plus className="h-3.5 w-3.5" />
                  Add channel
                </>
              )}
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {adding && <AddChannel existing={list} onDone={() => setAdding(false)} />}
        {planGated ? (
          <p role="status" className="text-sm text-muted-foreground">
            Notification channels come with alert rules, on Hobby and above.{' '}
            <a className="text-brand underline" href="/dashboard/plans">
              View plans
            </a>
          </p>
        ) : phase !== 'ready' ? (
          <InlinePhase
            phase={phase}
            error={channels.error}
            loadingMessage="Reading channels…"
            emptyMessage="No channels yet. Add Slack, PagerDuty or your email, then point rules at it."
            onRetry={() => void channels.refetch()}
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border" aria-label="Notification channels">
            {list.map((channel) => {
              const Icon = KIND[channel.kind]?.icon ?? Bell;
              const result = results[channel.id];
              return (
                <li key={channel.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <Icon aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="font-mono text-sm">{channel.name}</span>
                        <span className="label-mono text-muted-foreground">
                          {channelKindLabel(channel.kind)}
                          {channel.pagerduty_region && ` · ${channel.pagerduty_region}`}
                        </span>
                      </span>
                      <span className="break-all font-mono text-xs text-muted-foreground">
                        {channel.target}
                      </span>
                      <ChannelStatus channel={channel} />
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        size="xs"
                        variant="outline"
                        className="gap-1"
                        disabled={test.isPending && test.variables === channel.id}
                        onClick={() => sendTest(channel)}
                      >
                        <SendDiagonal className="h-3.5 w-3.5" />
                        Send test
                      </Button>
                      <button
                        type="button"
                        aria-label={`Delete channel ${channel.name}`}
                        onClick={() => void askDelete(channel)}
                        className="text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <Trash className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  {result !== undefined && <TestOutcome result={result} />}
                  {refused?.id === channel.id && (
                    <div role="alert" className="flex flex-col gap-1 text-xs">
                      <span style={{ color: 'var(--status-critical)' }}>
                        {errorMessage(refused.error)}
                      </span>
                      <ProblemHelp error={refused.error} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Panel>
  );
}

function TestOutcome({ result }: { result: ChannelTestResult | string }) {
  if (typeof result === 'string')
    return (
      <p role="status" className="text-xs" style={{ color: 'var(--status-critical)' }}>
        {result}
      </p>
    );
  return result.delivered ? (
    <p role="status" className="inline-flex items-center gap-1.5 text-xs">
      <CheckCircle aria-hidden className="h-3.5 w-3.5" style={{ color: 'var(--status-good)' }} />
      The test was accepted.
    </p>
  ) : (
    <p role="status" className="inline-flex items-start gap-1.5 text-xs">
      <WarningTriangle
        aria-hidden
        className="mt-0.5 h-3.5 w-3.5 shrink-0"
        style={{ color: 'var(--status-critical)' }}
      />
      <span>
        The destination refused the test
        {result.error && <span className="font-mono">: {result.error}</span>}
      </span>
    </p>
  );
}

type Field = 'name' | 'slack' | 'routingKey' | 'email';

/**
 * Write-only by construction, like the outbound credential: the Slack URL and
 * the PagerDuty key live in this form's state until the POST settles, are
 * cleared on success, and never reach the query or mutation cache.
 */
function AddChannel({ existing, onDone }: { existing: NotificationChannel[]; onDone: () => void }) {
  const { account } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [kind, setKind] = useState<Kind>('slack');
  const [name, setName] = useState('');
  const [slackUrl, setSlackUrl] = useState('');
  const [routingKey, setRoutingKey] = useState('');
  const [region, setRegion] = useState<'us' | 'eu'>('us');
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const email = account?.email ?? '';
  const formId = useId();

  const errors: Record<Field, string | undefined> = {
    name: !NAME_PATTERN.test(name)
      ? 'Use lowercase letters, digits, - and _, starting with a letter.'
      : existing.some((c) => c.name === name)
        ? 'A channel already has this name.'
        : undefined,
    slack:
      kind === 'slack' && !slackUrl.trim().startsWith(SLACK_PREFIX)
        ? `Paste a Slack incoming webhook URL, starting ${SLACK_PREFIX}`
        : undefined,
    routingKey:
      kind === 'pagerduty' && !ROUTING_KEY.test(routingKey.trim())
        ? 'Paste the 32-character Events API v2 integration key.'
        : undefined,
    email: kind === 'email' && !email ? 'This account has no email address to send to.' : undefined,
  };
  const shown = (field: Field) => (attempted ? errors[field] : undefined);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    setFailure(null);
    if (Object.values(errors).some(Boolean) || saving) return;
    // Only the chosen kind's fields: apid refuses a body that mixes them
    // (NormalizeNotificationChannelRequest, notification_channels.go:56-82).
    const body: CreateNotificationChannel =
      kind === 'slack'
        ? { name, kind, slack_webhook_url: slackUrl.trim() }
        : kind === 'pagerduty'
          ? { name, kind, pagerduty_routing_key: routingKey.trim(), pagerduty_region: region }
          : { name, kind, email };
    setSaving(true);
    try {
      const created = await createNotificationChannelOnce(body);
      setSlackUrl('');
      setRoutingKey('');
      toast({
        kind: 'success',
        title: `${created.name} added`,
        description: 'Send it a test to check the destination.',
      });
      onDone();
    } catch (err) {
      setFailure(err);
    } finally {
      setSaving(false);
      void qc.invalidateQueries({ queryKey: notificationChannelsKey });
    }
  };

  return (
    <form
      noValidate
      autoComplete="off"
      onSubmit={(e) => void submit(e)}
      className="grid grid-cols-1 gap-4 rounded-lg border border-border p-4 sm:grid-cols-2"
    >
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <span className="label-mono text-muted-foreground">Kind</span>
        <SegmentedControl
          label="Channel kind"
          value={kind}
          options={(['slack', 'pagerduty', 'email'] as const).map((k) => ({
            key: k,
            label: KIND[k].label,
          }))}
          onChange={(next) => {
            setKind(next);
            setFailure(null);
          }}
        />
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="label-mono text-muted-foreground">Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="ops-slack"
          spellCheck={false}
          maxLength={63}
          className={cn(FIELD, 'font-mono')}
          {...fieldErrorProps(shown('name'), 'channel-name-error')}
        />
        {shown('name') && <FieldError id="channel-name-error">{shown('name')}</FieldError>}
      </label>
      {kind === 'slack' && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${formId}-slack`} className="label-mono text-muted-foreground">
            Slack webhook URL
          </label>
          <input
            id={`${formId}-slack`}
            name="slack"
            type="password"
            value={slackUrl}
            onChange={(e) => setSlackUrl(e.target.value)}
            placeholder={`${SLACK_PREFIX}…`}
            autoComplete="new-password"
            spellCheck={false}
            className={cn(FIELD, 'font-mono')}
            {...fieldErrorProps(shown('slack'), 'channel-slack-error')}
          />
          {shown('slack') ? (
            <FieldError id="channel-slack-error">{shown('slack')}</FieldError>
          ) : (
            <span className="text-xs text-muted-foreground">
              Sealed on save and never shown again.
            </span>
          )}
        </div>
      )}
      {kind === 'pagerduty' && (
        <>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${formId}-key`} className="label-mono text-muted-foreground">
              Integration key
            </label>
            <input
              id={`${formId}-key`}
              name="routingKey"
              type="password"
              value={routingKey}
              onChange={(e) => setRoutingKey(e.target.value)}
              placeholder="32 characters, from the service's Integrations tab"
              autoComplete="new-password"
              spellCheck={false}
              className={cn(FIELD, 'font-mono')}
              {...fieldErrorProps(shown('routingKey'), 'channel-key-error')}
            />
            {shown('routingKey') ? (
              <FieldError id="channel-key-error">{shown('routingKey')}</FieldError>
            ) : (
              <span className="text-xs text-muted-foreground">
                Sealed on save; only its last four characters are shown.
              </span>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">Region</span>
            <SegmentedControl
              label="PagerDuty region"
              value={region}
              options={[
                { key: 'us', label: 'US' },
                { key: 'eu', label: 'EU' },
              ]}
              onChange={setRegion}
            />
          </div>
        </>
      )}
      {kind === 'email' && (
        <label className="flex flex-col gap-1.5">
          <span className="label-mono text-muted-foreground">Email</span>
          <input value={email} readOnly className={cn(FIELD, 'text-muted-foreground')} />
          {shown('email') ? (
            <FieldError id="channel-email-error">{shown('email')}</FieldError>
          ) : (
            <span className="text-xs text-muted-foreground">
              Email channels can only send to your account's own address for now.
            </span>
          )}
        </label>
      )}
      {failure !== null && (
        <div role="alert" className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span style={{ color: 'var(--status-critical)' }}>{refusal(failure)}</span>
          <ProblemHelp error={failure} />
        </div>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" size="sm" busy={saving} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Add channel
        </Button>
      </div>
    </form>
  );
}

/**
 * Which channels a rule delivers to: up to five of the account's channels
 * (validateRuleChannels, handlers_alerts_channels.go:15-37). Budgets share the
 * same cap (MaxChannelsPerFinancialBudget) and pass their own `limitNote`.
 */
export function ChannelPicker({
  value,
  onChange,
  idPrefix = 'channel',
  limitNote = `A rule delivers to at most ${MAX_CHANNELS_PER_RULE} channels.`,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  idPrefix?: string;
  limitNote?: string;
}) {
  const channels = useNotificationChannels();
  const list = channels.data ?? [];
  const phase = queryPhase({
    error: channels.error,
    loading: channels.isPending,
    isEmpty: list.length === 0,
  });
  const full = value.length >= MAX_CHANNELS_PER_RULE;
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="label-mono text-muted-foreground">Channels</legend>
      {phase !== 'ready' ? (
        <div className="pt-1.5 text-xs">
          <InlinePhase
            phase={phase}
            error={channels.error}
            loadingMessage="Reading channels…"
            emptyMessage="No channels yet."
          />
          {phase === 'empty' && (
            <a className="text-brand underline" href="/dashboard/alerts?view=channels">
              Add Slack, PagerDuty or email
            </a>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5 pt-1.5">
          {list.map((channel) => {
            const on = value.includes(channel.id);
            return (
              <label
                key={channel.id}
                htmlFor={`${idPrefix}-${channel.id}`}
                className={cn(
                  'pressable inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs',
                  on
                    ? 'border-brand bg-brand/10 text-foreground'
                    : 'border-border text-muted-foreground',
                  !on && full && 'opacity-50'
                )}
              >
                <input
                  id={`${idPrefix}-${channel.id}`}
                  type="checkbox"
                  checked={on}
                  disabled={!on && full}
                  onChange={() =>
                    onChange(on ? value.filter((id) => id !== channel.id) : [...value, channel.id])
                  }
                  className="h-3.5 w-3.5 accent-[color:var(--brand)]"
                />
                <span className="font-mono">{channel.name}</span>
                <span className="text-muted-foreground">{channelKindLabel(channel.kind)}</span>
              </label>
            );
          })}
        </div>
      )}
      {full && <span className="text-xs text-muted-foreground">{limitNote}</span>}
    </fieldset>
  );
}
