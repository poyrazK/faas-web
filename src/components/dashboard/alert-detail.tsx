import { useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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
  updateAlertRuleOnce,
  useAlertRule,
  useAppSLOs,
  useAppSyntheticChecks,
  type AlertRule,
  type UpdateAlertRule,
} from '@/lib/api/alert-rules';
import { ApiError } from '@/lib/api/errors';
import { useNotificationChannels } from '@/lib/api/notification-channels';
import { keys, useDeleteAlert, useRotateAlertSecret, useUpdateAlert } from '@/lib/api/queries';
import { absoluteTime, parseTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import { AlertAnomalyPreview } from './alert-anomaly-preview';
import {
  AlertObservationCoverage,
  AlertObservationHistory,
  AlertRecoveryChecks,
  AlertRuleMode,
  describeObservationCoverage,
} from './alert-observation';
import { AlertDeliveries } from './alert-deliveries';
import { alertWindowLabel, formatAnomalyValue } from './alert-language';
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
import { isHttpsUrl, useCapabilityCheck } from './alert-rule-form';
import { ChannelPicker, channelKindLabel } from './notification-channels';
import { InlinePhase, Panel, queryPhase } from './primitives';
import { RotateSecretDialog } from './rotate-secret-dialog';

const STATE: Record<string, { label: string; color: string; icon: typeof CheckCircle }> = {
  ok: { label: 'OK', color: 'var(--status-good)', icon: CheckCircle },
  firing: { label: 'Firing', color: 'var(--status-critical)', icon: WarningTriangle },
  degraded: { label: 'Degraded', color: 'var(--status-warning)', icon: WarningCircle },
  unknown: { label: 'Unknown', color: 'var(--muted-foreground)', icon: Clock },
};

function describeAnomalyEvaluation(
  evaluation: NonNullable<AlertRule['anomaly_evaluation']>,
  rule: AlertRule
): ReactNode {
  switch (evaluation.reason) {
    case 'insufficient_traffic':
      if (evaluation.required_count === undefined)
        return 'Too few eligible requests for this window.';
      return `${evaluation.count} of ${evaluation.required_count} eligible requests in the last ${alertWindowLabel(rule.window_spec)}.`;
    case 'insufficient_history':
      if (evaluation.required_count === undefined) return 'Too few historical windows qualified.';
      if (evaluation.baseline_days !== undefined)
        return `${evaluation.baseline_days} of ${evaluation.required_count} required baseline days qualified.`;
      return `${evaluation.count} of ${evaluation.required_count} required historical windows qualified.`;
    case 'telemetry_missing_or_stale':
      return 'Request telemetry is missing or stale for this window.';
    case 'telemetry_unavailable':
      return 'Gregale couldn’t read telemetry for this evaluation.';
    case 'threshold_not_reached':
      return 'The observed value hasn’t reached the baseline threshold.';
    case 'minimum_impact_not_reached': {
      const subject = rule.comparison === 'below_baseline' ? 'The baseline' : 'The observed value';
      const minimum = evaluation.minimum_value;
      return minimum === undefined
        ? `${subject} is below the required minimum.`
        : `${subject} is below the required minimum of ${formatAnomalyValue(rule.metric, minimum)}.`;
    }
    case 'zero_baseline':
      return 'This rule needs a positive baseline to detect a relative increase.';
    case 'observed_breach':
      return 'The rule’s threshold was breached while observing.';
    case 'recovery_confirmation_pending':
      return `${evaluation.count} of ${evaluation.required_count ?? 2} healthy checks. The incident is still open.`;
    case 'recovery_confirmed':
      return 'Two consecutive healthy checks confirmed recovery.';
    case 'notification_cooldown':
      return (
        <AnomalyCooldownMessage
          key={evaluation.next_notification_eligible_at}
          eligibleAt={evaluation.next_notification_eligible_at}
        />
      );
  }
}

function AnomalyCooldownMessage({ eligibleAt }: { eligibleAt: string | undefined }) {
  const deadline = parseTime(eligibleAt);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (deadline === undefined || now >= deadline) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, deadline - Date.now()));
    return () => window.clearTimeout(timer);
  }, [deadline, now]);

  if (deadline === undefined) return 'Still firing. Repeat notifications are in cooldown.';
  if (now >= deadline) return 'Still firing at the last check. Awaiting next evaluation.';
  return (
    <>
      Still firing. Another notification is eligible from{' '}
      <Timestamp value={deadline} mode="absolute" /> if the breach continues.
    </>
  );
}

/**
 * A rule's evaluation state in colour, icon and word. degraded means the
 * metric's own source is unavailable; unknown means too few samples
 * (AlertRuleResponse.state).
 */
export function AlertState({ state, observeOnly }: { state: string; observeOnly?: boolean }) {
  if (observeOnly) return <span className="text-xs text-muted-foreground">Observe only</span>;
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
      help={describeCondition(rule)}
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
            <AlertState state={rule.state} observeOnly={rule.observe_only} />
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
          {isBaseline(rule.comparison) && (
            <Fact label="Recovery">
              {rule.recovery_confirmation_checks === 2
                ? 'Two consecutive healthy checks'
                : 'One healthy check'}
            </Fact>
          )}
          <Fact label="Action">{ACTION[rule.action] ?? rule.action}</Fact>
          <Fact label="Scope">{accountWide ? 'Every app on the account' : 'This app'}</Fact>
          {rule.environment_scope && <Fact label="Environment">{rule.environment_scope}</Fact>}
          <Fact label="Last fired">
            <Timestamp value={rule.last_fired_at} />
          </Fact>
          {!rule.anomaly_evaluation && (
            <Fact label="Last evaluated">
              <Timestamp value={rule.last_evaluated_at} />
            </Fact>
          )}
          <Fact label="Updated">
            <Timestamp value={rule.updated_at} />
          </Fact>
          <Fact label="Rule ID">
            <CopyableId value={rule.id} label="rule ID" />
          </Fact>
        </dl>

        {rule.anomaly_evaluation && (
          <section aria-label="Latest evaluation" className="flex flex-col gap-2">
            <h3 className="label-mono text-muted-foreground">Latest evaluation</h3>
            <p className="text-sm">{describeAnomalyEvaluation(rule.anomaly_evaluation, rule)}</p>
            {rule.anomaly_evaluation.baseline_days !== undefined &&
              rule.anomaly_evaluation.reason !== 'insufficient_history' && (
                <p className="text-xs text-muted-foreground">
                  {rule.anomaly_evaluation.baseline_days}{' '}
                  {rule.anomaly_evaluation.baseline_days === 1 ? 'day' : 'days'} qualified for the
                  baseline.
                </p>
              )}
            {rule.anomaly_evaluation.observed !== undefined && (
              <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Fact label="Observed">
                  {formatAnomalyValue(rule.metric, rule.anomaly_evaluation.observed)}
                </Fact>
                {rule.anomaly_evaluation.baseline !== undefined && (
                  <Fact label="Baseline">
                    {formatAnomalyValue(rule.metric, rule.anomaly_evaluation.baseline)}
                  </Fact>
                )}
                {rule.anomaly_evaluation.trigger_value !== undefined && (
                  <Fact label="Baseline threshold">
                    {formatAnomalyValue(rule.metric, rule.anomaly_evaluation.trigger_value)}{' '}
                    {rule.comparison === 'below_baseline' ? 'or lower' : 'or higher'}
                  </Fact>
                )}
              </dl>
            )}
            <span className="text-xs text-muted-foreground">
              <Timestamp value={rule.anomaly_evaluation.evaluated_at} />
            </span>
          </section>
        )}

        <AlertObservationCoverage rule={rule} />
        <AlertObservationHistory rule={rule} />
        <section
          aria-label={rule.observe_only ? 'Delivery destinations' : 'Delivers to'}
          className="flex flex-col gap-2"
        >
          <h3 className="label-mono text-muted-foreground">
            {rule.observe_only ? 'Delivery destinations' : 'Delivers to'}
          </h3>
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
  const confirm = useConfirm();
  const isOn = useCapabilityCheck();
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const spec = metricSpec(rule.metric);
  const baselines = Boolean(rule.app_id) && isOn('anomaly-alerts');
  const comparisons = comparisonsFor(rule.metric, baselines);
  // A baseline rule keeps its comparison listed even after the flag goes off:
  // apid keeps evaluating it and only refuses changing it.
  if (!comparisons.includes(rule.comparison)) comparisons.push(rule.comparison);
  const windows = windowsFor(rule.metric);
  const [name, setName] = useState(rule.name);
  const [comparison, setComparison] = useState<AlertComparison>(rule.comparison);
  const [threshold, setThreshold] = useState(String(rule.threshold));
  const [observeOnly, setObserveOnly] = useState(Boolean(rule.observe_only));
  const [recoveryConfirmationChecks, setRecoveryConfirmationChecks] = useState<1 | 2>(
    rule.recovery_confirmation_checks === 2 ? 2 : 1
  );
  const [environmentScope, setEnvironmentScope] = useState(rule.environment_scope ?? '');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [window, setWindow] = useState<AlertWindow>(rule.window_spec);
  const [cooldown, setCooldown] = useState(String(rule.cooldown_minutes));
  const [channelIds, setChannelIds] = useState<string[]>(rule.channel_ids ?? []);
  const [notifyResolved, setNotifyResolved] = useState(Boolean(rule.notify_resolved));
  const [attempted, setAttempted] = useState(false);

  const parsedThreshold = Number(threshold);
  const parsedCooldown = Number(cooldown);
  const range = baselineRange(comparison);
  const newWebhook = webhookUrl.trim();
  const scopeChanged = environmentScope !== (rule.environment_scope ?? '');
  const promotingEnvironment = Boolean(rule.observe_only && !observeOnly && environmentScope);
  const errors = {
    name: name.trim() ? undefined : 'Enter a name.',
    mode:
      scopeChanged && !rule.observe_only && !observeOnly
        ? 'Switch to Observe only to change the environment.'
        : (observeOnly || environmentScope) && !isBaseline(comparison)
          ? observeOnly
            ? 'Choose a baseline comparison for Observe only.'
            : 'Choose a baseline comparison for this environment.'
          : undefined,
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
      !observeOnly && !hasWebhook && !newWebhook && channelIds.length === 0
        ? 'A rule without a webhook needs at least one channel.'
        : undefined,
    webhookUrl:
      newWebhook && !isHttpsUrl(newWebhook) ? 'Enter a complete HTTPS webhook URL.' : undefined,
    webhookSecret:
      newWebhook && (webhookSecret.length < 1 || webhookSecret.length > 256)
        ? 'Enter a webhook secret of no more than 256 characters.'
        : undefined,
  };
  const shown = (k: keyof typeof errors) => (attempted ? errors[k] : undefined);

  const save = async () => {
    setAttempted(true);
    if (Object.values(errors).some(Boolean) || saving) return;
    const body: UpdateAlertRule = {};
    if (name.trim() !== rule.name) body.name = name.trim();
    if (comparison !== rule.comparison) body.comparison = comparison;
    const recoveryChecks = isBaseline(comparison) ? recoveryConfirmationChecks : 1;
    if (recoveryChecks !== (rule.recovery_confirmation_checks ?? 1))
      body.recovery_confirmation_checks = recoveryChecks;
    if (parsedThreshold !== rule.threshold) body.threshold = parsedThreshold;
    if (window !== rule.window_spec) body.window_spec = window;
    if (observeOnly !== Boolean(rule.observe_only)) body.observe_only = observeOnly;
    if (scopeChanged || promotingEnvironment) body.environment_scope = environmentScope;
    const clearAction = promotingEnvironment && rule.action !== 'webhook';
    if (clearAction) {
      body.action = 'webhook';
      if (rule.post_deploy_rollback_window_seconds) body.post_deploy_rollback_window_seconds = 0;
    }
    if (newWebhook) {
      body.webhook_url = newWebhook;
      body.webhook_secret = webhookSecret;
    }
    if (parsedCooldown !== rule.cooldown_minutes) body.cooldown_minutes = parsedCooldown;
    const before = rule.channel_ids ?? [];
    if (channelIds.length !== before.length || channelIds.some((id) => !before.includes(id)))
      body.channel_ids = channelIds;
    if ((hasWebhook || newWebhook) && notifyResolved !== Boolean(rule.notify_resolved))
      body.notify_resolved = notifyResolved;
    if (Object.keys(body).length === 0) return onDone();
    setSaving(true);
    try {
      if (rule.observe_only && !observeOnly) {
        const sameCondition =
          !scopeChanged &&
          rule.window_spec === window &&
          rule.comparison === comparison &&
          rule.threshold === parsedThreshold;
        const currentCoverage = sameCondition ? rule.observation_coverage : undefined;
        const lastCheckedAt = currentCoverage
          ? currentCoverage.last_checked_at
          : rule.last_evaluated_at;
        const lastCheck = sameCondition ? parseTime(lastCheckedAt) : undefined;
        const days = sameCondition ? rule.anomaly_evaluation?.baseline_days : undefined;
        const check =
          lastCheck === undefined
            ? 'No check recorded for this condition and environment.'
            : `Last check at ${absoluteTime(lastCheck)}.`;
        const baseline =
          days === undefined
            ? 'Baseline coverage is unavailable.'
            : `${days} ${days === 1 ? 'day' : 'days'} qualified for the baseline.`;
        const coverage = sameCondition
          ? describeObservationCoverage(currentCoverage)
          : 'The edited condition and environment have no observation coverage.';
        const action = clearAction ? ' The deployment action will be cleared.' : '';
        if (
          !(await confirm({
            title: environmentScope
              ? `Enable notifications for ${environmentScope}?`
              : 'Enable notifications?',
            description: `${check} ${baseline} ${coverage}${action}`,
            confirmLabel: 'Enable notifications',
          }))
        )
          return;
      }
      await updateAlertRuleOnce(slug, rule.id, body);
      await qc.invalidateQueries({ queryKey: keys.appAlerts(slug) });
      toast({ kind: 'success', title: 'Rule updated' });
      onDone();
    } catch (err) {
      toast({ kind: 'error', title: 'Could not update', error: err });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      noValidate
      aria-label="Edit rule"
      className="grid grid-cols-1 gap-4 well rounded-xl bg-muted/40 p-4 sm:grid-cols-2 lg:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
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
      {baselines &&
        (rule.metric === 'request_count' ||
          rule.metric === 'error_rate_pct' ||
          rule.metric === 'latency_p95_ms') &&
        isBaseline(comparison) &&
        !errors.threshold && (
          <div className="sm:col-span-2 lg:col-span-4">
            <AlertAnomalyPreview
              slug={slug}
              query={{
                comparison,
                threshold: parsedThreshold,
                window_spec: window,
                ...(rule.metric === 'request_count' ? {} : { metric: rule.metric }),
              }}
              cooldownMinutes={errors.cooldown ? undefined : parsedCooldown}
              recoveryConfirmationChecks={recoveryConfirmationChecks}
              ruleEnvironment={environmentScope}
              onUseEnvironment={(scope) => {
                setEnvironmentScope(scope);
                setObserveOnly(true);
              }}
            />
          </div>
        )}
      <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-4">
        {(isBaseline(comparison) || observeOnly) && (
          <AlertRuleMode
            observeOnly={observeOnly}
            onChange={setObserveOnly}
            environmentScope={environmentScope}
            onClearEnvironment={() => setEnvironmentScope('')}
            error={shown('mode')}
          />
        )}
        {isBaseline(comparison) && (
          <AlertRecoveryChecks
            value={recoveryConfirmationChecks}
            onChange={setRecoveryConfirmationChecks}
          />
        )}
        <ChannelPicker value={channelIds} onChange={setChannelIds} idPrefix="edit-channel" />
        {shown('channels') && <FieldError id="edit-channels-error">{shown('channels')}</FieldError>}
      </div>
      {rule.observe_only && !hasWebhook && (
        <>
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="text-sm font-medium">Webhook URL (optional)</span>
            <input
              value={webhookUrl}
              onChange={(event) => setWebhookUrl(event.target.value)}
              className={FIELD}
              {...fieldErrorProps(shown('webhookUrl'), 'edit-webhook-url-error')}
            />
            {shown('webhookUrl') && (
              <FieldError id="edit-webhook-url-error">{shown('webhookUrl')}</FieldError>
            )}
          </label>
          {newWebhook && (
            <label className="flex flex-col gap-1.5 sm:col-span-2">
              <span className="text-sm font-medium">Webhook secret</span>
              <input
                type="password"
                value={webhookSecret}
                onChange={(event) => setWebhookSecret(event.target.value)}
                className={FIELD}
                {...fieldErrorProps(shown('webhookSecret'), 'edit-webhook-secret-error')}
              />
              {shown('webhookSecret') && (
                <FieldError id="edit-webhook-secret-error">{shown('webhookSecret')}</FieldError>
              )}
            </label>
          )}
        </>
      )}
      {(hasWebhook || newWebhook) && (
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
        <Button type="submit" size="sm" busy={saving}>
          Save changes
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
