import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';
import { useApp } from '@/lib/api/queries';
import { ApiError, errorMessage } from '@/lib/api/errors';
import {
  activityOutcome,
  activityResourceId,
  scopedActivity,
  useActivityWorkspace,
  useResourceActivity,
  type ActivityFilters,
  type ResourceActivity,
} from '@/lib/api/resource-activity';

/** Resolve the stable app ID only when the Activity tab is opened. */
export function AppActivityTimeline({ slug }: { slug: string }) {
  const app = useApp(slug);
  if (app.error)
    return (
      <div className="space-y-3">
        <p role="alert">{errorMessage(app.error)}</p>
        <Button size="xs" variant="outline" onClick={() => void app.refetch()}>
          Retry app read
        </Button>
      </div>
    );
  if (app.isPending)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Resolving app activity…
      </p>
    );
  if (!app.data)
    return (
      <p className="text-sm text-muted-foreground">App unavailable. Activity cannot be scoped.</p>
    );
  return <ResourceActivityTimeline appId={app.data.id} appSlug={slug} />;
}

export function ResourceActivityTimeline(props: {
  appId: string;
  appSlug?: string;
  deploymentId?: string;
}) {
  const { account } = useAuth();
  return (
    <ActivityTimeline
      key={`${account?.id}:${props.appId}:${props.deploymentId ?? ''}`}
      {...props}
      accountId={account?.id}
    />
  );
}

function activityError(error: unknown) {
  if (error instanceof ApiError && error.status === 403)
    return 'Your workspace role does not permit reading this activity. Ask a workspace owner to review your membership.';
  if (error instanceof ApiError && error.status === 404)
    return 'This workspace is unavailable to your account. Activity cannot be read.';
  return errorMessage(error);
}

function ActivityTimeline({
  appId,
  appSlug,
  deploymentId,
  accountId,
}: {
  appId: string;
  appSlug?: string;
  deploymentId?: string;
  accountId?: string;
}) {
  const [filters, setFilters] = useState<ActivityFilters>({});
  const workspace = useActivityWorkspace(accountId, appId);
  const activity = useResourceActivity(accountId, workspace.data?.slug, appId, filters);
  const rows = scopedActivity(activity.data?.pages ?? [], appId, deploymentId);
  const failure = workspace.error ?? activity.error;
  const retryRead = () => {
    if (workspace.error || !workspace.data) void workspace.refetch();
    else void (activity.isFetchNextPageError ? activity.fetchNextPage() : activity.refetch());
  };
  return (
    <section aria-label={deploymentId ? 'Release activity' : 'App activity'} className="space-y-4">
      <div>
        <p className="label-mono text-muted-foreground">
          {deploymentId ? 'Release activity' : 'App activity'}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Newest events first. {workspace.data ? `Recorded in ${workspace.data.name}. ` : ''}
          Curated workspace activity is append-only; the API does not advertise a retention expiry.
          Historical coverage can be incomplete for older or deleted resources. Only records visible
          to your current workspace membership appear.
        </p>
        {deploymentId && (
          <p className="mt-2 text-xs text-muted-foreground">
            Only events identifying this release appear here. Older app pages may contain no
            matching release; load more to continue. App-wide config and domain events are in the
            app’s Activity tab.
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-xs">
          Event category
          <select
            aria-label="Event category"
            value={filters.kind_prefix ?? ''}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                kind_prefix: event.target.value || undefined,
              }))
            }
            className="h-8 rounded-md border border-border bg-background px-2 text-sm"
          >
            <option value="">All events</option>
            <option value="deploy.">Deployment actions</option>
            <option value="app.">App lifecycle and config</option>
            <option value="env.">Environment changes</option>
            <option value="domain.">Domains and TLS</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Actor category
          <select
            aria-label="Actor category"
            value={filters.actor_type ?? ''}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                actor_type: (event.target.value || undefined) as ActivityFilters['actor_type'],
              }))
            }
            className="h-8 rounded-md border border-border bg-background px-2 text-sm"
          >
            <option value="">All actors</option>
            <option value="user">User</option>
            <option value="api_key">API key</option>
            <option value="github">GitHub</option>
            <option value="system">System</option>
            <option value="operator">Operator</option>
          </select>
        </label>
        {Boolean(workspace.data) && (
          <Button
            size="sm"
            variant="outline"
            disabled={activity.isFetching}
            onClick={() => void activity.refetch()}
          >
            Refresh activity
          </Button>
        )}
      </div>
      {!accountId ? (
        <p className="text-sm text-muted-foreground">Sign in to read resource activity.</p>
      ) : failure && rows.length === 0 ? (
        <p role="alert" className="text-sm text-status-critical">
          {activityError(failure)}
        </p>
      ) : !workspace.data && !workspace.isPending ? (
        <p className="text-sm text-muted-foreground">
          This app’s persisted workspace could not be resolved from the accessible inventory. No
          unscoped activity is shown.
        </p>
      ) : workspace.isPending || activity.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Reading resource activity…
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No matching events in the loaded history.</p>
      ) : null}
      {rows.length > 0 && (
        <ol className="divide-y divide-border">
          {rows.map((row) => (
            <ActivityRow key={row.id} row={row} appSlug={appSlug} />
          ))}
        </ol>
      )}
      {failure && (
        <div className="flex flex-wrap items-center gap-3">
          {rows.length > 0 && (
            <p role="alert" className="text-sm text-status-critical">
              {activityError(failure)} Loaded events remain available.
            </p>
          )}
          <Button
            size="xs"
            variant="outline"
            disabled={activity.isFetching || workspace.isFetching}
            onClick={retryRead}
          >
            Retry activity read
          </Button>
        </div>
      )}
      {activity.hasNextPage && (
        <Button
          size="sm"
          variant="outline"
          busy={activity.isFetchingNextPage}
          onClick={() => void activity.fetchNextPage()}
        >
          Load older activity
        </Button>
      )}
      {appSlug && deploymentId && (
        <Link
          to="/dashboard/workflows/$workflowId"
          params={{ workflowId: appSlug }}
          search={{ tab: 'Activity' }}
          className="inline-block text-sm text-brand hover:underline"
        >
          View all app activity
        </Link>
      )}
      <Link to="/dashboard/audit" className="block text-xs text-brand hover:underline">
        View account audit log
      </Link>
    </section>
  );
}

function ActivityRow({ row, appSlug }: { row: ResourceActivity; appSlug?: string }) {
  const release = activityResourceId(row.deployment_id);
  const timestamp = Date.parse(row.occurred_at);
  const when = Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString().replace('T', ' ').replace('.000Z', ' UTC')
    : 'Timestamp unavailable';
  const outcome = activityOutcome(row.kind);
  return (
    <li className="space-y-2 py-3 [overflow-wrap:anywhere]">
      <p className="text-sm">{row.summary || row.kind}</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          Actor: {row.actor.label || 'Unknown actor'} ({row.actor.type || 'unknown'})
        </span>
        <time dateTime={Number.isFinite(timestamp) ? row.occurred_at : undefined}>{when}</time>
        <span className={outcome === 'Failed' ? 'text-status-critical' : ''}>
          Outcome: {outcome}
        </span>
      </div>
      <p className="font-mono text-xs text-muted-foreground">
        {row.kind} · {row.resource.label || row.resource.type} · Event {row.id}
      </p>
      {release ? (
        <Link
          to="/dashboard/deployments"
          search={{ deployment: row.deployment_id, releaseSection: 'audit' }}
          className="inline-block text-xs text-brand hover:underline"
        >
          View affected release
        </Link>
      ) : appSlug && row.kind.startsWith('domain.') ? (
        <Link
          to="/dashboard/domains"
          search={{ q: row.resource.label }}
          className="inline-block text-xs text-brand hover:underline"
        >
          View affected domain
        </Link>
      ) : appSlug && (row.kind.startsWith('env.') || row.kind === 'app.config_updated') ? (
        <Link
          to="/dashboard/workflows/$workflowId"
          params={{ workflowId: appSlug }}
          search={{ tab: row.kind.startsWith('env.') ? 'Env vars' : 'Configuration' }}
          className="inline-block text-xs text-brand hover:underline"
        >
          View affected configuration
        </Link>
      ) : null}
      {Object.keys(row.data ?? {}).length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Event details</summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2">
            {JSON.stringify(row.data, null, 2)}
          </pre>
        </details>
      )}
    </li>
  );
}
