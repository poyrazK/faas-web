import { useMemo } from 'react';
import { WarningTriangle } from 'iconoir-react';
import { ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { useAppRoutes } from '@/lib/api/queries';
import { appRouteUrl } from '@/lib/app-url';
import { CopyIconButton } from '@/components/ui/copy-button';

/**
 * Routes served by an app, from `/v1/apps/{slug}/routes`.
 *
 * These are observed at the gateway, not declared — the list is whatever has
 * actually been requested, which is why there is nothing to create or edit here.
 *
 * The endpoint is plan-gated: per-route observability is off for Free, and the
 * response says `source: 'unavailable'` when it is. That is a different thing
 * from an app with no traffic, and the page has to say which it is rather than
 * showing the same empty table for both.
 */
interface RouteRow {
  id: string;
  path: string;
}

/**
 * The apis body, without the page chrome around it.
 *
 * Rendered both by this route and as a tab on the app detail page, so
 * the two can never drift into two different implementations of the
 * same resource.
 */
export function RoutesBody({ slug, baseUrl }: { slug: string; baseUrl?: string }) {
  const { data, isPending, error, refetch } = useAppRoutes(slug);

  const rows = useMemo<RouteRow[]>(
    () => (data?.routes ?? []).map((path) => ({ id: path, path })),
    [data]
  );

  const columns: Column<RouteRow>[] = [
    {
      key: 'path',
      label: 'Route',
      render: (r) => {
        const match = /^([A-Z]+) (\/.*)$/.exec(r.path);
        const url = match ? appRouteUrl(baseUrl, match[2]) : undefined;
        if (!url) return <span className="font-mono text-xs">{r.path}</span>;
        return (
          <span className="inline-flex items-center gap-1 font-mono text-xs">
            {match?.[1] === 'GET' ? (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Open ${r.path}`}
                className="text-brand underline-offset-2 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                {r.path}
              </a>
            ) : (
              <span>{r.path}</span>
            )}
            {match?.[1] !== 'GET' && <CopyIconButton text={url} label={`${r.path} URL`} />}
          </span>
        );
      },
    },
  ];

  const unavailable = data?.source === 'unavailable';

  return (
    <div className="flex flex-col gap-6">
      <div className="max-w-2xl">
        <h2 className="text-base font-medium">See which routes receive traffic</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          These paths appeared in requests to {slug}. Routes are defined in your app’s code; this
          list fills in as traffic arrives.
        </p>
      </div>
      {unavailable && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-lg border px-3 py-2 text-xs"
          style={{ borderColor: 'color-mix(in oklab, var(--status-warning) 40%, transparent)' }}
        >
          <WarningTriangle
            className="mt-px h-3.5 w-3.5 shrink-0"
            style={{ color: 'var(--status-warning)' }}
          />
          Per-route metrics are not enabled for this app, so no routes can be listed. This is a paid
          plan feature.
        </p>
      )}

      {data?.cap_hit && (
        <p className="text-xs text-muted-foreground">
          The route list hit its cap — some low-traffic routes are not shown.
        </p>
      )}

      <ResourceTable
        rows={rows}
        columns={columns}
        initialSort={{ key: 'path', dir: 'asc' }}
        searchKeys={['path']}
        searchPlaceholder="Filter by path…"
        emptyMessage={
          unavailable
            ? 'Route metrics are disabled for this app.'
            : slug
              ? `No routes observed for ${slug} yet.`
              : 'Create an app first.'
        }
        minWidth="min-w-0"
        loading={isPending}
        error={error}
        onRetry={() => void refetch()}
      />
    </div>
  );
}
