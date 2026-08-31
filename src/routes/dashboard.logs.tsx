import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Link } from '@tanstack/react-router';
import {
  ArrowDown,
  ArrowRight,
  Bookmark,
  Download,
  Pause,
  Play,
  Search,
  Xmark,
} from 'iconoir-react';
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
import { CopyMorph, useCopy } from '@/components/ui/copy-button';
import { EmptyState, LevelTag, LoadingState, PageHeader } from '@/components/dashboard/primitives';
import { Pill } from '@/components/dashboard/resource-table';
import { AppScope, AppSelect, useSelectedApp } from '@/components/dashboard/app-select';
import { AccountEventsPanel } from '@/components/dashboard/account-events-panel';
import { LOG_LEVELS, MAX_LINES, useLogStream, type LogLevelFilter } from '@/lib/api/logs';
import { useAppInstances } from '@/lib/api/queries';
import { errorMessage } from '@/lib/api/errors';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { consoleHead } from '@/lib/seo';
import { DeploymentGate } from '@/components/dashboard/deployment-gate';
import { hasRunnableDeployment } from '@/lib/deployment-status';
import { useData } from '@/lib/store';

export const Route = createFileRoute('/dashboard/logs')({
  component: LogsPage,
  head: () => consoleHead('logs'),
  // Filters live in the URL, so a pasted link opens the same view — the
  // shareable log link an on-call handoff actually needs.
  validateSearch: (search: Record<string, unknown>): LogsSearch => ({
    ...(typeof search.app === 'string' && search.app ? { app: search.app } : {}),
    ...(LOG_LEVELS.includes(search.level as LogLevelFilter)
      ? { level: search.level as LogLevelFilter }
      : {}),
    ...(typeof search.q === 'string' && search.q ? { q: search.q } : {}),
    ...(search.mode === 'archive' ? { mode: 'archive' as const } : {}),
  }),
});

interface LogsSearch {
  app?: string;
  level?: LogLevelFilter;
  q?: string;
  mode?: 'archive';
}

const STATUS_LABEL: Record<string, { label: string; color?: string }> = {
  idle: { label: 'idle' },
  connecting: { label: 'connecting', color: 'var(--status-warning)' },
  streaming: { label: 'live', color: 'var(--status-good)' },
  paused: { label: 'paused', color: 'var(--status-warning)' },
  ended: { label: 'ended' },
  error: { label: 'disconnected', color: 'var(--status-critical)' },
};

const WRAP_KEY = 'gregale.logs.wrap';

/** Per-plan archive retention, in days. Free has no archive read-back at all. */
const RETENTION_DAYS: Record<string, number> = { free: 0, hobby: 7, pro: 30, scale: 90 };

const ARCHIVE_REASON: Record<string, string> = {
  archive_complete: 'That is the whole day.',
  archive_missing: 'Nothing was archived for this instance on this date.',
  archive_degraded: 'Partial — some of this day was never shipped to the archive.',
};

const isoDay = (offsetDays = 0) =>
  new Date(Date.now() - offsetDays * 86_400_000).toISOString().slice(0, 10);

export interface LogFilters {
  level: LogLevelFilter | '';
  grep: string;
  mode: 'live' | 'archive';
}

/**
 * The live log view, without the page chrome around it.
 *
 * Rendered both by this route and as a tab on the app detail page. The
 * route passes `initial` (from the URL) and listens on `onFilters` to keep
 * the URL shareable; the tab passes neither and behaves as before.
 */
export function LogsBody({
  slug,
  initial,
  onFilters,
}: {
  slug: string;
  initial?: Partial<LogFilters>;
  onFilters?: (f: LogFilters) => void;
}) {
  const [connected, setConnected] = useState(true);
  const [grepInput, setGrepInput] = useState(initial?.grep ?? '');
  const [grep, setGrep] = useState(initial?.grep ?? '');
  const [level, setLevel] = useState<LogLevelFilter | ''>(initial?.level ?? '');
  const [mode, setMode] = useState<'live' | 'archive'>(initial?.mode ?? 'live');

  // Report filter changes upward without ever depending on the callback's
  // identity — the route recreates it per render.
  const onFiltersRef = useRef(onFilters);
  useEffect(() => {
    onFiltersRef.current = onFilters;
  });
  useEffect(() => {
    onFiltersRef.current?.({ level, grep, mode });
  }, [level, grep, mode]);
  const [instance, setInstance] = useState('');
  const [date, setDate] = useState(() => isoDay(1));
  const [wrap, setWrap] = useState(() => localStorage.getItem(WRAP_KEY) !== '0');
  const { copied, copy: copyBuffer } = useCopy(1800);

  const { account } = useAuth();
  const retention = RETENTION_DAYS[account?.plan ?? 'free'] ?? 0;
  const archiveAllowed = retention > 0;

  const instances = useAppInstances(mode === 'archive' ? slug : '');
  const chosenInstance = instance || instances.data?.[0]?.id || '';

  const source = useMemo(
    () =>
      mode === 'archive'
        ? { kind: 'archive' as const, slug, instance: chosenInstance, date, grep, level }
        : { kind: 'live' as const, slug, grep, level },
    [mode, slug, chosenInstance, date, grep, level]
  );
  // An archive read is a one-shot fetch, so the pause switch does not apply.
  const { lines, status, reason, error, truncated, clear } = useLogStream(
    source,
    mode === 'archive' ? true : connected
  );

  const viewportRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const lastCount = useRef(0);

  // Scrolling up detaches the tail; a position check rather than a wheel
  // listener, so keyboard and touch behave the same as the mouse.
  const onScroll = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setAtBottom(bottom);
    if (bottom) setUnseen(0);
  }, []);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const added = lines.length - lastCount.current;
    lastCount.current = lines.length;
    if (added <= 0) return;
    if (atBottom) el.scrollTop = el.scrollHeight;
    else setUnseen((n) => n + added);
  }, [lines, atBottom]);

  const jumpToLive = () => {
    const el = viewportRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setAtBottom(true);
    setUnseen(0);
  };

  const asText = () => lines.map((l) => `${new Date(l.ts).toISOString()} ${l.raw}`).join('\n');

  const copy = () => void copyBuffer(asText());

  const download = () => {
    const blob = new Blob([asText()], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const badge = STATUS_LABEL[status] ?? STATUS_LABEL.idle;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div
          role="group"
          aria-label="Source"
          className="flex rounded-md border border-border p-0.5"
        >
          {(['live', 'archive'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={cn(
                'rounded px-2.5 py-1 text-xs capitalize pressable',
                mode === m
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {m}
            </button>
          ))}
        </div>

        <form
          className="relative flex min-w-56 flex-1 items-center sm:max-w-xs"
          onSubmit={(e) => {
            e.preventDefault();
            // Applied on submit, not per keystroke: each change restarts the
            // stream, and doing that on every letter would thrash the server.
            setGrep(grepInput);
          }}
        >
          <Search className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={grepInput}
            onChange={(e) => setGrepInput(e.target.value)}
            placeholder="grep… (press Enter)"
            className="h-9 w-full rounded-md border border-border bg-card pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-brand/50"
          />
        </form>

        {/* Filtered server-side, so a narrower level is less traffic, not just
            less on screen. */}
        <div role="group" aria-label="Level" className="flex rounded-md border border-border p-0.5">
          {(['', ...LOG_LEVELS] as const).map((value) => (
            <button
              key={value || 'all'}
              type="button"
              aria-pressed={level === value}
              onClick={() => setLevel(value)}
              className={cn(
                'rounded px-2.5 py-1 text-xs pressable',
                level === value
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {value || 'all'}
            </button>
          ))}
        </div>

        {mode === 'live' ? (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => setConnected((c) => !c)}
          >
            {connected ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {connected ? 'Pause' : 'Resume'}
          </Button>
        ) : (
          <>
            <label className="flex items-center gap-2">
              <span className="label-mono text-muted-foreground">Instance</span>
              <select
                value={chosenInstance}
                onChange={(e) => setInstance(e.target.value)}
                aria-label="Instance to read"
                className="h-9 max-w-44 rounded-md border border-border bg-card px-2.5 font-mono text-xs outline-none focus:border-brand/50"
              >
                {(instances.data ?? []).length === 0 && <option value="">No instances</option>}
                {(instances.data ?? []).map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.id.slice(0, 12)}… · {i.state}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <span className="label-mono text-muted-foreground">Date</span>
              <input
                type="date"
                value={date}
                // Bounded by the plan's window, so the retention refusal is
                // usually prevented rather than reported.
                min={isoDay(retention)}
                max={isoDay(0)}
                onChange={(e) => setDate(e.target.value)}
                aria-label="Archive date"
                className="h-9 rounded-md border border-border bg-card px-2.5 text-sm outline-none focus:border-brand/50"
              />
            </label>
          </>
        )}

        <Pill label={badge.label} color={badge.color} />

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            aria-label="Wrap long lines"
            aria-pressed={wrap}
            onClick={() => {
              setWrap((w) => {
                localStorage.setItem(WRAP_KEY, w ? '0' : '1');
                return !w;
              });
            }}
            className={cn(
              'rounded-md px-2 py-1.5 font-mono text-xs pressable',
              wrap ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            wrap
          </button>
          <button
            type="button"
            aria-label="Copy the buffer"
            disabled={!lines.length}
            onClick={copy}
            className="pressable rounded-md p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            <CopyMorph copied={copied} />
            <span aria-live="polite" className="sr-only">
              {copied ? 'Copied' : ''}
            </span>
          </button>
          <button
            type="button"
            aria-label="Download the buffer"
            disabled={!lines.length}
            onClick={download}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="Clear the buffer"
            disabled={!lines.length}
            onClick={() => {
              clear();
              lastCount.current = 0;
              setUnseen(0);
            }}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
          >
            <Xmark className="h-3.5 w-3.5" />
          </button>
          <span className="ml-2 text-xs text-muted-foreground [font-variant-numeric:tabular-nums]">
            {lines.length} lines
          </span>
        </div>
      </div>

      {/* An unknown `level` comes back as an SSE error frame with a code, which
          is worth more than a generic disconnect. */}
      {status === 'error' && reason && (
        <p role="alert" className="text-xs text-muted-foreground">
          The stream stopped: <span className="font-mono">{reason}</span>
        </p>
      )}
      {mode === 'archive' && lines.length > 0 && reason && (
        <p className="text-xs text-muted-foreground">
          {lines.length} lines from {date}. {ARCHIVE_REASON[reason] ?? reason}
        </p>
      )}
      {truncated && (
        <p className="text-xs text-muted-foreground">
          Showing the last {MAX_LINES.toLocaleString()} lines. Earlier output has scrolled out of
          the buffer — download before clearing if you need it.
        </p>
      )}

      {mode === 'archive' && !archiveAllowed ? (
        <div className="rounded-xl border border-border bg-card p-6">
          <p className="text-sm font-medium">Log archive is not on the free plan</p>
          <p className="mt-1.5 max-w-lg text-sm leading-relaxed text-muted-foreground">
            Live output is always available. Reading a past day back from object storage needs Hobby
            or above, which also sets how far back you can go — 7 days on Hobby, 30 on Pro, 90 on
            Scale.
          </p>
          <Link
            to="/dashboard/plans"
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline"
          >
            Compare plans
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      ) : lines.length === 0 ? (
        <EmptyState
          message={
            mode === 'archive'
              ? status === 'connecting'
                ? 'Reading the archive…'
                : (reason && ARCHIVE_REASON[reason]) ||
                  (error ? errorMessage(error) : 'Nothing archived for this instance and date.')
              : connected
                ? 'Waiting for output. A parked app produces nothing until it wakes.'
                : 'Paused. Resume to stream logs.'
          }
        />
      ) : (
        <div className="relative overflow-hidden rounded-xl border border-border bg-card">
          <div
            ref={viewportRef}
            onScroll={onScroll}
            role="log"
            aria-label="Log output"
            className="max-h-[60vh] overflow-y-auto p-4"
          >
            {lines.map((line) => (
              // content-visibility lets the browser skip layout and paint for
              // offscreen lines — 2,000 buffered lines stop costing 2,000
              // laid-out paragraphs. The intrinsic size keeps the scrollbar
              // honest while unwrapped; wrapped lines re-measure on approach.
              <p
                key={line.id}
                className={cn(
                  'flex gap-3 font-mono text-xs leading-relaxed [contain-intrinsic-block-size:auto_1.25rem] [content-visibility:auto]',
                  wrap ? 'break-all' : 'whitespace-nowrap'
                )}
              >
                <span className="shrink-0 select-none text-muted-foreground">
                  {new Date(line.ts).toLocaleTimeString()}
                </span>
                {line.level ? (
                  <LevelTag level={line.level} />
                ) : (
                  <span aria-hidden className="w-14 shrink-0" />
                )}
                <span className={cn('min-w-0', wrap && 'whitespace-pre-wrap')}>{line.text}</span>
              </p>
            ))}
          </div>

          {/* Detached from the tail: say how much was missed, and offer the way
              back rather than yanking the viewport. */}
          {!atBottom && (
            <button
              type="button"
              onClick={jumpToLive}
              className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-popover px-3 py-1.5 text-xs shadow-lg transition-colors hover:border-border-secondary"
            >
              <ArrowDown className="h-3.5 w-3.5" />
              {unseen > 0 ? `${unseen} new ${unseen === 1 ? 'line' : 'lines'}` : 'Jump to live'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Saved views — named filter sets, kept in the browser
 * ------------------------------------------------------------------ */

interface SavedView {
  name: string;
  app: string;
  level?: LogLevelFilter;
  q?: string;
  mode?: 'archive';
}

const VIEWS_KEY = 'gregale.logs.views';

function readViews(): SavedView[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(VIEWS_KEY) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter(
          (v): v is SavedView =>
            typeof v === 'object' &&
            v !== null &&
            typeof (v as SavedView).name === 'string' &&
            typeof (v as SavedView).app === 'string'
        )
      : [];
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
        description="App, level, search, and mode — as they stand now."
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
  const [showAccount, setShowAccount] = useState(false);
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const appState = useSelectedApp();
  const { slug, select, apps } = appState;
  const { deployments, loading: loadingData } = useData();
  const selectedDeployments = deployments.filter((deployment) => deployment.workflowId === slug);

  // The URL's app wins over the remembered one, once the list can confirm
  // it exists. Cheap no-op on every render after it has applied.
  useEffect(() => {
    if (search.app && search.app !== slug && apps.some((a) => a.slug === search.app)) {
      select(search.app);
    }
  });

  const filtersRef = useRef<LogFilters>({
    level: search.level ?? '',
    grep: search.q ?? '',
    mode: search.mode ?? 'live',
  });
  // Remounts LogsBody when a saved view applies, so its internal state
  // re-initialises from the fresh URL.
  const [viewNonce, setViewNonce] = useState(0);

  const syncUrl = (f: LogFilters, app: string) => {
    void navigate({
      replace: true,
      search: {
        ...(app ? { app } : {}),
        ...(f.level ? { level: f.level } : {}),
        ...(f.grep ? { q: f.grep } : {}),
        ...(f.mode === 'archive' ? { mode: 'archive' as const } : {}),
      },
    });
  };

  const applyView = (v: SavedView) => {
    if (apps.some((a) => a.slug === v.app)) select(v.app);
    void navigate({
      replace: true,
      search: {
        app: v.app,
        ...(v.level ? { level: v.level } : {}),
        ...(v.q ? { q: v.q } : {}),
        ...(v.mode ? { mode: v.mode } : {}),
      },
    });
    filtersRef.current = { level: v.level ?? '', grep: v.q ?? '', mode: v.mode ?? 'live' };
    setViewNonce((n) => n + 1);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Logs"
        description="Live output from this app's instances. The stream ends on its own when the app parks. Filters live in the URL — the page is a shareable link."
        actions={
          <div className="flex items-center gap-2">
            <SavedViewsMenu
              current={() => {
                const f = filtersRef.current;
                return {
                  app: slug,
                  ...(f.level ? { level: f.level } : {}),
                  ...(f.grep ? { q: f.grep } : {}),
                  ...(f.mode === 'archive' ? { mode: 'archive' as const } : {}),
                };
              }}
              onApply={applyView}
            />
            <AppSelect
              slug={slug}
              onSelect={(next) => {
                select(next);
                syncUrl(filtersRef.current, next);
              }}
              apps={apps}
            />
          </div>
        }
      />
      <AppScope state={appState} resource="logs">
        {loadingData ? (
          <LoadingState message="Loading app state…" />
        ) : !hasRunnableDeployment(selectedDeployments) ? (
          <DeploymentGate slug={slug} resource="Logs" />
        ) : (
          <LogsBody
            key={viewNonce}
            slug={slug}
            initial={{
              level: search.level ?? '',
              grep: search.q ?? '',
              mode: search.mode ?? 'live',
            }}
            onFilters={(f) => {
              filtersRef.current = f;
              syncUrl(f, slug);
            }}
          />
        )}
      </AppScope>

      {/* `gregale tail` for the browser: mounted on demand so the /v1/events
          connection is only held while someone is actually watching it. */}
      <button
        type="button"
        onClick={() => setShowAccount((v) => !v)}
        className="self-start text-xs text-brand transition-colors hover:text-brand-hover"
      >
        {showAccount ? 'Hide account activity' : 'Account activity (all apps) →'}
      </button>
      {showAccount && <AccountEventsPanel />}
    </div>
  );
}
