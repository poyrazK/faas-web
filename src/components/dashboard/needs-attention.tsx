import { useEffect, useId, useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { CheckCircle, WarningTriangle, Xmark } from 'iconoir-react';
import type { App, Deployment } from '@/lib/api/queries';
import { useApps, useDeployments, useUsageSummary } from '@/lib/api/queries';
import { Tooltip } from '@/components/ui/tooltip';
import type { components } from '@/lib/api/schema';
import { toRunState } from '@/lib/api/adapters';
import { formatUsageNumber } from '@/lib/usage-format';
import { formatRelative } from '@/lib/mock-data';
import { queryPhase, type QueryPhase } from './primitives';

const DAY = 86_400_000;
const DISPLAY_LIMIT = 3;
const ACTION_CLASS =
  'pressable inline-flex shrink-0 items-center rounded text-xs text-brand hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand';

interface ReadResult<T> {
  data?: T;
  error: unknown;
  isPending: boolean;
  refetch: () => unknown;
}

export interface NeedsAttentionProps {
  onNavigate?: () => void;
  apps: ReadResult<Pick<App, 'id' | 'slug' | 'status' | 'deleted_at'>[]>;
  deployments: ReadResult<{
    items: Pick<Deployment, 'id' | 'app_id' | 'status' | 'created_at'>[];
    next_before?: string | null;
  }>;
  usage: ReadResult<
    Pick<
      components['schemas']['UsageSummaryResponse'],
      'month' | 'used_gb_hours' | 'included_gb_hours'
    >
  >;
}

function readPhase(result: ReadResult<unknown>, invalid = false): QueryPhase {
  const phase = queryPhase({ error: result.error, loading: result.isPending });
  return phase === 'ready' && (result.data == null || invalid) ? 'error' : phase;
}

function ReadNotice({
  label,
  phase,
  retry,
}: {
  label: string;
  phase: QueryPhase;
  retry: () => unknown;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
      <p role="status">
        {phase === 'loading'
          ? `Checking ${label.toLowerCase()}…`
          : `${label} ${phase === 'unreachable' ? 'unreachable' : 'unavailable'}.`}
      </p>
      {phase !== 'loading' && (
        <button
          type="button"
          aria-label={`Retry ${label.toLowerCase()}`}
          className={ACTION_CLASS}
          onClick={() => void retry()}
        >
          Retry
        </button>
      )}
    </div>
  );
}

function AttentionRow({
  title,
  detail,
  tone = 'critical',
  children,
}: {
  title: string;
  detail: string;
  tone?: 'critical' | 'warning';
  children: ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-start gap-x-4 gap-y-2 py-4 first:pt-0 last:pb-0">
      <WarningTriangle
        aria-hidden="true"
        className="mt-0.5 h-4 w-4 shrink-0"
        style={{ color: `var(--status-${tone})` }}
      />
      <div className="min-w-0 flex-1 basis-48">
        <p className="break-words text-sm font-medium">{title}</p>
        <p className="mt-1 break-words text-xs leading-relaxed text-muted-foreground">{detail}</p>
      </div>
      {children}
    </li>
  );
}

/** A bounded summary of reported problems, not a claim of fleet-wide health. */
export function NeedsAttentionContent({
  apps,
  deployments,
  usage,
  onNavigate,
}: NeedsAttentionProps) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    // Notices age out even when polling returns the same cached records.
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const appsPhase = readPhase(apps);
  const deploymentsPhase = readPhase(deployments);
  const usagePhase = readPhase(
    usage,
    Boolean(
      usage.data &&
      [usage.data.used_gb_hours, usage.data.included_gb_hours].some(
        (value) => !Number.isFinite(value) || value < 0
      )
    )
  );
  // A failed refresh must not present cached issues as current observations.
  const appFailures =
    appsPhase === 'ready'
      ? (apps.data ?? [])
          .filter((app) => !app.deleted_at && toRunState(app.status) === 'error')
          .sort((a, b) => a.slug.localeCompare(b.slug))
      : [];
  const failedDeployments =
    deploymentsPhase === 'ready'
      ? (deployments.data?.items ?? [])
          .filter((deployment) => {
            const created = Date.parse(deployment.created_at);
            // The shared lifecycle vocabulary includes cancellations as failed;
            // an intentional cancellation is not an incident for this panel.
            return (
              ['failed', 'error', 'crashed'].includes(deployment.status.toLowerCase()) &&
              created >= now - DAY &&
              created <= now
            );
          })
          .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      : [];
  const allowance = usagePhase === 'ready' ? usage.data : undefined;
  const lowAllowance = Boolean(
    allowance && allowance.used_gb_hours >= allowance.included_gb_hours * 0.8
  );
  const exhausted = Boolean(allowance && allowance.used_gb_hours >= allowance.included_gb_hours);
  const noIssues =
    appsPhase === 'ready' &&
    deploymentsPhase === 'ready' &&
    usagePhase === 'ready' &&
    appFailures.length === 0 &&
    failedDeployments.length === 0 &&
    !lowAllowance;
  // Resolve names only from a successful accessible app inventory. A deleted
  // app's historical release still has a safe, exact deployment detail link.
  const appNames = new Map(
    appsPhase === 'ready' ? (apps.data ?? []).map((app) => [app.id, app.slug]) : []
  );
  const issueCount = appFailures.length + failedDeployments.length + Number(lowAllowance);
  const SummaryIcon = noIssues ? CheckCircle : WarningTriangle;
  const summaryColor = noIssues ? 'var(--status-good)' : 'var(--status-warning)';
  const checksUnavailable = [appsPhase, deploymentsPhase, usagePhase].some(
    (phase) => phase === 'error' || phase === 'unreachable'
  );

  return (
    <div role="region" aria-label="Needs attention" className="flex flex-col gap-6">
      <div className="rounded-xl border border-border bg-muted/35 p-4 sm:p-5">
        <div className="flex items-start gap-3.5">
          <span
            className="flex size-11 shrink-0 items-center justify-center rounded-full"
            style={{
              color: summaryColor,
              background: `color-mix(in oklab, ${summaryColor} 12%, transparent)`,
            }}
          >
            <SummaryIcon aria-hidden="true" className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="text-lg font-semibold tracking-tight">
              {noIssues
                ? 'Nothing to investigate'
                : issueCount > 0
                  ? `${issueCount} ${issueCount === 1 ? 'item' : 'items'} to review`
                  : checksUnavailable
                    ? 'Some checks are unavailable'
                    : 'Checking your workspace'}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {noIssues
                ? 'No reported issues in the checked data.'
                : 'Inspect reported failures and keep an eye on your compute allowance.'}
            </p>
          </div>
        </div>
        <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-border pt-4 text-xs">
          <div>
            <dt className="text-muted-foreground">App failures</dt>
            <dd className="mt-1 font-medium">
              {appsPhase === 'ready'
                ? appFailures.length
                : appsPhase === 'loading'
                  ? 'Checking…'
                  : 'Unavailable'}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Failed in 24h</dt>
            <dd className="mt-1 font-medium">
              {deploymentsPhase === 'ready'
                ? failedDeployments.length
                : deploymentsPhase === 'loading'
                  ? 'Checking…'
                  : 'Unavailable'}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Allowance used</dt>
            <dd className="mt-1 font-medium">
              {allowance
                ? allowance.included_gb_hours > 0
                  ? `${formatUsageNumber((allowance.used_gb_hours / allowance.included_gb_hours) * 100, 1)}%`
                  : 'None included'
                : usagePhase === 'loading'
                  ? 'Checking…'
                  : 'Unavailable'}
            </dd>
          </div>
        </dl>
      </div>
      <div className="flex flex-col gap-6">
        {(appsPhase !== 'ready' || appFailures.length > 0) && (
          <section aria-label="App failures">
            <h3 className="mb-3 text-xs font-medium text-muted-foreground">App failures</h3>
            {appsPhase !== 'ready' ? (
              <ReadNotice label="App status" phase={appsPhase} retry={apps.refetch} />
            ) : (
              <>
                <ul className="divide-y divide-border">
                  {appFailures.slice(0, DISPLAY_LIMIT).map((app) => (
                    <AttentionRow
                      key={app.id}
                      title={app.slug}
                      detail={`Reported status: ${app.status}. Inspect the app logs.`}
                    >
                      <Link
                        onClick={onNavigate}
                        to="/dashboard/workflows/$workflowId"
                        params={{ workflowId: app.slug }}
                        search={{ tab: 'Logs' }}
                        aria-label={`View logs for ${app.slug}`}
                        className={ACTION_CLASS}
                      >
                        View logs
                      </Link>
                    </AttentionRow>
                  ))}
                </ul>
                {appFailures.length > DISPLAY_LIMIT && (
                  <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>Showing 3 of {appFailures.length} failing apps.</span>
                    <Link onClick={onNavigate} to="/dashboard/workflows" className={ACTION_CLASS}>
                      View all apps
                    </Link>
                  </p>
                )}
              </>
            )}
          </section>
        )}
        {(deploymentsPhase !== 'ready' || failedDeployments.length > 0) && (
          <section aria-label="Recent failed deployments">
            <h3 className="mb-3 text-xs font-medium text-muted-foreground">
              Recent failed deployments
            </h3>
            {deploymentsPhase !== 'ready' ? (
              <ReadNotice
                label="Deployment history"
                phase={deploymentsPhase}
                retry={deployments.refetch}
              />
            ) : (
              <>
                <ul className="divide-y divide-border">
                  {failedDeployments.slice(0, DISPLAY_LIMIT).map((deployment) => (
                    <AttentionRow
                      key={deployment.id}
                      title={`Deployment failed · ${appNames.get(deployment.app_id) ?? deployment.app_id}`}
                      detail={`Created ${formatRelative(Date.parse(deployment.created_at))}. Review the reported cause and build output.`}
                    >
                      <Link
                        onClick={onNavigate}
                        to="/dashboard/deployments"
                        search={{ deployment: deployment.id }}
                        aria-label={`View deployment ${deployment.id}`}
                        title={deployment.id}
                        className={ACTION_CLASS}
                      >
                        View deployment
                      </Link>
                    </AttentionRow>
                  ))}
                </ul>
                {failedDeployments.length > DISPLAY_LIMIT && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Showing 3 of {failedDeployments.length} recent failed deployments.
                  </p>
                )}
              </>
            )}
          </section>
        )}
        {(usagePhase !== 'ready' || lowAllowance) && (
          <section aria-label="Compute allowance">
            <h3 className="mb-3 text-xs font-medium text-muted-foreground">Compute allowance</h3>
            {usagePhase !== 'ready' || !allowance ? (
              <ReadNotice label="Compute allowance" phase={usagePhase} retry={usage.refetch} />
            ) : (
              <ul>
                <AttentionRow
                  title={
                    allowance.included_gb_hours === 0
                      ? 'No compute allowance included'
                      : exhausted
                        ? 'Compute allowance exhausted'
                        : 'Compute allowance running low'
                  }
                  tone={exhausted ? 'critical' : 'warning'}
                  detail={`${formatUsageNumber(allowance.used_gb_hours, 3)} of ${formatUsageNumber(allowance.included_gb_hours, 3)} GB-h used for ${allowance.month}. ${formatUsageNumber(Math.max(0, allowance.included_gb_hours - allowance.used_gb_hours), 3)} GB-h remaining.`}
                >
                  <Link onClick={onNavigate} to="/dashboard/usage" className={ACTION_CLASS}>
                    Review usage
                  </Link>
                </AttentionRow>
              </ul>
            )}
          </section>
        )}
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
          <span>
            Deployment checks cover at most the latest 50 deployments, not the full history.
          </span>
          <Link onClick={onNavigate} to="/dashboard/deployments" className={ACTION_CLASS}>
            Open deployment history
          </Link>
        </p>
      </div>
    </div>
  );
}

function LiveAttention({ onNavigate }: { onNavigate: () => void }) {
  const apps = useApps({ refetchInterval: 15_000 });
  const deployments = useDeployments(50, { refetchInterval: 10_000 });
  const usage = useUsageSummary();
  return (
    <NeedsAttentionContent
      apps={apps}
      deployments={deployments}
      usage={usage}
      onNavigate={onNavigate}
    />
  );
}

/** Mount checks only on demand; share the console's existing query cache. */
export function NeedsAttentionButton() {
  const [open, setOpen] = useState(false);
  const descriptionId = useId();
  const close = () => setOpen(false);
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen} modal={false}>
      <Tooltip content="Needs Attention" side="bottom">
        <PopoverPrimitive.Trigger asChild>
          <button
            type="button"
            aria-label="Needs Attention"
            className="pressable inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-card px-2.5 text-xs font-medium text-foreground hover:border-border-secondary hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand data-[state=open]:border-brand/40 data-[state=open]:bg-brand/10"
          >
            <WarningTriangle aria-hidden="true" className="size-4 text-status-warning" />
            <span className="hidden sm:inline">Needs Attention</span>
          </button>
        </PopoverPrimitive.Trigger>
      </Tooltip>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="bottom"
          align="end"
          sideOffset={10}
          collisionPadding={12}
          aria-label="Needs Attention"
          aria-describedby={descriptionId}
          className="animate-pop-in z-[90] flex max-h-[min(38rem,var(--radix-popover-content-available-height))] w-[min(30rem,calc(100vw-1.5rem))] origin-[var(--radix-popover-content-transform-origin)] flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-elevation-3 outline-none"
        >
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-4 py-3.5">
            <div>
              <h2 className="text-sm font-semibold tracking-tight">Needs Attention</h2>
              <p id={descriptionId} className="mt-1 text-xs leading-relaxed text-muted-foreground">
                App failures, recent failed deployments and compute allowance.
              </p>
            </div>
            <PopoverPrimitive.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="pressable -mr-1 -mt-1 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-brand"
              >
                <Xmark aria-hidden="true" className="size-4" />
              </button>
            </PopoverPrimitive.Close>
          </header>
          <div className="min-h-0 overflow-y-auto overscroll-contain p-4">
            <LiveAttention onNavigate={close} />
          </div>
          <PopoverPrimitive.Arrow width={12} height={6} className="fill-popover" />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
