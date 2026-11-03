import { useState, type ReactNode } from 'react';
import { CheckCircle, Circle, Plus, Trash, WarningTriangle } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { FIELD } from '@/components/ui/field';
import { Timestamp } from '@/components/ui/timestamp';
import { useToast } from '@/components/ui/toast';
import { ApiError, errorMessage } from '@/lib/api/errors';
import {
  previewCompoundAlert,
  previewLifecycleAlert,
  setCompoundPolicy,
  setFrequencyPolicy,
  setImpactPolicy,
  setLifecyclePolicy,
  useCompoundPolicy,
  useFrequencyPolicy,
  useImpactPolicy,
  useLifecyclePolicy,
  useStorePolicy,
  type CompoundPolicy,
  type CompoundPreview,
  type CompoundRule,
  type FrequencyPolicy,
  type FrequencyRule,
  type LifecyclePolicy,
  type LifecyclePreview,
} from '@/lib/api/issue-policies';
import { useIssues } from '@/lib/api/issues';
import { InlinePhase, Panel, queryPhase } from './primitives';
import { ProblemHelp } from './problem-help';
import { StatusTag } from './postgres-shared';

/**
 * An app's issue alert policies (faas docs/issues.md § Notifications and
 * recovery): customer impact, event frequency, new-issue and regression
 * filters, and compound rules. Each is read and replaced whole against the
 * revision it was read at; a stale write answers 409 and the page offers a
 * reload instead of overwriting someone else's change. Gated on
 * `issue-alert-policies` by the caller.
 */

const KEY = /^[a-z0-9][a-z0-9-]{0,47}$/;
const ENVIRONMENT = /^[a-z0-9][a-z0-9-]{0,62}$/;
const STALE = new Set([
  'issue_frequency_alert_revision_conflict',
  'issue_lifecycle_alert_policy_changed',
  'issue_compound_alert_revision_conflict',
]);

export function isStalePolicy(err: unknown): boolean {
  return err instanceof ApiError && STALE.has(err.code);
}

/** "300 s (5 min)", so a seconds field reads at a glance. */
export function seconds(value: number): string {
  if (value >= 3600 && value % 3600 === 0) return `${value} s (${value / 3600} h)`;
  if (value >= 60 && value % 60 === 0) return `${value} s (${value / 60} min)`;
  return `${value} s`;
}

type Rule = FrequencyRule & { minimum_customers?: number };

/** The bounds apid enforces on a rule (docs/issues.md § Event-frequency and § Compound alerts). */
export function ruleErrors(rules: Rule[], compound: boolean): string[] {
  const errors: string[] = [];
  const keys = new Set<string>();
  rules.forEach((r, i) => {
    const n = `Rule ${i + 1}`;
    if (!KEY.test(r.key))
      errors.push(`${n}: key is lowercase letters, digits and dashes (48 at most).`);
    else if (keys.has(r.key)) errors.push(`${n}: key ${r.key} is used twice.`);
    keys.add(r.key);
    if (r.environment && !ENVIRONMENT.test(r.environment))
      errors.push(`${n}: environment is an exact lowercase name, or empty for all.`);
    if (!(
      Number.isInteger(r.minimum_events) &&
      r.minimum_events >= 1 &&
      r.minimum_events <= 100000
    ))
      errors.push(`${n}: events from 1 to 100,000.`);
    if (
      compound &&
      !(
        Number.isInteger(r.minimum_customers) &&
        (r.minimum_customers ?? 0) >= 1 &&
        (r.minimum_customers ?? 0) <= 10000
      )
    )
      errors.push(`${n}: verified customers from 1 to 10,000.`);
    if (!(
      Number.isInteger(r.window_seconds) &&
      r.window_seconds >= 60 &&
      r.window_seconds <= 86400
    ))
      errors.push(`${n}: window from 60 to 86,400 seconds.`);
    if (!(
      Number.isInteger(r.cooldown_seconds) &&
      r.cooldown_seconds >= 60 &&
      r.cooldown_seconds <= 604800
    ))
      errors.push(`${n}: cooldown from 60 to 604,800 seconds.`);
  });
  if (rules.length > 10) errors.push('At most 10 rules.');
  return errors;
}

/** Parses "production, staging" into exact names; undefined when one is not a valid name. */
export function parseEnvironments(text: string): string[] | undefined {
  const names = [...new Set(text.split(/[\s,]+/).filter(Boolean))];
  return names.every((n) => ENVIRONMENT.test(n)) && names.length <= 20 ? names : undefined;
}

export function IssueAlertPolicies({ accountId, slug }: { accountId: string; slug: string }) {
  // The previews evaluate a draft against one existing issue.
  const issues = useIssues(accountId, slug, {});
  const options = issues.data?.pages.flatMap((p) => p.items) ?? [];
  const [issueId, setIssueId] = useState('');
  const previewIssue = options.some((i) => i.id === issueId) ? issueId : (options[0]?.id ?? '');
  return (
    <section aria-label="Alert policies" className="flex min-w-0 flex-col gap-5">
      <div>
        <h3 className="text-base font-semibold">Alert policies</h3>
        <p className="max-w-2xl text-sm text-muted-foreground">
          When an issue should notify. Policies decide eligibility; delivery goes to app webhooks
          subscribed to the event named under each policy, and to native Slack routes where they are
          set up. Edits apply to future captures only and never send anything themselves.
        </p>
      </div>
      <label className="flex max-w-md flex-col gap-1.5 text-xs">
        <span className="label-mono text-muted-foreground">Preview against issue</span>
        <select
          className={FIELD}
          value={previewIssue}
          onChange={(e) => setIssueId(e.target.value)}
          disabled={options.length === 0}
        >
          {options.length === 0 && <option value="">No retained issue to preview against</option>}
          {options.map((i) => (
            <option key={i.id} value={i.id}>
              {i.title} · {i.environment}
            </option>
          ))}
        </select>
      </label>
      <ImpactSection accountId={accountId} slug={slug} />
      <FrequencySection accountId={accountId} slug={slug} />
      <LifecycleSection accountId={accountId} slug={slug} issueId={previewIssue} />
      <CompoundSection accountId={accountId} slug={slug} issueId={previewIssue} />
    </section>
  );
}

function Failure({ error, onReload }: { error: unknown; onReload: () => void }) {
  if (error === undefined) return null;
  return (
    <div role="alert" className="flex flex-col gap-1 text-sm">
      <span style={{ color: 'var(--status-critical)' }}>
        {isStalePolicy(error)
          ? 'These rules changed since you opened them. Reload to see the saved version; nothing was overwritten.'
          : errorMessage(error)}
      </span>
      <ProblemHelp error={error} />
      {isStalePolicy(error) && (
        <Button variant="outline" size="sm" className="self-start" onClick={onReload}>
          Reload saved rules
        </Button>
      )}
    </div>
  );
}

function Loaded<T>({
  query,
  children,
}: {
  query: { data?: T; error: unknown; isPending: boolean; refetch: () => unknown };
  children: (data: T) => ReactNode;
}) {
  const phase = queryPhase({ error: query.error, loading: query.isPending });
  if (phase !== 'ready' || query.data === undefined)
    return (
      <InlinePhase
        phase={phase === 'ready' ? 'loading' : phase}
        error={query.error}
        loadingMessage="Reading the policy…"
        onRetry={() => void query.refetch()}
      />
    );
  return <>{children(query.data)}</>;
}

function ImpactSection({ accountId, slug }: { accountId: string; slug: string }) {
  const query = useImpactPolicy(accountId, slug);
  return (
    <Panel
      title="Customer impact"
      description="Alert once when an issue crosses this many verified distinct customers in a rolling 24 hours. 0 turns it off. Webhook event: issue.impact_threshold_reached."
    >
      <Loaded query={query}>
        {(policy) => (
          <ImpactForm
            key={policy.minimum_customers}
            accountId={accountId}
            slug={slug}
            value={policy.minimum_customers}
            enabled={policy.enabled}
          />
        )}
      </Loaded>
    </Panel>
  );
}

function ImpactForm({
  accountId,
  slug,
  value,
  enabled,
}: {
  accountId: string;
  slug: string;
  value: number;
  enabled: boolean;
}) {
  const store = useStorePolicy(accountId, slug);
  const { toast } = useToast();
  const [draft, setDraft] = useState(String(value));
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const n = Number(draft);
  const valid = Number.isInteger(n) && n >= 0 && n <= 10000;
  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setFailure(undefined);
    try {
      store('impact', await setImpactPolicy(slug, n));
      toast({ kind: 'success', title: n === 0 ? 'Impact alerts off' : 'Impact alert saved' });
    } catch (err) {
      setFailure(err);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="label-mono text-muted-foreground">Verified customers</span>
          <input
            type="number"
            min={0}
            max={10000}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className={`${FIELD} w-32 font-mono`}
            aria-invalid={valid ? undefined : true}
          />
        </label>
        <Button
          variant="outline"
          disabled={!valid || saving || n === value}
          onClick={() => void save()}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <StatusTag tone={enabled ? 'good' : 'muted'} icon={enabled ? CheckCircle : Circle}>
          {enabled ? `On at ${value}` : 'Off'}
        </StatusTag>
      </div>
      {!valid && (
        <p className="text-xs" style={{ color: 'var(--status-critical)' }}>
          Enter 0 to 10,000.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Changes apply to future events; issues already above the threshold are not alerted again.
      </p>
      <Failure error={failure} onReload={() => undefined} />
    </div>
  );
}

function FrequencySection({ accountId, slug }: { accountId: string; slug: string }) {
  const query = useFrequencyPolicy(accountId, slug);
  const store = useStorePolicy(accountId, slug);
  return (
    <Panel
      title="Event frequency"
      description="Alert when one issue records at least this many retained events inside the window. Only a new capture inside the window triggers, and a cooldown holds the next alert per rule and issue. Ignored issues stay quiet. Webhook event: issue.frequency_threshold_reached."
    >
      <Loaded query={query}>
        {(policy) => (
          <RulesEditor
            key={policy.revision}
            kind="frequency"
            policy={policy}
            onSave={(rules) =>
              setFrequencyPolicy(slug, { expected_revision: policy.revision, rules })
            }
            onSaved={store}
            onReload={() => void query.refetch()}
          />
        )}
      </Loaded>
    </Panel>
  );
}

function CompoundSection({
  accountId,
  slug,
  issueId,
}: {
  accountId: string;
  slug: string;
  issueId: string;
}) {
  const query = useCompoundPolicy(accountId, slug);
  const store = useStorePolicy(accountId, slug);
  return (
    <Panel
      title="Compound: frequency and verified customers"
      description="Alert only when an issue meets both an event count and a verified distinct-customer count in the same window. Active ignores and snoozes suppress it. Webhook event: issue.compound_threshold_reached."
    >
      <Loaded query={query}>
        {(policy) => (
          <RulesEditor
            key={policy.revision}
            kind="compound"
            policy={policy}
            onSave={(rules) =>
              setCompoundPolicy(slug, {
                expected_revision: policy.revision,
                rules: rules as CompoundRule[],
              })
            }
            onSaved={store}
            onReload={() => void query.refetch()}
            preview={
              issueId
                ? (rule) =>
                    previewCompoundAlert(slug, { issue_id: issueId, rule: rule as CompoundRule })
                : undefined
            }
          />
        )}
      </Loaded>
    </Panel>
  );
}

const newRule = (compound: boolean, n: number): Rule => ({
  key: `rule-${n}`,
  enabled: true,
  environment: '',
  minimum_events: compound ? 20 : 50,
  window_seconds: compound ? 600 : 300,
  cooldown_seconds: 1800,
  ...(compound ? { minimum_customers: 3 } : {}),
});

function RulesEditor({
  kind,
  policy,
  onSave,
  onSaved,
  onReload,
  preview,
}: {
  kind: 'frequency' | 'compound';
  policy: FrequencyPolicy | CompoundPolicy;
  onSave: (rules: Rule[]) => Promise<FrequencyPolicy | CompoundPolicy>;
  onSaved: ReturnType<typeof useStorePolicy>;
  onReload: () => void;
  preview?: (rule: Rule) => Promise<CompoundPreview>;
}) {
  const compound = kind === 'compound';
  const { toast } = useToast();
  const [rules, setRules] = useState<Rule[]>(policy.rules as Rule[]);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const [attempted, setAttempted] = useState(false);
  const [previews, setPreviews] = useState<Record<number, CompoundPreview | { error: unknown }>>(
    {}
  );
  const errors = ruleErrors(rules, compound);
  const dirty = JSON.stringify(rules) !== JSON.stringify(policy.rules);
  const edit = (i: number, patch: Partial<Rule>) => {
    setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    setPreviews((p) => Object.fromEntries(Object.entries(p).filter(([k]) => Number(k) !== i)));
  };
  const save = async () => {
    setAttempted(true);
    if (errors.length || saving) return;
    setSaving(true);
    setFailure(undefined);
    try {
      const saved = await onSave(rules);
      toast({
        kind: 'success',
        title: `Saved ${saved.rules.length} ${saved.rules.length === 1 ? 'rule' : 'rules'}`,
      });
      onSaved(kind, saved);
    } catch (err) {
      setFailure(err);
    } finally {
      setSaving(false);
    }
  };
  const runPreview = async (i: number) => {
    if (!preview) return;
    try {
      const result = await preview(rules[i]);
      setPreviews((p) => ({ ...p, [i]: result }));
    } catch (err) {
      setPreviews((p) => ({ ...p, [i]: { error: err } }));
    }
  };

  const number = (label: string, value: number | undefined, onChange: (v: number) => void) => (
    <label className="flex flex-col gap-1">
      <span className="label-mono text-muted-foreground">{label}</span>
      <input
        type="number"
        value={Number.isNaN(value) ? '' : (value ?? '')}
        onChange={(e) => onChange(e.target.value === '' ? Number.NaN : Number(e.target.value))}
        className={`${FIELD} w-full font-mono`}
      />
    </label>
  );

  return (
    <div className="flex flex-col gap-4">
      {rules.length === 0 && (
        <p className="text-sm text-muted-foreground">No rules. Revision {policy.revision}.</p>
      )}
      {rules.map((rule, i) => {
        const result = previews[i];
        return (
          <fieldset
            key={i}
            aria-label={`Rule ${rule.key || i + 1}`}
            className="flex flex-col gap-3 rounded-lg border border-border p-3"
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <label className="col-span-2 flex flex-col gap-1 sm:col-span-1">
                <span className="label-mono text-muted-foreground">Key</span>
                <input
                  value={rule.key}
                  onChange={(e) => edit(i, { key: e.target.value })}
                  className={`${FIELD} w-full font-mono`}
                />
              </label>
              <label className="col-span-2 flex flex-col gap-1 sm:col-span-1">
                <span className="label-mono text-muted-foreground">Environment</span>
                <input
                  value={rule.environment}
                  placeholder="All"
                  onChange={(e) => edit(i, { environment: e.target.value })}
                  className={`${FIELD} w-full font-mono`}
                />
              </label>
              {number('Events', rule.minimum_events, (v) => edit(i, { minimum_events: v }))}
              {compound &&
                number('Customers', rule.minimum_customers, (v) =>
                  edit(i, { minimum_customers: v })
                )}
              {number('Window (s)', rule.window_seconds, (v) => edit(i, { window_seconds: v }))}
              {number('Cooldown (s)', rule.cooldown_seconds, (v) =>
                edit(i, { cooldown_seconds: v })
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={(e) => edit(i, { enabled: e.target.checked })}
                />
                Enabled
              </label>
              <span className="text-muted-foreground">
                {Number.isFinite(rule.window_seconds)
                  ? `window ${seconds(rule.window_seconds)}`
                  : ''}
              </span>
              {preview && (
                <Button variant="outline" size="xs" onClick={() => void runPreview(i)}>
                  Preview
                </Button>
              )}
              <Button
                variant="ghost"
                size="xs"
                aria-label={`Remove rule ${rule.key || i + 1}`}
                onClick={() => {
                  setRules((rs) => rs.filter((_, j) => j !== i));
                  setPreviews({});
                }}
              >
                <Trash aria-hidden className="h-3 w-3" />
                Remove
              </Button>
            </div>
            {result && 'error' in result ? (
              <p role="alert" className="text-xs" style={{ color: 'var(--status-critical)' }}>
                {errorMessage(result.error)}
              </p>
            ) : result ? (
              <CompoundPreviewResult result={result} />
            ) : null}
          </fieldset>
        );
      })}
      {attempted && errors.length > 0 && (
        <ul
          role="alert"
          className="list-disc pl-5 text-xs"
          style={{ color: 'var(--status-critical)' }}
        >
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <Failure error={failure} onReload={onReload} />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          disabled={rules.length >= 10}
          onClick={() => setRules((rs) => [...rs, newRule(compound, rs.length + 1)])}
        >
          <Plus aria-hidden className="h-3.5 w-3.5" />
          Add rule
        </Button>
        <Button size="sm" disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save rules'}
        </Button>
        <span className="text-xs text-muted-foreground">
          Revision {policy.revision}. Saving replaces every rule; an empty list removes them all.
        </span>
      </div>
    </div>
  );
}

const COMPOUND_REASON: Record<CompoundPreview['reason'], string> = {
  eligible: 'Would alert',
  disabled: 'Rule is disabled',
  environment_excluded: 'Environment does not match',
  suppressed: 'Issue is ignored or snoozed',
  event_threshold: 'Below the event threshold',
  customer_threshold: 'Below the customer threshold',
  cooldown: 'Cooling down',
};

function CompoundPreviewResult({ result }: { result: CompoundPreview }) {
  return (
    <div role="status" className="flex flex-col gap-1 text-xs">
      <span className="flex flex-wrap items-center gap-2">
        <StatusTag
          tone={result.allowed ? 'good' : 'warning'}
          icon={result.allowed ? CheckCircle : WarningTriangle}
        >
          {COMPOUND_REASON[result.reason]}
        </StatusTag>
        <span className="text-muted-foreground">
          {result.observed_events} events and {result.identified_customers} verified customers in
          the window ending <Timestamp value={result.window_end} />
        </span>
      </span>
      {result.next_eligible_at && (
        <span className="text-muted-foreground">
          Next eligible <Timestamp value={result.next_eligible_at} />.
        </span>
      )}
      <span className="text-muted-foreground">
        Eligibility only: subscriptions, routing and capacity still decide delivery.
      </span>
    </div>
  );
}

function LifecycleSection({
  accountId,
  slug,
  issueId,
}: {
  accountId: string;
  slug: string;
  issueId: string;
}) {
  const query = useLifecyclePolicy(accountId, slug);
  const store = useStorePolicy(accountId, slug);
  return (
    <Panel
      title="New-issue and regression alerts"
      description="Filters native Slack alerts for new and regressed issues by exact environment, with one cooldown per issue across both. Lifecycle webhooks keep their own subscriptions."
    >
      <Loaded query={query}>
        {(policy) => (
          <LifecycleForm
            key={policy.revision}
            slug={slug}
            policy={policy}
            issueId={issueId}
            onSaved={(saved) => store('lifecycle', saved)}
            onReload={() => void query.refetch()}
          />
        )}
      </Loaded>
    </Panel>
  );
}

const LIFECYCLE_REASON: Record<LifecyclePreview['reason'], string> = {
  eligible: 'Would alert',
  environment_excluded: 'Environment is filtered out',
  cooldown: 'Cooling down',
};

function LifecycleForm({
  slug,
  policy,
  issueId,
  onSaved,
  onReload,
}: {
  slug: string;
  policy: LifecyclePolicy;
  issueId: string;
  onSaved: (saved: LifecyclePolicy) => void;
  onReload: () => void;
}) {
  const { toast } = useToast();
  const [environments, setEnvironments] = useState(policy.environments.join(', '));
  const [cooldown, setCooldown] = useState(String(policy.cooldown_seconds));
  const [event, setEvent] = useState<LifecyclePreview['event']>('regressed');
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const [result, setResult] = useState<LifecyclePreview | { error: unknown }>();
  const names = parseEnvironments(environments);
  const seconds_ = Number(cooldown);
  const validCooldown = Number.isInteger(seconds_) && seconds_ >= 0 && seconds_ <= 604800;
  const draft =
    names && validCooldown ? { environments: names, cooldown_seconds: seconds_ } : undefined;
  const save = async () => {
    if (!draft || saving) return;
    setSaving(true);
    setFailure(undefined);
    try {
      const saved = await setLifecyclePolicy(slug, {
        expected_revision: policy.revision,
        ...draft,
      });
      toast({ kind: 'success', title: 'Lifecycle alert policy saved' });
      onSaved(saved);
    } catch (err) {
      setFailure(err);
    } finally {
      setSaving(false);
    }
  };
  const runPreview = async () => {
    if (!draft || !issueId) return;
    try {
      setResult(await previewLifecycleAlert(slug, { issue_id: issueId, event, ...draft }));
    } catch (err) {
      setResult({ error: err });
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="label-mono text-muted-foreground">Environments</span>
          <input
            value={environments}
            placeholder="All environments"
            onChange={(e) => setEnvironments(e.target.value)}
            className={`${FIELD} font-mono`}
            aria-invalid={names ? undefined : true}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label-mono text-muted-foreground">Cooldown (s)</span>
          <input
            type="number"
            min={0}
            max={604800}
            value={cooldown}
            onChange={(e) => setCooldown(e.target.value)}
            className={`${FIELD} font-mono`}
            aria-invalid={validCooldown ? undefined : true}
          />
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        Exact names, comma separated, up to 20; empty permits all. A cooldown of 0 turns throttling
        off; it starts only when an alert is queued.
      </p>
      {!draft && (
        <p className="text-xs" style={{ color: 'var(--status-critical)' }}>
          {names
            ? 'Cooldown is 0 to 604,800 seconds.'
            : 'Environments are lowercase names such as production.'}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" disabled={!draft || saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save policy'}
        </Button>
        <select
          aria-label="Preview event"
          className={`${FIELD} h-8 text-xs`}
          value={event}
          onChange={(e) => setEvent(e.target.value as LifecyclePreview['event'])}
        >
          <option value="regressed">If it regressed</option>
          <option value="created">If it were new</option>
        </select>
        <Button
          variant="outline"
          size="sm"
          disabled={!draft || !issueId}
          onClick={() => void runPreview()}
        >
          Preview
        </Button>
        <span className="text-xs text-muted-foreground">Revision {policy.revision}</span>
      </div>
      {result && 'error' in result ? (
        <p role="alert" className="text-xs" style={{ color: 'var(--status-critical)' }}>
          {errorMessage(result.error)}
        </p>
      ) : result ? (
        <p role="status" className="flex flex-wrap items-center gap-2 text-xs">
          <StatusTag
            tone={result.allowed ? 'good' : 'warning'}
            icon={result.allowed ? CheckCircle : WarningTriangle}
          >
            {LIFECYCLE_REASON[result.reason]}
          </StatusTag>
          <span className="text-muted-foreground">
            {result.environment}
            {result.next_eligible_at && (
              <>
                {' '}
                · next eligible <Timestamp value={result.next_eligible_at} />
              </>
            )}{' '}
            · policy only; subscriptions, routing and capacity still decide delivery.
          </span>
        </p>
      ) : null}
      <Failure error={failure} onReload={onReload} />
    </div>
  );
}
