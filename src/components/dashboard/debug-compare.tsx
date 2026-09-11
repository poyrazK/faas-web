import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  ErrorState,
  InlinePhase,
  LoadingState,
  UnreachableState,
  queryPhase,
} from '@/components/dashboard/primitives';
import { ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { useAppDeployments, useCompareDeployments } from '@/lib/api/queries';
import { errorMessage } from '@/lib/api/errors';
import { DebugGate, isPlanGated } from './debug-gate';
import { WINDOWS, type DebugSelection } from './debug-search';

/**
 * Per-route latency for two deployments over one window.
 *
 * The request body calls them `source` and `mirror`, but `debugCompareHandler`
 * runs the same per-route query against each id — no mirror relationship is
 * required. So this answers the question people actually have after shipping:
 * did the new deployment make this route slower than the old one?
 *
 * A missing side means the deployment served no traffic on that route in the
 * window. The API is explicit that it does not synthesise the absent
 * percentiles from the other side, and neither does this: an empty cell reads
 * as "no traffic", never as zero milliseconds.
 */

interface Row {
  id: string;
  route: string;
  sourceP50: number | null;
  sourceP95: number | null;
  sourceCount: number | null;
  mirrorP50: number | null;
  mirrorP95: number | null;
  mirrorCount: number | null;
}

function ms(v: number | null): string {
  return v == null ? '—' : `${v} ms`;
}

/** The delta only means something when both sides actually served traffic. */
function delta(a: number | null, b: number | null): { text: string; color: string } | null {
  if (a == null || b == null) return null;
  if (a === 0 || b === 0)
    return { text: 'Ratio unavailable at zero', color: 'var(--muted-foreground)' };
  const factor = b / a;
  if (factor >= 1.1)
    return { text: `${factor.toFixed(2)}× slower`, color: 'var(--status-critical)' };
  if (factor <= 0.9)
    return { text: `${(1 / factor).toFixed(2)}× faster`, color: 'var(--status-good)' };
  return { text: 'about the same', color: 'var(--muted-foreground)' };
}

export function DebugCompare({
  slug,
  search,
  onSelect,
}: { slug: string } & Partial<DebugSelection>) {
  const [localSince, setSince] = useState('24h');
  const since = search?.debugWindow ?? (search ? '24h' : localSince);

  return (
    <AppDeploymentCompare
      key={slug}
      slug={slug}
      since={since}
      onSinceChange={
        onSelect
          ? (value) => onSelect({ debugWindow: value as DebugSelection['search']['debugWindow'] })
          : setSince
      }
      search={search}
      onSelect={onSelect}
    />
  );
}

function AppDeploymentCompare({
  slug,
  since,
  onSinceChange,
  search,
  onSelect,
}: {
  slug: string;
  since: string;
  onSinceChange: (value: string) => void;
} & Partial<DebugSelection>) {
  const deployments = useAppDeployments(slug);
  const compare = useCompareDeployments(slug);
  const [localSource, setSource] = useState('');
  const [localMirror, setMirror] = useState('');
  const [localRoute, setRoute] = useState('');
  const routeInput = useRef<HTMLInputElement>(null);
  const source = search ? (search.debugSource ?? '') : localSource;
  const mirror = search ? (search.debugMirror ?? '') : localMirror;
  const route = search ? (search.debugRoute ?? '') : localRoute;
  const resetCompare = compare.reset;

  useEffect(() => {
    resetCompare();
  }, [resetCompare, source, mirror, since, route]);

  const deploymentItems = deployments.data?.pages.flatMap((page) => page.items) ?? [];
  const deploymentPhase = queryPhase({
    error: deploymentItems.length === 0 ? deployments.error : undefined,
    loading: deployments.isPending,
    isEmpty: deploymentItems.length === 0,
  });

  const options = deploymentItems.map((d) => ({
    id: d.id,
    label: `${d.id.slice(0, 12)} · ${d.status} · ${d.kind || 'source not reported'} · ${d.created_at || 'time not reported'}`,
  }));

  // A selected id can outlive an app switch. Keep it in the native select only
  // while it belongs to the current app, so a stale id cannot reach compare.
  const sourceId = options.some((option) => option.id === source) ? source : '';
  const mirrorId = options.some((option) => option.id === mirror) ? mirror : '';

  // Mutation variables belong to its data/error, so a response can only be
  // shown beside the controls that requested it. Parameter changes clear the
  // observer, not the controls; keyboard focus and DOM identity survive.
  const currentComparison =
    compare.variables?.source === sourceId &&
    compare.variables?.mirror === mirrorId &&
    compare.variables?.since === since &&
    (compare.variables?.route ?? '') === route;
  const result = currentComparison ? compare.data : undefined;
  const compareError = currentComparison ? compare.error : null;

  const rows: Row[] = (result?.routes ?? []).map((r) => ({
    id: r.route,
    route: r.route,
    sourceP50: r.source_p50_ms ?? null,
    sourceP95: r.source_p95_ms ?? null,
    sourceCount: r.source_count ?? null,
    mirrorP50: r.mirror_p50_ms ?? null,
    mirrorP95: r.mirror_p95_ms ?? null,
    mirrorCount: r.mirror_count ?? null,
  }));

  const columns: Column<Row>[] = [
    {
      key: 'route',
      label: 'Route template',
      render: (r) => <span className="font-mono text-xs">{r.route}</span>,
    },
    {
      key: 'sourceP95',
      label: 'A · p95',
      numeric: true,
      render: (r) => <span className="[font-variant-numeric:tabular-nums]">{ms(r.sourceP95)}</span>,
    },
    {
      key: 'mirrorP95',
      label: 'B · p95',
      numeric: true,
      render: (r) => <span className="[font-variant-numeric:tabular-nums]">{ms(r.mirrorP95)}</span>,
    },
    {
      key: 'id',
      label: 'Change',
      render: (r) => {
        const d = delta(r.sourceP95, r.mirrorP95);
        return d ? (
          <span className="text-xs font-medium" style={{ color: d.color }}>
            {d.text}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">
            No comparable percentile on one or both sides
          </span>
        );
      },
    },
    {
      key: 'sourceCount',
      label: 'A · requests',
      numeric: true,
      render: (r) => (
        <span className="[font-variant-numeric:tabular-nums] text-muted-foreground">
          {r.sourceCount ?? '—'}
        </span>
      ),
    },
    {
      key: 'mirrorCount',
      label: 'B · requests',
      numeric: true,
      render: (r) => (
        <span className="[font-variant-numeric:tabular-nums] text-muted-foreground">
          {r.mirrorCount ?? '—'}
        </span>
      ),
    },
  ];

  const ready = sourceId !== '' && mirrorId !== '' && sourceId !== mirrorId;

  return (
    <DebugGate error={isPlanGated(compareError) ? compareError : null}>
      {deploymentPhase === 'unreachable' ? (
        <UnreachableState onRetry={() => void deployments.refetch()} />
      ) : deploymentPhase === 'error' ? (
        <ErrorState error={deployments.error} onRetry={() => void deployments.refetch()} />
      ) : deploymentPhase === 'loading' ? (
        <LoadingState message="Loading deployment history…" />
      ) : deploymentPhase === 'empty' ? (
        <InlinePhase phase="empty" emptyMessage="No deployments to compare yet." />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            {[['A', setSource] as const, ['B', setMirror] as const].map(([label, set]) => (
              <label key={label} className="flex flex-col gap-1.5">
                <span className="label-mono text-muted-foreground">Deployment {label}</span>
                <select
                  aria-label={`Deployment ${label}`}
                  value={label === 'A' ? sourceId : mirrorId}
                  onChange={(e) =>
                    onSelect
                      ? onSelect(
                          label === 'A'
                            ? { debugSource: e.target.value || undefined }
                            : { debugMirror: e.target.value || undefined }
                        )
                      : set(e.target.value)
                  }
                  className="h-9 min-w-52 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-brand/50"
                >
                  <option value="">Choose a deployment…</option>
                  {options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}

            <label className="flex flex-col gap-1.5">
              <span className="label-mono text-muted-foreground">Window</span>
              <select
                aria-label="Compare window"
                value={since}
                onChange={(e) => onSinceChange(e.target.value)}
                className="h-9 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-brand/50"
              >
                {WINDOWS.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="label-mono text-muted-foreground">Exact route</span>
              <input
                ref={routeInput}
                aria-label="Exact route"
                value={route}
                placeholder="All routes"
                onChange={(event) =>
                  onSelect
                    ? onSelect({ debugRoute: event.target.value || undefined })
                    : setRoute(event.target.value)
                }
                className="h-9 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-brand/50"
              />
            </label>

            <Button
              size="sm"
              disabled={!ready}
              busy={currentComparison && compare.isPending}
              onClick={() =>
                void compare
                  .mutateAsync({
                    source: sourceId,
                    mirror: mirrorId,
                    since,
                    ...(route ? { route } : {}),
                  })
                  .catch(() => undefined)
              }
            >
              Compare
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            A is the baseline selection; B is the current selection. Git ref metadata is not
            returned by deployment history.
          </p>
          {route && (
            <div className="flex items-center gap-3 text-xs">
              <span>
                Comparing route: <code>{route}</code>
              </span>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  if (onSelect) onSelect({ debugRoute: undefined });
                  else setRoute('');
                  routeInput.current?.focus();
                }}
              >
                Compare all routes
              </Button>
            </div>
          )}
          {((source && !sourceId) || (mirror && !mirrorId)) && (
            <p className="text-xs text-muted-foreground">
              A selected deployment is not in the loaded history. Load older deployments or choose
              another; the URL selection is preserved.
            </p>
          )}

          {deployments.hasNextPage && (
            <div className="flex flex-col items-center gap-2">
              <Button
                size="xs"
                variant="outline"
                busy={deployments.isFetchingNextPage}
                onClick={() => void deployments.fetchNextPage().catch(() => undefined)}
              >
                Load older deployments
              </Button>
              {Boolean(deployments.error) && (
                <InlinePhase
                  phase={queryPhase({ error: deployments.error })}
                  error={deployments.error}
                />
              )}
            </div>
          )}

          {sourceId !== '' && sourceId === mirrorId && (
            <p className="text-xs text-[color:var(--status-warning)]">
              Pick two different deployments — comparing one with itself says nothing.
            </p>
          )}

          {compareError && !isPlanGated(compareError) && (
            <p className="text-sm text-[color:var(--status-critical)]">
              {errorMessage(compareError)}
            </p>
          )}

          {result ? (
            <ResourceTable
              rows={rows}
              columns={columns}
              initialSort={{ key: 'route', dir: 'asc' }}
              searchKeys={['route']}
              searchPlaceholder="Filter by route…"
              query={search ? (search.debugQuery ?? '') : undefined}
              onQueryChange={
                onSelect
                  ? (debugQuery) => onSelect({ debugQuery: debugQuery || undefined })
                  : undefined
              }
              emptyMessage={
                search?.debugQuery?.trim()
                  ? 'No returned comparison routes match this text filter.'
                  : route
                    ? 'No comparison traffic was returned for the selected route in this window.'
                    : 'No comparison traffic was returned for these deployments in this window.'
              }
              minWidth="min-w-[860px]"
            />
          ) : (
            <InlinePhase
              phase="empty"
              emptyMessage="Choose two deployments to compare their per-route latency."
            />
          )}
        </div>
      )}
    </DebugGate>
  );
}
