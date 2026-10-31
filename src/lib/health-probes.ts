import type { App, Deployment } from '@/lib/api/queries';
import type { Plan } from '@/lib/auth';

/**
 * The effective health probes and restart contract of an app, resolved the
 * way faas resolves them, so the console can mark which values are defaults.
 *
 * Two sources: the app's lifecycle settings (`AppResponse.manifest`, written
 * by `PATCH /v1/apps/{slug}` and by a gregale.yaml `lifecycle:` block), and
 * the serving deployment's probe overrides (`override_healthcheck`,
 * `override_readiness_probe`, `override_liveness_probe`), which are fixed per
 * deployment. Nothing here is observed: these are the settings, not results.
 */

export type ExecutionMode = 'request' | 'service' | 'worker' | 'job';
export type RestartPolicy = 'no' | 'on-failure' | 'always' | 'unless-stopped';

export const RESTART_POLICIES: RestartPolicy[] = ['no', 'on-failure', 'always', 'unless-stopped'];

/** The signals guest-init delivers (faas gregalemanifest/manifest.go:1771). */
export const STOP_SIGNALS = ['SIGTERM', 'SIGINT', 'SIGQUIT', 'SIGHUP', 'SIGUSR1', 'SIGUSR2'];

/**
 * Per-plan lifecycle defaults, which are also the caps apid enforces
 * (faas pkg/api/limits.go:5115, 5555, 5991, 6402; appmanifest.go:780).
 */
const PLAN_LIMITS: Record<
  Plan,
  { stopGraceS: number; startupDeadlineS: number; maxRetries: number }
> = {
  free: { stopGraceS: 15, startupDeadlineS: 15, maxRetries: 3 },
  hobby: { stopGraceS: 30, startupDeadlineS: 30, maxRetries: 5 },
  pro: { stopGraceS: 60, startupDeadlineS: 30, maxRetries: 10 },
  scale: { stopGraceS: 120, startupDeadlineS: 30, maxRetries: 20 },
};

export function lifecycleLimits(plan: Plan | undefined) {
  return plan ? PLAN_LIMITS[plan] : undefined;
}

/**
 * The scheduler stops a worker or job with 30 s of grace when none is set
 * (faas pkg/sched/lifecycle.go:1541, engine.go:7807); the plan value above is
 * only the ceiling.
 */
const DEFAULT_STOP_GRACE_S = 30;

/** Per-mode restart default (faas pkg/api/appmanifest.go EffectiveRestartPolicy). */
export function defaultRestartPolicy(mode: ExecutionMode): RestartPolicy {
  if (mode === 'job') return 'no';
  if (mode === 'service' || mode === 'worker') return 'always';
  return 'on-failure';
}

export function executionMode(app: App): ExecutionMode {
  return app.manifest?.execution_mode ?? 'request';
}

const UNIT_NS: Record<string, number> = {
  ns: 1,
  us: 1e3,
  µs: 1e3,
  ms: 1e6,
  s: 1e9,
  m: 60e9,
  h: 3600e9,
};

/**
 * `stop_grace_period` is a Go time.Duration with no JSON marshaller, so apid
 * sends integer nanoseconds; the spec calls it a duration string. Both read
 * as whole seconds, rounded up as apid stores them (lifecycle.go:154).
 */
export function gracePeriodSeconds(raw: unknown): number {
  let ns = 0;
  if (typeof raw === 'number' && Number.isFinite(raw)) ns = raw;
  else if (typeof raw === 'string' && raw.trim()) {
    const parts = [...raw.trim().matchAll(/(\d+(?:\.\d+)?)(ns|us|µs|ms|s|m|h)/g)];
    if (parts.map((p) => p[0]).join('') !== raw.trim()) return 0;
    ns = parts.reduce((sum, [, n, unit]) => sum + Number(n) * UNIT_NS[unit], 0);
  }
  return ns > 0 ? Math.ceil(ns / 1e9) : 0;
}

export type Setting<T> = { value: T | undefined; isDefault: boolean };

const setOr = <T>(stored: T | undefined | null | '' | 0, fallback: T | undefined): Setting<T> =>
  stored ? { value: stored, isDefault: false } : { value: fallback, isDefault: true };

export function effectiveLifecycle(app: App, plan: Plan | undefined) {
  const m = app.manifest;
  const mode = executionMode(app);
  const limits = lifecycleLimits(plan);
  return {
    mode,
    restartPolicy: setOr<RestartPolicy>(m?.restart_policy, defaultRestartPolicy(mode)),
    maxRetries: setOr(m?.max_retries, limits?.maxRetries),
    startupDeadlineS: setOr(m?.startup_deadline_s, limits?.startupDeadlineS),
    stopSignal: setOr(m?.stop_signal, 'SIGTERM'),
    stopGraceS: setOr(gracePeriodSeconds(m?.stop_grace_period), DEFAULT_STOP_GRACE_S),
  };
}

/**
 * The release most production requests reach: a live row in the default
 * scope (omitted scope is `default`) with the highest traffic_percent above 0,
 * the newer one on a tie. A live row at 0% is a staged or scheduled release,
 * and another scope is another environment, so neither counts; with no such
 * row the answer is "none", not a guess.
 */
export function servingDeployment(deployments: Deployment[]): Deployment | undefined {
  return deployments
    .filter(
      (d) =>
        d.status === 'live' && (d.scope ?? 'default') === 'default' && (d.traffic_percent ?? 0) > 0
    )
    .sort(
      (a, b) =>
        (b.traffic_percent ?? 0) - (a.traffic_percent ?? 0) ||
        Date.parse(b.created_at) - Date.parse(a.created_at)
    )[0];
}

export type ProbeView = {
  /** `set` came from the deployment or build; `default` is the platform's; `off` runs nothing. */
  kind: 'set' | 'default' | 'off';
  action: string;
  timing?: string;
};

type Action = { path?: string; grpc?: { service?: string } };

function describe(probe: Action): string {
  if (probe.grpc) return `gRPC health check${probe.grpc.service ? ` (${probe.grpc.service})` : ''}`;
  return `GET ${probe.path ?? '/'}`;
}

// Liveness and readiness both default to 5 s, 2 s and 3 failures
// (faas pkg/api/limits.go:8035; docs/deploy-overrides.md).
const timing = (every?: number, timeout?: number) =>
  `every ${every || 5} s · ${timeout || 2} s timeout`;

/**
 * Probes of the serving deployment, or undefined when nothing serves yet.
 * Workers and jobs have no HTTP contract, so the default /healthz liveness
 * probe does not run for them (faas pkg/fcvm/manager.go:2594).
 */
export function effectiveProbes(app: App, deployment: Deployment | undefined) {
  if (!deployment) return undefined;
  const mode = executionMode(app);
  const listens = mode !== 'worker' && mode !== 'job';
  const check = deployment.override_healthcheck;
  const ready = deployment.override_readiness_probe;
  const live = deployment.override_liveness_probe;
  const healthz = app.manifest?.healthz;

  const startup: ProbeView = check
    ? { kind: 'set', action: describe(check) }
    : healthz
      ? { kind: 'set', action: `GET ${healthz}` }
      : listens
        ? { kind: 'default', action: `TCP connect on port ${app.manifest?.port || 8080}` }
        : { kind: 'off', action: 'No HTTP check: workers and jobs do not listen' };

  const readiness: ProbeView = ready
    ? {
        kind: 'set',
        action: describe(ready),
        timing: `${timing(ready.period_s, ready.timeout_s)} · out of routing after ${ready.failure_threshold || 3} failures`,
      }
    : { kind: 'off', action: 'Off' };

  const liveness: ProbeView = live
    ? {
        kind: 'set',
        action: describe(live),
        timing: `${timing(live.interval_s, live.timeout_s)} · restart after ${live.consecutive_failures || 3} failures`,
      }
    : listens
      ? {
          kind: 'default',
          action: 'GET /healthz',
          timing: `${timing()} · restart after 3 failures`,
        }
      : { kind: 'off', action: 'Off: workers and jobs have no HTTP endpoint' };

  return { startup, readiness, liveness };
}
