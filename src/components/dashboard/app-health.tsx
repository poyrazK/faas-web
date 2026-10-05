import { useEffect, useState } from 'react';
import { Circle } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useAppHealth, type AppHealth } from '@/lib/api/queries';
import { InlinePhase, queryPhase } from './primitives';

type Destination = 'Metrics' | 'Deployments' | 'Logs' | 'Errors' | 'Configuration';
const DESTINATIONS: Record<string, Destination> = {
  metrics: 'Metrics',
  deployments: 'Deployments',
  logs: 'Logs',
  errors: 'Errors',
  configuration: 'Configuration',
};
const LABELS = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  unhealthy: 'Unhealthy',
  unknown: 'Health unconfirmed',
};
const TONES: Record<string, string> = {
  healthy: 'var(--status-good)',
  pass: 'var(--status-good)',
  degraded: 'var(--status-warning)',
  warning: 'var(--status-warning)',
  unhealthy: 'var(--status-critical)',
  fail: 'var(--status-critical)',
};

export function assessmentIsCurrent(data: AppHealth, now: number): boolean {
  const at = Date.parse(data.evaluated_at);
  const age = now - at;
  return (
    Number.isFinite(at) &&
    data.valid_for_seconds > 0 &&
    age >= -data.valid_for_seconds * 1000 &&
    age <= data.valid_for_seconds * 1000
  );
}

/** Shows only a current server assessment. Cached success cannot mask a failed read. */
export function AppHealthPanel({
  slug,
  onNavigate,
}: {
  slug: string;
  onNavigate: (tab: Destination, deploymentId?: string) => void;
}) {
  const health = useAppHealth(slug);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, []);
  const phase = queryPhase({
    error: health.error,
    loading: health.isPending,
    isEmpty: !health.data,
  });
  const data =
    phase === 'ready' && health.data && assessmentIsCurrent(health.data, now)
      ? health.data
      : undefined;
  const stale = phase === 'ready' && health.data && !data;
  const color = (data && TONES[data.status]) ?? 'var(--muted-foreground)';
  return (
    <section aria-label="App health" className="rounded-xl border border-border bg-card p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Circle aria-hidden className="h-3 w-3 fill-current" style={{ color }} />
            Observed health · Default scope
          </p>
          <h2 className="mt-2 text-xl font-medium" aria-live="polite">
            {data ? LABELS[data.status] : 'Health unconfirmed'}
            {data &&
              ['idle', 'stopped', 'deploying', 'starting', 'maintenance'].includes(data.phase) && (
                <span className="ml-2 text-sm font-normal capitalize text-muted-foreground">
                  · {data.phase}
                </span>
              )}
          </h2>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void health.refetch()}
          disabled={health.isFetching}
        >
          Refresh health
        </Button>
      </div>
      <div className="mt-3">
        <InlinePhase
          phase={phase}
          error={health.error}
          loadingMessage="Collecting health evidence…"
          emptyMessage="No assessment was returned."
          onRetry={() => void health.refetch()}
        />
        {stale && (
          <p role="status" className="text-sm text-muted-foreground">
            This assessment has expired. Refresh to confirm current health.
          </p>
        )}
        {data && (
          <>
            <p className="text-sm leading-relaxed text-muted-foreground">{data.summary}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              Assessed {new Date(data.evaluated_at).toLocaleTimeString()} ·{' '}
              {data.capacity.known ? (
                <>
                  {data.capacity.ready} ready · {data.capacity.required} required ·{' '}
                  {data.capacity.starting} starting · {data.capacity.unknown} unconfirmed
                </>
              ) : (
                'Replica readiness unconfirmed'
              )}
            </p>
            <ul className="mt-4 divide-y divide-border border-t border-border">
              {data.checks.map((check) => {
                const destination = check.action && DESTINATIONS[check.action];
                return (
                  <li
                    key={check.code}
                    className="flex flex-col justify-between gap-2 py-3 sm:flex-row sm:items-start"
                  >
                    <div className="flex min-w-0 gap-2">
                      <span
                        className="mt-0.5 shrink-0 text-xs"
                        style={{ color: TONES[check.status] ?? 'var(--muted-foreground)' }}
                      >
                        {check.status === 'not_applicable'
                          ? 'Info'
                          : check.status === 'unknown'
                            ? 'Unconfirmed'
                            : check.status}
                      </span>
                      <p className="text-sm leading-relaxed [overflow-wrap:anywhere]">
                        {check.detail}
                      </p>
                    </div>
                    {destination && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onNavigate(destination, check.deployment_id)}
                      >
                        Inspect {destination.toLowerCase()}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="text-xs text-muted-foreground">
              Request evidence covers all app scopes over 5 minutes. This read does not wake or
              probe your app.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
