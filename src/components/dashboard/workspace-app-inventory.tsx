import { Link } from '@tanstack/react-router';
import { ApiError } from '@/lib/api/errors';
import { useOrgApps, type OrgApp, type WorkspaceTarget } from '@/lib/api/workspace-apps';
import { formatRelative } from '@/lib/mock-data';
import { InlinePhase, Panel, queryPhase } from './primitives';
import { ResourceTable, type Column } from './resource-table';

/**
 * What a shared workspace has, from `GET /v1/orgs/{slug}/apps`.
 *
 * The summary is deliberately small (no creator, no configuration), and every
 * `/v1/apps/{slug}/…` route still answers only the app's creator, so a slug
 * links only when it is one of the signed-in account's own apps — anything
 * else would open a page that cannot load.
 */
export function WorkspaceAppInventory({
  workspace,
  ownSlugs,
}: {
  workspace: WorkspaceTarget & { org: string };
  ownSlugs: ReadonlySet<string>;
}) {
  const q = useOrgApps(workspace.org);
  const code = q.error instanceof ApiError ? q.error.code : '';
  const phase = queryPhase({
    loading: q.isPending,
    error: q.error,
    isEmpty: q.data?.apps.length === 0,
  });
  const columns: Column<OrgApp>[] = [
    {
      key: 'slug',
      label: 'App',
      render: (app) =>
        ownSlugs.has(app.slug) ? (
          <Link
            to="/dashboard/apps/$appSlug"
            params={{ appSlug: app.slug }}
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            {app.slug}
          </Link>
        ) : (
          <span className="font-medium">{app.slug}</span>
        ),
    },
    {
      key: 'type',
      label: 'Type',
      render: (app) => (
        <span className="text-muted-foreground">
          {[app.type, app.runtime].filter(Boolean).join(' · ')}
        </span>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (app) => <span className="text-muted-foreground">{app.status}</span>,
    },
    {
      key: 'created_at',
      label: 'Created',
      render: (app) => (
        <time className="text-muted-foreground" dateTime={app.created_at}>
          {formatRelative(Date.parse(app.created_at))}
        </time>
      ),
    },
  ];
  return (
    <Panel
      title="In this workspace"
      description={`Apps attributed to ${workspace.label}. Settings, deploys, and logs stay with each app's creator, so only apps you created open from here.`}
    >
      {code === 'org_role_forbidden' ? (
        <p className="text-sm text-muted-foreground">
          You are not an active member of {workspace.label} with permission to view its apps. An
          owner or admin can invite you or change your role.
        </p>
      ) : code === 'org_not_found' ? (
        <p className="text-sm text-muted-foreground">
          {workspace.label} is no longer available. Choose another workspace in the switcher.
        </p>
      ) : phase !== 'ready' ? (
        <InlinePhase
          phase={phase}
          error={q.error}
          loadingMessage={`Loading ${workspace.label}'s apps…`}
          emptyMessage={`No apps are attributed to ${workspace.label} yet. Apps you create while it is selected are added here.`}
          onRetry={() => void q.refetch()}
        />
      ) : (
        <ResourceTable
          rows={q.data!.apps}
          columns={columns}
          initialSort={{ key: 'created_at', dir: 'desc' }}
          minWidth="min-w-[520px]"
        />
      )}
    </Panel>
  );
}
