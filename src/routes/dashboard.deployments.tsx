import { useMemo } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { InlinePhase, PageHeader, queryPhase } from '@/components/dashboard/primitives';
import { Pill, ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { formatRelative } from '@/lib/mock-data';
import {
  useApps,
  useBuildRecords,
  useInfiniteBuilds,
  useInfiniteDeployments,
} from '@/lib/api/queries';
import type { components } from '@/lib/api/schema';
import { Button } from '@/components/ui/button';
import { ReleaseDetailPanel } from '@/components/dashboard/release-detail';
import {
  sourceSize,
  validateReleasesSearch,
  type ReleasesSearch,
} from '@/components/dashboard/releases-search';
import { consoleHead } from '@/lib/seo';
import { releaseStatusColor } from '@/components/dashboard/release-status';

export const Route = createFileRoute('/dashboard/deployments')({
  component: DeploymentsPage,
  validateSearch: validateReleasesSearch,
  head: () => consoleHead('deployments'),
});

type Build = components['schemas']['BuildResponse'];
type Deployment = components['schemas']['DeploymentResponse'];
interface ReleaseRow {
  id: string;
  deploymentId?: string;
  buildId?: string;
  image: string;
  app: string;
  status: string;
  buildStatus: string;
  source: string;
  failure: string;
  sourceBytes?: number;
  duration?: number;
  createdAt: string;
}

export function DeploymentsPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const apps = useApps();
  const deploymentsQuery = useInfiniteDeployments();
  const buildsQuery = useInfiniteBuilds();
  const view = search.view ?? (search.build && !search.deployment ? 'builds' : 'releases');
  const select = (patch: Partial<ReleasesSearch>, replace = false) => {
    void navigate({
      search: (current) => ({ ...current, ...patch }),
      hash: true,
      replace,
      resetScroll: false,
    });
  };
  const builds = useMemo(
    () => buildsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [buildsQuery.data]
  );
  const deployments = useMemo(
    () => deploymentsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [deploymentsQuery.data]
  );
  const missingBuilds = useBuildRecords(
    view === 'releases'
      ? deployments.flatMap((deployment) =>
          deployment.build_id && !builds.some((build) => build.id === deployment.build_id)
            ? [deployment.build_id]
            : []
        )
      : []
  );
  const joinedBuilds = useMemo(() => {
    const byId = new Map(builds.map((build) => [build.id, build]));
    for (const result of missingBuilds) if (result.data) byId.set(result.data.id, result.data);
    const byDeployment = new Map<string, Build>();
    for (const build of builds) {
      const previous = byDeployment.get(build.deployment_id);
      if (!previous || build.enqueued_at > previous.enqueued_at)
        byDeployment.set(build.deployment_id, build);
    }
    return new Map(
      deployments.map((deployment) => [
        deployment.id,
        deployment.build_id ? byId.get(deployment.build_id) : byDeployment.get(deployment.id),
      ])
    );
  }, [builds, deployments, missingBuilds]);
  const appById = useMemo(
    () => new Map((apps.data ?? []).map((app) => [app.id, app.slug])),
    [apps.data]
  );
  const rows = useMemo<ReleaseRow[]>(() => {
    const row = (build?: Build, deployment?: Deployment): ReleaseRow => ({
      id: deployment?.id ?? build!.id,
      deploymentId: deployment?.id,
      buildId: build?.id,
      image: deployment?.image_digest ?? '',
      app: deployment ? (appById.get(deployment.app_id) ?? deployment.app_id) : '—',
      status: deployment?.status ?? build!.status,
      buildStatus: build?.status ?? '—',
      source: build?.kind ?? deployment?.kind ?? '—',
      failure: build?.failure_class ?? '',
      sourceBytes: build?.source_bytes,
      duration: build?.duration_seconds,
      createdAt: deployment?.created_at ?? build!.enqueued_at,
    });
    const result =
      view === 'builds'
        ? builds.map((build) => row(build))
        : deployments.map((deployment) => row(joinedBuilds.get(deployment.id), deployment));
    return result.filter(
      (item) =>
        (!search.status || item.status === search.status) &&
        (!search.kind || item.source === search.kind)
    );
  }, [builds, deployments, joinedBuilds, appById, view, search.status, search.kind]);
  const currentQuery = view === 'builds' ? buildsQuery : deploymentsQuery;
  const loadedItems = view === 'builds' ? builds : deployments;
  const error =
    view === 'releases'
      ? (apps.error ?? (loadedItems.length === 0 ? currentQuery.error : undefined))
      : loadedItems.length === 0
        ? currentQuery.error
        : undefined;
  const retry = () => {
    if (view === 'releases') void apps.refetch();
    void currentQuery.refetch();
  };
  const columns: Column<ReleaseRow>[] = [
    {
      key: 'status',
      label: view === 'builds' ? 'Build status' : 'Deployment state',
      render: (r) => <Pill label={r.status} color={releaseStatusColor(r.status)} />,
    },
    {
      key: 'id',
      label: view === 'builds' ? 'Build' : 'Release',
      render: (r) => (
        <span className="flex min-w-0 flex-col">
          <span className="font-mono text-xs">{r.id}</span>
          {r.image && (
            <span className="truncate text-xs text-muted-foreground">image {r.image}</span>
          )}
        </span>
      ),
    },
    ...(view === 'releases'
      ? [
          { key: 'app' as const, label: 'App' },
          {
            key: 'buildStatus' as const,
            label: 'Build status',
            priority: 'secondary' as const,
            render: (r: ReleaseRow) => (
              <Pill label={r.buildStatus} color={releaseStatusColor(r.buildStatus)} />
            ),
          },
        ]
      : []),
    { key: 'source', label: 'Source', priority: 'secondary' },
    {
      key: 'failure',
      label: 'Failure',
      priority: 'secondary',
      render: (r) =>
        r.failure ? (
          <Pill
            label={r.failure}
            color={r.failure === 'user_error' ? 'var(--status-warning)' : 'var(--status-critical)'}
          />
        ) : (
          '—'
        ),
    },
    {
      key: 'sourceBytes',
      label: 'Source size',
      priority: 'secondary',
      numeric: true,
      render: (r) => (r.sourceBytes == null ? '—' : sourceSize(r.sourceBytes)),
    },
    {
      key: 'duration',
      label: 'Duration',
      priority: 'secondary',
      numeric: true,
      render: (r) => (r.duration == null ? '—' : `${r.duration}s`),
    },
    {
      key: 'createdAt',
      label: 'When',
      priority: 'secondary',
      numeric: true,
      render: (r) => formatRelative(Date.parse(r.createdAt)),
    },
  ];
  const selected = deployments.find((deployment) => deployment.id === search.deployment);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Releases" description="Deployment history and the builds behind it." />
      <nav aria-label="Releases views" className="flex flex-wrap gap-2 border-b border-border pb-3">
        {(['releases', 'builds'] as const).map((value) => (
          <Link
            key={value}
            to="/dashboard/deployments"
            search={(current) => ({
              ...current,
              view: value,
              deployment: undefined,
              build: undefined,
              releaseSection: undefined,
            })}
            hash
            aria-current={view === value ? 'page' : undefined}
            className={
              view === value
                ? 'rounded-md bg-muted px-3 py-2 text-sm font-medium'
                : 'rounded-md px-3 py-2 text-sm text-muted-foreground'
            }
          >
            {value === 'releases' ? 'Releases' : 'Builds'}
          </Link>
        ))}
      </nav>
      {view === 'builds' && (
        <p className="text-sm text-muted-foreground">
          All image builds, including builds without an attached deployment.
        </p>
      )}
      <ResourceTable
        rows={rows}
        columns={columns}
        initialSort={{ key: 'createdAt', dir: 'desc' }}
        query={search.q ?? ''}
        onQueryChange={(q) => select({ q: q || undefined }, true)}
        searchKeys={['id', 'image', 'app', 'status', 'source', 'failure', 'buildId', 'buildStatus']}
        searchPlaceholder="Filter by release, build, image or source…"
        emptyMessage={
          loadedItems.length
            ? `No ${view === 'builds' ? 'builds' : 'releases'} match these filters.`
            : view === 'builds'
              ? 'No builds yet.'
              : 'No releases yet.'
        }
        emptyAction={
          loadedItems.length ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => select({ q: undefined, status: undefined, kind: undefined })}
            >
              Clear filters
            </Button>
          ) : (
            <Button asChild size="sm">
              <Link to="/dashboard/workflows">Choose an app to deploy</Link>
            </Button>
          )
        }
        loading={
          loadedItems.length === 0 &&
          (currentQuery.isPending || (view === 'releases' && apps.isPending))
        }
        error={error}
        onRetry={retry}
        filters={
          <>
            <label className="text-xs text-muted-foreground">
              Status{' '}
              <input
                aria-label="Status filter"
                value={search.status ?? ''}
                onChange={(event) => select({ status: event.target.value || undefined }, true)}
                className="rounded-md border border-border bg-background p-2"
              />
            </label>
            <label className="text-xs text-muted-foreground">
              Source{' '}
              <select
                aria-label="Source filter"
                value={search.kind ?? ''}
                onChange={(event) => select({ kind: event.target.value || undefined }, true)}
                className="rounded-md border border-border bg-background p-2"
              >
                <option value="">All sources</option>
                {['github', 'tarball', 'railpack', 'dockerfile'].map((kind) => (
                  <option key={kind}>{kind}</option>
                ))}
              </select>
            </label>
          </>
        }
        onRowClick={(row) =>
          select({
            deployment: row.deploymentId,
            build: row.deploymentId ? undefined : row.buildId,
            releaseSection: undefined,
          })
        }
      />
      {loadedItems.length > 0 && Boolean(currentQuery.error) && (
        <div className="flex flex-wrap items-center justify-center gap-3">
          <InlinePhase
            phase={queryPhase({ error: currentQuery.error })}
            error={currentQuery.error}
          />
          <Button
            size="xs"
            variant="ghost"
            onClick={() =>
              void (
                currentQuery.isFetchNextPageError
                  ? currentQuery.fetchNextPage()
                  : currentQuery.refetch()
              ).catch(() => undefined)
            }
          >
            Retry
          </Button>
        </div>
      )}
      {view === 'releases' && Boolean(buildsQuery.error) && (
        <div className="flex items-center gap-3">
          <InlinePhase phase={queryPhase({ error: buildsQuery.error })} error={buildsQuery.error} />
          <Button size="xs" variant="ghost" onClick={() => void buildsQuery.refetch()}>
            Retry build evidence
          </Button>
        </div>
      )}
      {currentQuery.hasNextPage && (
        <div className="flex justify-center">
          <Button
            size="sm"
            variant="outline"
            busy={currentQuery.isFetchingNextPage}
            onClick={() => void currentQuery.fetchNextPage().catch(() => undefined)}
          >
            Load older {view === 'builds' ? 'builds' : 'deployments'}
          </Button>
        </div>
      )}
      {view === 'releases' && buildsQuery.hasNextPage && (
        <Button
          size="xs"
          variant="ghost"
          busy={buildsQuery.isFetchingNextPage}
          onClick={() => void buildsQuery.fetchNextPage().catch(() => undefined)}
        >
          Load older build evidence
        </Button>
      )}
      {(search.deployment || search.build) && (
        <ReleaseDetailPanel
          key={search.deployment ?? search.build}
          deploymentId={search.deployment}
          buildId={search.build}
          fallbackBuildId={selected ? joinedBuilds.get(selected.id)?.id : undefined}
          section={search.releaseSection ?? 'overview'}
          onSectionChange={(releaseSection, replace) => select({ releaseSection }, replace)}
          onClose={() =>
            select({ deployment: undefined, build: undefined, releaseSection: undefined })
          }
        />
      )}
      {selected && appById.has(selected.app_id) && (
        <Link
          to="/dashboard/workflows/$workflowId"
          params={{ workflowId: appById.get(selected.app_id)! }}
          search={{
            tab: 'Deployments',
            deployment: selected.id,
            releaseSection: search.releaseSection,
          }}
        >
          Open {appById.get(selected.app_id)}
        </Link>
      )}
    </div>
  );
}
