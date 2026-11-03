import { useId, useState, type ReactNode } from 'react';
import { Plus, ShieldCheck, ShieldEye, ShieldMinus, Trash } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { CapabilityNotice } from '@/components/dashboard/capability-notice';
import { InlinePhase, Panel, queryPhase } from '@/components/dashboard/primitives';
import { ProblemHelp } from '@/components/dashboard/problem-help';
import { Pill } from '@/components/dashboard/resource-table';
import { SegmentedControl } from '@/components/dashboard/tabs';
import { INPUT, StringListField } from '@/components/dashboard/edge-rules/fields';
import { useCapability, useCapabilityAccess } from '@/lib/api/capabilities';
import { usePreAuthObservations, useUpdatePreAuthGuard } from '@/lib/api/edge-protection';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useApp } from '@/lib/api/queries';
import { useWorkspaceTarget } from '@/lib/api/workspace-apps';
import { useAuth } from '@/lib/auth';
import {
  PRE_AUTH_MAX_ROUTES,
  PRE_AUTH_METHODS,
  emptyRoute,
  enforceEffect,
  preAuthConfig,
  preAuthDraft,
  preAuthSummary,
  samePreAuth,
  validatePreAuth,
  type PreAuthConfig,
  type PreAuthDraft,
  type PreAuthMode,
  type RouteDraft,
} from '@/lib/pre-auth-guard';
import { cn } from '@/lib/utils';

/**
 * The pre-auth guard's editor, beside its observations on the Edge
 * protection tab. It was set only with `gregale app --pre-auth`; the
 * semantics are faas docs/security.md §Optional pre-auth source limit, and
 * the rules live in `lib/pre-auth-guard.ts`.
 *
 * Observe is the documented default (ADR-829) and never rejects, so it saves
 * without asking. Enforce is confirmed with what it refuses and the
 * server's own 24-hour check, as the CLI prints it first
 * (faas cmd/gregale/app_pre_auth.go:48); switching off is confirmed because
 * it removes the limit. `pre_auth_rate_limit` belongs to the edge-protection
 * capability (faas pkg/productcap/catalog.json), so apid refuses it with
 * `capability_not_released` while that is hidden, and the editor does too.
 */

/** ADR-829's default rate, clamped to the Free plan's 5 rps (appmanifest.go:447). */
function defaultRate(plan: string | undefined) {
  return { rps: plan === 'free' ? 5 : 10, burst: 20 };
}

const MODES: readonly { key: PreAuthMode; label: string }[] = [
  { key: 'off', label: 'Off' },
  { key: 'observe', label: 'Observe' },
  { key: 'enforce', label: 'Enforce' },
];

const STATUS: Record<PreAuthMode, { label: string; icon: typeof ShieldCheck; color?: string }> = {
  off: { label: 'Off', icon: ShieldMinus },
  observe: { label: 'Observing', icon: ShieldEye, color: 'var(--status-warning)' },
  enforce: { label: 'Enforcing', icon: ShieldCheck, color: 'var(--status-good)' },
};

function ModeBadge({ mode }: { mode: PreAuthMode }) {
  const s = STATUS[mode];
  const Icon = s.icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs',
        !s.color && 'border-border text-muted-foreground'
      )}
      style={
        s.color
          ? { borderColor: `color-mix(in oklab, ${s.color} 35%, transparent)`, color: s.color }
          : undefined
      }
    >
      <Icon aria-hidden className="h-3 w-3" />
      {s.label}
    </span>
  );
}

const ADVICE: Record<string, { title: string; color?: string }> = {
  ready: { title: 'Ready to enforce', color: 'var(--status-good)' },
  review: { title: 'Review before enforcing', color: 'var(--status-warning)' },
  insufficient_data: { title: 'Not enough data yet' },
};

/** apid's PATCH /v1/apps/{slug} is org.configure_app (faas appaccess/routes.go:29, authz/authorize.go:43). */
function useExplain() {
  const workspace = useWorkspaceTarget();
  const org = workspace.org ? workspace.label : "the app's organization";
  return (err: unknown) =>
    err instanceof ApiError && err.code === 'org_role_forbidden'
      ? `In ${org}, changing an app’s settings needs the owner, admin or developer role.`
      : errorMessage(err);
}

export function PreAuthGuardPanel({ slug }: { slug: string }) {
  const { account } = useAuth();
  const app = useApp(slug);
  const phase = queryPhase({ error: app.error, loading: app.isPending });
  const stored = app.data?.manifest?.pre_auth_rate_limit;
  const storedMode: PreAuthMode = stored?.mode ?? 'off';

  return (
    <div role="region" aria-label="Pre-auth guard">
      <Panel
        title="Pre-auth guard"
        help="A limit on each client address that runs after the host is matched and before credentials are checked, a body is read or the app wakes."
        actions={phase === 'ready' ? <ModeBadge mode={storedMode} /> : undefined}
      >
        {phase !== 'ready' ? (
          <InlinePhase
            phase={phase}
            error={app.error}
            loadingMessage="Reading the pre-auth guard…"
            onRetry={() => void app.refetch()}
          />
        ) : (
          <GuardEditor
            // A stored change (here, the CLI, another tab) reseeds the form.
            key={JSON.stringify(stored ?? null)}
            slug={slug}
            stored={stored}
            fallback={defaultRate(account?.plan)}
          />
        )}
      </Panel>
    </div>
  );
}

function GuardEditor({
  slug,
  stored,
  fallback,
}: {
  slug: string;
  stored: PreAuthConfig | undefined;
  fallback: { rps: number; burst: number };
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const explain = useExplain();
  const access = useCapabilityAccess('edge-protection');
  const cap = useCapability('edge-protection');
  const update = useUpdatePreAuthGuard(slug);
  const [draft, setDraft] = useState<PreAuthDraft>(() => preAuthDraft(stored, fallback));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<unknown>(null);
  const [unreleased, setUnreleased] = useState(false);
  const storedMode: PreAuthMode = stored?.mode ?? 'off';
  const editable = access.access === 'on' && !unreleased;
  const unchanged = samePreAuth(stored, draft);

  const toEnforce = draft.mode === 'enforce' && storedMode !== 'enforce';
  const check = usePreAuthObservations(slug, '24h', editable && toEnforce);
  const suggestion = check.data?.suggestion;
  const checkLine = !toEnforce
    ? ''
    : suggestion
      ? `${ADVICE[suggestion.status]?.title ?? suggestion.status}: ${suggestion.reason}`
      : check.isPending
        ? 'The 24-hour check is still being read.'
        : check.error
          ? 'The 24-hour check could not be read.'
          : storedMode === 'off'
            ? 'There is no 24-hour check while the guard is off: observe first to see what enforce would refuse.'
            : 'The 24-hour check is unavailable: the metrics could not be read.';

  const set = (patch: Partial<PreAuthDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setProblem(null);
  };
  const setRoute = (i: number, patch: Partial<RouteDraft>) =>
    set({ routes: draft.routes.map((r, j) => (j === i ? { ...r, ...patch } : r)) });

  const submit = async () => {
    const local = validatePreAuth(draft);
    setErrors(local);
    if (Object.keys(local).length) return;
    const body = preAuthConfig(draft);
    if (body.mode === 'enforce') {
      const ok = await confirm({
        title:
          storedMode === 'enforce'
            ? `Change the enforced pre-auth guard on ${slug}?`
            : `Enforce the pre-auth guard on ${slug}?`,
        description: `${enforceEffect(body)}${checkLine ? ` 24-hour check — ${checkLine}` : ''}`,
        confirmLabel: storedMode === 'enforce' ? 'Save and enforce' : 'Enforce',
        destructive: true,
      });
      if (!ok) return;
    } else if (body.mode === 'off' && storedMode !== 'off') {
      const ok = await confirm({
        title: `Switch the pre-auth guard off for ${slug}?`,
        description:
          'No per-source limit runs before credentials are checked or the app wakes. The rate and route overrides are kept, so switching back on restores them.',
        confirmLabel: 'Switch off',
      });
      if (!ok) return;
    }
    try {
      await update.mutateAsync(body);
      toast({ kind: 'success', title: 'Pre-auth guard saved', description: preAuthSummary(body) });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'capability_not_released') setUnreleased(true);
      setProblem(err);
    }
  };

  const on = draft.mode !== 'off';
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm">
        <span className="text-muted-foreground">Stored: </span>
        {preAuthSummary(stored)}
      </p>

      {!editable && (
        <div className="flex flex-col gap-2 text-sm text-muted-foreground">
          {access.access === 'off' || unreleased ? (
            <p>
              Changing the pre-auth guard is not yet available to this account. The guard above
              keeps running as stored.
            </p>
          ) : access.access !== 'loading' ? (
            <CapabilityNotice capability={cap.capability} state={cap.state} onRetry={cap.refresh} />
          ) : null}
        </div>
      )}

      {editable && (
        <>
          <div className="flex flex-col gap-2">
            <SegmentedControl
              label="Pre-auth guard mode"
              value={draft.mode}
              options={MODES}
              onChange={(mode) => set({ mode })}
            />
            <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
              {draft.mode === 'off'
                ? 'Off: no per-source limit runs before credentials are checked. New apps start in observe.'
                : draft.mode === 'observe'
                  ? 'Observe records the requests a source sends over the limit without rejecting any of them. Check the observations below before enforcing.'
                  : enforceEffect(preAuthConfig(draft))}
            </p>
            {toEnforce && (
              <p className="flex flex-wrap items-center gap-2 text-xs" role="status">
                <span className="label-mono text-muted-foreground">24-hour check</span>
                {suggestion && ADVICE[suggestion.status] ? (
                  <>
                    <Pill
                      label={ADVICE[suggestion.status].title}
                      color={ADVICE[suggestion.status].color}
                    />
                    <span className="text-muted-foreground">{suggestion.reason}</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">{checkLine}</span>
                )}
              </p>
            )}
          </div>

          {on && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <NumberInput
                  label="Requests per second, per source"
                  hint="No more than your plan's request rate."
                  error={errors.requests_per_second}
                  value={draft.requests_per_second}
                  onChange={(requests_per_second) => set({ requests_per_second })}
                />
                <NumberInput
                  label="Burst, per source"
                  hint="Requests one source may send at once. No more than your plan's burst."
                  error={errors.burst}
                  value={draft.burst}
                  onChange={(burst) => set({ burst })}
                />
              </div>

              <section className="flex flex-col gap-3">
                <div>
                  <p className="label-mono text-muted-foreground">Route overrides</p>
                  <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
                    A stricter limit for one exact method and public path, such as a login form.
                    Each has its own bucket, and its requests still count against the app-wide
                    limit. Paths match before edge rewrites. Up to {PRE_AUTH_MAX_ROUTES}.
                  </p>
                </div>
                {errors.routes && <FieldError>{errors.routes}</FieldError>}
                {draft.routes.map((r, i) => (
                  <RouteEditor
                    key={i}
                    index={i}
                    route={r}
                    errors={errors}
                    onChange={(patch) => setRoute(i, patch)}
                    onRemove={() => set({ routes: draft.routes.filter((_, j) => j !== i) })}
                  />
                ))}
                <div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    disabled={draft.routes.length >= PRE_AUTH_MAX_ROUTES}
                    onClick={() =>
                      set({
                        routes: [
                          ...draft.routes,
                          emptyRoute({ rps: draft.requests_per_second, burst: draft.burst }),
                        ],
                      })
                    }
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add route override
                  </Button>
                </div>
              </section>
            </>
          )}

          {problem !== null && (
            <div role="alert" className="flex flex-col gap-1 text-sm">
              <span style={{ color: 'var(--status-critical)' }}>{explain(problem)}</span>
              <ProblemHelp error={problem} />
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
            <Button
              size="sm"
              variant="ghost"
              disabled={unchanged || update.isPending}
              onClick={() => {
                setDraft(preAuthDraft(stored, fallback));
                setErrors({});
                setProblem(null);
              }}
            >
              Discard changes
            </Button>
            <Button
              size="sm"
              disabled={unchanged || update.isPending}
              onClick={() => void submit()}
              aria-label="Save guard"
            >
              {update.isPending ? 'Saving…' : 'Save guard'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function RouteEditor({
  index,
  route: r,
  errors,
  onChange,
  onRemove,
}: {
  index: number;
  route: RouteDraft;
  errors: Record<string, string>;
  onChange: (patch: Partial<RouteDraft>) => void;
  onRemove: () => void;
}) {
  const n = index + 1;
  const err = (field: string) => errors[`routes.${index}.${field}`];
  const where = `${r.method} ${r.path.trim() || '(no path)'}`;
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <div className="flex items-start gap-3">
        <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-[7rem_minmax(0,1fr)]">
          <Labeled label="Method" aria={`Route ${n} method`}>
            {(id) => (
              <select
                id={id}
                aria-label={`Route ${n} method`}
                value={r.method}
                onChange={(e) => onChange({ method: e.target.value as RouteDraft['method'] })}
                className={INPUT}
              >
                {PRE_AUTH_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            )}
          </Labeled>
          <Labeled
            label="Path"
            aria={`Route ${n} path`}
            error={err('path')}
            hint="Exact, as the client sends it."
          >
            {(id) => (
              <input
                id={id}
                aria-label={`Route ${n} path`}
                aria-invalid={err('path') ? true : undefined}
                value={r.path}
                placeholder="/login"
                onChange={(e) => onChange({ path: e.target.value })}
                className={cn(INPUT, 'font-mono')}
              />
            )}
          </Labeled>
        </div>
        <button
          type="button"
          aria-label={`Remove route override ${where}`}
          onClick={onRemove}
          className="mt-7 text-muted-foreground transition-colors hover:text-foreground"
        >
          <Trash className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <NumberInput
          label="Requests per second"
          aria={`Route ${n} requests per second`}
          error={err('requests_per_second')}
          value={r.requests_per_second}
          onChange={(requests_per_second) => onChange({ requests_per_second })}
        />
        <NumberInput
          label="Burst"
          aria={`Route ${n} burst`}
          error={err('burst')}
          value={r.burst}
          onChange={(burst) => onChange({ burst })}
        />
        <CoordinationSelect
          label="Request budget"
          aria={`Route ${n} coordination`}
          value={r.coordination}
          onChange={(coordination) => onChange({ coordination })}
        />
      </div>
      <SwitchRow
        label="Count failed responses"
        aria={`Route ${n} failed responses`}
        hint="A second budget only the app's selected 4xx answers spend; once a source spends it, its requests are refused before authentication or a wake. Successful responses never spend it."
        checked={r.failed}
        onChange={(failed) => onChange({ failed })}
      />
      {r.failed && (
        <div className="grid gap-3 sm:grid-cols-2">
          <NumberInput
            label="Failures per minute"
            aria={`Route ${n} failures per minute`}
            hint="Refill rate; at most the route's rate times 60."
            error={err('failures_per_minute')}
            value={r.failures_per_minute}
            onChange={(failures_per_minute) => onChange({ failures_per_minute })}
          />
          <NumberInput
            label="Failure burst"
            aria={`Route ${n} failure burst`}
            hint="Consecutive failures allowed; at most the route's burst."
            error={err('failed_burst')}
            value={r.failed_burst}
            onChange={(failed_burst) => onChange({ failed_burst })}
          />
          <StringListField
            label="Counted statuses"
            hint="Up to four 4xx codes, not 429. Enter or comma to add."
            error={err('statuses')}
            value={r.statuses}
            onChange={(statuses) => onChange({ statuses })}
            placeholder="Default: 401 and 403"
          />
          <CoordinationSelect
            label="Failure budget"
            aria={`Route ${n} failure coordination`}
            value={r.failed_coordination}
            onChange={(failed_coordination) => onChange({ failed_coordination })}
          />
        </div>
      )}
      {(r.observe_targets || (r.method === 'POST' && r.failed)) && (
        <SwitchRow
          label="Observe login targets"
          aria={`Route ${n} observe targets`}
          hint="Counts failures against one login identifier across addresses, from the X-Gregale-Abuse-Target digest your app returns. A signal only: it never blocks. Needs central request coordination."
          checked={r.observe_targets}
          onChange={(observe_targets) => onChange({ observe_targets })}
          error={err('observe_targets')}
        />
      )}
    </div>
  );
}

function FieldError({ children }: { children: ReactNode }) {
  return (
    <span className="text-xs" style={{ color: 'var(--status-critical)' }} role="alert">
      {children}
    </span>
  );
}

/** A visible label with an accessible name that says which route it belongs to. */
function Labeled({
  label,
  aria,
  hint,
  error,
  children,
}: {
  label: string;
  aria: string;
  hint?: string;
  error?: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-field={aria}>
      <label htmlFor={id} className="label-mono text-muted-foreground">
        {label}
      </label>
      {children(id)}
      {error ? (
        <FieldError>{error}</FieldError>
      ) : hint ? (
        <span className="text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </div>
  );
}

function NumberInput({
  label,
  aria = label,
  hint,
  error,
  value,
  onChange,
}: {
  label: string;
  aria?: string;
  hint?: string;
  error?: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
}) {
  return (
    <Labeled label={label} aria={aria} hint={hint} error={error}>
      {(id) => (
        <input
          id={id}
          type="number"
          min={1}
          aria-label={aria}
          aria-invalid={error ? true : undefined}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
          className={cn(INPUT, 'font-mono [font-variant-numeric:tabular-nums]')}
        />
      )}
    </Labeled>
  );
}

function CoordinationSelect({
  label,
  aria,
  value,
  onChange,
}: {
  label: string;
  aria: string;
  value: 'local' | 'central';
  onChange: (v: 'local' | 'central') => void;
}) {
  return (
    <Labeled
      label={label}
      aria={aria}
      hint={
        value === 'central'
          ? 'One budget across every gateway, kept in 1,024 shards per route: colliding sources share it.'
          : 'Each gateway keeps its own budget.'
      }
    >
      {(id) => (
        <select
          id={id}
          aria-label={aria}
          value={value}
          onChange={(e) => onChange(e.target.value as 'local' | 'central')}
          className={INPUT}
        >
          <option value="local">Per gateway</option>
          <option value="central">Shared (central)</option>
        </select>
      )}
    </Labeled>
  );
}

function SwitchRow({
  label,
  aria,
  hint,
  checked,
  onChange,
  error,
}: {
  label: string;
  aria: string;
  hint: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  error?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-6 border-t border-border pt-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-0.5 max-w-lg text-xs leading-relaxed text-muted-foreground">{hint}</p>
        {error && <FieldError>{error}</FieldError>}
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        aria-label={aria}
        className="mt-0.5 data-[state=checked]:bg-brand"
      />
    </div>
  );
}
