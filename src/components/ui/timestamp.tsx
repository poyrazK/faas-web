import { absoluteTime, clockTime, compactTime, parseTime, relativeTime } from '@/lib/time';

/**
 * One way to show a time: "5m ago" (or "in 6d"), or with `mode="absolute"` the
 * short form "Today 14:03" / "Oct 20, 14:03". The exact date, seconds and zone
 * are always on hover. A missing or unparseable value is a dash, never a raw
 * string or 1970.
 */
export function Timestamp({
  value,
  mode = 'relative',
  className,
}: {
  value: string | number | Date | null | undefined;
  mode?: 'relative' | 'absolute' | 'clock';
  className?: string;
}) {
  const ms = parseTime(value);
  if (ms === undefined) return <span className={className}>—</span>;

  const exact = absoluteTime(ms);
  const display =
    mode === 'clock' ? clockTime(ms) : mode === 'absolute' ? compactTime(ms) : relativeTime(ms);
  return (
    <time dateTime={new Date(ms).toISOString()} title={exact} className={className}>
      {display}
    </time>
  );
}
