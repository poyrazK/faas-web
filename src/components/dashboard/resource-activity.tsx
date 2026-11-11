import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';
import { useApp } from '@/lib/api/queries';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { RefreshDouble } from 'iconoir-react';
import {
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
import {
  activityHeadline,
  activitySentence,
  actorWords,
  groupByDay,
  namesActor,
  outcomeMark,
} from './activity-words';

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
  const filtered = Boolean(filters.kind_prefix || filters.actor_type);
  const headline = activityHeadline(rows, { hasOlder: Boolean(activity.hasNextPage), filtered });
  const groups = groupByDay(rows);
  return (
    <section aria-label={deploymentId ? 'Release activity' : 'App activity'} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className="flex items-center gap-1 text-base font-medium">
          {deploymentId ? 'Release activity' : 'Activity'}
          <HelpTip label="About activity">
            Newest first.{' '}
            {deploymentId
              ? 'Only events naming this release appear; app-wide events are on the app’s Activity tab. '
              : ''}
            {workspace.data ? `Recorded in ${workspace.data.name}. ` : ''}Coverage can be incomplete
            for older or deleted resources.
          </HelpTip>
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label="Event category"
            value={filters.kind_prefix ?? ''}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                kind_prefix: event.target.value || undefined,
              }))
            }
            className="h-8 w-auto text-xs"
          >
            <option value="">All events</option>
            <option value="deploy.">Deployments</option>
            <option value="app.">App lifecycle and settings</option>
            <option value="env.">Environment</option>
            <option value="domain.">Domains and TLS</option>
          </Select>
          <Select
            aria-label="Actor category"
            value={filters.actor_type ?? ''}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                actor_type: (event.target.value || undefined) as ActivityFilters['actor_type'],
              }))
            }
            className="h-8 w-auto text-xs"
          >
            <option value="">Anyone</option>
            <option value="user">People</option>
            <option value="api_key">API keys</option>
            <option value="github">GitHub</option>
            <option value="system">System</option>
            <option value="operator">Operator</option>
          </Select>
          {Boolean(workspace.data) && (
            <Button
              size="xs"
              variant="ghost"
              aria-label="Refresh activity"
              disabled={activity.isFetching}
              onClick={() => void activity.refetch()}
            >
              <RefreshDouble
                aria-hidden
                className={`size-3.5 ${activity.isFetching ? 'animate-spin motion-reduce:animate-none' : ''}`}
              />
              Refresh
            </Button>
          )}
        </div>
      </div>
      {headline && rows.length > 0 && (
        <p className="text-xl leading-7 font-medium tracking-[-0.01em] tabular-nums text-balance">
          {headline}
        </p>
      )}
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
      {groups.length > 0 && (
        <div className="flex flex-col gap-5">
          {groups.map((group) => (
            <section key={group.key} aria-label={group.label} className="flex flex-col">
              <h3 className="bento-label pb-1">{group.label}</h3>
              <ol className="flex flex-col divide-y divide-border/60">
                {group.rows.map((row) => (
                  <ActivityRow key={row.id} row={row} appSlug={appSlug} />
                ))}
              </ol>
            </section>
          ))}
        </div>
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
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {appSlug && deploymentId && (
          <Link
            to="/dashboard/apps/$appSlug"
            params={{ appSlug: appSlug }}
            search={{ tab: 'Activity' }}
            className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            View all app activity
          </Link>
        )}
        <Link
          to="/dashboard/audit"
          className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          View account audit log
        </Link>
      </div>
    </section>
  );
}

const QUIET_LINK =
  'text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-brand';

/** One event: the API's sentence and when, then who, its outcome and where it landed. */
function ActivityRow({ row, appSlug }: { row: ResourceActivity; appSlug?: string }) {
  const release = activityResourceId(row.deployment_id);
  const mark = outcomeMark(row.kind);
  const failed = mark?.tone === 'critical';
  const sentence = activitySentence(row);
  return (
    <li className="flex gap-3 py-2.5 [overflow-wrap:anywhere]">
      <span
        aria-hidden
        className="mt-[7px] size-1.5 shrink-0 rounded-full"
        style={{
          background: failed
            ? 'var(--status-critical)'
            : 'color-mix(in oklch, var(--muted-foreground) 45%, transparent)',
        }}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline justify-between gap-4">
          <p className="text-sm" title={row.kind}>
            {sentence}
          </p>
          {parseTime(row.occurred_at) === undefined ? (
            <span className="shrink-0 text-xs text-muted-foreground">Time unknown</span>
          ) : (
            <Timestamp
              value={row.occurred_at}
              className="shrink-0 text-xs text-muted-foreground tabular-nums"
            />
          )}
        </div>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {!namesActor(row) && <span>by {actorWords(row.actor)}</span>}
          {mark && (
            <span
              className={failed ? 'font-medium' : undefined}
              style={failed ? { color: 'var(--status-critical)' } : undefined}
            >
              {mark.word}
            </span>
          )}
          {release ? (
            <Link
              to="/dashboard/releases"
              search={{ deployment: row.deployment_id, releaseSection: 'audit' }}
              className={QUIET_LINK}
            >
              View release
            </Link>
          ) : appSlug && row.kind.startsWith('domain.') ? (
            <Link to="/dashboard/domains" search={{ q: row.resource.label }} className={QUIET_LINK}>
              View domain
            </Link>
          ) : appSlug && (row.kind.startsWith('env.') || row.kind === 'app.config_updated') ? (
            <Link
              to="/dashboard/apps/$appSlug"
              params={{ appSlug: appSlug }}
              search={{ tab: row.kind.startsWith('env.') ? 'Environment' : 'Runtime' }}
              className={QUIET_LINK}
            >
              {row.kind.startsWith('env.') ? 'View environment' : 'View settings'}
            </Link>
          ) : null}
          <details className="open:basis-full">
            <summary className="cursor-pointer hover:text-foreground">Details</summary>
            <p className="mt-2 font-mono">
              {row.kind} · {actorWords(row.actor)} · {row.resource.label || row.resource.type} ·
              event {row.id}
            </p>
            {Object.keys(row.data ?? {}).length > 0 && (
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2">
                {JSON.stringify(row.data, null, 2)}
              </pre>
            )}
          </details>
        </div>
      </div>
    </li>
  );
}
