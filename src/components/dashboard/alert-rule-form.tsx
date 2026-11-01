import { useState, type ReactNode } from 'react';
import { Plus } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { FIELD, FieldError, fieldErrorProps, useFormValidation } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { useCapabilityRegistry } from '@/lib/api/capabilities';
import {
  useAppSLOs,
  useAppSyntheticChecks,
  useNotificationChannels,
} from '@/lib/api/notification-channels';
import { useCreateAlert } from '@/lib/api/queries';
import { useWorkspaceTarget } from '@/lib/api/workspace-apps';
import { capabilityAccess } from '@/lib/capability-state';
import { cn } from '@/lib/utils';
import {
  ALERT_METRICS,
  COMPARISON_LABEL,
  EMPTY_RULE_DRAFT,
  FAILURE_SOURCES,
  MAX_CHANNELS_PER_RULE,
  comparisonsFor,
  metricSpec,
  ruleDraftBody,
  ruleDraftErrors,
  windowsFor,
  type AlertComparison,
  type AlertMetric,
  type AlertWindow,
  type FailureSource,
  type RuleDraft,
  type RuleField,
} from '@/lib/alert-rules';

/**
 * A labelled control with its complaint after the label rather than inside
 * it, so the error describes the control instead of joining its name.
 */
export function Labelled({
  label,
  className,
  children,
  after,
}: {
  label: string;
  className?: string;
  children: ReactNode;
  after?: ReactNode;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label className="flex flex-col gap-1.5">
        <span className="label-mono text-muted-foreground">{label}</span>
        {children}
      </label>
      {after}
    </div>
  );
}

/** Which capabilities apid would let this account use. */
function useReleased() {
  const { query, phase } = useCapabilityRegistry();
  return (id: string) => capabilityAccess(query.data, id, phase) === 'on';
}

/** Errors in the order their controls appear, so the first one gets focus. */
function inFormOrder(
  errors: Partial<Record<RuleField, string>>,
  form: HTMLFormElement
): Partial<Record<RuleField, string>> {
  const names = Array.from(form.elements).map((el) => el.getAttribute('name'));
  return Object.fromEntries(
    Object.entries(errors).sort(([a], [b]) => names.indexOf(a) - names.indexOf(b))
  );
}

/**
 * The "Add a rule" form: any app metric the backend evaluates without a
 * selector this form lacks, the selectors it does need (SLO, synthetic check,
 * log query, custom metric, failure source), baseline comparisons where they
 * are released, and delivery to a webhook, notification channels, or both.
 * Every check mirrors apid's; lib/alert-rules.ts cites each.
 */
export function AlertRuleForm({ slug }: { slug: string }) {
  const { toast } = useToast();
  const create = useCreateAlert(slug);
  const released = useReleased();
  const { org } = useWorkspaceTarget();
  // A company app's rule cannot bind the creator's personal channels, and the
  // list is the signed-in account's own, so a company workspace never reads it.
  const channelsOn = !org && released('notification-channels');
  const channels = useNotificationChannels(channelsOn);
  const [draft, setDraft] = useState<RuleDraft>(EMPTY_RULE_DRAFT);
  const target = metricSpec(draft.metric)?.target;
  const slos = useAppSLOs(slug, target === 'slo');
  const checks = useAppSyntheticChecks(slug, target === 'synthetic');
  const validation = useFormValidation<RuleField>();
  const errors = ruleDraftErrors(draft);
  const shown = (name: RuleField) => (validation.submitAttempted ? errors[name] : undefined);
  const set = (patch: Partial<RuleDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const field = (name: RuleField) => fieldErrorProps(shown(name), `alert-${name}-error`);
  const error = (name: RuleField) =>
    shown(name) && <FieldError id={`alert-${name}-error`}>{shown(name)}</FieldError>;

  const metrics = ALERT_METRICS.filter((m) => !m.capability || released(m.capability));
  const groups = [...new Set(metrics.map((m) => m.group))];
  const baselines = released('anomaly-alerts');
  const comparisons = comparisonsFor(draft.metric, baselines);
  const windows = windowsFor(draft.metric);
  const baseline = draft.comparison.endsWith('_baseline');

  const chooseMetric = (metric: AlertMetric) =>
    setDraft((d) => ({
      ...d,
      metric,
      // Move the comparison and window into the new metric's range instead
      // of keeping a choice apid would refuse.
      comparison: comparisonsFor(metric, baselines).includes(d.comparison) ? d.comparison : 'gt',
      window: windowsFor(metric).includes(d.window)
        ? d.window
        : (windowsFor(metric).at(-1) ?? '15m'),
    }));

  const toggleChannel = (id: string, on: boolean) =>
    setDraft((d) => ({
      ...d,
      channelIds: on ? [...d.channelIds, id] : d.channelIds.filter((c) => c !== id),
    }));

  return (
    <form
      noValidate
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        if (!validation.validate(inFormOrder(errors, form), form) || create.isPending) return;
        void create
          .mutateAsync(ruleDraftBody(draft))
          .then((rule) => {
            setDraft((d) => ({
              ...d,
              name: '',
              webhookUrl: '',
              webhookSecret: '',
              channelIds: [],
            }));
            validation.resetValidation();
            toast({ kind: 'success', title: 'Rule added', description: rule.name });
          })
          .catch((err: unknown) => toast({ kind: 'error', title: 'Could not add', error: err }));
      }}
    >
      <Labelled label="Name" className="sm:col-span-2" after={error('name')}>
        <input
          name="name"
          value={draft.name}
          onChange={(e) => set({ name: e.target.value })}
          {...field('name')}
          placeholder="Error rate over 5%"
          className={FIELD}
        />
      </Labelled>
      <Labelled label="Metric">
        <select
          value={draft.metric}
          onChange={(e) => chooseMetric(e.target.value as AlertMetric)}
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
      </Labelled>
      <div className="flex gap-2">
        <Labelled label="Is" className="w-24">
          <select
            value={draft.comparison}
            onChange={(e) => set({ comparison: e.target.value as AlertComparison })}
            className={`${FIELD} font-mono`}
          >
            {comparisons.map((c) => (
              <option key={c} value={c}>
                {COMPARISON_LABEL[c]}
              </option>
            ))}
          </select>
        </Labelled>
        <Labelled
          label={baseline ? 'Multiplier' : 'Threshold'}
          className="min-w-0 flex-1"
          after={error('threshold')}
        >
          <input
            name="threshold"
            type="number"
            step="any"
            value={draft.threshold}
            onChange={(e) => set({ threshold: e.target.value })}
            {...field('threshold')}
            title={
              baseline
                ? 'Compared with the median of the same window at this time of day over the last seven days'
                : undefined
            }
            className={`${FIELD} font-mono [font-variant-numeric:tabular-nums]`}
          />
        </Labelled>
      </div>

      {target === 'failure_source' && (
        <Labelled label="Failure source">
          <select
            value={draft.failureSource}
            onChange={(e) => set({ failureSource: e.target.value as FailureSource })}
            className={FIELD}
          >
            {FAILURE_SOURCES.map((source) => (
              <option key={source} value={source}>
                {source.replace('_', ' ')}
              </option>
            ))}
          </select>
        </Labelled>
      )}
      {target === 'slo' && (
        <SelectorField
          label="SLO"
          name="sloId"
          value={draft.sloId}
          onChange={(sloId) => set({ sloId })}
          options={(slos.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
          loading={slos.isPending}
          empty="This app has no SLOs yet; define one on its SLO page first."
          fieldProps={field('sloId')}
          error={error('sloId')}
        />
      )}
      {target === 'synthetic' && (
        <SelectorField
          label="Synthetic check"
          name="syntheticCheckId"
          value={draft.syntheticCheckId}
          onChange={(syntheticCheckId) => set({ syntheticCheckId })}
          options={(checks.data ?? []).map((c) => ({
            value: c.id,
            label: `${c.name} (${c.path})`,
          }))}
          loading={checks.isPending}
          empty="This app has no synthetic checks yet; add one first."
          fieldProps={field('syntheticCheckId')}
          error={error('syntheticCheckId')}
        />
      )}
      {target === 'log_query' && (
        <Labelled label="Log query" className="sm:col-span-2" after={error('logQuery')}>
          <input
            name="logQuery"
            value={draft.logQuery}
            onChange={(e) => set({ logQuery: e.target.value })}
            {...field('logQuery')}
            placeholder="source=runtime&level=error&q=database"
            spellCheck={false}
            className={`${FIELD} font-mono`}
          />
        </Labelled>
      )}
      {target === 'custom_metric' && (
        <Labelled label="Custom metric" after={error('customMetricName')}>
          <input
            name="customMetricName"
            value={draft.customMetricName}
            onChange={(e) => set({ customMetricName: e.target.value })}
            {...field('customMetricName')}
            placeholder="orders_pending"
            spellCheck={false}
            className={`${FIELD} font-mono`}
          />
        </Labelled>
      )}

      {channelsOn && (
        <fieldset className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-4">
          <legend className="label-mono mb-1.5 text-muted-foreground">Notification channels</legend>
          {channels.isPending ? (
            <span className="text-xs text-muted-foreground">Loading channels…</span>
          ) : (channels.data ?? []).length === 0 ? (
            <span className="text-xs text-muted-foreground">
              No channels yet. Add Slack, PagerDuty or email under Notification channels below.
            </span>
          ) : (
            <span className="flex flex-wrap gap-x-5 gap-y-2">
              {(channels.data ?? []).map((c) => {
                const checked = draft.channelIds.includes(c.id);
                return (
                  <label key={c.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="channels"
                      checked={checked}
                      disabled={!checked && draft.channelIds.length >= MAX_CHANNELS_PER_RULE}
                      onChange={(e) => toggleChannel(c.id, e.target.checked)}
                      className="accent-[var(--brand)]"
                    />
                    <span className="font-mono">{c.name}</span>
                    <span className="text-xs text-muted-foreground">{c.kind}</span>
                  </label>
                );
              })}
            </span>
          )}
          {error('channels')}
        </fieldset>
      )}

      <Labelled label="Webhook URL" className="sm:col-span-2" after={error('webhookUrl')}>
        <input
          name="webhookUrl"
          value={draft.webhookUrl}
          onChange={(e) => set({ webhookUrl: e.target.value })}
          {...field('webhookUrl')}
          placeholder={channelsOn ? 'Optional with a channel' : 'https://hooks.example.com/gregale'}
          spellCheck={false}
          className={`${FIELD} font-mono`}
        />
      </Labelled>
      <Labelled label="Webhook secret" after={error('secret')}>
        <input
          name="secret"
          type="password"
          value={draft.webhookSecret}
          onChange={(e) => set({ webhookSecret: e.target.value })}
          {...field('secret')}
          placeholder="1–256 bytes"
          autoComplete="new-password"
          className={`${FIELD} font-mono`}
        />
      </Labelled>
      <div className="flex gap-2">
        <Labelled label="Window" className="flex-1" after={error('window')}>
          <select
            name="window"
            value={draft.window}
            onChange={(e) => set({ window: e.target.value as AlertWindow })}
            {...field('window')}
            className={`${FIELD} font-mono`}
          >
            {windows.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </Labelled>
        <Labelled label="Cooldown" className="w-24" after={error('cooldown')}>
          <input
            name="cooldown"
            type="number"
            min={5}
            max={1440}
            step={1}
            value={draft.cooldown}
            onChange={(e) => set({ cooldown: e.target.value })}
            {...field('cooldown')}
            title="Minutes between firings"
            className={`${FIELD} font-mono [font-variant-numeric:tabular-nums]`}
          />
        </Labelled>
      </div>
      <div className="flex items-end sm:col-span-2 lg:col-span-4">
        <Button type="submit" size="sm" className="gap-1.5" busy={create.isPending}>
          <Plus className="h-3.5 w-3.5" />
          Add rule
        </Button>
      </div>
    </form>
  );
}

function SelectorField({
  label,
  name,
  value,
  onChange,
  options,
  loading,
  empty,
  fieldProps,
  error,
}: {
  label: string;
  name: RuleField;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  loading: boolean;
  empty: string;
  fieldProps: ReturnType<typeof fieldErrorProps>;
  error: ReactNode;
}) {
  return (
    <Labelled
      label={label}
      className="sm:col-span-2"
      after={
        <>
          {!loading && options.length === 0 && (
            <span className="text-xs text-muted-foreground">{empty}</span>
          )}
          {error}
        </>
      }
    >
      <select
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...fieldProps}
        className={FIELD}
      >
        <option value="">{loading ? 'Loading…' : `Choose a ${label.toLowerCase()}`}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Labelled>
  );
}
