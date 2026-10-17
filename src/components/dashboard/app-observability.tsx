import { Link } from '@tanstack/react-router';
import { CheckCircle, HelpCircle, WarningTriangle } from 'iconoir-react';
import {
  useAppHealth,
  useAppHealthHistory,
  useDependencyLatency,
  useRouteAwake,
} from '@/lib/api/queries';
import { PlanGated } from './plan-gated';
import { InlinePhase, Panel, queryPhase } from './primitives';

/* ------------------------------------------------------------------ *
 * Observability panels for one app, each over an endpoint apid already
 * serves. Every figure is what the API returned; when an endpoint cannot
 * answer (plan, retention, no evidence) the panel says so instead.
 * ------------------------------------------------------------------ */

/** apid's closed set of health check codes, in words. */
const CHECK_NAMES: Record<string, string> = {
  readiness: 'Readiness',
  requests: 'Requests',
  deployment: 'Deployment',
  latest_deployment: 'Latest deployment',
  workload: 'Workload',
  traffic_readiness: 'Traffic readiness',
  collection: 'Evidence collection',
  maintenance: 'Maintenance',
};

/** apid names where to look next; these are the app tabs that answer it. */
const ACTION_TABS = {
  deployments: 'Deployments',
  configuration: 'Configuration',
  logs: 'Logs',
  metrics: 'Metrics',
  errors: 'Errors',
} as const;

const pct = (share: number) => `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%`;
const ms = (value: number | undefined) => (value === undefined ? '—' : `${value} ms`);

function tone(status: string) {
  const s = status.toLowerCase();
  if (['healthy', 'ok', 'pass', 'passing', 'ready'].includes(s))
    return { color: 'var(--status-good)', icon: CheckCircle };
  if (['unhealthy', 'failing', 'fail', 'failed', 'down', 'critical'].includes(s))
    return { color: 'var(--status-critical)', icon: WarningTriangle };
  if (['degraded', 'warn', 'warning', 'at_risk'].includes(s))
    return { color: 'var(--status-warning)', icon: WarningTriangle };
  return { color: 'var(--muted-foreground)', icon: HelpCircle };
}

function StatusWord({ status }: { status: string }) {
  const { color, icon: Icon } = tone(status);
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium" style={{ color }}>
      <Icon aria-hidden className="h-4 w-4" />
      {status.replace(/_/g, ' ')}
    </span>
  );
}

/** apid's current assessment, the checks behind it, and recent changes. */
export function AppHealthPanel({ slug }: { slug: string }) {
  const health = useAppHealth(slug);
  const history = useAppHealthHistory(slug);
  const phase = queryPhase({ error: health.error, loading: health.isPending });
  const data = health.data;
  const failing = (data?.checks ?? []).filter((check) => tone(check.status).icon !== CheckCircle);
  return (
    <Panel title="Health" description="apid's assessment of whether this app can serve.">
      <PlanGated error={health.error} feature="App health">
        {phase !== 'ready' || !data ? (
          <InlinePhase
            phase={phase}
            error={health.error}
            loadingMessage="Reading health…"
            onRetry={() => void health.refetch()}
          />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <StatusWord status={data.status} />
              <span className="text-sm text-muted-foreground">{data.summary}</span>
            </div>
            {data.capacity.known && (
              <p className="text-xs text-muted-foreground">
                {data.capacity.ready} of {data.capacity.required} instances ready
                {data.capacity.starting > 0 && ` · ${data.capacity.starting} starting`}
                {data.capacity.unready > 0 && ` · ${data.capacity.unready} not ready`}
              </p>
            )}
            {failing.length > 0 && (
              <ul aria-label="Failing checks" className="flex flex-col gap-2">
                {failing.map((check) => (
                  <li key={check.code} className="rounded-md border border-border p-3 text-sm">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">
                        {CHECK_NAMES[check.code] ?? check.code.replace(/_/g, ' ')}
                      </span>
                      <StatusWord status={check.status} />
                    </p>
                    <p className="mt-1 text-muted-foreground">{check.detail}</p>
                    {check.action && (
                      <Link
                        to="/dashboard/apps/$appSlug"
                        params={{ appSlug: slug }}
                        search={{ tab: ACTION_TABS[check.action] }}
                        className="mt-1 inline-block text-xs text-brand underline-offset-2 hover:underline"
                      >
                        Open {ACTION_TABS[check.action].toLowerCase()}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div>
              <h3 className="mb-1 text-xs font-medium text-muted-foreground">Recent changes</h3>
              {history.data?.entries.length ? (
                <ul aria-label="Health history" className="divide-y divide-border text-sm">
                  {history.data.entries.map((entry) => (
                    <li key={entry.id} className="flex flex-wrap justify-between gap-x-4 py-1.5">
                      <span>
                        {entry.kind === 'gap'
                          ? 'No evidence collected'
                          : `${entry.previous_status ? `${entry.previous_status.replace(/_/g, ' ')} → ` : ''}${entry.assessment.status.replace(/_/g, ' ')}`}
                      </span>
                      <time dateTime={entry.observed_at} className="text-xs text-muted-foreground">
                        {new Date(entry.observed_at).toLocaleString()}
                      </time>
                    </li>
                  ))}
                </ul>
              ) : (
                <InlinePhase
                  phase={queryPhase({
                    error: history.error,
                    loading: history.isPending,
                    isEmpty: true,
                  })}
                  error={history.error}
                  loadingMessage="Reading history…"
                  emptyMessage="No recorded changes."
                  onRetry={() => void history.refetch()}
                />
              )}
            </div>
          </div>
        )}
      </PlanGated>
    </Panel>
  );
}

/**
 * Which routes keep the app awake. On scale-to-zero this is the cost and
 * cold-start story: a health check every minute holds an app awake around the
 * clock, and each route's share says what removing it would save.
 */
export function AwakeRoutesPanel({ slug, since }: { slug: string; since: string }) {
  const awake = useRouteAwake(slug, since);
  const phase = queryPhase({
    error: awake.error,
    loading: awake.isPending,
    isEmpty: !awake.data?.routes.length,
  });
  const data = awake.data;
  return (
    <Panel
      title="What keeps it awake"
      description="Routes whose requests restarted the idle timer, by share of awake time."
    >
      <PlanGated error={awake.error} feature="Awake-time analysis">
        {data && (
          <p className="mb-3 text-sm text-muted-foreground">
            Awake <span className="font-medium text-foreground">{pct(data.awake_share)}</span> of
            the window · {data.gb_hours.toFixed(2)} GB-h · {data.wakes} cold starts
            {data.window_clamped && ' · window shortened by plan retention'}
          </p>
        )}
        {phase !== 'ready' || !data ? (
          <InlinePhase
            phase={phase}
            error={awake.error}
            loadingMessage="Reading awake time…"
            emptyMessage="No requests kept this app awake in the window."
            onRetry={() => void awake.refetch()}
          />
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="py-2 font-medium">
                  Route
                </th>
                <th scope="col" className="py-2 font-medium">
                  Awake share
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  Requests
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  Cold starts
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  GB-h
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.routes.map((route) => (
                <tr key={`${route.method} ${route.route}`}>
                  <th scope="row" className="py-2 pr-3 font-normal">
                    <span className="font-mono text-xs">
                      {route.method} {route.route}
                    </span>
                    {route.pattern === 'periodic' && route.interval_seconds ? (
                      <span className="block text-xs text-muted-foreground">
                        every ~{route.interval_seconds} s
                      </span>
                    ) : null}
                    {route.suggestion && (
                      <span className="block text-xs text-muted-foreground">
                        {route.suggestion.message}
                      </span>
                    )}
                  </th>
                  <td className="py-2 pr-3">
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="h-1.5 w-16 overflow-hidden rounded-full bg-muted"
                      >
                        <span
                          className="block h-full rounded-full bg-brand"
                          style={{ width: pct(Math.min(1, route.awake_share)) }}
                        />
                      </span>
                      <span className="text-xs tabular-nums">{pct(route.awake_share)}</span>
                    </span>
                  </td>
                  <td className="py-2 text-right tabular-nums">{route.requests}</td>
                  <td className="py-2 text-right tabular-nums">{route.wakes}</td>
                  <td className="py-2 text-right tabular-nums">{route.gb_hours.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </PlanGated>
    </Panel>
  );
}

/** Downstream calls by p95 and error rate, flagging regressions against the baseline. */
export function DependencyLatencyPanel({ slug, since }: { slug: string; since: string }) {
  const deps = useDependencyLatency(slug, since);
  const phase = queryPhase({
    error: deps.error,
    loading: deps.isPending,
    isEmpty: !deps.data?.dependencies.length,
  });
  const data = deps.data;
  return (
    <Panel
      title="Dependencies"
      description="Databases, caches and APIs this app calls, from traced spans."
    >
      <PlanGated error={deps.error} feature="Dependency latency">
        {phase !== 'ready' || !data ? (
          <InlinePhase
            phase={phase}
            error={deps.error}
            loadingMessage="Reading dependency latency…"
            emptyMessage="No traced dependency calls in this window."
            onRetry={() => void deps.refetch()}
          />
        ) : (
          <>
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="py-2 font-medium">
                    Dependency
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    Calls
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    Errors
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    p95
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    vs baseline
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.dependencies.map((dep) => (
                  <tr key={`${dep.type}:${dep.name}`}>
                    <th scope="row" className="py-2 pr-3 font-normal">
                      <span className="block truncate">{dep.name}</span>
                      <span className="text-xs text-muted-foreground">{dep.kind ?? dep.type}</span>
                    </th>
                    <td className="py-2 text-right tabular-nums">{dep.calls}</td>
                    <td className="py-2 text-right tabular-nums">
                      {dep.error_rate_pct.toFixed(1)}%
                    </td>
                    <td className="py-2 text-right tabular-nums">{ms(dep.p95_ms)}</td>
                    <td className="py-2 text-right text-xs">
                      {dep.regression || dep.failure_regression ? (
                        <span
                          className="inline-flex items-center gap-1"
                          style={{ color: 'var(--status-critical)' }}
                        >
                          <WarningTriangle aria-hidden className="h-3.5 w-3.5" />
                          {dep.regression && dep.p95_delta_ms !== undefined
                            ? `+${dep.p95_delta_ms} ms`
                            : 'more errors'}
                        </span>
                      ) : dep.p95_delta_ms !== undefined ? (
                        <span className="text-muted-foreground">
                          {dep.p95_delta_ms >= 0 ? '+' : ''}
                          {dep.p95_delta_ms} ms
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.complete && (
              <p className="mt-2 text-xs text-muted-foreground">
                Sampled: trace caps were reached, so rare dependencies may be missing.
              </p>
            )}
          </>
        )}
      </PlanGated>
    </Panel>
  );
}
