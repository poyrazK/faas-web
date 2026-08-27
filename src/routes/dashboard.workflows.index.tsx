import { useMemo, useState } from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ArrowDown, ArrowUp, Plus, Search } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StateBadge,
} from '@/components/dashboard/primitives';
import { formatCompact, formatMs, formatRelative, type RunState } from '@/lib/mock-data';
import { useData } from '@/lib/store';
import { cn } from '@/lib/utils';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/workflows/')({
  head: () => consoleHead('workflows'),
  component: FunctionsPage,
});

const STATE_FILTERS: { key: RunState | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'running', label: 'Running' },
  { key: 'idle', label: 'Idle' },
  { key: 'undeployed', label: 'Undeployed' },
  { key: 'error', label: 'Failing' },
  { key: 'deploying', label: 'Deploying' },
];

type SortKey =
  | 'name'
  | 'state'
  | 'runtime'
  | 'invocations24h'
  | 'avgDurationMs'
  | 'errorRatePct'
  | 'lastDeployedAt';

const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: 'name', label: 'Function', numeric: false },
  { key: 'state', label: 'State', numeric: false },
  { key: 'runtime', label: 'Runtime', numeric: false },
  { key: 'invocations24h', label: 'Invocations 24h', numeric: true },
  { key: 'avgDurationMs', label: 'Avg duration', numeric: true },
  { key: 'errorRatePct', label: 'Errors', numeric: true },
  { key: 'lastDeployedAt', label: 'Deployed', numeric: true },
];

function FunctionsPage() {
  const [query, setQuery] = useState('');
  const [state, setState] = useState<RunState | 'all'>('all');
  // Was a project filter. The API has no projects — apps are flat per account —
  // so this filters on the one grouping that is real: the runtime.
  const [runtime, setRuntime] = useState<string>('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({
    key: 'invocations24h',
    dir: 'desc',
  });
  const { workflows, loading, error, refresh } = useData();
  const navigate = useNavigate();

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = workflows.filter((fn) => {
      if (state !== 'all' && fn.state !== state) return false;
      if (runtime !== 'all' && fn.runtime !== runtime) return false;
      if (q && !fn.name.toLowerCase().includes(q) && !fn.runtime.toLowerCase().includes(q))
        return false;
      return true;
    });

    const factor = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * factor;
      return String(av).localeCompare(String(bv)) * factor;
    });
  }, [workflows, query, state, runtime, sort]);

  // Built from what is actually deployed rather than a fixed list, so the
  // filter never offers a runtime with nothing behind it.
  const runtimes = useMemo(
    () => [...new Set(workflows.map((fn) => fn.runtime))].filter(Boolean).sort(),
    [workflows]
  );

  // Text columns read naturally A→Z first; numbers most-interesting first.
  const toggleSort = (key: SortKey, numeric: boolean) =>
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: numeric ? 'desc' : 'asc' }
    );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Apps"
        description="Every app in this workspace."
        actions={
          <Button asChild size="sm" className="gap-1.5">
            <Link to="/dashboard/workflows/new">
              <Plus className="h-3.5 w-3.5" />
              New app
            </Link>
          </Button>
        }
      />

      {/* Filters — one row above the table */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative flex min-w-56 flex-1 items-center sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name or runtime…"
            className="h-9 w-full rounded-md border border-border bg-card pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-brand/50"
          />
        </label>

        <div className="flex rounded-md border border-border p-0.5">
          {STATE_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={state === f.key}
              onClick={() => setState(f.key)}
              className={cn(
                'rounded px-2.5 py-1 text-xs transition-colors',
                state === f.key
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <select
          value={runtime}
          onChange={(e) => setRuntime(e.target.value)}
          aria-label="Filter by runtime"
          className="h-9 rounded-md border border-border bg-card px-2.5 text-sm outline-none focus:border-brand/50"
        >
          <option value="all">All runtimes</option>
          {runtimes.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>

        <span className="ml-auto text-xs text-muted-foreground [font-variant-numeric:tabular-nums]">
          {rows.length} of {workflows.length}
        </span>
      </div>

      {error ? (
        <ErrorState error={error} onRetry={refresh} />
      ) : loading ? (
        <LoadingState message="Loading apps…" />
      ) : rows.length === 0 ? (
        <EmptyState
          message={
            workflows.length === 0
              ? 'No apps on this account yet.'
              : 'No workflows match these filters.'
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="sticky top-14 z-10 bg-card">
                <tr className="border-b border-border text-left">
                  {COLUMNS.map((col) => {
                    const isSorted = sort.key === col.key;
                    return (
                      <th
                        key={col.key}
                        scope="col"
                        aria-sort={
                          isSorted ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'
                        }
                        className={cn('px-4 py-3', col.numeric && 'text-right')}
                      >
                        <button
                          type="button"
                          onClick={() => toggleSort(col.key, col.numeric)}
                          className={cn(
                            'label-mono inline-flex items-center gap-1 transition-colors hover:text-foreground',
                            col.numeric && 'flex-row-reverse',
                            isSorted ? 'text-foreground' : 'text-muted-foreground'
                          )}
                        >
                          {col.label}
                          {isSorted &&
                            (sort.dir === 'asc' ? (
                              <ArrowUp className="h-3 w-3" />
                            ) : (
                              <ArrowDown className="h-3 w-3" />
                            ))}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((fn) => (
                  // The whole row is a click target for convenience; the name
                  // link remains the keyboard-navigable element, so the row
                  // itself is deliberately not a tab stop.
                  <tr
                    key={fn.id}
                    onClick={() =>
                      navigate({
                        to: '/dashboard/workflows/$workflowId',
                        params: { workflowId: fn.id },
                      })
                    }
                    className="group cursor-pointer transition-colors hover:bg-muted/40"
                  >
                    <td className="px-4 py-3">
                      <Link
                        to="/dashboard/workflows/$workflowId"
                        params={{ workflowId: fn.id }}
                        // The link navigates on its own; do not let the row fire a second time.
                        onClick={(e) => e.stopPropagation()}
                        className="font-mono group-hover:text-brand"
                      >
                        {fn.name}
                      </Link>
                      <p className="mt-0.5 text-xs text-muted-foreground">{fn.runtime}</p>
                    </td>
                    <td className="px-4 py-3">
                      <StateBadge state={fn.state} />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      <span className="font-mono text-xs">{fn.runtime}</span>
                      <p className="mt-0.5 text-xs">{fn.memoryMb} MB</p>
                    </td>
                    <td className="px-4 py-3 text-right [font-variant-numeric:tabular-nums]">
                      {formatCompact(fn.invocations24h)}
                    </td>
                    <td className="px-4 py-3 text-right [font-variant-numeric:tabular-nums]">
                      {formatMs(fn.avgDurationMs)}
                    </td>
                    <td
                      className="px-4 py-3 text-right [font-variant-numeric:tabular-nums]"
                      style={{
                        color: fn.errorRatePct > 1 ? 'var(--status-critical)' : undefined,
                      }}
                    >
                      {fn.errorRatePct.toFixed(2)}%
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground [font-variant-numeric:tabular-nums]">
                      {formatRelative(fn.lastDeployedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
