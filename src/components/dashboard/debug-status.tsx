import type { ComponentType, SVGProps } from 'react';
import {
  CheckCircle,
  HelpCircle,
  PauseWindow,
  RefreshDouble,
  WarningTriangle,
  XmarkCircle,
} from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { CopyableId } from '@/components/ui/copyable-id';
import { Timestamp } from '@/components/ui/timestamp';
import { useCapabilityAccess } from '@/lib/api/capabilities';
import { useDebugStatus, type DebugStatus } from '@/lib/api/debug';
import { DebugGate } from './debug-gate';
import { MaturityLabel } from './maturity-label';
import { InlinePhase, queryPhase } from './primitives';

/*
 * GET /v1/apps/{slug}/debug/status (production-debugger preview): one answer
 * to "is this app healthy, and if not where do I look?" (faas
 * docs/debug-status.md, handlers_debug_rollout.go). The verdict and headline
 * are apid's; the panel shows the numbers behind them and links each recent
 * failure to its evidence.
 */

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

/** apid's verdicts, worst first (docs/debug-status.md:30-39). */
const VERDICTS: Record<DebugStatus['verdict'], { label: string; color: string; icon: Icon }> = {
  failing: { label: 'Failing', color: 'var(--status-critical)', icon: XmarkCircle },
  rolled_back: { label: 'Rolled back', color: 'var(--status-critical)', icon: RefreshDouble },
  degraded: { label: 'Degraded', color: 'var(--status-warning)', icon: WarningTriangle },
  releasing: { label: 'Releasing', color: 'var(--status-warning)', icon: RefreshDouble },
  healthy: { label: 'Healthy', color: 'var(--status-good)', icon: CheckCircle },
  idle: { label: 'Idle', color: 'var(--muted-foreground)', icon: PauseWindow },
};

const count = (value: number) => value.toLocaleString('en-US');

export function DebugStatusPanel({
  slug,
  since,
  onOpenRequest,
}: {
  slug: string;
  since: string;
  onOpenRequest: (id: string) => void;
}) {
  const { capability } = useCapabilityAccess('production-debugger');
  const status = useDebugStatus(slug, since);
  const data = status.data;
  const phase = queryPhase({ error: status.error, loading: status.isPending });
  const verdict = data ? (VERDICTS[data.verdict] ?? null) : null;
  const Glyph = verdict?.icon ?? HelpCircle;

  return (
    <section aria-label="Debug status" className="rounded-lg border border-border p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Status</h3>
        <div className="flex items-center gap-2">
          <MaturityLabel capability={capability} />
          <Button
            size="xs"
            variant="ghost"
            aria-label="Refresh status"
            disabled={status.isFetching}
            onClick={() => void status.refetch()}
          >
            Refresh
          </Button>
        </div>
      </div>
      <DebugGate error={status.error}>
        {phase !== 'ready' || !data ? (
          <InlinePhase
            phase={phase}
            error={status.error}
            loadingMessage="Reading status…"
            onRetry={() => void status.refetch()}
          />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <span
                role="status"
                aria-label="Debug verdict"
                className="inline-flex items-center gap-1.5 text-base font-medium"
                style={{ color: verdict?.color ?? 'var(--muted-foreground)' }}
              >
                <Glyph aria-hidden className="h-4 w-4 shrink-0" />
                {verdict?.label ?? data.verdict.replace(/_/g, ' ')}
              </span>
              <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                {data.headline}
              </p>
              <p className="text-xs text-muted-foreground">
                Last {data.since} · generated <Timestamp value={data.generated_at} />
              </p>
            </div>

            <dl className="grid grid-cols-3 gap-3 text-xs">
              {[
                ['Requests', count(data.health.requests)],
                ['Server errors', count(data.health.server_errors)],
                ['p95', data.health.requests ? `${count(data.health.p95_ms)} ms` : '—'],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="mt-1 text-sm tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>

            {data.deployments.length > 0 && (
              <div className="text-xs">
                <h4 className="mb-1 text-muted-foreground">Serving</h4>
                <ul className="flex flex-col gap-1">
                  {data.deployments.map((dep) => (
                    <li key={dep.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <CopyableId value={dep.id} label="deployment ID" />
                      <span className="tabular-nums">{dep.traffic_percent}%</span>
                      {dep.commit_sha && (
                        <span className="font-mono text-muted-foreground">
                          commit {dep.commit_sha.slice(0, 8)}
                        </span>
                      )}
                      {dep.rollout_state && (
                        <span className="text-muted-foreground">{dep.rollout_state}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {data.rollout && data.rollout.state !== 'none' && (
              <div className="text-xs">
                <h4 className="mb-1 text-muted-foreground">Release</h4>
                <p className="[overflow-wrap:anywhere]">{data.rollout.headline}</p>
              </div>
            )}

            {data.regressions_total > 0 && (
              <div className="text-xs">
                <h4 className="mb-1 text-muted-foreground">
                  Open regressions ({count(data.regressions_total)})
                </h4>
                <ul className="flex flex-col gap-1">
                  {data.regressions.map((r) => (
                    <li key={`${r.deployment_id}:${r.route}`} className="font-mono">
                      {r.route}{' '}
                      <span className="text-muted-foreground">
                        {r.kind === 'errors'
                          ? `errors ${r.error_rate_pct?.toFixed(1) ?? '—'}% (was ${r.error_rate_base_pct?.toFixed(1) ?? '—'}%)`
                          : `p95 ${r.p95_ms} ms (was ${r.p95_base_ms} ms)`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {data.recent_failures.length > 0 && (
              <div className="text-xs">
                <h4 className="mb-1 text-muted-foreground">Recent failures</h4>
                <ul className="flex flex-col gap-1">
                  {data.recent_failures.map((req, index) => (
                    <li
                      key={req.id ?? `${req.received_at}-${index}`}
                      className="flex flex-wrap items-center gap-x-3"
                    >
                      <Timestamp value={req.received_at} className="text-muted-foreground" />
                      <span className="font-mono">
                        {req.method} {req.route}
                      </span>
                      <span style={{ color: 'var(--status-critical)' }}>{req.status}</span>
                      {req.id && (
                        <button
                          type="button"
                          onClick={() => onOpenRequest(req.id!)}
                          className="pressable rounded text-brand underline-offset-2 hover:underline"
                        >
                          Open request details
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {(data.oom_kills_total ?? 0) > 0 && (
              <div className="text-xs">
                <h4 className="mb-1 text-muted-foreground">
                  Out of memory ({count(data.oom_kills_total ?? 0)})
                </h4>
                <ul className="flex flex-col gap-1">
                  {(data.oom_kills ?? []).map((kill) => (
                    <li key={`${kill.at}-${kill.deployment_id}`}>
                      <Timestamp value={kill.at} /> · peak {count(kill.peak_mb)} MB, plan{' '}
                      {count(kill.plan_mb)} MB ·{' '}
                      {kill.deployment_failed ? 'deployment failed' : 'instance replaced'}
                    </li>
                  ))}
                </ul>
                {data.oom_fix && (
                  <ul className="mt-2 list-disc pl-5 text-muted-foreground">
                    {data.oom_fix
                      .split('\n')
                      .filter((line) => line.trim())
                      .map((line) => (
                        <li key={line}>{line.replace(/^[•\-*]\s*/, '')}</li>
                      ))}
                  </ul>
                )}
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Tracing {data.tracing_enabled ? 'on' : 'off'}.
              {!data.tracing_enabled && (
                <>
                  {' '}
                  <a className="text-brand underline-offset-2 hover:underline" href="/docs/tracing">
                    Turn on request tracing
                  </a>{' '}
                  to see database, cache and HTTP calls on each request.
                </>
              )}
            </p>
          </div>
        )}
      </DebugGate>
    </section>
  );
}
