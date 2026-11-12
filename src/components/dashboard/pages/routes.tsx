import { Fragment, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Plus, Search } from 'iconoir-react';
import { HelpTip } from '@/components/dashboard/kit/help-tip';
import {
  ErrorState,
  LoadingState,
  UnreachableState,
  queryPhase,
} from '@/components/dashboard/primitives';
import { Button } from '@/components/ui/button';
import { CopyIconButton } from '@/components/ui/copy-button';
import { useApp, useAppRoutes, useDomains } from '@/lib/api/queries';
import { appRouteUrl, publicAppUrl } from '@/lib/app-url';
import { parseRoute, routesSentence, type RouteLabel } from './route-words';

/**
 * Routes served by an app, from `/v1/apps/{slug}/routes`, in plain words
 * (docs/console-plain-english.md).
 *
 * These are observed at the gateway, not declared — the list is whatever has
 * actually been requested, so there is nothing to create or edit here. The
 * tab opens with which addresses reach the app and how many routes have had
 * traffic; the one thing to add is another address, a custom domain.
 *
 * Route tracking is an app setting (`route_metrics_enabled`, off on Free),
 * and the list can be unreadable when the servers that record it do not
 * answer; the tab says which it is rather than one empty list for all three.
 */

/** Fewer routes than this read at a glance without a filter. */
const FILTER_FROM = 12;

/** A path with a template segment (`{id}`, `:id`, `*`) is not a page anyone can open. */
const isTemplate = (path: string) => /[{}*]|\/:/.test(path);

/**
 * The routes body, without the page chrome around it.
 *
 * Rendered both by the APIs page and as a tab on the app detail page, so
 * the two can never drift into two different implementations of the
 * same resource.
 */
export function RoutesBody({ slug, baseUrl }: { slug: string; baseUrl?: string }) {
  const { data, isPending, error, refetch } = useAppRoutes(slug);
  const app = useApp(slug).data;
  const domains = useDomains().data;
  const [query, setQuery] = useState('');

  const routes = useMemo<RouteLabel[]>(
    () =>
      [...(data?.routes ?? [])]
        .map(parseRoute)
        // Real routes by path, the overflow bucket last.
        .sort((a, b) =>
          a.other !== b.other
            ? Number(a.other) - Number(b.other)
            : (a.path ?? a.raw).localeCompare(b.path ?? b.raw) ||
              (a.method ?? '').localeCompare(b.method ?? '')
        ),
    [data]
  );
  const real = routes.filter((r) => !r.other);
  // The method column only when the labels carry methods at all.
  const methods = real.some((r) => r.method);
  const answer = routesSentence({
    slug,
    tracking: app?.route_metrics_enabled,
    source: data?.source,
    count: real.length,
    other: routes.some((r) => r.other),
    capHit: data?.cap_hit === true,
  });

  // The addresses that reach this app: its own, then its verified custom domains.
  const platform = publicAppUrl(baseUrl);
  const appId = data?.app_id ?? app?.id;
  const custom = (domains ?? []).filter((d) => appId && d.app_id === appId && d.verified);
  const addresses = [
    ...(platform ? [new URL(platform).host] : []),
    ...custom.map((d) => (d.environment ? `${d.domain} (${d.environment} only)` : d.domain)),
  ];

  const phase = queryPhase({ error, loading: isPending });
  if (phase === 'unreachable') return <UnreachableState onRetry={() => void refetch()} />;
  if (phase === 'error') return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (phase === 'loading') return <LoadingState message="Loading routes…" />;

  const primary =
    answer.kind === 'off' ? (
      <Button asChild size="sm">
        <Link to="/dashboard/apps/$appSlug" params={{ appSlug: slug }} search={{ tab: 'Runtime' }}>
          Turn on route tracking
        </Link>
      </Button>
    ) : answer.kind === 'unavailable' ? (
      <Button size="sm" variant="outline" onClick={() => void refetch()}>
        Check again
      </Button>
    ) : (
      <Button asChild size="sm" variant={addresses.length > 0 ? 'outline' : 'default'}>
        <Link to="/dashboard/domains" search={{ add: true }}>
          <Plus className="h-3.5 w-3.5" />
          Add a domain
        </Link>
      </Button>
    );

  const q = query.trim().toLowerCase();
  const shown = q ? routes.filter((r) => r.raw.toLowerCase().includes(q)) : routes;

  return (
    <div className="flex flex-col gap-6">
      <section
        aria-label="Routes at a glance"
        className="well flex flex-col gap-3 rounded-2xl bg-muted/40 px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:gap-6 sm:px-6"
      >
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-xl leading-7 font-medium tracking-[-0.01em] text-balance">
            {answer.lead}
          </p>
          {addresses.length > 0 && answer.kind !== 'off' && (
            <p className="text-sm text-foreground/80 [overflow-wrap:anywhere]">
              Requests reach it at{' '}
              {addresses.map((address, i) => (
                <Fragment key={address}>
                  {i > 0 && (i === addresses.length - 1 ? ' and ' : ', ')}
                  <span className="font-mono text-[13px] text-foreground">{address}</span>
                </Fragment>
              ))}
              .
            </p>
          )}
          {answer.rest && <p className="text-sm text-muted-foreground">{answer.rest}</p>}
        </div>
        <div className="shrink-0">{primary}</div>
      </section>

      {routes.length > 0 && (
        <section
          aria-labelledby="routes-list-title"
          className="surface flex flex-col rounded-[1.25rem] bg-card"
        >
          <header className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-2">
            <div className="flex items-center gap-1">
              <h3 id="routes-list-title" className="text-[15px] font-semibold tracking-[-0.01em]">
                Routes with traffic
              </h3>
              <HelpTip label="About routes">
                Recorded from requests at the gateway, before edge rules rewrite them. Labels use
                your declared templates when there are some; otherwise numeric, UUID and long hex
                segments become {'{id}'}.
              </HelpTip>
            </div>
            {routes.length >= FILTER_FROM && (
              <label className="relative flex w-full items-center sm:w-64">
                <span className="sr-only">Filter by path</span>
                <Search
                  aria-hidden
                  className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-muted-foreground"
                />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Filter by path…"
                  className="h-8 w-full rounded-lg border border-border bg-background pr-3 pl-8 text-sm outline-none focus:border-brand"
                />
              </label>
            )}
          </header>
          {shown.length === 0 ? (
            <p className="px-5 pt-2 pb-5 text-sm text-muted-foreground">
              No route matches “{query}”.
            </p>
          ) : (
            <ul
              aria-label={`Routes on ${slug}`}
              className="flex flex-col divide-y divide-border pb-2"
            >
              {shown.map((route) => (
                <RouteRow
                  key={route.raw}
                  route={route}
                  slug={slug}
                  baseUrl={baseUrl}
                  methods={methods}
                />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

/** "GET /v1/orders → api-gateway", with the full URL one click away. */
function RouteRow({
  route,
  slug,
  baseUrl,
  methods,
}: {
  route: RouteLabel;
  slug: string;
  baseUrl?: string;
  /** Some label has a method, so every row keeps the column. */
  methods: boolean;
}) {
  if (route.other)
    return (
      <li className="flex items-center gap-3 px-5 py-2.5 text-sm" title={route.raw}>
        {methods && <span className="w-14 shrink-0" />}
        <span className="text-muted-foreground">Other routes</span>
        <HelpTip label="About other routes">
          Routes past the tracking limit, counted together under{' '}
          <code className="text-[11px]">{route.raw}</code>.
        </HelpTip>
      </li>
    );

  const url = route.path ? appRouteUrl(baseUrl, route.path) : undefined;
  const openable = url && route.method === 'GET' && route.path && !isTemplate(route.path);
  return (
    <li className="flex items-center gap-3 px-5 py-2.5">
      {methods &&
        (route.method ? (
          <span
            className="inline-flex w-14 shrink-0 justify-center rounded-md bg-muted py-0.5 font-mono text-[11px] text-muted-foreground"
            title={`HTTP method ${route.method}`}
          >
            {route.method}
          </span>
        ) : (
          <span className="w-14 shrink-0" title="No method recorded" />
        ))}
      <span className="min-w-0 flex-1 font-mono text-[13px] [overflow-wrap:anywhere]">
        {openable ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${route.raw}`}
            className="text-brand underline-offset-2 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            {route.path}
          </a>
        ) : (
          (route.path ?? route.raw)
        )}
        <span className="ml-2 hidden font-sans text-xs text-muted-foreground sm:inline">
          → {slug}
        </span>
      </span>
      {url && !openable && <CopyIconButton text={url} label={`${route.raw} URL`} />}
    </li>
  );
}
