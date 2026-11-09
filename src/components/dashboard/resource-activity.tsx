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
import { Select } from '@/components/ui/field';
import { Timestamp } from '@/components/ui/timestamp';
import { HelpTip } from './kit/help-tip';
import { parseTime } from '@/lib/time';

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
        <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
          Newest first
          <HelpTip label="About activity">
            {workspace.data ? `Recorded in ${workspace.data.name}. ` : ''}Coverage can be incomplete
            for older or deleted resources.
          </HelpTip>
        </p>
        {deploymentId && (
          <p className="mt-2 text-xs text-muted-foreground">
            Only events naming this release appear; app-wide events are on the app’s Activity tab.
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-xs">
          Event category
          <Select
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
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Actor category
          <Select
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
          </Select>
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
          This app’s workspace could not be found, so no activity is shown.
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
          to="/dashboard/apps/$appSlug"
          params={{ appSlug: appSlug }}
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
  const outcome = activityOutcome(row.kind);
  const actor = row.actor.label || 'Unknown actor';
  return (
    <li className="space-y-1.5 py-3 [overflow-wrap:anywhere]">
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-sm">{row.summary || row.kind}</p>
        {parseTime(row.occurred_at) === undefined ? (
          <span className="shrink-0 text-xs text-muted-foreground">Time unknown</span>
        ) : (
          <Timestamp value={row.occurred_at} className="shrink-0 text-xs text-muted-foreground" />
        )}
      </div>
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>
          {actor}
          {row.actor.type && row.actor.type !== 'user' ? ` · ${row.actor.type}` : ''}
        </span>
        {/* Success is the norm; only the outcomes worth a second look are named. */}
        {outcome === 'Failed' ? (
          <span className="text-status-critical">Failed</span>
        ) : outcome === 'Completed' ? null : (
          <span>{outcome.startsWith('Recorded') ? 'Outcome unknown' : outcome}</span>
        )}
      </p>
      {release ? (
        <Link
          to="/dashboard/releases"
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
          to="/dashboard/apps/$appSlug"
          params={{ appSlug: appSlug }}
          search={{ tab: row.kind.startsWith('env.') ? 'Environment' : 'Runtime' }}
          className="inline-block text-xs text-brand hover:underline"
        >
          View affected configuration
        </Link>
      ) : null}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">Event details</summary>
        <p className="mt-2 font-mono">
          {row.kind} · {row.resource.label || row.resource.type} · event {row.id}
        </p>
        {Object.keys(row.data ?? {}).length > 0 && (
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2">
            {JSON.stringify(row.data, null, 2)}
          </pre>
        )}
      </details>
    </li>
  );
}
