import { useId, useState, type FormEvent } from 'react';
import { Eye, Lock } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { FIELD, FieldError, Select, fieldErrorProps } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { usePreviewBudget } from '@/lib/api/budgets';
import { useProjectEnvironments, useProjects } from '@/lib/api/projects';
import { useApps, useJobs } from '@/lib/api/queries';
import {
  LEVELS,
  METERS,
  SCOPE_KINDS,
  draftErrors,
  draftFromSpec,
  emptyDraft,
  specFromDraft,
  type Budget,
  type BudgetDraft,
  type BudgetLevel,
  type BudgetPreview,
  type BudgetSpec,
  type DraftField,
  type ScopeKind,
} from '@/lib/budgets';
import { cn } from '@/lib/utils';
import { InlinePhase, queryPhase } from '../primitives';
import { ProblemHelp } from '../problem-help';
import { SegmentedControl } from '../tabs';
import type { ScopeLabel } from './budget-bits';
import { BudgetPreviewResult } from './budget-preview';
import { sameSpec, useBudgetSave } from './use-budget-save';

const LABEL = 'label-mono text-muted-foreground';
const HINT = 'text-xs text-muted-foreground';
const ORDER: BudgetLevel[] = ['alert', 'stop-previews', 'strict'];

/** The picker for one scope's resource; only the list it needs is read. */
function ScopeResource({
  accountId,
  kind,
  value,
  onChange,
  error,
}: {
  accountId: string;
  kind: Exclude<ScopeKind, 'account'>;
  value: string;
  onChange: (id: string) => void;
  error?: string;
}) {
  const id = useId();
  const apps = useApps({ enabled: kind === 'app' });
  const jobs = useJobs(undefined, kind === 'job');
  const projects = useProjects(kind === 'project' || kind === 'environment' ? accountId : '');
  const [project, setProject] = useState('');
  const environments = useProjectEnvironments(kind === 'environment' ? accountId : '', project);

  const options =
    kind === 'app'
      ? (apps.data ?? []).map((app) => ({
          id: app.id,
          label: app.preview_of_slug ? `${app.slug} (preview)` : app.slug,
        }))
      : kind === 'job'
        ? (jobs.data?.jobs ?? []).map((job) => ({ id: job.id, label: job.name }))
        : kind === 'project'
          ? (projects.data ?? []).map((p) => ({ id: p.id, label: p.slug }))
          : (environments.data ?? []).map((env) => ({ id: env.id, label: env.slug }));
  const source =
    kind === 'app' ? apps : kind === 'job' ? jobs : kind === 'project' ? projects : environments;
  const needsProject = kind === 'environment' && !project;
  const phase = needsProject
    ? 'ready'
    : queryPhase({ error: source.error, loading: source.isPending, isEmpty: !options.length });

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {kind === 'environment' && (
        <>
          <label htmlFor={`${id}-project`} className={LABEL}>
            Project
          </label>
          <Select
            id={`${id}-project`}
            value={project}
            onChange={(e) => {
              setProject(e.target.value);
              onChange('');
            }}
          >
            <option value="">Choose a project…</option>
            {(projects.data ?? []).map((p) => (
              <option key={p.id} value={p.slug}>
                {p.slug}
              </option>
            ))}
          </Select>
        </>
      )}
      <label htmlFor={id} className={LABEL}>
        {kind === 'environment' ? 'Environment' : kind[0].toUpperCase() + kind.slice(1)}
      </label>
      {phase !== 'ready' ? (
        <div className="text-xs">
          <InlinePhase
            phase={phase}
            error={source.error}
            loadingMessage={`Reading ${kind}s…`}
            emptyMessage={`This account has no ${kind}s.`}
            onRetry={() => void source.refetch()}
          />
        </div>
      ) : (
        <Select
          id={id}
          name="scope"
          value={value}
          disabled={needsProject}
          onChange={(e) => onChange(e.target.value)}
          {...fieldErrorProps(error, `${id}-error`)}
        >
          <option value="">{needsProject ? 'Choose a project first' : `Choose a ${kind}…`}</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </Select>
      )}
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </div>
  );
}

/**
 * Creates a budget, or edits one when `budget` is given.
 *
 * The response is chosen on the grade apid can activate — Alert, Stop
 * previews, Strict cap — and "Preview" asks apid what this spec would do this
 * month before anything is saved. Fields a response cannot carry are not
 * offered: a strict cap has no thresholds or drain, stopping previews counts
 * compute alone, and object storage only counts on an account alert.
 */
export function BudgetForm({
  accountId,
  budget,
  scopeLabel,
  strictRefused,
  onStrictRefused,
  onSaved,
  onCancel,
}: {
  accountId: string;
  budget?: Budget;
  scopeLabel: ScopeLabel;
  /** apid has refused to turn on a strict cap for this account. */
  strictRefused: boolean;
  onStrictRefused: () => void;
  onSaved: (budget: Budget) => void;
  onCancel?: () => void;
}) {
  const formId = useId();
  const { toast } = useToast();
  const [draft, setDraft] = useState<BudgetDraft>(() =>
    budget ? draftFromSpec(budget.spec) : emptyDraft()
  );
  const [attempted, setAttempted] = useState(false);
  const [failure, setFailure] = useState<{
    error: unknown;
    message: string;
    strictNotReleased: boolean;
  } | null>(null);
  const [previewed, setPreviewed] = useState<{ spec: BudgetSpec; preview: BudgetPreview } | null>(
    null
  );
  const preview = usePreviewBudget();
  const { save, pending } = useBudgetSave(accountId, scopeLabel);

  // An enabled strict cap stays editable when the flag is off; apid exempts
  // the revision it replaces (handlers_financial_budgets.go:133-147).
  const strictExempt = Boolean(budget?.spec.enabled && budget.spec.mode === 'strict');
  const strictBlocked = draft.level === 'strict' && strictRefused && !strictExempt;
  const errors = draftErrors(draft);
  const shown = (field: DraftField) => (attempted ? errors[field] : undefined);
  const set = (patch: Partial<BudgetDraft>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
    setFailure(null);
  };
  // What would be saved, as if turned on: a preview of a draft would select
  // nothing, and the person is asking what it would do.
  const spec = (enabled = draft.enabled && !strictBlocked) => specFromDraft({ ...draft, enabled });
  const shownPreview =
    previewed && sameSpec(previewed.spec, spec(true)) ? previewed.preview : undefined;

  const firstInvalid = (form: HTMLFormElement) => {
    const field = (Object.keys(errors) as DraftField[])[0];
    const name = field === 'drain' ? 'drainSeconds' : field;
    const control = form.elements.namedItem(name);
    if (control instanceof HTMLElement) control.focus();
  };

  const runPreview = async (form: HTMLFormElement | null) => {
    setAttempted(true);
    if (Object.keys(errors).length) {
      if (form) firstInvalid(form);
      return;
    }
    const asked = spec(true);
    try {
      setPreviewed({ spec: asked, preview: await preview.mutateAsync(asked) });
    } catch (error) {
      setPreviewed(null);
      setFailure({ error, message: 'The preview could not be read.', strictNotReleased: false });
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement> | null, enabled?: boolean) => {
    event?.preventDefault();
    setAttempted(true);
    setFailure(null);
    if (Object.keys(errors).length) {
      if (event) firstInvalid(event.currentTarget);
      return;
    }
    const wanted = spec(enabled);
    const outcome = await save(wanted, budget, previewed ?? undefined);
    if (outcome.preview) setPreviewed({ spec: spec(true), preview: outcome.preview });
    if (outcome.kind === 'cancelled') return;
    if (outcome.kind === 'refused') {
      if (outcome.strictNotReleased) onStrictRefused();
      setFailure(outcome);
      return;
    }
    toast({
      kind: 'success',
      title: budget ? `${outcome.budget.spec.name} saved` : `${outcome.budget.spec.name} created`,
      description: outcome.budget.spec.enabled
        ? undefined
        : 'Saved as a draft: it neither alerts nor stops anything until it is turned on.',
    });
    if (!budget) {
      setDraft(emptyDraft());
      setAttempted(false);
      setPreviewed(null);
    }
    onSaved(outcome.budget);
  };

  const level = draft.level;
  const account = draft.scopeKind === 'account';

  return (
    <form
      noValidate
      autoComplete="off"
      aria-label={budget ? `Edit ${budget.spec.name}` : 'New budget'}
      onSubmit={(e) => void submit(e)}
      className="flex flex-col gap-5"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={`${formId}-name`} className={LABEL}>
            Name
          </label>
          <input
            id={`${formId}-name`}
            name="name"
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="e.g. Monthly compute"
            maxLength={128}
            className={FIELD}
            {...fieldErrorProps(shown('name'), `${formId}-name-error`)}
          />
          {shown('name') && <FieldError id={`${formId}-name-error`}>{shown('name')}</FieldError>}
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={`${formId}-scope`} className={LABEL}>
            Scope
          </label>
          <Select
            id={`${formId}-scope`}
            value={draft.scopeKind}
            onChange={(e) => set({ scopeKind: e.target.value as ScopeKind, scopeId: '' })}
          >
            {SCOPE_KINDS.map((option) => (
              <option key={option.kind} value={option.kind}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
        {!account && (
          <div className="sm:col-span-2">
            <ScopeResource
              key={draft.scopeKind}
              accountId={accountId}
              kind={draft.scopeKind as Exclude<ScopeKind, 'account'>}
              value={draft.scopeId}
              onChange={(scopeId) => set({ scopeId })}
              error={shown('scope')}
            />
          </div>
        )}
      </div>

      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className={cn(LABEL, 'mb-2')}>Response</legend>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          {ORDER.map((key, index) => {
            const on = level === key;
            return (
              <label
                key={key}
                className={cn(
                  'pressable flex cursor-pointer flex-col gap-1 rounded-lg border p-3',
                  on ? 'border-brand bg-brand/10' : 'border-border'
                )}
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  {/* Named by the title alone; the summary describes it. */}
                  <input
                    type="radio"
                    name="level"
                    value={key}
                    checked={on}
                    onChange={() => set({ level: key })}
                    aria-labelledby={`${formId}-${key}-title`}
                    aria-describedby={`${formId}-${key}-summary`}
                    className="h-3.5 w-3.5 accent-[color:var(--brand)]"
                  />
                  <span aria-hidden className="label-mono text-muted-foreground">
                    {index + 1}
                  </span>
                  <span id={`${formId}-${key}-title`}>{LEVELS[key].label}</span>
                  {key === 'strict' && strictRefused && (
                    <Lock aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </span>
                <span id={`${formId}-${key}-summary`} className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">{LEVELS[key].summary}</span>
                  {key === 'strict' && (
                    <span className="text-xs" style={{ color: 'var(--status-warning)' }}>
                      {strictRefused
                        ? 'Not released to this account: draft only.'
                        : 'Released account by account; until then it can only be a draft.'}
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={`${formId}-limit`} className={LABEL}>
            Limit (USD a month)
          </label>
          <input
            id={`${formId}-limit`}
            name="limit"
            inputMode="decimal"
            value={draft.limit}
            onChange={(e) => set({ limit: e.target.value })}
            placeholder="e.g. 25"
            className={cn(FIELD, '[font-variant-numeric:tabular-nums]')}
            {...fieldErrorProps(shown('limit'), `${formId}-limit-error`)}
          />
          {shown('limit') ? (
            <FieldError id={`${formId}-limit-error`}>{shown('limit')}</FieldError>
          ) : (
            <span className={HINT}>
              {level === 'strict'
                ? 'Funded compute stops here. It must cover what this month has already committed.'
                : 'Also an alert threshold. Counts the meters below, not the whole invoice.'}
            </span>
          )}
        </div>
        {level !== 'strict' && (
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor={`${formId}-thresholds`} className={LABEL}>
              Earlier alerts (USD, optional)
            </label>
            <input
              id={`${formId}-thresholds`}
              name="thresholds"
              inputMode="decimal"
              value={draft.thresholds}
              onChange={(e) => set({ thresholds: e.target.value })}
              placeholder="e.g. 10, 20"
              className={cn(FIELD, '[font-variant-numeric:tabular-nums]')}
              {...fieldErrorProps(shown('thresholds'), `${formId}-thresholds-error`)}
            />
            {shown('thresholds') ? (
              <FieldError id={`${formId}-thresholds-error`}>{shown('thresholds')}</FieldError>
            ) : (
              <span className={HINT}>Up to 8, increasing, at or below the limit.</span>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {level === 'alert' && (
          <fieldset className="flex min-w-0 flex-col gap-1.5">
            <legend className={cn(LABEL, 'mb-1.5')}>Meters</legend>
            <div className="flex flex-wrap gap-1.5">
              {METERS.filter((m) => m.meter !== 'object_storage' || account).map((m) => {
                const on = draft.meters.includes(m.meter);
                return (
                  <label
                    key={m.meter}
                    className={cn(
                      'pressable inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs',
                      on
                        ? 'border-brand bg-brand/10 text-foreground'
                        : 'border-border text-muted-foreground'
                    )}
                  >
                    <input
                      type="checkbox"
                      name="meters"
                      checked={on}
                      onChange={() =>
                        set({
                          meters: on
                            ? draft.meters.filter((x) => x !== m.meter)
                            : [...draft.meters, m.meter],
                        })
                      }
                      className="h-3.5 w-3.5 accent-[color:var(--brand)]"
                    />
                    {m.label}
                  </label>
                );
              })}
            </div>
            {shown('meters') ? (
              <FieldError id={`${formId}-meters-error`}>{shown('meters')}</FieldError>
            ) : (
              <span className={HINT}>
                {account
                  ? 'Object storage is the live estimate, refreshed every five minutes.'
                  : 'Object storage counts only on an account budget.'}
              </span>
            )}
          </fieldset>
        )}
        {level === 'strict' && account && (
          <label className="flex min-w-0 items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.meters.includes('egress')}
              onChange={(e) =>
                set({ meters: e.target.checked ? ['compute', 'egress'] : ['compute'] })
              }
              className="mt-0.5 h-3.5 w-3.5 accent-[color:var(--brand)]"
            />
            <span className="flex flex-col gap-0.5">
              Cap egress under the same limit
              <span className={HINT}>Compute and egress share one paid limit.</span>
            </span>
          </label>
        )}
        {level !== 'strict' ? (
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className={LABEL}>Count</span>
            <SegmentedControl
              label="Usage basis"
              value={draft.basis}
              options={[
                { key: 'net_usage', label: 'After allowance' },
                { key: 'gross_usage', label: 'Before allowance' },
              ]}
              onChange={(basis) => set({ basis })}
            />
            <span className={HINT}>
              {draft.basis === 'net_usage'
                ? 'What you pay: usage past the included allowance, shared once across the account.'
                : 'All usage, as if nothing were included.'}
            </span>
          </div>
        ) : (
          <p className={cn(HINT, 'self-center')}>
            {account
              ? 'Counts compute after the included allowance.'
              : 'Counts compute before the included allowance, as a resource cap must.'}
          </p>
        )}
      </div>

      {level !== 'alert' && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {level === 'stop-previews' && (
            <div className="flex min-w-0 flex-col gap-1.5">
              <label htmlFor={`${formId}-drain`} className={LABEL}>
                Drain (seconds)
              </label>
              <input
                id={`${formId}-drain`}
                name="drainSeconds"
                inputMode="numeric"
                value={draft.drainSeconds}
                onChange={(e) => set({ drainSeconds: e.target.value })}
                className={cn(FIELD, '[font-variant-numeric:tabular-nums]')}
                {...fieldErrorProps(shown('drain'), `${formId}-drain-error`)}
              />
              {shown('drain') ? (
                <FieldError id={`${formId}-drain-error`}>{shown('drain')}</FieldError>
              ) : (
                <span className={HINT}>
                  In-flight requests finish for up to this long before previews stop. 0 to 300.
                </span>
              )}
            </div>
          )}
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className={LABEL}>Lifts</span>
            <SegmentedControl
              label="When the stop lifts"
              value={draft.resumeRule}
              options={[
                { key: 'next_period', label: 'Next month' },
                { key: 'manual', label: 'When I change it' },
              ]}
              onChange={(resumeRule) => set({ resumeRule })}
            />
            <span className={HINT}>
              {draft.resumeRule === 'next_period'
                ? 'Lifts at the start of the next UTC month.'
                : 'Stays, across months, until you edit, turn off or delete this budget.'}
            </span>
          </div>
        </div>
      )}

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="enabled"
          checked={draft.enabled && !strictBlocked}
          disabled={strictBlocked}
          onChange={(e) => set({ enabled: e.target.checked })}
          className="mt-0.5 h-3.5 w-3.5 accent-[color:var(--brand)]"
        />
        <span className="flex flex-col gap-0.5">
          Turn on now
          <span className={HINT}>
            {strictBlocked
              ? 'Strict budgets are not released to this account, so this saves a draft.'
              : 'Off saves a draft, which neither alerts nor stops anything.'}
          </span>
        </span>
      </label>

      {budget && (
        <p className={HINT}>
          Saving starts revision {budget.revision + 1}. This month&apos;s spending is evaluated
          again, so a threshold already passed can alert again, and a stop placed by revision{' '}
          {budget.revision} is released. Spending itself is never reset.
        </p>
      )}

      {failure && (
        <div role="alert" className="flex flex-col gap-2 well rounded-xl bg-muted/40 p-3 text-sm">
          <span style={{ color: 'var(--status-critical)' }}>{failure.message}</span>
          <ProblemHelp error={failure.error} className="[&_code]:break-all" />
          {failure.strictNotReleased && (
            <div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                busy={pending}
                onClick={() => void submit(null, false)}
              >
                Save as a draft instead
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1.5"
          busy={preview.isPending}
          onClick={(e) => void runPreview(e.currentTarget.form)}
        >
          <Eye className="h-3.5 w-3.5" />
          Preview this month
        </Button>
        <Button type="submit" size="sm" busy={pending}>
          {budget ? 'Save changes' : 'Create budget'}
        </Button>
        {onCancel && (
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>

      {shownPreview && <BudgetPreviewResult preview={shownPreview} />}
    </form>
  );
}
