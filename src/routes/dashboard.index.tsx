import { useMemo } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowRight, Plus } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Panel,
  StatTile,
  StateBadge,
  UnreachableState,
  queryPhase,
} from '@/components/dashboard/primitives';
import { FirstRun } from '@/components/dashboard/first-run';
import { useData } from '@/lib/store';
import { useAuth } from '@/lib/auth';
import { useUsageSummary } from '@/lib/api/queries';
import { formatCompact, formatRelative } from '@/lib/mock-data';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/')({
  component: OverviewPage,
  head: () => consoleHead('overview'),
});

const formatGbHours = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 2 });

/**
 * The console landing page, built from the real account.
 *
 * The figures are deliberately the ones the API can answer without a fan-out:
 * the app list, the metrics rollup the store already fetches, and the usage
 * summary. Anything needing a per-app query lives on that app's own page.
 */
function OverviewPage() {
  const { workflows, deployments, loading, error, refresh } = useData();
  const { account, user } = useAuth();
  const usage = useUsageSummary();

  const phase = queryPhase({ error, loading });
  // A failed read leaves the derived counts at zero, which would present an
  // outage as a healthy, empty account. The tiles say "unknown" instead.
  const tile = error
    ? ('unavailable' as const)
    : loading
      ? ('loading' as const)
      : ('ready' as const);

  const usageTile = usage.error
    ? ('unavailable' as const)
    : usage.isPending
      ? ('loading' as const)
      : ('ready' as const);

  const stats = useMemo(() => {
    const running = workflows.filter((w) => w.state === 'running').length;
    const failing = workflows.filter((w) => w.state === 'error').length;
    const invocations = workflows.reduce((sum, w) => sum + w.invocations24h, 0);
    return { running, failing, invocations };
  }, [workflows]);

  const recent = useMemo(
    () => [...deployments].sort((a, b) => b.createdAt - a.createdAt).slice(0, 6),
    [deployments]
  );

  const firstName = user?.name.split(' ')[0];
  // Nothing deployed and the read succeeded: four zeroes and a dash are
  // accurate and useless, so the page becomes instructions instead.
  const firstRun = phase === 'ready' && workflows.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={
          // "Welcome back" to someone who has never deployed anything is the
          // wrong greeting; a first run is a welcome, not a return.
          firstName ? `Welcome${firstRun ? '' : ' back'}, ${firstName}` : 'Overview'
        }
        description={
          firstRun
            ? 'Nothing deployed yet. Three commands and you are live.'
            : account
              ? `${account.app_count} app${account.app_count === 1 ? '' : 's'} on the ${account.plan} plan.`
              : 'Your account at a glance.'
        }
        actions={
          <Button asChild size="sm" className="gap-1.5">
            <Link to="/dashboard/workflows/new">
              <Plus className="h-3.5 w-3.5" />
              New app
            </Link>
          </Button>
        }
      />

      {firstRun && <FirstRun />}

      {!firstRun && (
        <>
          {/* Numeric values so the tiles roll to fresh figures on refetch
              instead of jumping. */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile label="Apps" value={workflows.length} state={tile} />
            <StatTile label="Running" value={stats.running} state={tile} />
            <StatTile
              label="Failing"
              value={stats.failing}
              state={tile}
              tone={stats.failing > 0 ? 'red' : undefined}
            />
            <StatTile
              label="Requests (24h)"
              value={stats.invocations || '—'}
              format={formatCompact}
              state={tile}
            />
          </div>

          {(usage.data || usage.error || usage.isPending) && (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile
                label="GB-hours used"
                value={usage.data?.used_gb_hours}
                format={formatGbHours}
                state={usageTile}
              />
              <StatTile
                label="Included"
                value={usage.data?.included_gb_hours}
                format={formatGbHours}
                state={usageTile}
              />
              <StatTile
                label="Overage"
                value={usage.data?.overage_gb_hours}
                format={formatGbHours}
                state={usageTile}
                tone={usage.data && usage.data.overage_gb_hours > 0 ? 'orange' : undefined}
              />
              <StatTile label="Billing period" value={usage.data?.month} state={usageTile} />
            </div>
          )}

          <div className="grid gap-6 xl:grid-cols-2">
            <Panel
              padded={false}
              title="Apps"
              actions={
                <Link
                  to="/dashboard/workflows"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  All apps
                  <ArrowRight className="h-3 w-3" />
                </Link>
              }
            >
              {phase === 'unreachable' ? (
                <UnreachableState onRetry={refresh} />
              ) : phase === 'error' ? (
                <ErrorState error={error} onRetry={refresh} />
              ) : phase === 'loading' ? (
                <LoadingState />
              ) : workflows.length === 0 ? (
                <EmptyState message="No apps yet. Create one to get started." />
              ) : (
                <ul className="flex flex-col">
                  {workflows.slice(0, 6).map((app) => (
                    <li key={app.id} className="border-b border-border last:border-0">
                      <Link
                        to="/dashboard/workflows/$workflowId"
                        params={{ workflowId: app.id }}
                        className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-muted"
                      >
                        <span className="flex flex-col gap-0.5">
                          <span className="font-mono text-xs">{app.name}</span>
                          <span className="text-xs text-muted-foreground">{app.runtime}</span>
                        </span>
                        <StateBadge state={app.state} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel
              padded={false}
              title="Recent deployments"
              actions={
                <Link
                  to="/dashboard/deployments"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  All deployments
                  <ArrowRight className="h-3 w-3" />
                </Link>
              }
            >
              {phase === 'unreachable' ? (
                <UnreachableState onRetry={refresh} />
              ) : phase === 'error' ? (
                <ErrorState error={error} onRetry={refresh} />
              ) : phase === 'loading' ? (
                <LoadingState />
              ) : recent.length === 0 ? (
                <EmptyState message="Nothing deployed yet." />
              ) : (
                <ul className="flex flex-col">
                  {recent.map((d) => (
                    <li
                      key={d.id}
                      className="flex items-center justify-between gap-3 border-b border-border px-5 py-3 last:border-0"
                    >
                      <span className="flex flex-col gap-0.5">
                        <span className="font-mono text-xs">{d.workflowId}</span>
                        <span className="text-xs text-muted-foreground">
                          {d.version || 'no image'} · {formatRelative(d.createdAt)}
                        </span>
                      </span>
                      <StateBadge
                        state={
                          d.state === 'succeeded'
                            ? 'running'
                            : d.state === 'failed'
                              ? 'error'
                              : 'deploying'
                        }
                      />
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
