import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowRight } from 'iconoir-react';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCompact } from '@/lib/mock-data';
import { formatCents } from '@/lib/money';
import { cn } from '@/lib/utils';
import { PlanGate } from '../plan-gate';
import type { QueryPhase } from '../primitives';
import type { FleetMetrics } from './overview-stats-data';

/**
 * The Overview's analytics as numbers, not charts: `/v1/apps/metrics`,
 * `/v1/instances` and the usage summary return scalars, and this console
 * does not draw series it does not have. Two wide cards lead (requests and
 * error rate); four small ones follow (wake p95, memory now, GB-hours left,
 * CPU). A degraded or failed read is unknown, never zero.
 */

export interface OverviewStatsProps {
  /** Hobby and above: request, error and wake figures exist. */
  paid: boolean;
  /** The plan is known and has no metrics, so say so once. */
  showPlanGate: boolean;
  appCount: number;
  /** e.g. "last 24 hours". */
  rangeDescription: string;
  metrics: {
    /** Pending, failed or degraded: every metrics figure reads as unknown. */
    unavailable: boolean;
    degraded: boolean;
    figures: FleetMetrics;
  };
  resident: { known: boolean; partial: boolean; mb: number; count: number };
  usage: {
    phase: QueryPhase;
    usedGbHours: number;
    /** null when the plan carries no allowance (a company with no usage yet). */
    includedGbHours: number | null;
    overGbHours: number;
    overageCents?: number;
    cpuHours: number | null;
  };
}

const UNKNOWN = <span className="text-muted-foreground">—</span>;
const gbh = (v: number) => v.toLocaleString('en', { maximumFractionDigits: 2 });
const Unit = ({ children }: { children: ReactNode }) => (
  <span className="ml-1 text-sm font-normal text-muted-foreground">{children}</span>
);

function StatCard({
  label,
  hint,
  sub,
  large,
  className,
  children,
}: {
  label: string;
  /** What the figure is, for a hover; the card itself says only the number. */
  hint: string;
  /** The quiet last line — real context, so the card ends composed. */
  sub?: ReactNode;
  large?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      title={hint}
      className={cn(
        'surface animate-item-enter flex h-full flex-col rounded-[1.25rem] bg-card p-5',
        large && 'min-h-36',
        className
      )}
    >
      <h3 className="text-xs text-muted-foreground">{label}</h3>
      <p
        className={cn(
          'mt-3 leading-none font-semibold tracking-tight tabular-nums',
          large ? 'text-[34px]' : 'text-[26px]'
        )}
      >
        {children}
      </p>
      {sub != null && <p className="mt-auto pt-3 text-xs text-muted-foreground">{sub}</p>}
    </section>
  );
}

export function OverviewStats({
  paid,
  showPlanGate,
  appCount,
  rangeDescription,
  metrics,
  resident,
  usage,
}: OverviewStatsProps) {
  const m = metrics.figures;
  const metricsNote = metrics.degraded ? 'metrics degraded' : 'metrics unavailable';
  const usageReading = usage.phase === 'loading';
  const usageFailed = usage.phase !== 'loading' && usage.phase !== 'ready';
  const over = usage.overGbHours > 0;
  const remaining =
    usage.includedGbHours != null ? Math.max(0, usage.includedGbHours - usage.usedGbHours) : null;

  return (
    <>
      {showPlanGate && (
        <PlanGate
          feature="Metrics"
          description="Request counts, error rates and wake times start on Hobby. Your compute usage and running instances are below."
        />
      )}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {paid && (
          <>
            <StatCard
              label="Total requests"
              large
              className="col-span-2"
              hint={`Requests served across your apps over the ${rangeDescription}.`}
              sub={
                metrics.unavailable
                  ? metricsNote
                  : `Across ${appCount} ${appCount === 1 ? 'app' : 'apps'}, ${rangeDescription}`
              }
            >
              {metrics.unavailable ? UNKNOWN : formatCompact(m.requests)}
            </StatCard>
            <StatCard
              label="Error rate"
              large
              className="col-span-2"
              hint="Share of requests that failed, weighted by each app's traffic."
              sub={
                metrics.unavailable
                  ? metricsNote
                  : `${formatCompact(m.errored)} errored, weighted by traffic`
              }
            >
              {metrics.unavailable || m.errorPct == null ? (
                UNKNOWN
              ) : (
                <span className={cn(m.errorPct > 1 && 'text-status-critical')}>
                  {m.errorPct.toFixed(2)}%
                </span>
              )}
            </StatCard>
            <StatCard
              label="Wake p95"
              hint="How long the slowest 5% of wake-ups from sleep took, across all your apps."
              sub="Cold start, fleet-wide"
            >
              {metrics.unavailable || m.wakeP95Ms == null ? (
                UNKNOWN
              ) : (
                <>
                  {Math.round(m.wakeP95Ms)}
                  <Unit>ms</Unit>
                </>
              )}
            </StatCard>
          </>
        )}
        <StatCard
          label="Memory now"
          hint="Memory held by running instances right now. Sleeping instances hold none."
          sub={
            resident.known
              ? `${resident.count} running ${resident.count === 1 ? 'instance' : 'instances'}`
              : resident.partial
                ? 'more instances than one page · open Instances'
                : 'instance read failed'
          }
        >
          {resident.known ? (
            <>
              {resident.mb.toLocaleString('en')}
              <Unit>MB</Unit>
            </>
          ) : (
            UNKNOWN
          )}
        </StatCard>
        <StatCard
          label={over ? 'GB-h over' : remaining != null ? 'GB-h left' : 'GB-h used'}
          hint="Compute this billing period, in GB-hours: memory multiplied by the time your apps ran."
          sub={
            usageReading || usageFailed
              ? 'reading usage'
              : over
                ? usage.overageCents != null
                  ? `${formatCents(usage.overageCents)} overage this period`
                  : 'over the allowance this period'
                : remaining != null
                  ? `of ${gbh(usage.includedGbHours!)} this period`
                  : 'this period'
          }
        >
          {usageReading ? (
            <Skeleton className="h-6 w-16" />
          ) : usageFailed ? (
            UNKNOWN
          ) : over ? (
            <span className="text-status-warning">{gbh(usage.overGbHours)}</span>
          ) : (
            gbh(remaining ?? usage.usedGbHours)
          )}
        </StatCard>
        <StatCard
          label="CPU"
          hint="CPU-hours used this billing period. Measured, not billed."
          sub="Measured this period, not billed"
        >
          {usageReading ? (
            <Skeleton className="h-6 w-16" />
          ) : usageFailed || usage.cpuHours == null ? (
            UNKNOWN
          ) : (
            <>
              {usage.cpuHours.toLocaleString('en', {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              })}
              <Unit>h</Unit>
            </>
          )}
        </StatCard>
      </div>
      <div className="flex justify-end">
        <Link
          to="/dashboard/usage"
          className="pressable inline-flex items-center gap-1 rounded font-mono text-xs text-muted-foreground hover:text-foreground"
        >
          Usage
          <ArrowRight aria-hidden className="h-3 w-3" />
        </Link>
      </div>
    </>
  );
}
