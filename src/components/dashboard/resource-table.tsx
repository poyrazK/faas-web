import { useMemo, useState, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowDown, ArrowUp, Search, Xmark } from 'iconoir-react';
import { EmptyState, ErrorState, Skeleton, UnreachableState, queryPhase } from './primitives';
import { EASE } from './motion';
import { cn } from '@/lib/utils';

/** Rows past this index appear together — a stagger that long reads as lag. */
const STAGGER_CAP = 15;
/** Enough to fill the fold without pretending to know the row count. */
const SKELETON_ROWS = 6;
const STAGGER_STEP = 0.02;
/** The height of the header row plus SKELETON_ROWS skeleton rows. Applied to
 * the empty/error/unreachable boxes so replacing a loading table with one of
 * them does not move the rest of the page. */
const STATE_MIN_H = 'min-h-[17.75rem]';
/** Rows rendered before the table asks. The API has no cursors yet, so every
 * response arrives whole — this bounds the DOM, not the data. Filtering and
 * sorting still cover the full set. */
const PAGE_SIZE = 50;

/**
 * The shape almost every resource page shares: a filter row, a sortable
 * table, and an empty state. Pages supply columns and rows; sorting,
 * searching, and the chrome live here.
 */

export interface Column<T> {
  /** Property used for sorting; also the React key. */
  key: keyof T & string;
  label: string;
  /** Right-aligns and sorts descending on first click. */
  numeric?: boolean;
  sortable?: boolean;
  render?: (row: T) => ReactNode;
  /** Tailwind width utility, e.g. 'w-40'. */
  width?: string;
}

export interface ResourceTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  initialSort?: { key: keyof T & string; dir: 'asc' | 'desc' };
  onRowClick?: (row: T) => void;
  /** Fields searched by the filter box. Omit to hide the box. */
  searchKeys?: (keyof T & string)[];
  searchPlaceholder?: string;
  /** Extra controls rendered in the filter row. */
  filters?: ReactNode;
  emptyMessage?: string;
  minWidth?: string;
  /** True while the first fetch is in flight. Replaces the table, not the header. */
  loading?: boolean;
  /** A failed fetch. Rendered instead of an empty state, which means the opposite. */
  error?: unknown;
  /** Wired to the error state's retry button. */
  onRetry?: () => void;
  /**
   * Per-row controls, rendered in their own trailing cell inside a click
   * shield: pressing one never also fires `onRowClick`, so callers stop
   * hand-writing `stopPropagation` (and forgetting it).
   */
  rowActions?: (row: T) => ReactNode;
  /** Controlled filter text — pass with `onQueryChange` when the query lives
   * somewhere the table cannot own, like the URL. */
  query?: string;
  onQueryChange?: (query: string) => void;
}

export function ResourceTable<T extends { id: string }>({
  rows,
  columns,
  initialSort,
  onRowClick,
  searchKeys,
  searchPlaceholder = 'Filter…',
  filters,
  emptyMessage = 'Nothing here yet.',
  minWidth = 'min-w-[820px]',
  loading = false,
  error,
  onRetry,
  rowActions,
  query: controlledQuery,
  onQueryChange,
}: ResourceTableProps<T>) {
  const [internalQuery, setInternalQuery] = useState('');
  const query = controlledQuery ?? internalQuery;
  const setQuery = onQueryChange ?? setInternalQuery;
  const [sort, setSort] = useState(initialSort);
  const [shownCount, setShownCount] = useState(PAGE_SIZE);
  const reduce = useReducedMotion();

  // Callers pass `searchKeys` as an inline literal, so key the memo on its
  // contents rather than its identity.
  const searchKeysSig = searchKeys?.join('|') ?? '';
  const stableSearchKeys = useMemo(
    () => (searchKeysSig ? (searchKeysSig.split('|') as (keyof T & string)[]) : []),
    [searchKeysSig]
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered =
      q && stableSearchKeys.length
        ? rows.filter((row) =>
            stableSearchKeys.some((k) =>
              String(row[k] ?? '')
                .toLowerCase()
                .includes(q)
            )
          )
        : rows;

    if (!sort) return filtered;
    const factor = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * factor;
      return String(av).localeCompare(String(bv)) * factor;
    });
  }, [rows, query, sort, stableSearchKeys]);

  const phase = queryPhase({ error, loading, isEmpty: visible.length === 0 });
  const shown = visible.length > shownCount ? visible.slice(0, shownCount) : visible;

  // A row that appears in a later payload — a create landing, a refetch
  // picking up someone else's write — gets a one-time arrival wash so the
  // reader can find what just changed. Derived with the React "adjust state
  // when props change" render-time pattern (no ref reads, no effect): when a
  // new `rows` array arrives, ids absent from the previous one are marked.
  // The full first payload is never marked — everything is new on load, so
  // nothing is.
  const [prevRows, setPrevRows] = useState<T[] | null>(null);
  const [newIds, setNewIds] = useState<ReadonlySet<string>>(() => new Set());
  if (rows !== prevRows) {
    setPrevRows(rows);
    if (prevRows !== null && prevRows.length > 0 && rows.length > prevRows.length) {
      const before = new Set(prevRows.map((r) => r.id));
      setNewIds(new Set(rows.filter((r) => !before.has(r.id)).map((r) => r.id)));
    }
  }

  const toggleSort = (col: Column<T>) => {
    if (col.sortable === false) return;
    setSort((prev) =>
      prev?.key === col.key
        ? { key: col.key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key: col.key, dir: col.numeric ? 'desc' : 'asc' }
    );
  };

  return (
    <div className="animate-item-enter flex flex-col gap-4">
      {/* Also shown, filterless, once a table is big enough to truncate —
          the count is then the only statement of how much exists. */}
      {(searchKeys?.length || filters || rows.length > PAGE_SIZE) && (
        <div className="flex flex-wrap items-center gap-3">
          {searchKeys?.length ? (
            <label className="relative flex min-w-56 flex-1 items-center sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                // Escape clears without leaving the field, so refining a
                // filter never means select-all-and-delete.
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && query) {
                    e.preventDefault();
                    e.stopPropagation();
                    setQuery('');
                  }
                }}
                placeholder={searchPlaceholder}
                className="h-9 w-full rounded-lg border border-border bg-card pl-9 pr-9 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-brand/50 [&::-webkit-search-cancel-button]:appearance-none"
              />
              {query && (
                <button
                  type="button"
                  aria-label="Clear filter"
                  onClick={() => setQuery('')}
                  className="pressable absolute right-2 rounded p-1 text-muted-foreground hover:text-foreground"
                >
                  <Xmark className="h-3.5 w-3.5" />
                </button>
              )}
            </label>
          ) : null}
          {filters}
          {/* Announced, so a screen-reader user filtering the table hears the
              result count change instead of typing into silence. */}
          <span
            aria-live="polite"
            className="ml-auto text-xs text-muted-foreground [font-variant-numeric:tabular-nums]"
          >
            {/* "0 of 0" while the read is still out states a count nobody has. */}
            {phase === 'loading' || phase === 'unreachable'
              ? ''
              : `${visible.length} of ${rows.length}`}
          </span>
        </div>
      )}

      {/* Precedence lives in `queryPhase`: a failed fetch is not an empty
          list, and neither is a fetch still in flight. An in-flight read keeps
          the table chrome and fills it with skeleton rows, so the headers stay
          put and nothing jumps when the data lands. When the answer is not a
          table at all — empty, error, unreachable — the replacement fades in
          at the skeleton table's height (STATE_MIN_H) instead of hard-swapping
          to a shorter box, so the page holds still. Loading and ready share a
          key: data landing swaps skeleton rows for real ones without re-fading
          the chrome. */}
      <motion.div
        key={phase === 'ready' || phase === 'loading' ? 'table' : phase}
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.18 }}
      >
        {phase === 'unreachable' ? (
          <UnreachableState className={STATE_MIN_H} onRetry={onRetry} />
        ) : phase === 'error' ? (
          <ErrorState className={STATE_MIN_H} error={error} onRetry={onRetry} />
        ) : phase === 'empty' ? (
          <EmptyState className={STATE_MIN_H} message={emptyMessage} />
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="overflow-x-auto">
              <table className={cn('w-full text-sm', minWidth)}>
                <thead>
                  <tr className="border-b border-border text-left">
                    {columns.map((col) => {
                      const isSorted = sort?.key === col.key;
                      return (
                        <th
                          key={col.key}
                          scope="col"
                          aria-sort={
                            isSorted ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'
                          }
                          className={cn('px-4 py-3', col.numeric && 'text-right', col.width)}
                        >
                          {col.sortable === false ? (
                            <span className="label-mono text-muted-foreground">{col.label}</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => toggleSort(col)}
                              className={cn(
                                'pressable label-mono inline-flex items-center gap-1 hover:text-foreground',
                                col.numeric && 'flex-row-reverse',
                                isSorted ? 'text-foreground' : 'text-muted-foreground'
                              )}
                            >
                              {col.label}
                              {isSorted &&
                                (sort!.dir === 'asc' ? (
                                  <ArrowUp className="h-3 w-3" />
                                ) : (
                                  <ArrowDown className="h-3 w-3" />
                                ))}
                            </button>
                          )}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {phase === 'loading'
                    ? Array.from({ length: SKELETON_ROWS }, (_, i) => (
                        <tr key={`skeleton-${i}`} aria-hidden>
                          {columns.map((col) => (
                            <td key={col.key} className="px-4 py-3">
                              <Skeleton
                                className={cn('h-3.5', col.numeric ? 'ml-auto w-10' : 'w-24')}
                              />
                            </td>
                          ))}
                          {rowActions && <td className="px-4 py-3" />}
                        </tr>
                      ))
                    : null}
                  {phase === 'loading' && (
                    <tr className="sr-only">
                      <td colSpan={columns.length + (rowActions ? 1 : 0)} role="status">
                        Loading…
                      </td>
                    </tr>
                  )}
                  {shown.map((row, i) => {
                    const isNew = newIds.has(row.id);
                    // Keyed by id, so rows entering the filtered set rise in
                    // and rows that stay put do not re-animate. No `layout` —
                    // table cells and layout projection do not get along.
                    return (
                      <motion.tr
                        key={row.id}
                        initial={reduce ? false : { opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{
                          duration: 0.28,
                          ease: EASE,
                          delay: reduce ? 0 : Math.min(i, STAGGER_CAP) * STAGGER_STEP,
                        }}
                        onClick={onRowClick ? () => onRowClick(row) : undefined}
                        // Clickable rows are keyboard-operable too: Enter or Space
                        // on the row itself (not on a control inside it) activates.
                        tabIndex={onRowClick ? 0 : undefined}
                        role={onRowClick ? 'button' : undefined}
                        onKeyDown={
                          onRowClick
                            ? (e) => {
                                if (e.target !== e.currentTarget) return;
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  onRowClick(row);
                                }
                              }
                            : undefined
                        }
                        className={cn(
                          'transition-colors hover:bg-muted/40',
                          isNew && 'animate-row-arrive',
                          onRowClick &&
                            'cursor-pointer outline-none focus-visible:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring'
                        )}
                      >
                        {columns.map((col) => (
                          <td
                            key={col.key}
                            className={cn(
                              'px-4 py-3',
                              col.numeric && 'text-right [font-variant-numeric:tabular-nums]'
                            )}
                          >
                            {col.render ? col.render(row) : String(row[col.key] ?? '—')}
                          </td>
                        ))}
                        {rowActions && (
                          <td className="w-0 whitespace-nowrap px-4 py-3 text-right">
                            {/* The shield: controls in here act on the row's
                                data, never as a click on the row. */}
                            <span
                              className="inline-flex items-center gap-2"
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => e.stopPropagation()}
                            >
                              {rowActions(row)}
                            </span>
                          </td>
                        )}
                      </motion.tr>
                    );
                  })}
                  {phase === 'ready' && visible.length > shown.length && (
                    <tr>
                      <td colSpan={columns.length + (rowActions ? 1 : 0)} className="p-0">
                        <button
                          type="button"
                          onClick={() => setShownCount((n) => n + PAGE_SIZE)}
                          className="pressable w-full px-4 py-3 text-center text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                        >
                          Show {Math.min(PAGE_SIZE, visible.length - shown.length)} more —{' '}
                          {visible.length - shown.length} not shown
                        </button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}

/** Small pill for enum-ish cells, coloured by a caller-supplied token. */
export function Pill({ label, color }: { label: string; color?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs',
        !color && 'border-border text-muted-foreground'
      )}
      style={
        color ? { borderColor: `color-mix(in oklab, ${color} 35%, transparent)`, color } : undefined
      }
    >
      {label}
    </span>
  );
}
