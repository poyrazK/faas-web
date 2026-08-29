import { useMemo } from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Plus } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { PageHeader, StateBadge } from '@/components/dashboard/primitives';
import { ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { Select } from '@/components/ui/field';
import {
  formatCompact,
  formatMs,
  formatRelative,
  type RunState,
  type Workflow,
} from '@/lib/mock-data';
import { useData } from '@/lib/store';
import { cn } from '@/lib/utils';
import { consoleHead } from '@/lib/seo';

const STATE_FILTERS: { key: RunState | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'running', label: 'Running' },
  { key: 'idle', label: 'Idle' },
  { key: 'undeployed', label: 'Undeployed' },
  { key: 'error', label: 'Failing' },
  { key: 'deploying', label: 'Deploying' },
];

const STATE_KEYS = STATE_FILTERS.map((f) => f.key);

export const Route = createFileRoute('/dashboard/workflows/')({
  head: () => consoleHead('workflows'),
  component: FunctionsPage,
  // Filters live in the URL, so a reload keeps them and "the failing apps"
  // is a link someone can be sent. All optional: the defaults leave no query
  // string behind.
  validateSearch: (
    search: Record<string, unknown>
  ): { q?: string; state?: RunState | 'all'; runtime?: string } => ({
    ...(typeof search.q === 'string' && search.q ? { q: search.q } : {}),
    ...(STATE_KEYS.includes(search.state as RunState | 'all') && search.state !== 'all'
      ? { state: search.state as RunState }
      : {}),
    ...(typeof search.runtime === 'string' && search.runtime && search.runtime !== 'all'
      ? { runtime: search.runtime }
      : {}),
  }),
});

/**
 * Shared with every other resource page: columns + rows into ResourceTable,
 * which owns sorting, the skeleton, and the read states. This page used to
 * hand-roll its own table — its own sort logic, its own filter row, and rows
 * that were click-only — and was the one place keyboard users could not open
 * a row. The chips and runtime select ride in the table's `filters` slot;
 * the query stays in the URL.
 */
const COLUMNS: Column<Workflow>[] = [
  {
    key: 'name',
    label: 'Function',
    render: (fn) => (
      <>
        <span className="font-mono">{fn.name}</span>
        <p className="mt-0.5 text-xs text-muted-foreground">{fn.runtime}</p>
      </>
    ),
  },
  { key: 'state', label: 'State', render: (fn) => <StateBadge state={fn.state} /> },
  {
    key: 'runtime',
    label: 'Runtime',
    render: (fn) => (
      <span className="text-muted-foreground">
        <span className="font-mono text-xs">{fn.runtime}</span>
        <p className="mt-0.5 text-xs">{fn.memoryMb} MB</p>
      </span>
    ),
  },
  {
    key: 'invocations24h',
    label: 'Invocations 24h',
    numeric: true,
    render: (fn) => <>{formatCompact(fn.invocations24h)}</>,
  },
  {
    key: 'avgDurationMs',
    label: 'Avg duration',
    numeric: true,
    render: (fn) => <>{formatMs(fn.avgDurationMs)}</>,
  },
  {
    key: 'errorRatePct',
    label: 'Errors',
    numeric: true,
    render: (fn) => (
      <span style={{ color: fn.errorRatePct > 1 ? 'var(--status-critical)' : undefined }}>
        {fn.errorRatePct.toFixed(2)}%
      </span>
    ),
  },
  {
    key: 'lastDeployedAt',
    label: 'Deployed',
    numeric: true,
    render: (fn) => (
      <span className="text-muted-foreground">{formatRelative(fn.lastDeployedAt)}</span>
    ),
  },
];

function FunctionsPage() {
  const { q: query = '', state = 'all', runtime = 'all' } = Route.useSearch();
  const routeNavigate = Route.useNavigate();
  // Filter changes replace rather than push — refining a filter is not
  // history the back button should replay keystroke by keystroke.
  const setQuery = (next: string) =>
    routeNavigate({ search: (prev) => ({ ...prev, q: next || undefined }), replace: true });
  const setState = (next: RunState | 'all') =>
    routeNavigate({
      search: (prev) => ({ ...prev, state: next === 'all' ? undefined : next }),
      replace: true,
    });
  // Was a project filter. The API has no projects — apps are flat per account —
  // so this filters on the one grouping that is real: the runtime.
  const setRuntime = (next: string) =>
    routeNavigate({
      search: (prev) => ({ ...prev, runtime: next === 'all' ? undefined : next }),
      replace: true,
    });
  const { workflows, loading, error, refresh } = useData();
  const navigate = useNavigate();

  // The chip and select filters apply here; the text query applies inside the
  // table, which also announces the result count.
  const rows = useMemo(
    () =>
      workflows.filter((fn) => {
        if (state !== 'all' && fn.state !== state) return false;
        if (runtime !== 'all' && fn.runtime !== runtime) return false;
        return true;
      }),
    [workflows, state, runtime]
  );

  // Built from what is actually deployed rather than a fixed list, so the
  // filter never offers a runtime with nothing behind it.
  const runtimes = useMemo(
    () => [...new Set(workflows.map((fn) => fn.runtime))].filter(Boolean).sort(),
    [workflows]
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

      <ResourceTable
        rows={rows}
        columns={COLUMNS}
        initialSort={{ key: 'invocations24h', dir: 'desc' }}
        searchKeys={['name', 'runtime']}
        searchPlaceholder="Filter by name or runtime…"
        query={query}
        onQueryChange={setQuery}
        filters={
          <>
            <div className="flex rounded-md border border-border p-0.5">
              {STATE_FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={state === f.key}
                  onClick={() => setState(f.key)}
                  className={cn(
                    'pressable rounded px-2.5 py-1 text-xs',
                    state === f.key
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <Select
              value={runtime}
              onChange={(e) => setRuntime(e.target.value)}
              aria-label="Filter by runtime"
              className="bg-card px-2.5"
            >
              <option value="all">All runtimes</option>
              {runtimes.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </>
        }
        emptyMessage={
          workflows.length === 0 ? 'No apps on this account yet.' : 'No apps match these filters.'
        }
        loading={loading}
        error={error}
        onRetry={refresh}
        onRowClick={(fn) =>
          navigate({ to: '/dashboard/workflows/$workflowId', params: { workflowId: fn.id } })
        }
      />
    </div>
  );
}
