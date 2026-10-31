import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { FIELD, FieldError, Select, fieldErrorProps } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/api/errors';
import { useAppDeployments, useUpdateApp, type App } from '@/lib/api/queries';
import type { Plan } from '@/lib/auth';
import {
  RESTART_POLICIES,
  STOP_SIGNALS,
  defaultRestartPolicy,
  effectiveLifecycle,
  effectiveProbes,
  gracePeriodSeconds,
  lifecycleLimits,
  servingDeployment,
  type ProbeView,
} from '@/lib/health-probes';
import { InlinePhase, Panel, queryPhase } from './primitives';

/**
 * Health probes and the restart contract (ledger C47).
 *
 * Probes are fixed per deployment (`override_healthcheck`,
 * `override_readiness_probe`, `override_liveness_probe` on the deployment,
 * faas pkg/api/dto.go:2777), so they are shown read-only from the serving
 * deployment, with the steps that set them. The restart contract is app
 * state that `PATCH /v1/apps/{slug}` writes (dto.go:1033, apidserver
 * lifecycle.go:239), so it is edited here, in its own PATCH: none of it
 * converges live the way the Runtime form's policies do.
 */

const PLAN_NAMES: Record<Plan, string> = {
  free: 'Free',
  hobby: 'Hobby',
  pro: 'Pro',
  scale: 'Scale',
};

const PROBE_LINES: Record<'startup' | 'readiness' | 'liveness', string> = {
  startup: 'Gates a new instance: no traffic until it passes, within the startup deadline below.',
  readiness:
    'While running, an instance that fails it is taken out of routing without restarting, and comes back when it passes.',
  liveness:
    'While running, an instance that fails it repeatedly is destroyed and cold-booted. Three such restarts in five minutes park the app.',
};

function Tag({ kind }: { kind: ProbeView['kind'] }) {
  if (kind === 'set') return null;
  return (
    <span className="rounded border border-border px-1.5 py-px font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
      {kind === 'off' ? 'off' : 'default'}
    </span>
  );
}

function ProbeRow({ label, view, line }: { label: string; view: ProbeView; line: string }) {
  return (
    <li aria-label={label} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
      <p className="label-mono text-muted-foreground">{label}</p>
      <p className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm">{view.action}</span>
        <Tag kind={view.kind} />
      </p>
      {view.timing && (
        <p className="font-mono text-xs text-muted-foreground [font-variant-numeric:tabular-nums]">
          {view.timing}
        </p>
      )}
      <p className="text-xs text-muted-foreground">{line}</p>
    </li>
  );
}

const Code = ({ children }: { children: string }) => (
  <code className="whitespace-nowrap font-mono text-foreground">{children}</code>
);

function Probes({ app }: { app: App }) {
  const query = useAppDeployments(app.slug);
  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const phase = queryPhase({ error: query.error, loading: query.isPending });
  const probes = effectiveProbes(app, servingDeployment(items));

  return (
    <section aria-labelledby="health-probes-heading" className="flex flex-col gap-3">
      <h3 id="health-probes-heading" className="text-sm font-medium">
        Probes
      </h3>
      {phase !== 'ready' ? (
        <InlinePhase
          phase={phase}
          error={query.error}
          loadingMessage="Reading the serving deployment…"
          onRetry={() => void query.refetch()}
        />
      ) : !probes ? (
        <p className="text-sm text-muted-foreground">
          No deployment is serving yet. Its probes are set when it deploys.
        </p>
      ) : (
        <ul aria-label="Probes" className="flex flex-col divide-y divide-border">
          <ProbeRow label="Startup check" view={probes.startup} line={PROBE_LINES.startup} />
          <ProbeRow label="Readiness probe" view={probes.readiness} line={PROBE_LINES.readiness} />
          <ProbeRow label="Liveness probe" view={probes.liveness} line={PROBE_LINES.liveness} />
        </ul>
      )}
      <p className="text-xs leading-relaxed text-muted-foreground">
        Probes are fixed per deployment and change with the next one. Set the startup check with{' '}
        <Code>hosting.health</Code> in gregale.yaml or{' '}
        <Code>gregale deploy --healthcheck-path</Code>. Readiness and liveness probes are{' '}
        <Code>overrides.readiness_probe</Code> and <Code>overrides.liveness_probe</Code> on an image
        deployment, or a <Code>healthcheck:</Code> on a Compose service. A Dockerfile{' '}
        <Code>HEALTHCHECK</Code> replaces the default liveness probe. See{' '}
        <a href="/docs/deploy-overrides" className="text-brand underline-offset-2 hover:underline">
          Deployment overrides
        </a>
        .
      </p>
    </section>
  );
}

type Draft = {
  restart_policy: string;
  max_retries: string;
  startup_deadline_s: string;
  stop_signal: string;
  stop_grace_period_s: string;
};

const num = (n: number | null | undefined) => (n ? String(n) : '');

function draftFrom(app: App): Draft {
  const m = app.manifest;
  return {
    restart_policy: m?.restart_policy ?? '',
    max_retries: num(m?.max_retries),
    startup_deadline_s: num(m?.startup_deadline_s),
    stop_signal: m?.stop_signal ?? '',
    stop_grace_period_s: num(gracePeriodSeconds(m?.stop_grace_period)),
  };
}

const NUMERIC = ['max_retries', 'startup_deadline_s', 'stop_grace_period_s'] as const;
type Numeric = (typeof NUMERIC)[number];

function NumberField({
  id,
  label,
  value,
  placeholder,
  error,
  hint,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  error?: string;
  hint: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="label-mono text-muted-foreground">
        {label}
      </label>
      <input
        id={id}
        type="number"
        min={0}
        inputMode="numeric"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        {...fieldErrorProps(error, `${id}-error`)}
        className={`${FIELD} w-full [font-variant-numeric:tabular-nums]`}
      />
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
      <span className="text-xs text-muted-foreground">{hint}</span>
    </div>
  );
}

function RestartContract({ app, plan }: { app: App; plan: Plan | undefined }) {
  const { toast } = useToast();
  const update = useUpdateApp(app.slug);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(app));
  const [failure, setFailure] = useState('');
  const set = (key: keyof Draft, value: string) => setDraft((d) => ({ ...d, [key]: value }));
  const eff = effectiveLifecycle(app, plan);
  const limits = lifecycleLimits(plan);
  const planName = plan ? PLAN_NAMES[plan] : '';
  const isWorker = eff.mode === 'worker';

  const caps: Record<Numeric, number | undefined> = {
    max_retries: limits?.maxRetries,
    startup_deadline_s: limits?.startupDeadlineS,
    stop_grace_period_s: limits?.stopGraceS,
  };
  const errors = Object.fromEntries(
    NUMERIC.map((key) => {
      const raw = draft[key];
      if (raw === '') return [key, undefined];
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0) return [key, 'A whole number, 0 or more.'];
      const cap = caps[key];
      const unit = key === 'max_retries' ? '' : ' s';
      if (cap !== undefined && n > cap)
        return [key, `At most ${cap}${unit} on the ${planName} plan.`];
      return [key, undefined];
    })
  ) as Record<Numeric, string | undefined>;
  const blocked = Object.values(errors).some(Boolean);

  // Only what changed; an empty value is apid's "inherit the default".
  const changes = useMemo(() => {
    const base = draftFrom(app);
    const out: Record<string, string | number> = {};
    for (const key of Object.keys(draft) as (keyof Draft)[]) {
      if (draft[key] === base[key]) continue;
      out[key] = (NUMERIC as readonly string[]).includes(key)
        ? Number(draft[key] || 0)
        : draft[key];
    }
    return out;
  }, [app, draft]);
  const dirty = Object.keys(changes).length > 0;

  const save = () => {
    if (!dirty || blocked || update.isPending) return;
    setFailure('');
    update
      .mutateAsync(changes)
      .then((next) => {
        setDraft(draftFrom(next));
        toast({
          kind: 'success',
          title: 'Restart settings saved',
          description:
            'Restart policy and retries apply from the next deploy, the startup deadline from the next start, the stop settings from the next stop.',
        });
      })
      .catch((err: unknown) => setFailure(errorMessage(err)));
  };

  const policies = RESTART_POLICIES.filter((p) => !(eff.mode === 'job' && p === 'always'));
  const shown = (key: keyof Draft, fallback: string | number | undefined) => draft[key] || fallback;
  const placeholder = (value: number | undefined) =>
    value === undefined ? 'Plan default' : `${value} (default)`;
  const onPlan = (value: number | undefined, unit = '') =>
    value === undefined ? 'the plan default' : `${value}${unit} on ${planName}`;

  return (
    <section aria-labelledby="restart-contract-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="restart-contract-heading" className="text-sm font-medium">
          Restarts and stopping
        </h3>
        <Button size="sm" disabled={!dirty || blocked} busy={update.isPending} onClick={save}>
          Save restart settings
        </Button>
      </div>
      {failure && (
        <p role="alert" className="text-xs" style={{ color: 'var(--status-critical)' }}>
          {failure}
        </p>
      )}
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="restart-policy" className="label-mono text-muted-foreground">
            Restart policy
          </label>
          <Select
            id="restart-policy"
            value={draft.restart_policy}
            onChange={(e) => set('restart_policy', e.target.value)}
            className="w-full font-mono"
          >
            <option value="">Default ({defaultRestartPolicy(eff.mode)})</option>
            {policies.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
          <span className="text-xs text-muted-foreground">
            When the main process exits: never restart, restart after a non-zero exit, always
            restart, or always unless it was stopped on purpose. The default follows the app’s{' '}
            {eff.mode} mode.
          </span>
        </div>
        <NumberField
          id="max-retries"
          label="Max retries"
          value={draft.max_retries}
          placeholder={placeholder(limits?.maxRetries)}
          error={errors.max_retries}
          hint={`Restarts in a row before the instance is marked failed as a crash loop. Default and limit: ${onPlan(limits?.maxRetries)}.`}
          onChange={(v) => set('max_retries', v)}
        />
        <NumberField
          id="startup-deadline"
          label="Startup deadline (s)"
          value={draft.startup_deadline_s}
          placeholder={placeholder(limits?.startupDeadlineS)}
          error={errors.startup_deadline_s}
          hint={`Time an instance has to pass its startup check before the start fails. Default and limit: ${onPlan(limits?.startupDeadlineS, ' s')}.`}
          onChange={(v) => set('startup_deadline_s', v)}
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="stop-signal" className="label-mono text-muted-foreground">
            Stop signal
          </label>
          <Select
            id="stop-signal"
            value={draft.stop_signal}
            onChange={(e) => set('stop_signal', e.target.value)}
            className="w-full font-mono"
          >
            <option value="">Default (SIGTERM)</option>
            {STOP_SIGNALS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
          <span className="text-xs text-muted-foreground">
            Sent to a worker or job when it is stopped, so it can finish its work. Request and
            service instances are snapshotted instead.
          </span>
        </div>
        <NumberField
          id="stop-grace"
          label="Grace period (s)"
          value={draft.stop_grace_period_s}
          placeholder={placeholder(30)}
          error={errors.stop_grace_period_s}
          hint={`How long a stopping worker or job has after the signal before it is killed. Limit: ${onPlan(limits?.stopGraceS, ' s')}.${isWorker ? ' A worker’s drain_timeout in gregale.yaml sets the same value.' : ''}`}
          onChange={(v) => set('stop_grace_period_s', v)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-xs leading-relaxed text-muted-foreground">
          A <Code>lifecycle:</Code> block in gregale.yaml is applied on every deploy and replaces
          what is saved here
          {isWorker ? (
            <>
              ; so do <Code>worker.drain_timeout</Code> and <Code>worker.stop_signal</Code>
            </>
          ) : null}
          . The same settings there:
        </p>
        <pre
          aria-label="gregale.yaml lifecycle block"
          className="overflow-x-auto rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs leading-relaxed"
        >
          {[
            'lifecycle:',
            `  restart_policy: ${shown('restart_policy', defaultRestartPolicy(eff.mode))}`,
            `  max_retries: ${shown('max_retries', limits?.maxRetries ?? 0)}`,
            `  startup_deadline_s: ${shown('startup_deadline_s', limits?.startupDeadlineS ?? 0)}`,
            `  stop_signal: ${shown('stop_signal', 'SIGTERM')}`,
            `  stop_grace_period_s: ${shown('stop_grace_period_s', 30)}`,
          ].join('\n')}
        </pre>
      </div>
    </section>
  );
}

export function HealthProbes({ app, plan }: { app: App; plan: Plan | undefined }) {
  return (
    <Panel
      title="Health and restarts"
      description="How an instance is judged ready and alive, and how it restarts and stops."
    >
      <div className="flex flex-col gap-8">
        <Probes app={app} />
        <RestartContract app={app} plan={plan} />
      </div>
    </Panel>
  );
}
