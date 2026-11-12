import { cn } from '@/lib/utils';

export interface BreakdownRow {
  id: string;
  label: string;
  value: number;
  formatted?: string;
  onSelect?: () => void;
}
/** Bars compare real groups within the selected window; they are not trends. */
export function AnalyticsBreakdown({
  rows,
  label,
  empty = 'No requests in this window.',
  color = 'blue',
}: {
  rows: BreakdownRow[];
  label: string;
  empty?: string;
  color?: 'blue' | 'red';
}) {
  const maximum = Math.max(1, ...rows.map((row) => row.value));
  if (!rows.length) return <p className="py-6 text-sm text-muted-foreground">{empty}</p>;
  return (
    <ol aria-label={label} className="flex flex-col divide-y divide-border/60">
      {rows.map((row) => {
        const body = (
          <>
            <span className="min-w-0 truncate text-left" title={row.label}>
              {row.label}
            </span>
            <span className="flex min-w-0 items-center justify-end gap-3">
              <span
                aria-hidden
                className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-muted sm:block"
              >
                <span
                  className={cn(
                    'block h-full rounded-full',
                    color === 'red' ? 'bg-status-critical' : 'bg-cat-storage'
                  )}
                  style={{ width: `${(Math.max(0, row.value) / maximum) * 100}%` }}
                />
              </span>
              <span className="min-w-12 text-right tabular-nums">
                {row.formatted ?? row.value.toLocaleString()}
              </span>
            </span>
          </>
        );
        return (
          <li key={row.id}>
            {row.onSelect ? (
              <button
                type="button"
                onClick={row.onSelect}
                className="grid min-h-11 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded px-1 py-2 text-xs hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-brand"
              >
                {body}
              </button>
            ) : (
              <div className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-1 py-2 text-xs">
                {body}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
