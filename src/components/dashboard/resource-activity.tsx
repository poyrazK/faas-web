import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';
import { useApp } from '@/lib/api/queries';
import { ApiError, errorMessage } from '@/lib/api/errors';
import {
  Box,
  Clock,
  CodeBrackets,
  Globe,
  NavArrowRight,
  RefreshDouble,
  Rocket,
  Settings,
  WarningCircle,
} from 'iconoir-react';
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
  activityContext,
  activityHeadline,
  activitySentence,
  activityTitle,
  actorWords,
  groupByDay,
  namesActor,
  outcomeMark,
} from './activity-words';
import { releaseLink } from '@/components/dashboard/release-page/links';

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
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-xl font-semibold tracking-tight">
            {deploymentId ? 'Release activity' : 'Activity'}
            <HelpTip label="About activity">
              Newest first.{' '}
              {deploymentId
                ? 'Only events naming this release appear; app-wide events are on the app’s Activity tab. '
                : ''}
              {workspace.data ? `Recorded in ${workspace.data.name}. ` : ''}Coverage can be
              incomplete for older or deleted resources.
            </HelpTip>
          </h2>
          {headline && (
            <p className="mt-1 text-sm text-muted-foreground tabular-nums">{headline}</p>
          )}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Select
            aria-label="Event category"
            value={filters.kind_prefix ?? ''}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                kind_prefix: event.target.value || undefined,
              }))
            }
            className="max-w-full text-sm"
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
            className="max-w-full text-sm"
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
              size="sm"
              variant="outline"
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
            <section
              key={group.key}
              aria-label={group.label}
              className="overflow-hidden rounded-[1.25rem] border border-border bg-card"
            >
              <h3 className="border-b border-border bg-muted/30 px-3 py-2.5 text-sm font-medium sm:px-5">
                {group.label}
              </h3>
              <ol className="relative flex flex-col divide-y divide-border/60 before:pointer-events-none before:absolute before:inset-y-6 before:left-7 before:z-10 before:w-px before:bg-border sm:before:left-9">
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
  'rounded-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-brand';

const EVENT_LINK =
  'rounded-sm font-medium text-brand underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-brand';

const ACTIVITY_ICONS = new Map([
  ['app', <Box />],
  ['app.config_updated', <Settings />],
  ['deploy', <Rocket />],
  ['env', <CodeBrackets />],
  ['domain', <Globe />],
]);

function ActivityRow({ row, appSlug }: { row: ResourceActivity; appSlug?: string }) {
  const release = activityResourceId(row.deployment_id) ? row.deployment_id : undefined;
  const mark = outcomeMark(row.kind);
  const failed = mark?.tone === 'critical';
  const title = activityTitle(row.kind);
  const sentence = activitySentence(row);
  const context = title && activityContext(row);
  const actor = actorWords(row.actor);
  const category = row.kind === 'app.deployed' ? 'deploy' : row.kind.split('.')[0];
  const icon = failed ? (
    <WarningCircle />
  ) : (
    (ACTIVITY_ICONS.get(row.kind) ?? ACTIVITY_ICONS.get(category) ?? <Clock />)
  );
  const iconTone = failed
    ? 'border-status-critical/25 bg-status-critical/10 text-status-critical'
    : category === 'deploy'
      ? 'border-brand/20 bg-brand/10 text-brand'
      : 'border-border bg-muted text-muted-foreground';

  return (
    <li
      className={`grid grid-cols-[auto_minmax(0,1fr)] gap-3 px-3 py-3 sm:px-5 ${failed ? 'bg-status-critical/5' : ''}`}
    >
      <span aria-hidden className="relative z-20 size-8 shrink-0 rounded-lg bg-card">
        <span
          className={`flex size-full items-center justify-center rounded-lg border [&>svg]:size-4 ${iconTone}`}
        >
          {icon}
        </span>
      </span>
      <div className="min-w-0 [overflow-wrap:anywhere]">
        <div className="flex items-start justify-between gap-2 sm:gap-4">
          <div className="min-w-0">
            <p
              className={`text-sm leading-5 font-semibold ${failed ? 'text-status-critical' : ''}`}
            >
              {title ?? sentence}
            </p>
            <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              {context && <span className="font-medium text-foreground/85">{context}</span>}
              {(title || !namesActor(row)) && (
                <span>
                  {failed && title ? 'Requested by' : 'by'} {actor}
                </span>
              )}
              {!title && mark && <span>{mark.word}</span>}
            </div>
          </div>
          {parseTime(row.occurred_at) === undefined ? (
            <span className="shrink-0 text-xs text-muted-foreground">Time unknown</span>
          ) : (
            <Timestamp
              value={row.occurred_at}
              mode="clock"
              className="shrink-0 pt-0.5 font-mono text-xs text-muted-foreground tabular-nums"
            />
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
          {release ? (
            <Link
              {...releaseLink(release, { slug: appSlug, panel: 'activity' })}
              className={EVENT_LINK}
            >
              View release
            </Link>
          ) : appSlug && row.kind.startsWith('domain.') ? (
            <Link to="/dashboard/domains" search={{ q: row.resource.label }} className={EVENT_LINK}>
              View domain
            </Link>
          ) : appSlug && (row.kind.startsWith('env.') || row.kind === 'app.config_updated') ? (
            <Link
              to="/dashboard/apps/$appSlug"
              params={{ appSlug }}
              search={{ tab: row.kind.startsWith('env.') ? 'Environment' : 'Runtime' }}
              className={EVENT_LINK}
            >
              {row.kind.startsWith('env.') ? 'View environment' : 'View settings'}
            </Link>
          ) : null}
          <details className="group min-w-0 open:basis-full">
            <summary
              className={`flex w-fit cursor-pointer list-none items-center gap-1 ${QUIET_LINK} [&::-webkit-details-marker]:hidden`}
            >
              <NavArrowRight aria-hidden className="size-3 group-open:rotate-90" />
              Details
            </summary>
            <div className="mt-2 rounded-lg border border-border bg-muted/40 p-3 text-muted-foreground">
              {title && <p className="mb-3 leading-relaxed">{sentence}</p>}
              <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
                <div>
                  <dt>Event type</dt>
                  <dd className="font-mono text-foreground">{row.kind}</dd>
                </div>
                <div>
                  <dt>Actor</dt>
                  <dd className="text-foreground">{actor}</dd>
                </div>
                <div>
                  <dt>Resource</dt>
                  <dd className="text-foreground">{row.resource.label || row.resource.type}</dd>
                </div>
                <div>
                  <dt>Event ID</dt>
                  <dd className="font-mono text-foreground">{row.id}</dd>
                </div>
              </dl>
              {Object.keys(row.data ?? {}).length > 0 && (
                <pre className="mt-3 max-h-48 overflow-auto rounded-md bg-background p-2 whitespace-pre-wrap">
                  {JSON.stringify(row.data, null, 2)}
                </pre>
              )}
            </div>
          </details>
        </div>
      </div>
    </li>
  );
}
