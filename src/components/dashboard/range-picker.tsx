import { useState } from 'react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { Calendar, NavArrowLeft, NavArrowRight } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * The window the analytics grid is drawn over.
 *
 * Two shapes, because the API takes two: a duration (`24h`) that means "up to
 * now", and an explicit half-open `[since, until)` pair. A duration is not the
 * same as the equivalent pair — it keeps moving — so the picker stores which
 * one the reader chose rather than flattening both to timestamps.
 */
export type Range =
  { kind: 'preset'; value: string } | { kind: 'custom'; since: string; until: string };

export interface Preset {
  value: string;
  label: string;
  /** What a delta on this window is measured against, in words. */
  half: string;
}

export const PRESETS: Preset[] = [
  { value: '1h', label: 'Last 1 hour', half: 'the 30 minutes before' },
  { value: '6h', label: 'Last 6 hours', half: 'the 3 hours before' },
  { value: '12h', label: 'Last 12 hours', half: 'the 6 hours before' },
  { value: '24h', label: 'Last 24 hours', half: 'the 12 hours before' },
  { value: '3d', label: 'Last 3 days', half: 'the 36 hours before' },
  { value: '7d', label: 'Last 7 days', half: 'the 3.5 days before' },
  { value: '14d', label: 'Last 14 days', half: 'the 7 days before' },
];

/**
 * The zone the reader is in, named the way their system names it.
 *
 * Shown, not chosen. Timestamps go to the API with an offset and come back in
 * UTC, so a zone selector here would change only what this one control reads —
 * a setting that appears to do something and does not.
 */
export function localZoneLabel(now = new Date()): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const offsetMinutes = -now.getTimezoneOffset();
  const sign = offsetMinutes < 0 ? '-' : '+';
  const hours = Math.floor(Math.abs(offsetMinutes) / 60);
  const minutes = Math.abs(offsetMinutes) % 60;
  const offset = `GMT${sign}${hours}${minutes ? `:${String(minutes).padStart(2, '0')}` : ''}`;
  return `${zone} (${offset})`;
}

export function rangeLabel(range: Range): string {
  if (range.kind === 'preset') {
    return PRESETS.find((p) => p.value === range.value)?.label ?? range.value;
  }
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  return `${fmt(range.since)} — ${fmt(range.until)}`;
}

export function rangeHalfLabel(range: Range): string {
  return range.kind === 'preset'
    ? (PRESETS.find((p) => p.value === range.value)?.half ?? 'the window before')
    : 'the first half of this range';
}

/** Days of the month a calendar page shows, padded to whole weeks. */
export function monthGrid(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1);
  const lead = first.getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= days; d += 1) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** `datetime-local` wants a local-clock string, not an ISO instant. */
export function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function RangePicker({
  range,
  onChange,
}: {
  range: Range;
  onChange: (next: Range) => void;
}) {
  const [open, setOpen] = useState(false);
  const now = new Date();
  const [page, setPage] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1));
  const [start, setStart] = useState<Date | null>(null);
  const [end, setEnd] = useState<Date | null>(null);

  const pickDay = (day: Date) => {
    // First click opens a range, second closes it. Clicking before the open
    // edge restarts rather than producing a backwards range.
    if (!start || (start && end) || day < start) {
      setStart(day);
      setEnd(null);
      return;
    }
    setEnd(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59));
  };

  const apply = () => {
    if (start && end)
      onChange({ kind: 'custom', since: start.toISOString(), until: end.toISOString() });
    setOpen(false);
  };

  const cells = monthGrid(page.getFullYear(), page.getMonth());

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger
        className="pressable flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        aria-label={`Time range: ${rangeLabel(range)}`}
      >
        <Calendar aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
        {rangeLabel(range)}
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          sideOffset={6}
          className="z-50 w-[min(34rem,calc(100vw-2rem))] rounded-xl border border-border bg-popover p-0 shadow-[var(--elevation-3)]"
        >
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto]">
            <div className="border-border p-4 sm:border-r">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-medium">
                  {page.toLocaleString([], { month: 'long', year: 'numeric' })}
                </p>
                <div className="flex items-center gap-1">
                  <CalendarNav
                    label="Previous month"
                    onClick={() => setPage(new Date(page.getFullYear(), page.getMonth() - 1, 1))}
                  >
                    <NavArrowLeft aria-hidden="true" className="h-4 w-4" />
                  </CalendarNav>
                  <CalendarNav
                    label="Next month"
                    onClick={() => setPage(new Date(page.getFullYear(), page.getMonth() + 1, 1))}
                  >
                    <NavArrowRight aria-hidden="true" className="h-4 w-4" />
                  </CalendarNav>
                </div>
              </div>
              <div className="grid grid-cols-7 gap-y-1 text-center">
                {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
                  <span key={d} className="pb-1 text-xs text-muted-foreground">
                    {d}
                  </span>
                ))}
                {cells.map((day, i) => {
                  if (!day) return <span key={`pad-${i}`} />;
                  const future = day > now;
                  const isStart = start && sameDay(day, start);
                  const isEnd = end && sameDay(day, end);
                  const inside = start && end && day > start && day < end;
                  return (
                    <button
                      key={day.toISOString()}
                      type="button"
                      disabled={future}
                      onClick={() => pickDay(day)}
                      aria-pressed={Boolean(isStart || isEnd)}
                      className={cn(
                        'mx-auto flex h-8 w-8 items-center justify-center rounded-md text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
                        future && 'cursor-not-allowed text-muted-foreground/40',
                        !future && !isStart && !isEnd && !inside && 'hover:bg-muted',
                        inside && 'bg-muted',
                        (isStart || isEnd) && 'bg-foreground text-background'
                      )}
                    >
                      {day.getDate()}
                    </button>
                  );
                })}
              </div>
            </div>

            <ul className="max-h-64 overflow-y-auto p-2 sm:max-h-none">
              {PRESETS.map((preset) => {
                const active = range.kind === 'preset' && range.value === preset.value;
                return (
                  <li key={preset.value}>
                    <button
                      type="button"
                      onClick={() => {
                        onChange({ kind: 'preset', value: preset.value });
                        setOpen(false);
                      }}
                      aria-current={active ? 'true' : undefined}
                      className={cn(
                        'pressable w-full whitespace-nowrap rounded-md px-3 py-2 text-left text-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand',
                        active
                          ? 'bg-muted text-foreground'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                      )}
                    >
                      {preset.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="grid gap-3 border-t border-border p-4 sm:grid-cols-2">
            <LabelledTime
              label="Start"
              value={start ? toLocalInput(start) : ''}
              onChange={(v) => setStart(v ? new Date(v) : null)}
            />
            <LabelledTime
              label="End"
              value={end ? toLocalInput(end) : ''}
              onChange={(v) => setEnd(v ? new Date(v) : null)}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-4">
            <p className="text-xs text-muted-foreground">{localZoneLabel(now)}</p>
            <Button size="sm" onClick={apply} disabled={!start || !end}>
              Apply
            </Button>
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

function CalendarNav({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="pressable rounded-md border border-border p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      {children}
    </button>
  );
}

function LabelledTime({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      />
    </label>
  );
}
