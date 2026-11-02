import { useEffect, useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Bookmark, Xmark } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  UnreachableState,
  queryPhase,
} from '@/components/dashboard/primitives';
import { AppScope, AppSelect, useSelectedApp } from '@/components/dashboard/app-select';
import {
  logFilters,
  logsSearch,
  validateLogsSearch,
  type LogFilters,
  type LogsSearch,
} from '@/components/dashboard/logs-search';
import { slugIndex, toDeployment } from '@/lib/api/adapters';
import { useAppDeployments } from '@/lib/api/queries';
import { consoleHead } from '@/lib/seo';
import { DeploymentGate, NotLiveNotice } from '@/components/dashboard/deployment-gate';
import { hasLogSource, hasRunnableDeployment } from '@/lib/deployment-status';
import { LogsBody } from '@/components/dashboard/pages/logs';

export const Route = createFileRoute('/dashboard/logs')({
  component: LogsPage,
  head: () => consoleHead('logs'),
  validateSearch: validateLogsSearch,
});

/* ------------------------------------------------------------------ *
 * Saved views — named filter sets, kept in the browser
 * ------------------------------------------------------------------ */

interface SavedView extends LogsSearch {
  name: string;
  app: string;
}

const VIEWS_KEY = 'gregale.logs.views';

function readViews(): SavedView[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(VIEWS_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((value) => {
      if (
        !value ||
        typeof value !== 'object' ||
        typeof value.name !== 'string' ||
        !value.name.trim()
      )
        return [];
      const search = validateLogsSearch(value);
      return search.app ? [{ ...search, app: search.app, name: value.name }] : [];
    });
  } catch {
    return [];
  }
}

function writeViews(views: SavedView[]) {
  try {
    window.localStorage.setItem(VIEWS_KEY, JSON.stringify(views));
  } catch {
    // Storage can be denied; views simply do not persist.
  }
}

function SavedViewsMenu({
  current,
  onApply,
}: {
  /** Snapshot of the filters as they stand, name not yet chosen. */
  current: () => Omit<SavedView, 'name'>;
  onApply: (view: SavedView) => void;
}) {
  const [views, setViews] = useState<SavedView[]>(() =>
    typeof window === 'undefined' ? [] : readViews()
  );
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const next = [...views.filter((v) => v.name !== trimmed), { name: trimmed, ...current() }];
    setViews(next);
    writeViews(next);
    setNaming(false);
    setName('');
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5">
            <Bookmark className="h-3.5 w-3.5" />
            Views
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {views.length === 0 && (
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              No saved views yet.
            </DropdownMenuLabel>
          )}
          {views.map((v) => (
            <DropdownMenuItem
              key={v.name}
              onSelect={() => onApply(v)}
              className="flex items-center gap-3"
            >
              <span className="truncate">{v.name}</span>
              <span className="ml-auto truncate font-mono text-xs text-muted-foreground">
                {v.app}
                {v.level ? ` · ${v.level}` : ''}
              </span>
              <button
                type="button"
                aria-label={`Delete view ${v.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  const next = views.filter((x) => x.name !== v.name);
                  setViews(next);
                  writeViews(next);
                }}
                className="pressable rounded p-0.5 text-muted-foreground hover:text-foreground"
              >
                <Xmark className="h-3 w-3" />
              </button>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setNaming(true)}>Save current view…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Modal
        open={naming}
        onClose={() => setNaming(false)}
        title="Save this view"
        description="App, level, search, source, and archive instance/date — as they stand now."
        footer={
          <Button size="sm" disabled={!name.trim()} onClick={save}>
            Save view
          </Button>
        }
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
          }}
          placeholder="errors on api-gateway"
          aria-label="View name"
          className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-brand"
        />
      </Modal>
    </>
  );
}

function LogsPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const appState = useSelectedApp();
  const { select, apps } = appState;
  const slug = search.app
    ? apps.some((app) => app.slug === search.app)
      ? search.app
      : ''
    : appState.slug;
  const filters = logFilters(search);
  // The account-wide feed is intentionally capped. Reading it here meant a
  // busy workspace could hide this app's only runnable deployment behind the
  // global page boundary, so Logs now gates on the app-scoped history query.
  const deploymentsQuery = useAppDeployments(slug);
  const selectedDeployments = useMemo(() => {
    const bySlug = slugIndex(apps);
    return (deploymentsQuery.data?.pages.flatMap((page) => page.items) ?? []).map((deployment) =>
      toDeployment(deployment, bySlug)
    );
  }, [apps, deploymentsQuery.data]);
  const deploymentsPhase = queryPhase({
    error: deploymentsQuery.error,
    loading: deploymentsQuery.isPending,
  });

  // Canonical defaults replace the current entry; explicit edits add history.
  useEffect(() => {
    if (slug && (!search.app || (search.mode === 'archive' && !search.date))) {
      void navigate({ replace: true, search: logsSearch(logFilters(search), slug) });
    }
  }, [slug, search, navigate]);

  const syncUrl = (next: LogFilters, app: string, replace = false) => {
    void navigate({ replace, search: logsSearch(next, app) });
  };
  const applyView = (view: SavedView) => {
    void navigate({ search: validateLogsSearch({ ...view }) });
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Logs"
        description="Live output from this app's instances. The stream ends on its own when the app parks. Filters live in the URL — the page is a shareable link."
        actions={
          <div className="flex items-center gap-2">
            <SavedViewsMenu
              current={() => ({ ...logsSearch(filters, slug), app: slug })}
              onApply={applyView}
            />
            <AppSelect
              slug={search.app ?? slug}
              onSelect={(next) => {
                select(next);
                syncUrl({ ...filters, instance: '' }, next);
              }}
              apps={apps}
            />
          </div>
        }
      />
      <AppScope state={appState} resource="logs">
        {search.app && !slug ? (
          <EmptyState
            message={`The app “${search.app}” is unavailable in this account. It may have been deleted or your access may have changed. Choose an accessible app to continue.`}
          />
        ) : deploymentsPhase === 'unreachable' ? (
          <UnreachableState onRetry={() => void deploymentsQuery.refetch()} />
        ) : deploymentsPhase === 'error' ? (
          <ErrorState
            error={deploymentsQuery.error}
            onRetry={() => void deploymentsQuery.refetch()}
          />
        ) : deploymentsPhase === 'loading' ? (
          <LoadingState message="Loading deployment history…" />
        ) : !hasLogSource(selectedDeployments) ? (
          <DeploymentGate slug={slug} resource="Logs" />
        ) : (
          <>
            {!hasRunnableDeployment(selectedDeployments) && <NotLiveNotice slug={slug} />}
            <LogsBody
              key={slug}
              slug={slug}
              filters={filters}
              onFilters={(next, replace) => syncUrl(next, slug, replace)}
            />
          </>
        )}
      </AppScope>
    </div>
  );
}
