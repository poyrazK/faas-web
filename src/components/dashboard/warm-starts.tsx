import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { CheckCircle, WarningTriangle } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { FIELD, FieldError, fieldErrorProps } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { useCapabilityAccess } from '@/lib/api/capabilities';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useAppInstances, useUpdateApp, type App } from '@/lib/api/queries';
import { useWorkspaceTarget } from '@/lib/api/workspace-apps';
import type { Plan } from '@/lib/auth';
import { executionMode } from '@/lib/health-probes';
import {
  MIN_MS,
  MIN_REQUESTS,
  pausedNow,
  warmApplies,
  warmChanges,
  warmDraft,
  warmErrors,
  warmPoolAllowed,
  warmSnapshotAllowed,
  type WarmDraft,
} from '@/lib/warm-starts';
import { GATE_MESSAGES } from './capability-gate';
import { MaturityLabel } from './maturity-label';
import { StatusTag } from './postgres-shared';
import { InlinePhase, Panel, queryPhase } from './primitives';
import { ProblemHelp } from './problem-help';

/**
 * Warm pool and warm snapshots (ledger C50, beta, catalog `warm-pool`).
 *
 * A warm pool keeps paused VMs restored from the app's latest published
 * snapshot, so a wake resumes one (faas sched/warm_pool.go:20-27,
 * warm_pool_promote.go:16-19); they reserve memory and bill like a running
 * instance (state/machine.go:190-200). A warm snapshot is a second capture
 * taken when an instance that has warmed up parks, preferred over the init
 * snapshot on wake (docs/adr/071). Both are `PATCH /v1/apps/{slug}` fields,
 * saved here in their own request. The pool is dropped while the app's
 * billing subject, its organization for a company app, is at its spend cap
 * (warm_pool.go:163-170, ADR-20261030093512); the app read does not report
 * that, so the instance list's paused rows are shown against the size asked
 * for instead.
 */

const CAPABILITY = 'warm-pool';
const PLAN_NAMES: Record<Plan, string> = {
  free: 'Free',
  hobby: 'Hobby',
  pro: 'Pro',
  scale: 'Scale',
};
const PLAN_CODES = new Set(['plan_warm_pool_not_allowed', 'plan_warm_snapshot_not_allowed']);

function ComparePlans() {
  return (
    <Link to="/dashboard/plans" className="text-brand underline-offset-2 hover:underline">
      Compare plans
    </Link>
  );
}

function PlanGateNote({ feature, plans, plan }: { feature: string; plans: string; plan?: Plan }) {
  return (
    <p className="text-sm text-muted-foreground">
      {feature} are available on {plans}.{plan ? ` This account is on ${PLAN_NAMES[plan]}.` : ''}{' '}
      <ComparePlans />
    </p>
  );
}

function NumberField({
  id,
  label,
  value,
  min,
  max,
  error,
  hint,
  placeholder,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  min: number;
  max: number;
  error?: string;
  hint: string;
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="label-mono text-muted-foreground">
        {label}
      </label>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        inputMode="numeric"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        {...fieldErrorProps(error, `${id}-error`)}
        className={`${FIELD} w-full [font-variant-numeric:tabular-nums]`}
      />
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
      <span className="text-xs leading-relaxed text-muted-foreground">{hint}</span>
    </div>
  );
}

/** The paused rows the scheduler holds now, against the size asked for. */
function PausedNow({ slug, desired }: { slug: string; desired: number }) {
  const query = useAppInstances(slug);
  const phase = queryPhase({ error: query.error, loading: query.isPending });
  if (phase !== 'ready' && phase !== 'empty')
    return (
      <InlinePhase
        phase={phase}
        error={query.error}
        loadingMessage="Reading paused instances…"
        onRetry={() => void query.refetch()}
      />
    );
  const count = pausedNow(query.data ?? []);
  const full = count >= desired;
  return (
    <p className="flex flex-wrap items-center gap-2">
      <StatusTag tone={full ? 'good' : 'warning'} icon={full ? CheckCircle : WarningTriangle}>
        {`${count} of ${desired} paused now`}
      </StatusTag>
    </p>
  );
}

function WarmForm({
  app,
  poolOk,
  snapshotsOk,
  plan,
  onNotReleased,
}: {
  app: App;
  poolOk: boolean;
  snapshotsOk: boolean;
  plan: Plan | undefined;
  onNotReleased: () => void;
}) {
  const { toast } = useToast();
  const workspace = useWorkspaceTarget();
  const update = useUpdateApp(app.slug);
  const [draft, setDraft] = useState<WarmDraft>(() => warmDraft(app));
  const [failure, setFailure] = useState<unknown>(null);
  const set = <K extends keyof WarmDraft>(key: K, value: WarmDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const errors = warmErrors(draft, app);
  const blocked = Object.values(errors).some(Boolean);
  const changes = useMemo(() => warmChanges(app, draft), [app, draft]);
  const dirty = Object.keys(changes).length > 0;
  const max = app.max_concurrency;
  const savedPool = app.warm_pool_size ?? 0;
  const capHolder = workspace.org ? workspace.label : 'your account';

  const save = () => {
    if (!dirty || blocked || update.isPending) return;
    setFailure(null);
    update
      .mutateAsync(changes)
      .then((next) => {
        setDraft(warmDraft(next));
        const notes = [
          'warm_pool_size' in changes &&
            'The scheduler fills or drains the pool on its next passes.',
          Object.keys(changes).some((key) => key.startsWith('warm_snapshot')) &&
            'Warm snapshot settings apply the next time an instance parks.',
        ].filter(Boolean);
        toast({ kind: 'success', title: 'Warm settings saved', description: notes.join(' ') });
      })
      .catch((err: unknown) => {
        setFailure(err);
        if (err instanceof ApiError && err.code === 'capability_not_released') onNotReleased();
      });
  };

  return (
    <div className="flex flex-col gap-6">
      {failure !== null && (
        <div className="flex flex-col gap-1">
          <p role="alert" className="text-xs" style={{ color: 'var(--status-critical)' }}>
            {errorMessage(failure)}
          </p>
          <ProblemHelp error={failure} />
          {failure instanceof ApiError && PLAN_CODES.has(failure.code) && (
            <span className="text-xs">
              <ComparePlans />
            </span>
          )}
        </div>
      )}

      <fieldset aria-label="Warm pool" className="flex min-w-0 flex-col gap-3">
        <legend className="sr-only">Warm pool</legend>
        <p className="text-sm font-medium">Warm pool</p>
        {poolOk ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField
                id="warm-pool-size"
                label="Warm pool size"
                value={draft.warm_pool_size}
                min={0}
                max={max}
                error={errors.warm_pool_size}
                hint={`Paused instances restored from the app’s latest snapshot and held in memory, so a wake resumes one instead of restoring from disk. They are billed while paused, as running instances are. 0 turns the pool off; at most ${max}, this app’s max concurrency.`}
                onChange={(v) => set('warm_pool_size', v)}
              />
              {savedPool > 0 && (
                <div className="flex flex-col gap-1.5">
                  <span className="label-mono text-muted-foreground">Ready now</span>
                  <PausedNow slug={app.slug} desired={savedPool} />
                </div>
              )}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              The pool fills from the latest published snapshot, a few instances per scheduler pass,
              and stays empty until a deployment has produced one. It is emptied while the app is
              not active, and whenever {capHolder} reaches its{' '}
              <Link to="/dashboard/usage" className="text-brand underline-offset-2 hover:underline">
                spend cap
              </Link>
              , until the cap is raised or the month rolls over.
              {workspace.org ? ' A company app is capped by its organization, not by you.' : ''}
            </p>
          </>
        ) : (
          <PlanGateNote feature="Warm pools" plans="Hobby, Pro and Scale" plan={plan} />
        )}
      </fieldset>

      <fieldset aria-label="Warm snapshots" className="flex min-w-0 flex-col gap-3">
        <legend className="sr-only">Warm snapshots</legend>
        {snapshotsOk ? (
          <>
            <div className="flex items-start justify-between gap-6">
              <div>
                <p className="text-sm font-medium">Warm snapshots</p>
                <p className="mt-1 max-w-lg text-xs leading-relaxed text-muted-foreground">
                  When an instance that has warmed up parks, capture a second snapshot from it, so
                  the next wake restores a process whose caches and JIT are already warm. The init
                  snapshot from the deploy stays the fallback.
                </p>
              </div>
              <Switch
                checked={draft.warm_snapshot_enabled}
                onCheckedChange={(on) => set('warm_snapshot_enabled', on)}
                aria-label="Warm snapshots"
                className="mt-1 data-[state=checked]:bg-brand"
              />
            </div>
            {draft.warm_snapshot_enabled && (
              <div className="grid gap-4 sm:grid-cols-2">
                <NumberField
                  id="warm-min-ms"
                  label="Capture after (ms)"
                  value={draft.warm_snapshot_min_ms}
                  min={MIN_MS.min}
                  max={MIN_MS.max}
                  placeholder="Not set"
                  error={errors.warm_snapshot_min_ms}
                  hint="How long the instance has been ready before a warm capture. 100 to 60,000."
                  onChange={(v) => set('warm_snapshot_min_ms', v)}
                />
                <NumberField
                  id="warm-min-requests"
                  label="Capture after (requests)"
                  value={draft.warm_snapshot_min_requests}
                  min={MIN_REQUESTS.min}
                  max={MIN_REQUESTS.max}
                  placeholder="Not set"
                  error={errors.warm_snapshot_min_requests}
                  hint="Requests the instance has served before a warm capture. 1 to 100."
                  onChange={(v) => set('warm_snapshot_min_requests', v)}
                />
              </div>
            )}
            {draft.warm_snapshot_enabled && app.manifest?.before_checkpoint?.path && (
              <p
                role="note"
                className="flex items-start gap-2 rounded-md border px-3 py-2 text-xs leading-relaxed"
                style={{
                  color: 'var(--status-warning)',
                  borderColor: 'color-mix(in oklab, var(--status-warning) 35%, transparent)',
                }}
              >
                <WarningTriangle aria-hidden className="mt-px h-3.5 w-3.5 shrink-0" />
                <span>
                  Warm snapshots are on, but none is captured while the app has a before_checkpoint
                  hook: a warm capture resumes the same guest. Wakes restore the init snapshot.
                </span>
              </p>
            )}
          </>
        ) : (
          <>
            <p className="text-sm font-medium">Warm snapshots</p>
            <PlanGateNote feature="Warm snapshots" plans="Pro and Scale" plan={plan} />
          </>
        )}
      </fieldset>

      {(poolOk || snapshotsOk) && (
        <div className="flex justify-end">
          <Button size="sm" disabled={!dirty || blocked} busy={update.isPending} onClick={save}>
            Save warm settings
          </Button>
        </div>
      )}
    </div>
  );
}

export function WarmStarts({ app, plan }: { app: App; plan: Plan | undefined }) {
  const { access, capability, refresh } = useCapabilityAccess(CAPABILITY);
  const entitled = access !== 'plan-not-entitled';
  return (
    <Panel
      title="Warm starts"
      description="Keep paused instances ready to resume, and snapshot a process once it has warmed up, so a wake skips the cold path."
      actions={<MaturityLabel capability={capability} />}
    >
      {access !== 'on' && entitled ? (
        <div className="flex flex-col gap-3">
          <div
            role="status"
            className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground"
          >
            <span>{GATE_MESSAGES[access]}</span>
            {access === 'registry-error' && (
              <button type="button" className="text-brand underline" onClick={refresh}>
                Retry
              </button>
            )}
          </div>
          {access !== 'loading' && (
            <p className="text-xs text-muted-foreground">
              Saved settings still apply: warm pool size {app.warm_pool_size ?? 0}, warm snapshots{' '}
              {app.warm_snapshot_enabled ? 'on' : 'off'}.
            </p>
          )}
        </div>
      ) : !warmApplies(app) ? (
        <p className="text-sm text-muted-foreground">
          Warm pools and warm snapshots apply to request and service apps, which are snapshotted
          when they park. This app runs in {executionMode(app)} mode, so it keeps no pool.
        </p>
      ) : (
        <WarmForm
          app={app}
          plan={plan}
          poolOk={entitled && warmPoolAllowed(plan)}
          snapshotsOk={entitled && warmSnapshotAllowed(plan)}
          onNotReleased={refresh}
        />
      )}
    </Panel>
  );
}
