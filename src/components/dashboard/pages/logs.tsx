import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowDown, ArrowRight, Download, Pause, Play, Search, Xmark } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { CopyMorph, useCopy } from '@/components/ui/copy-button';
import { EmptyState, LevelTag } from '@/components/dashboard/primitives';
import { Pill } from '@/components/dashboard/resource-table';
import { LOG_LEVELS, MAX_LINES, useLogStream } from '@/lib/api/logs';
import { isoDay, logFilters, type LogFilters } from '@/components/dashboard/logs-search';
import { useAppInstances } from '@/lib/api/queries';
import { errorMessage } from '@/lib/api/errors';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { LogStreamRecovery } from '@/components/dashboard/log-stream-recovery';
import { Select } from '@/components/ui/field';

const STATUS_LABEL: Record<string, { label: string; color?: string }> = {
  idle: { label: 'idle' },
  connecting: { label: 'connecting', color: 'var(--status-warning)' },
  reconnecting: { label: 'reconnecting', color: 'var(--status-warning)' },
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

/** Applied filters are controlled by the route; only the text draft is local. */
function LogTextFilter({ value, onApply }: { value: string; onApply: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  return (
    <form
      className="relative flex min-w-56 flex-1 items-center sm:max-w-xs"
      onSubmit={(e) => {
        e.preventDefault();
        onApply(draft);
      }}
    >
      <Search className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-muted-foreground" />
      <input
        aria-label="Filter log text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        maxLength={2048}
        placeholder="grep… (press Enter)"
        className="h-9 w-full surface rounded-[1.25rem] bg-card pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-brand/50"
      />
    </form>
  );
}

/** Shared log viewer. Route-owned filters restore without remounting the pause state. */
export function LogsBody({
  slug,
  filters,
  onFilters,
}: {
  slug: string;
  filters?: LogFilters;
  onFilters?: (f: LogFilters, replace?: boolean) => void;
}) {
  const [connected, setConnected] = useState(true);
  const [localFilters, setLocalFilters] = useState(() => logFilters({}));
  const current = filters ?? localFilters;
  const { grep, level, mode, instance, date } = current;
  const update = (patch: Partial<LogFilters>) => {
    const next = { ...current, ...patch };
    if (onFilters) onFilters(next);
    else setLocalFilters(next);
  };
  const [wrap, setWrap] = useState(() => localStorage.getItem(WRAP_KEY) !== '0');
  const { copied, copy: copyBuffer } = useCopy(1800);

  const { account } = useAuth();
  const retention = RETENTION_DAYS[account?.plan ?? 'free'] ?? 0;
  const archiveAllowed = retention > 0;

  const instances = useAppInstances(mode === 'archive' ? slug : '');
  const chosenInstance = instance || instances.data?.[0]?.id || '';
  // Pin a default instance into a shared archive URL once it is known. An
  // explicit historical instance is never replaced by a currently running one.
  useEffect(() => {
    if (filters && mode === 'archive' && !instance && chosenInstance) {
      onFilters?.({ ...filters, instance: chosenInstance }, true);
    }
  }, [filters, mode, instance, chosenInstance, onFilters]);

  const source = useMemo(
    () =>
      mode === 'archive'
        ? { kind: 'archive' as const, slug, instance: chosenInstance, date, grep, level }
        : { kind: 'live' as const, slug, grep, level },
    [mode, slug, chosenInstance, date, grep, level]
  );
  // An archive read is a one-shot fetch, so the pause switch does not apply.
  const { lines, status, reason, error, truncated, clear, canRetry, retry } = useLogStream(
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
        <div role="group" aria-label="Source" className="flex well rounded-xl bg-muted/40 p-0.5">
          {(['live', 'archive'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => update({ mode: m })}
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

        <LogTextFilter key={grep} value={grep} onApply={(value) => update({ grep: value })} />

        {/* Filtered server-side, so a narrower level is less traffic, not just
            less on screen. */}
        <div role="group" aria-label="Level" className="flex well rounded-xl bg-muted/40 p-0.5">
          {(['', ...LOG_LEVELS] as const).map((value) => (
            <button
              key={value || 'all'}
              type="button"
              aria-pressed={level === value}
              onClick={() => update({ level: value })}
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
              <Select
                value={chosenInstance}
                onChange={(e) => update({ instance: e.target.value })}
                aria-label="Instance to read"
                className="h-9 max-w-44 surface rounded-[1.25rem] bg-card px-2.5 font-mono text-xs outline-none focus:border-brand/50"
              >
                {instance && !instances.data?.some((i) => i.id === instance) && (
                  <option value={instance}>{instance.slice(0, 12)}… · historical instance</option>
                )}
                {!instance && (instances.data ?? []).length === 0 && (
                  <option value="">No instances</option>
                )}
                {(instances.data ?? []).map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.id.slice(0, 12)}… · {i.state}
                  </option>
                ))}
              </Select>
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
                onChange={(e) => {
                  if (e.target.value) update({ date: e.target.value });
                }}
                aria-label="Archive date"
                className="h-9 surface rounded-[1.25rem] bg-card px-2.5 text-sm outline-none focus:border-brand/50"
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

      {mode === 'live' ? (
        <LogStreamRecovery status={status} reason={reason} canRetry={canRetry} retry={retry} />
      ) : status === 'error' && reason ? (
        <p role="alert" className="text-xs text-muted-foreground">
          The archive could not be read: <span className="font-mono">{reason}</span>
        </p>
      ) : null}
      {mode === 'archive' && lines.length > 0 && reason && (
        <p className="text-xs text-muted-foreground">
          {lines.length} lines from {date}. {ARCHIVE_REASON[reason] ?? reason}
        </p>
      )}
      {truncated && (
        <p className="text-xs text-muted-foreground">
          Showing the last {MAX_LINES.toLocaleString()} lines.
        </p>
      )}

      {mode === 'archive' && !archiveAllowed ? (
        <div className="surface rounded-[1.25rem] bg-card p-6">
          <p className="text-sm font-medium">Log archive is not on the free plan</p>
          <p className="mt-1.5 max-w-lg text-sm leading-relaxed text-muted-foreground">
            Past days need Hobby or above: 7 days on Hobby, 30 on Pro, 90 on Scale.
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
              : status === 'reconnecting'
                ? 'Waiting to reconnect…'
                : status === 'error'
                  ? 'The log stream is disconnected.'
                  : connected
                    ? 'Waiting for output; a parked app is silent until it wakes.'
                    : 'Paused. Resume to stream logs.'
          }
        />
      ) : (
        <div className="relative overflow-hidden surface rounded-[1.25rem] bg-card">
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
              className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-popover px-3 py-1.5 text-xs shadow-lg transition-colors hover:border-border-secondary"
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
