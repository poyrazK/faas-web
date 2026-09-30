import { createFileRoute, Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { InlinePhase, PageHeader, Panel, queryPhase } from '@/components/dashboard/primitives';
import { useAppCapacity } from '@/lib/api/queries';
import { consoleHead } from '@/lib/seo';
import { ObjectStorage } from '@/components/dashboard/object-storage';

export const Route = createFileRoute('/dashboard/storage')({
  component: StoragePage,
  head: () => consoleHead('storage'),
});

function AppCapacity() {
  const query = useAppCapacity();
  const account = query.data;
  if (query.isPending || query.error || !account)
    return (
      <Panel title="App capacity">
        <InlinePhase
          phase={queryPhase({ loading: query.isPending, error: query.error })}
          error={query.error}
          loadingMessage="Loading app capacity…"
          onRetry={() => void query.refetch()}
        />
      </Panel>
    );
  const used = account.app_count;
  const limit = account.limits.deployed_apps;
  const remaining = Math.max(0, limit - used);
  const percent = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const plan = account.plan.charAt(0).toUpperCase() + account.plan.slice(1);
  return (
    <section
      aria-labelledby="app-capacity-title"
      className="rounded-xl border border-border bg-card p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="app-capacity-title" className="text-sm font-medium">
            App capacity
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">{plan} plan</p>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link to="/dashboard/plans">View plans</Link>
        </Button>
      </div>
      <div className="mt-5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-4xl font-medium tracking-tight tabular-nums">
          {used}
          <span className="ml-1.5 text-2xl font-normal text-muted-foreground">/ {limit}</span>
        </p>
        <p className="text-sm text-muted-foreground">app slots used</p>
      </div>
      <div
        role="meter"
        aria-label="App capacity"
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={Math.min(used, limit)}
        aria-valuetext={`${used} of ${limit} app slots used`}
        className="mb-3 mt-4 h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={`h-full rounded-full ${remaining ? 'bg-brand' : 'bg-[color:var(--status-warning)]'}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="flex flex-wrap justify-between gap-2 text-xs">
        <p className="font-medium">
          {remaining
            ? `${remaining} app ${remaining === 1 ? 'slot' : 'slots'} available`
            : 'All app slots are in use'}
        </p>
        <p className="text-muted-foreground">Redeploying an app does not use another slot.</p>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Live development environments have a separate allowance.
      </p>
    </section>
  );
}

function StoragePage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Storage" description="Your app capacity and private object buckets." />
      <AppCapacity />
      <ObjectStorage />
    </div>
  );
}
