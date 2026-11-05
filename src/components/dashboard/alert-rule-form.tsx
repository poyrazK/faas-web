import { useId, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { FIELD, FieldError, fieldErrorProps, useFormValidation } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { useCapabilityRegistry } from '@/lib/api/capabilities';
import { capabilityAccess } from '@/lib/capability-state';
import {
  createAlertRuleOnce,
  useAppSLOs,
  useAppSyntheticChecks,
  type AlertRule,
  type CreateAlertRule,
} from '@/lib/api/alert-rules';
import { keys } from '@/lib/api/queries';
import { cliSloCreateCommand, cliSyntheticCheckCreateCommand } from '@/lib/cli-commands';
import { cn } from '@/lib/utils';
import {
  FAILURE_SOURCES,
  availableMetrics,
  baselineRange,
  comparisonsFor,
  isBaseline,
  metricSpec,
  windowsFor,
  type AlertComparison,
  type AlertMetric,
  type AlertWindow,
  type FailureSource,
} from './alert-metrics';
import { COMPARISON_WORDS, alertWindowLabel, explainAlertCondition } from './alert-language';
import { CliCommand } from './cli-command';
import { ChannelPicker } from './notification-channels';
import { InlinePhase, queryPhase } from './primitives';

const CUSTOM_METRIC = /^[a-z][a-z0-9_]{0,62}$/;

export function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname);
  } catch {
    return false;
  }
}

/** Whether the account has a catalog capability, read as apid decides it. */
export function useCapabilityCheck() {
  const { query, phase } = useCapabilityRegistry();
  return (id: string) => capabilityAccess(query.data, id, phase) === 'on';
}

type Field = 'name' | 'threshold' | 'target' | 'webhookUrl' | 'secret' | 'cooldown';

/**
 * Starting values, for a form opened from one SLO or synthetic check: the
 * metric that watches it, already pointed at it, with the documented starting
 * threshold. Every field stays editable.
 */
export type AlertRuleDraft = {
  metric?: AlertMetric;
  comparison?: AlertComparison;
  threshold?: string;
  sloId?: string;
  checkId?: string;
};

/**
 * Create an alert rule on one app (POST /v1/apps/{slug}/alerts).
 *
 * The form follows apid's create order (handlers_alerts.go:144-325): a metric,
 * the one selector it needs (failure source, SLO, synthetic check, log query
 * or custom metric name), a comparison and window apid accepts for it, then
 * where it delivers: notification channels, a signed webhook, or both. A rule
 * with a channel needs no webhook (handlers_alerts_channels.go:42-48).
 */
export function AlertRuleForm({
  slug,
  onCreated,
  initial,
}: {
  slug: string;
  onCreated?: (rule: AlertRule) => void;
  initial?: AlertRuleDraft;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const isOn = useCapabilityCheck();
  const metrics = availableMetrics(isOn);
  const baselines = isOn('anomaly-alerts');

  const [name, setName] = useState('');
  const [chosenMetric, setMetric] = useState<AlertMetric>(initial?.metric ?? 'error_rate_pct');
  const [chosenComparison, setComparison] = useState<AlertComparison>(initial?.comparison ?? 'gt');
  const [threshold, setThreshold] = useState(initial?.threshold ?? '5');
  const [chosenWindow, setWindow] = useState<AlertWindow>('15m');
  const [failureSource, setFailureSource] = useState<FailureSource>('any');
  const [sloId, setSloId] = useState(initial?.sloId ?? '');
  const [checkId, setCheckId] = useState(initial?.checkId ?? '');
  const [logQuery, setLogQuery] = useState('');
  const [customName, setCustomName] = useState('');
  const [channelIds, setChannelIds] = useState<string[]>([]);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [notifyResolved, setNotifyResolved] = useState(false);
  const [cooldown, setCooldown] = useState('30');
  const [saving, setSaving] = useState(false);
  const validation = useFormValidation<Field>();
  const formId = useId();
  const advancedRef = useRef<HTMLDetailsElement>(null);

  // Derived, so a metric change never leaves a comparison or window apid
  // would refuse for it selected.
  const metric = metrics.some((m) => m.value === chosenMetric)
    ? chosenMetric
    : (metrics[0]?.value ?? 'error_rate_pct');
  const spec = metricSpec(metric);
  const comparisons = comparisonsFor(metric, baselines);
  const comparison = comparisons.includes(chosenComparison) ? chosenComparison : 'gt';
  const windows = windowsFor(metric);
  const window = windows.includes(chosenWindow) ? chosenWindow : windows[0];
  const target = spec?.target;

  const slos = useAppSLOs(slug, target === 'slo');
  const checks = useAppSyntheticChecks(slug, target === 'synthetic_check');
  const sloList = slos.data ?? [];
  const checkList = checks.data ?? [];
  const slo = sloList.some((s) => s.id === sloId) ? sloId : (sloList[0]?.id ?? '');
  const check = checkList.some((c) => c.id === checkId) ? checkId : (checkList[0]?.id ?? '');

  const url = webhookUrl.trim();
  const parsedThreshold = Number(threshold);
  const parsedCooldown = Number(cooldown);
  const range = baselineRange(comparison);
  const errors: Record<Field, string | undefined> = {
    name: name.trim() ? undefined : 'Enter a name for this rule.',
    threshold:
      threshold === '' || !Number.isFinite(parsedThreshold)
        ? 'Enter a numeric threshold.'
        : range && (parsedThreshold < range.min || parsedThreshold > range.max)
          ? `Enter a multiplier from ${range.min} to ${range.max}.`
          : undefined,
    target:
      target === 'slo' && !slo
        ? 'Choose an SLO.'
        : target === 'synthetic_check' && !check
          ? 'Choose a synthetic check.'
          : target === 'log_query' && !logQuery.trim()
            ? 'Enter the log search filters to count.'
            : target === 'custom' && !CUSTOM_METRIC.test(customName)
              ? 'Enter a pushed metric name: lowercase letters, digits and _.'
              : undefined,
    // A rule needs somewhere to deliver: a channel, a webhook, or both.
    webhookUrl:
      channelIds.length === 0 && !url
        ? 'Choose a channel or enter a webhook URL.'
        : url && !isHttpsUrl(url)
          ? 'Enter a complete HTTPS webhook URL.'
          : undefined,
    secret:
      url && (secret.length < 1 || secret.length > 256)
        ? 'Enter a webhook secret of no more than 256 characters.'
        : undefined,
    cooldown:
      Number.isInteger(parsedCooldown) && parsedCooldown >= 5 && parsedCooldown <= 1440
        ? undefined
        : 'Enter whole minutes from 5 to 1440.',
  };
  const shown = (field: Field) => (validation.submitAttempted ? errors[field] : undefined);

  const submit = async (form: HTMLFormElement) => {
    if (errors.cooldown && advancedRef.current) advancedRef.current.open = true;
    if (!validation.validate(errors, form) || saving) return;
    const body: CreateAlertRule = {
      name: name.trim(),
      metric,
      comparison,
      threshold: parsedThreshold,
      window_spec: window,
      cooldown_minutes: parsedCooldown,
      action: 'webhook',
      ...(target === 'failure_source' ? { failure_source: failureSource } : {}),
      ...(target === 'slo' ? { slo_id: slo } : {}),
      ...(target === 'synthetic_check' ? { synthetic_check_id: check } : {}),
      ...(target === 'log_query' ? { log_query: logQuery.trim() } : {}),
      ...(target === 'custom' ? { custom_metric_name: customName } : {}),
      ...(channelIds.length ? { channel_ids: channelIds } : {}),
      ...(url ? { webhook_url: url, webhook_secret: secret } : {}),
      ...(url && notifyResolved ? { notify_resolved: true } : {}),
    };
    setSaving(true);
    try {
      const rule = await createAlertRuleOnce(slug, body);
      setName('');
      setWebhookUrl('');
      setSecret('');
      setNotifyResolved(false);
      validation.resetValidation();
      toast({ kind: 'success', title: 'Rule added', description: rule.name });
      onCreated?.(rule);
    } catch (err) {
      toast({ kind: 'error', title: 'Could not add', error: err });
    } finally {
      setSaving(false);
      void qc.invalidateQueries({ queryKey: keys.appAlerts(slug) });
    }
  };

  const groups = [...new Set(metrics.map((m) => m.group))];

  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(e.currentTarget);
      }}
    >
      <p className="text-sm leading-relaxed text-muted-foreground">
        Get a notification when a metric crosses a limit you choose.
      </p>
      <section className="flex flex-col gap-4" aria-labelledby={`${formId}-condition`}>
        <h3 id={`${formId}-condition`} className="text-sm font-medium">
          1. Choose what to watch
        </h3>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Metric</span>
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value as AlertMetric)}
            className={FIELD}
          >
            {groups.map((group) => (
              <optgroup key={group} label={group}>
                {metrics
                  .filter((m) => m.group === group)
                  .map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>

        {target && (
          <div className="flex flex-col gap-1.5">
            <TargetField
              slug={slug}
              target={target}
              failureSource={failureSource}
              onFailureSource={setFailureSource}
              slo={slo}
              onSlo={setSloId}
              slos={slos}
              check={check}
              onCheck={setCheckId}
              checks={checks}
              logQuery={logQuery}
              onLogQuery={setLogQuery}
              customName={customName}
              onCustomName={setCustomName}
              error={shown('target')}
            />
          </div>
        )}

        <div className="flex gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-sm font-medium">Is</span>
            <select
              value={comparison}
              onChange={(e) => setComparison(e.target.value as AlertComparison)}
              className={FIELD}
            >
              {comparisons.map((c) => (
                <option key={c} value={c}>
                  {COMPARISON_WORDS[c]}
                </option>
              ))}
            </select>
          </label>
          <div className="flex w-32 shrink-0 flex-col gap-1.5">
            <label htmlFor={`${formId}-threshold`} className="text-sm font-medium">
              {isBaseline(comparison) ? 'Multiplier' : 'Threshold'}
            </label>
            <input
              id={`${formId}-threshold`}
              name="threshold"
              type="number"
              step="any"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              {...fieldErrorProps(shown('threshold'), 'alert-threshold-error')}
              className={`${FIELD} font-mono [font-variant-numeric:tabular-nums]`}
            />
            {shown('threshold') ? (
              <FieldError id="alert-threshold-error">{shown('threshold')}</FieldError>
            ) : (
              <span className="text-xs text-muted-foreground">
                {isBaseline(comparison)
                  ? 'Times the usual value at this time of day, over the last 7 days.'
                  : spec?.unit}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          {!spec?.ignoresWindow && (
            <label className="flex flex-1 flex-col gap-1.5">
              <span className="text-sm font-medium">Window</span>
              <select
                value={window}
                onChange={(e) => setWindow(e.target.value as AlertWindow)}
                className={`${FIELD} font-mono`}
              >
                {windows.map((w) => (
                  <option key={w} value={w}>
                    {alertWindowLabel(w)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
          <p className="text-xs text-muted-foreground">Notify me when</p>
          <p className="mt-1 text-sm leading-relaxed">
            {!errors.threshold
              ? explainAlertCondition({
                  metric,
                  comparison,
                  threshold: parsedThreshold,
                  window_spec: window,
                })
              : 'Choose a valid threshold to preview this condition.'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {spec?.ignoresWindow
              ? target === 'slo'
                ? 'Uses the selected SLO’s measurement period.'
                : 'Counts consecutive failures for the selected check.'
              : `${alertWindowLabel(window)} evaluation window. Checks the metric across this rolling period.`}
          </p>
        </div>
      </section>
      <section
        className="flex flex-col gap-4 border-t border-border pt-5"
        aria-labelledby={`${formId}-delivery`}
      >
        <h3 id={`${formId}-delivery`} className="text-sm font-medium">
          2. Choose where to notify you
        </h3>
        <div className="min-w-0">
          <ChannelPicker value={channelIds} onChange={setChannelIds} idPrefix="rule-channel" />
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">
            Webhook URL{channelIds.length > 0 && ' (optional)'}
          </span>
          <input
            name="webhookUrl"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            {...fieldErrorProps(shown('webhookUrl'), 'alert-webhook-url-error')}
            placeholder="https://hooks.example.com/gregale"
            spellCheck={false}
            className={`${FIELD} font-mono`}
          />
          {shown('webhookUrl') && (
            <FieldError id="alert-webhook-url-error">{shown('webhookUrl')}</FieldError>
          )}
        </label>
        {url && (
          <>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Webhook secret</span>
              <input
                name="secret"
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                {...fieldErrorProps(shown('secret'), 'alert-secret-error')}
                placeholder="1–256 characters"
                autoComplete="new-password"
                className={`${FIELD} font-mono`}
              />
              {shown('secret') && (
                <FieldError id="alert-secret-error">{shown('secret')}</FieldError>
              )}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={notifyResolved}
                onChange={(e) => setNotifyResolved(e.target.checked)}
                className="h-3.5 w-3.5 accent-[color:var(--brand)]"
              />
              Also notify this webhook when the issue is resolved
            </label>
          </>
        )}
        <p className="text-xs leading-relaxed text-muted-foreground">
          Channels also receive a notification when the issue is resolved. A webhook secret lets
          your receiver verify that a message came from Gregale; it cannot be read back after
          saving.
        </p>
      </section>
      <section
        className="flex flex-col gap-4 border-t border-border pt-5"
        aria-labelledby={`${formId}-name`}
      >
        <h3 id={`${formId}-name`} className="text-sm font-medium">
          3. Name this rule
        </h3>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Name</span>
          <input
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            {...fieldErrorProps(shown('name'), 'alert-name-error')}
            placeholder="Error rate over 5%"
            maxLength={64}
            className={FIELD}
          />
          {shown('name') && <FieldError id="alert-name-error">{shown('name')}</FieldError>}
        </label>
      </section>
      <details ref={advancedRef} className="border-t border-border pt-4">
        <summary className="cursor-pointer text-sm font-medium">Advanced settings</summary>
        <div className="pt-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Minutes between repeat alerts</span>
            <input
              name="cooldown"
              type="number"
              min={5}
              max={1440}
              step={1}
              value={cooldown}
              onChange={(e) => setCooldown(e.target.value)}
              {...fieldErrorProps(shown('cooldown'), 'alert-cooldown-error')}
              aria-describedby={
                shown('cooldown') ? 'alert-cooldown-error' : `${formId}-cooldown-help`
              }
              className={`${FIELD} font-mono [font-variant-numeric:tabular-nums]`}
            />
            {shown('cooldown') && (
              <FieldError id="alert-cooldown-error">{shown('cooldown')}</FieldError>
            )}
            <span
              id={`${formId}-cooldown-help`}
              className="text-xs leading-relaxed text-muted-foreground"
            >
              Wait at least this long before firing again while the condition is met. Between 5
              minutes and 24 hours.
            </span>
          </label>
        </div>
      </details>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" className="gap-1.5" busy={saving}>
          <Plus className="h-3.5 w-3.5" />
          Add rule
        </Button>
      </div>
    </form>
  );
}

function TargetField({
  slug,
  target,
  failureSource,
  onFailureSource,
  slo,
  onSlo,
  slos,
  check,
  onCheck,
  checks,
  logQuery,
  onLogQuery,
  customName,
  onCustomName,
  error,
}: {
  slug: string;
  target: NonNullable<ReturnType<typeof metricSpec>>['target'];
  failureSource: FailureSource;
  onFailureSource: (v: FailureSource) => void;
  slo: string;
  onSlo: (v: string) => void;
  slos: ReturnType<typeof useAppSLOs>;
  check: string;
  onCheck: (v: string) => void;
  checks: ReturnType<typeof useAppSyntheticChecks>;
  logQuery: string;
  onLogQuery: (v: string) => void;
  customName: string;
  onCustomName: (v: string) => void;
  error?: string;
}) {
  const id = useId();
  const errorProps = fieldErrorProps(error, 'alert-target-error');
  const errorLine = error && <FieldError id="alert-target-error">{error}</FieldError>;
  if (target === 'failure_source')
    return (
      <label className="flex max-w-xs flex-col gap-1.5">
        <span className="text-sm font-medium">Failure source</span>
        <select
          value={failureSource}
          onChange={(e) => onFailureSource(e.target.value as FailureSource)}
          className={FIELD}
        >
          {FAILURE_SOURCES.map((source) => (
            <option key={source} value={source}>
              {source === 'any' ? 'Any source' : source.replaceAll('_', ' ')}
            </option>
          ))}
        </select>
      </label>
    );
  if (target === 'slo' || target === 'synthetic_check') {
    const isSlo = target === 'slo';
    const query = isSlo ? slos : checks;
    const items = (query.data ?? []) as { id: string; name: string }[];
    const phase = queryPhase({
      error: query.error,
      loading: query.isPending,
      isEmpty: items.length === 0,
    });
    const label = isSlo ? 'SLO' : 'Synthetic check';
    if (phase !== 'ready')
      return (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{label}</span>
          <InlinePhase
            phase={phase}
            error={query.error}
            loadingMessage={isSlo ? 'Reading SLOs…' : 'Reading checks…'}
            emptyMessage={
              isSlo ? 'This app has no SLOs yet.' : 'This app has no synthetic checks yet.'
            }
          />
          {phase === 'empty' && (
            <CliCommand
              command={isSlo ? cliSloCreateCommand(slug) : cliSyntheticCheckCreateCommand(slug)}
              copyLabel={
                isSlo ? `SLO create command for ${slug}` : `check create command for ${slug}`
              }
            />
          )}
          {errorLine}
        </div>
      );
    return (
      <label className="flex max-w-sm flex-col gap-1.5">
        <span className="text-sm font-medium">{label}</span>
        <select
          name="target"
          value={isSlo ? slo : check}
          onChange={(e) => (isSlo ? onSlo : onCheck)(e.target.value)}
          className={cn(FIELD, 'font-mono')}
          {...errorProps}
        >
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        {errorLine}
      </label>
    );
  }
  if (target === 'log_query')
    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-log`} className="text-sm font-medium">
          Log query
        </label>
        <input
          id={`${id}-log`}
          name="target"
          value={logQuery}
          onChange={(e) => onLogQuery(e.target.value)}
          placeholder="source=runtime&level=error&q=database"
          maxLength={2048}
          spellCheck={false}
          className={cn(FIELD, 'font-mono')}
          {...errorProps}
        />
        {errorLine ?? (
          <span className="text-xs text-muted-foreground">
            Log search filters: source, level, status, route, deployment_id, request_id, trace_id,
            q. The rule counts matching events in its window and keeps its own copy.
          </span>
        )}
      </div>
    );
  return (
    <div className="flex max-w-sm flex-col gap-1.5">
      <label htmlFor={`${id}-custom`} className="text-sm font-medium">
        Custom metric name
      </label>
      <input
        id={`${id}-custom`}
        name="target"
        value={customName}
        onChange={(e) => onCustomName(e.target.value)}
        placeholder="orders_pending"
        maxLength={63}
        spellCheck={false}
        className={cn(FIELD, 'font-mono')}
        {...errorProps}
      />
      {errorLine ?? (
        <span className="text-xs text-muted-foreground">
          A gauge compares its average over the window; a counter its per-second rate.
        </span>
      )}
    </div>
  );
}
