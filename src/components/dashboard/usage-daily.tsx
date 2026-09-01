/**
 * One day's GB-hours, one bar per app; the axis is the biggest app. Each bar
 * carries its label and number as its accessible name, so the chart reads
 * without the heights.
 */
export function UsageDailyBars({ rows }: { rows: { label: string; gb_hours: number }[] }) {
  const max = Math.max(1e-9, ...rows.map((r) => r.gb_hours));
  return (
    <div className="flex h-32 items-end gap-1">
      {rows.map((r) => (
        <div
          key={r.label}
          role="img"
          aria-label={`${r.label}: ${r.gb_hours.toFixed(2)} GB-hours`}
          title={`${r.label} · ${r.gb_hours.toFixed(2)} GB-h`}
          className="flex-1 rounded-t-sm bg-brand-fill/70 transition-colors hover:bg-brand-fill"
          style={{ height: `${(r.gb_hours / max) * 100}%` }}
        />
      ))}
    </div>
  );
}
