import { useState, type ReactNode } from 'react';
import {
  CheckCircle,
  Clock,
  EditPencil,
  Refresh,
  Trash,
  WarningCircle,
  WarningTriangle,
} from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { CopyableId } from '@/components/ui/copyable-id';
import { FIELD, FieldError, fieldErrorProps } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { Timestamp } from '@/components/ui/timestamp';
import { useToast } from '@/components/ui/toast';
import {
  useAlertRule,
  useAppSLOs,
  useAppSyntheticChecks,
  type AlertRule,
  type UpdateAlertRule,
} from '@/lib/api/alert-rules';
import { ApiError } from '@/lib/api/errors';
import { useNotificationChannels } from '@/lib/api/notification-channels';
import { useDeleteAlert, useRotateAlertSecret, useUpdateAlert } from '@/lib/api/queries';
import { cn } from '@/lib/utils';
import { AlertDeliveries } from './alert-deliveries';
import {
  COMPARISON_SYMBOL,
  baselineRange,
  comparisonsFor,
  describeCondition,
  isBaseline,
  metricLabel,
  metricSpec,
  windowsFor,
  type AlertComparison,
  type AlertWindow,
} from './alert-metrics';
import { useCapabilityCheck } from './alert-rule-form';
import { ChannelPicker, channelKindLabel } from './notification-channels';
import { InlinePhase, Panel, queryPhase } from './primitives';
import { RotateSecretDialog } from './rotate-secret-dialog';

const STATE: Record<string, { label: string; color: string; icon: typeof CheckCircle }> = {
  ok: { label: 'OK', color: 'var(--status-good)', icon: CheckCircle },
  firing: { label: 'Firing', color: 'var(--status-critical)', icon: WarningTriangle },
  degraded: { label: 'Degraded', color: 'var(--status-warning)', icon: WarningCircle },
  unknown: { label: 'Unknown', color: 'var(--muted-foreground)', icon: Clock },
};

/**
 * A rule's evaluation state in colour, icon and word. degraded means the
 * metric's own source is unavailable; unknown means too few samples
 * (AlertRuleResponse.state).
 */
export function AlertState({ state }: { state: string }) {
  const s = STATE[state] ?? STATE.unknown;
  const Icon = s.icon;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: s.color }}>
      <Icon aria-hidden className="h-3.5 w-3.5 shrink-0" />
      {STATE[state] ? s.label : state}
    </span>
  );
}

const ACTION: Record<string, string> = {
  webhook: 'Notify only',
  rollback: 'Notify and roll back to the last live deployment',
  demote: 'Notify and hold the canary at its current step',
  promote: 'Notify and promote the canary to 100%',
};

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="label-mono text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-sm">{children}</dd>
    </div>
  );
}

/**
 * One alert rule in full (GET /v1/apps/{slug}/alerts/{id}): what it watches,
 * where it delivers, its state and history, and the edits apid allows on it
 * (handlers_alerts.go PATCH; the metric family and its selector are fixed).
 */
export function AlertDetail({
  slug,
  ruleId,
  onClose,
}: {
  slug: string;
  ruleId: string;
  onClose: () => void;
}) {
  const rule = useAlertRule(slug, ruleId);
  const phase = queryPhase({ error: rule.error, loading: rule.isPending });
  const gone = rule.error instanceof ApiError && rule.error.isNotFound;
  if (phase !== 'ready' || !rule.data)
    return (
      <Panel
        title="Alert rule"
        actions={
          <Button size="xs" variant="ghost" onClick={onClose}>
            Close
          </Button>
        }
      >
        {gone ? (
          <p role="status" className="text-sm text-muted-foreground">
            This rule no longer exists. It may have been deleted elsewhere.
          </p>
        ) : (
          <InlinePhase
            phase={phase}
            error={rule.error}
            loadingMessage="Reading the rule…"
            onRetry={() => void rule.refetch()}
          />
        )}
      </Panel>
    );
  return <RuleDetail slug={slug} rule={rule.data} onClose={onClose} />;
}

function RuleDetail({
  slug,
  rule,
  onClose,
}: {
  slug: string;
  rule: AlertRule;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const isOn = useCapabilityCheck();
  const update = useUpdateAlert(slug);
  const remove = useDeleteAlert(slug);
  const rotate = useRotateAlertSecret(slug);
  const channels = useNotificationChannels();
  const slos = useAppSLOs(slug, Boolean(rule.slo_id) && isOn('custom-slos'));
  const checks = useAppSyntheticChecks(
    slug,
    Boolean(rule.synthetic_check_id) && isOn('synthetic-checks')
  );
  const [editing, setEditing] = useState(false);
  const [rotating, setRotating] = useState(false);

  const spec = metricSpec(rule.metric);
  const channelById = new Map((channels.data ?? []).map((c) => [c.id, c]));
  const ruleChannels = rule.channel_ids ?? [];
  const sloName = slos.data?.find((s) => s.id === rule.slo_id)?.name;
  const checkName = checks.data?.find((c) => c.id === rule.synthetic_check_id)?.name;
  const accountWide = rule.app_id === '';

  const setEnabled = (enabled: boolean) =>
    void update
      .mutateAsync({ id: rule.id, enabled })
      .then(() =>
        toast({ kind: 'success', title: enabled ? `${rule.name} resumed` : `${rule.name} paused` })
      )
      .catch((err: unknown) => toast({ kind: 'error', title: 'Could not update', error: err }));

  const askDelete = async () => {
    if (
      !(await confirm({
        title: `Delete ${rule.name}?`,
        description:
          'The rule stops evaluating immediately and its webhook secret is discarded. Its channels are kept.',
        confirmLabel: 'Delete rule',
        destructive: true,
      }))
    )
      return;
    try {
      await remove.mutateAsync(rule.id);
      toast({ kind: 'success', title: 'Rule deleted' });
      onClose();
    } catch (err) {
      toast({ kind: 'error', title: 'Could not delete', error: err });
    }
  };

  const target =
    rule.failure_source ??
    (rule.slo_id ? (sloName ?? rule.slo_id) : undefined) ??
    (rule.synthetic_check_id ? (checkName ?? rule.synthetic_check_id) : undefined) ??
    rule.log_query ??
    rule.custom_metric_name ??
    rule.edge_rule_id ??
    rule.event_subscription_id;

  return (
    <Panel
      title={rule.name}
      description={describeCondition(rule)}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs">
            <Switch
              size="sm"
              checked={rule.enabled}
              onCheckedChange={setEnabled}
              aria-label={`${rule.enabled ? 'Pause' : 'Resume'} ${rule.name}`}
              className="data-[state=checked]:bg-brand"
            />
            {rule.enabled ? 'Enabled' : 'Paused'}
          </label>
          <Button
            size="xs"
            variant="outline"
            className="gap-1"
            aria-expanded={editing}
            onClick={() => setEditing((v) => !v)}
          >
            <EditPencil className="h-3.5 w-3.5" />
            Edit
          </Button>
          {rule.webhook_url && (
            <Button size="xs" variant="outline" className="gap-1" onClick={() => setRotating(true)}>
              <Refresh className="h-3.5 w-3.5" />
              Rotate secret
            </Button>
          )}
          <Button size="xs" variant="outline" className="gap-1" onClick={() => void askDelete()}>
            <Trash className="h-3.5 w-3.5" />
            Delete
          </Button>
          <Button size="xs" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="State">
            <AlertState state={rule.state} />
          </Fact>
          <Fact label="Metric">
            {metricLabel(rule.metric)}{' '}
            <span className="font-mono text-xs text-muted-foreground">{rule.metric}</span>
          </Fact>
          {target && (
            <Fact label={rule.failure_source ? 'Failure source' : 'Watches'}>
              <span className="font-mono text-xs">{target}</span>
            </Fact>
          )}
          <Fact label="Condition">
            <span className="font-mono text-xs">
              {isBaseline(rule.comparison)
                ? `${rule.threshold}${COMPARISON_SYMBOL[rule.comparison]}`
                : `${COMPARISON_SYMBOL[rule.comparison] ?? rule.comparison} ${rule.threshold}`}
            </span>
          </Fact>
          <Fact label="Window">
            {spec?.ignoresWindow ? (
              <span className="text-muted-foreground">Not used by this metric</span>
            ) : (
              <span className="font-mono text-xs">{rule.window_spec}</span>
            )}
          </Fact>
          <Fact label="Cooldown">{rule.cooldown_minutes} min</Fact>
          <Fact label="Action">{ACTION[rule.action] ?? rule.action}</Fact>
          <Fact label="Scope">{accountWide ? 'Every app on the account' : 'This app'}</Fact>
          <Fact label="Last fired">
            <Timestamp value={rule.last_fired_at} />
          </Fact>
          <Fact label="Last evaluated">
            <Timestamp value={rule.last_evaluated_at} />
          </Fact>
          <Fact label="Updated">
            <Timestamp value={rule.updated_at} />
          </Fact>
          <Fact label="Rule ID">
            <CopyableId value={rule.id} label="rule ID" />
          </Fact>
        </dl>

        <section aria-label="Delivers to" className="flex flex-col gap-2">
          <h3 className="label-mono text-muted-foreground">Delivers to</h3>
          <ul className="flex flex-col gap-1.5 text-sm">
            {ruleChannels.map((id) => {
              const channel = channelById.get(id);
              return (
                <li key={id} className="flex flex-wrap items-center gap-2">
                  {channel ? (
                    <>
                      <span className="font-mono">{channel.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {channelKindLabel(channel.kind)} · {channel.target}
                      </span>
                    </>
                  ) : (
                    <span className="font-mono text-xs text-muted-foreground">
                      {channels.isPending ? id : `${id} (not one of your channels)`}
                    </span>
                  )}
                </li>
              );
            })}
            {rule.webhook_url && (
              <li className="flex flex-wrap items-center gap-2">
                <span className="break-all font-mono text-xs">{rule.webhook_url}</span>
                <span className="text-xs text-muted-foreground">
                  signed webhook
                  {rule.notify_resolved ? ', fires and resolves' : ', fires only'}
                </span>
              </li>
            )}
          </ul>
          {ruleChannels.length > 0 && (
            <p className="text-xs text-muted-foreground">Channels receive fires and resolves.</p>
          )}
        </section>

        {editing && (
          <EditRule
            slug={slug}
            rule={rule}
            onDone={() => setEditing(false)}
            hasWebhook={Boolean(rule.webhook_url)}
          />
        )}

        <section aria-label="Deliveries" className="flex flex-col gap-2">
          <h3 className="label-mono text-muted-foreground">Deliveries</h3>
          <AlertDeliveries slug={slug} ruleId={rule.id} />
        </section>
      </div>

      {rotating && (
        <RotateSecretDialog
          name={rule.name}
          onClose={() => setRotating(false)}
          onRotate={(webhookSecret) =>
            rotate
              .mutateAsync({ id: rule.id, webhookSecret })
              .then(() => toast({ kind: 'success', title: 'Secret rotated' }))
          }
        />
      )}
    </Panel>
  );
}

/**
 * The fields a PATCH may change on an existing rule. The metric and its
 * selector stay: a different metric family is refused with
 * alert_rule_invalid ("delete and recreate"), and the selectors are immutable.
 */
function EditRule({
  slug,
  rule,
  hasWebhook,
  onDone,
}: {
  slug: string;
  rule: AlertRule;
  hasWebhook: boolean;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const isOn = useCapabilityCheck();
  const update = useUpdateAlert(slug);
  const spec = metricSpec(rule.metric);
  const comparisons = comparisonsFor(rule.metric, isOn('anomaly-alerts'));
  // A baseline rule keeps its comparison listed even after the flag goes off:
  // apid keeps evaluating it and only refuses changing it.
  if (!comparisons.includes(rule.comparison)) comparisons.push(rule.comparison);
  const windows = windowsFor(rule.metric);
  const [name, setName] = useState(rule.name);
  const [comparison, setComparison] = useState<AlertComparison>(rule.comparison);
  const [threshold, setThreshold] = useState(String(rule.threshold));
  const [window, setWindow] = useState<AlertWindow>(rule.window_spec);
  const [cooldown, setCooldown] = useState(String(rule.cooldown_minutes));
  const [channelIds, setChannelIds] = useState<string[]>(rule.channel_ids ?? []);
  const [notifyResolved, setNotifyResolved] = useState(Boolean(rule.notify_resolved));
  const [attempted, setAttempted] = useState(false);

  const parsedThreshold = Number(threshold);
  const parsedCooldown = Number(cooldown);
  const range = baselineRange(comparison);
  const errors = {
    name: name.trim() ? undefined : 'Enter a name.',
    threshold:
      threshold === '' || !Number.isFinite(parsedThreshold)
        ? 'Enter a numeric threshold.'
        : range && (parsedThreshold < range.min || parsedThreshold > range.max)
          ? `Enter a multiplier from ${range.min} to ${range.max}.`
          : undefined,
    cooldown:
      Number.isInteger(parsedCooldown) && parsedCooldown >= 5 && parsedCooldown <= 1440
        ? undefined
        : 'Enter whole minutes from 5 to 1440.',
    channels:
      !hasWebhook && channelIds.length === 0
        ? 'A rule without a webhook needs at least one channel.'
        : undefined,
  };
  const shown = (k: keyof typeof errors) => (attempted ? errors[k] : undefined);

  const save = () => {
    setAttempted(true);
    if (Object.values(errors).some(Boolean) || update.isPending) return;
    const body: UpdateAlertRule = {};
    if (name.trim() !== rule.name) body.name = name.trim();
    if (comparison !== rule.comparison) body.comparison = comparison;
    if (parsedThreshold !== rule.threshold) body.threshold = parsedThreshold;
    if (window !== rule.window_spec) body.window_spec = window;
    if (parsedCooldown !== rule.cooldown_minutes) body.cooldown_minutes = parsedCooldown;
    const before = rule.channel_ids ?? [];
    if (channelIds.length !== before.length || channelIds.some((id) => !before.includes(id)))
      body.channel_ids = channelIds;
    if (hasWebhook && notifyResolved !== Boolean(rule.notify_resolved))
      body.notify_resolved = notifyResolved;
    if (Object.keys(body).length === 0) return onDone();
    void update
      .mutateAsync({ id: rule.id, ...body })
      .then(() => {
        toast({ kind: 'success', title: 'Rule updated' });
        onDone();
      })
      .catch((err: unknown) => toast({ kind: 'error', title: 'Could not update', error: err }));
  };

  return (
    <form
      noValidate
      aria-label="Edit rule"
      className="grid grid-cols-1 gap-4 rounded-lg border border-border p-4 sm:grid-cols-2 lg:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <label className="flex flex-col gap-1.5 sm:col-span-2">
        <span className="label-mono text-muted-foreground">Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={64}
          className={FIELD}
          {...fieldErrorProps(shown('name'), 'edit-name-error')}
        />
        {shown('name') && <FieldError id="edit-name-error">{shown('name')}</FieldError>}
      </label>
      <div className="flex gap-2 sm:col-span-2">
        <label className="flex w-32 shrink-0 sm:w-40 flex-col gap-1.5">
          <span className="label-mono text-muted-foreground">Is</span>
          <select
            value={comparison}
            onChange={(e) => setComparison(e.target.value as AlertComparison)}
            className={FIELD}
          >
            {comparisons.map((c) => (
              <option key={c} value={c}>
                {COMPARISON_SYMBOL[c] ?? c}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="label-mono text-muted-foreground">
            {isBaseline(comparison) ? 'Multiplier' : 'Threshold'}
          </span>
          <input
            type="number"
            step="any"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            className={cn(FIELD, 'font-mono')}
            {...fieldErrorProps(shown('threshold'), 'edit-threshold-error')}
          />
          {shown('threshold') && (
            <FieldError id="edit-threshold-error">{shown('threshold')}</FieldError>
          )}
        </label>
      </div>
      {!spec?.ignoresWindow && (
        <label className="flex flex-col gap-1.5">
          <span className="label-mono text-muted-foreground">Window</span>
          <select
            value={window}
            onChange={(e) => setWindow(e.target.value as AlertWindow)}
            className={cn(FIELD, 'font-mono')}
          >
            {(windows.includes(rule.window_spec) ? windows : [rule.window_spec, ...windows]).map(
              (w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              )
            )}
          </select>
        </label>
      )}
      <label className="flex flex-col gap-1.5">
        <span className="label-mono text-muted-foreground">Cooldown (min)</span>
        <input
          type="number"
          min={5}
          max={1440}
          value={cooldown}
          onChange={(e) => setCooldown(e.target.value)}
          className={cn(FIELD, 'font-mono')}
          {...fieldErrorProps(shown('cooldown'), 'edit-cooldown-error')}
        />
        {shown('cooldown') && <FieldError id="edit-cooldown-error">{shown('cooldown')}</FieldError>}
      </label>
      <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-4">
        <ChannelPicker value={channelIds} onChange={setChannelIds} idPrefix="edit-channel" />
        {shown('channels') && <FieldError id="edit-channels-error">{shown('channels')}</FieldError>}
      </div>
      {hasWebhook && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground sm:col-span-2">
          <input
            type="checkbox"
            checked={notifyResolved}
            onChange={(e) => setNotifyResolved(e.target.checked)}
            className="h-3.5 w-3.5 accent-[color:var(--brand)]"
          />
          Also send the webhook alert.resolved
        </label>
      )}
      <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
        <Button type="submit" size="sm" busy={update.isPending}>
          Save changes
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
