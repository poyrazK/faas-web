import { useId, useMemo, useState, type PointerEvent } from 'react';
import { scaleLinear } from 'd3-scale';
import { area, curveMonotoneX, curveStepAfter, line } from 'd3-shape';
import { cn } from '@/lib/utils';

/**
 * The console's charts: plain SVG, one hairline grid, flat fills.
 *
 * Geometry is drawn in a 100×100 viewBox stretched to the box
 * (`preserveAspectRatio="none"`), with `non-scaling-stroke` keeping lines at
 * 1.5px. Labels and the hover readout are HTML positioned by percentage, so
 * nothing measures the DOM and a resize costs nothing.
 */

export type ChartColor = 'green' | 'blue' | 'purple' | 'pink' | 'orange' | 'red' | 'grey';

const COLOR: Record<ChartColor, string> = {
  green: 'var(--status-good)',
  red: 'var(--status-critical)',
  orange: 'var(--status-warning)',
  blue: 'var(--cat-storage)',
  purple: 'var(--cat-security)',
  pink: 'var(--cat-network)',
  grey: 'var(--chart-muted)',
};

export type ChartSeries = Record<string, { label: string; color: ChartColor }>;

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const formatTick = (v: number) => compact.format(v);

/** Points to path strings, in viewBox units (y grows downward). */
function useGeometry(data: Record<string, unknown>[], keys: string[], filled: boolean) {
  return useMemo(() => {
    const values = (key: string) => data.map((d) => (d[key] == null ? NaN : Number(d[key])));
    // A round top (500, not 481) so the three ticks read as round numbers.
    const max = scaleLinear()
      .domain([0, Math.max(1, ...keys.flatMap(values).filter(Number.isFinite))])
      .nice(2)
      .domain()[1];
    const n = Math.max(1, data.length - 1);
    const x = (i: number) => (data.length === 1 ? 50 : (i / n) * 100);
    const y = (v: number) => 100 - (v / max) * 100;
    const paths = keys.map((key) => {
      const vs = values(key);
      const pts: [number, number][] = vs.map((v, i) => [x(i), y(v)]);
      return {
        key,
        isolated: pts.filter(
          (point, index) =>
            Number.isFinite(point[1]) &&
            !Number.isFinite(pts[index - 1]?.[1]) &&
            !Number.isFinite(pts[index + 1]?.[1])
        ),
        line:
          line()
            .defined((p) => Number.isFinite(p[1]))
            .curve(curveStepAfter)(pts) ?? '',
        area: filled
          ? (area<[number, number]>()
              .defined((p) => Number.isFinite(p[1]))
              .x((p) => p[0])
              .y0(100)
              .y1((p) => p[1])
              .curve(curveStepAfter)(pts) ?? '')
          : '',
      };
    });
    return { max, paths };
  }, [data, keys, filled]);
}

/**
 * A time series: one or more series over shared x labels.
 *
 * `x` names the label field (an hour, a day); each `series` key names a
 * numeric field. `kind="area"` fills under each line.
 */
export function TimeChart({
  data,
  x,
  series,
  kind = 'area',
  format = formatTick,
  className,
  compact = false,
  onInspect,
}: {
  data: Record<string, unknown>[];
  x: string;
  series: ChartSeries;
  kind?: 'area' | 'line';
  format?: (v: number) => string;
  className?: string;
  compact?: boolean;
  onInspect?: () => void;
}) {
  const keys = useMemo(() => Object.keys(series), [series]);
  const { max, paths } = useGeometry(data, keys, kind === 'area');
  const [hover, setHover] = useState<number | null>(null);
  const clipId = useId();

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width || data.length < 2) return;
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setHover(Math.round(ratio * (data.length - 1)));
  };

  const last = data.length - 1;
  const hoverLeft = hover === null ? 0 : (hover / Math.max(1, last)) * 100;

  return (
    <figure className={cn('flex flex-col gap-1.5', className)}>
      {!compact && keys.length > 1 && (
        <figcaption className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {keys.map((key) => (
            <span key={key} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-0.5 w-3 rounded-full"
                style={{ background: COLOR[series[key].color] }}
              />
              {series[key].label}
            </span>
          ))}
        </figcaption>
      )}
      <div className="flex min-h-0 flex-1 gap-2">
        {/* Y ticks: max, half, zero. */}
        {!compact && (
          <div
            aria-hidden="true"
            className="flex w-9 shrink-0 flex-col justify-between text-right text-[11px] text-muted-foreground [font-variant-numeric:tabular-nums]"
          >
            <span className="-translate-y-1/2">{format(max)}</span>
            <span>{format(max / 2)}</span>
            <span className="translate-y-1/2">0</span>
          </div>
        )}
        <div
          tabIndex={compact ? undefined : 0}
          role={onInspect ? 'button' : compact ? undefined : 'group'}
          aria-label={`${onInspect ? 'Open details for ' : 'Explore '}${keys.map((k) => series[k].label).join(', ')}. Arrow keys read values.`}
          onClick={onInspect}
          onKeyDown={(event) => {
            if ((event.key === 'Enter' || event.key === ' ') && onInspect) {
              event.preventDefault();
              onInspect();
            } else if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
              event.preventDefault();
              setHover((previous) =>
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? data.length - 1
                    : Math.max(
                        0,
                        Math.min(
                          data.length - 1,
                          (previous ?? -1) + (event.key === 'ArrowRight' ? 1 : -1)
                        )
                      )
              );
            }
          }}
          onBlur={() => setHover(null)}
          className="relative min-w-0 flex-1 rounded focus-visible:outline-2 focus-visible:outline-brand"
          onPointerMove={compact ? undefined : onMove}
          onPointerLeave={() => setHover(null)}
        >
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full overflow-visible"
            role="img"
            aria-label={keys.map((k) => series[k].label).join(', ')}
          >
            <clipPath id={clipId}>
              <rect x="0" y="0" width="100" height="100" />
            </clipPath>
            {(compact ? [100] : [0, 50, 100]).map((gy) => (
              <line
                key={gy}
                x1="0"
                x2="100"
                y1={gy}
                y2={gy}
                stroke="var(--chart-grid)"
                strokeWidth="1"
                strokeDasharray={compact ? undefined : '3 5'}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <g clipPath={`url(#${clipId})`}>
              {paths.map((p) => (
                <g key={p.key}>
                  {p.area && (
                    <path
                      d={p.area}
                      fill={`color-mix(in oklab, ${COLOR[series[p.key].color]} 14%, transparent)`}
                    />
                  )}
                  <path
                    d={p.line}
                    fill="none"
                    stroke={COLOR[series[p.key].color]}
                    strokeWidth="1.5"
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              ))}
            </g>
          </svg>
          {paths.flatMap((path) =>
            path.isolated.map(([left, top], index) => (
              <span
                key={`${path.key}-${index}`}
                aria-hidden
                className="pointer-events-none absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{
                  left: `${left}%`,
                  top: `${top}%`,
                  background: COLOR[series[path.key].color],
                }}
              />
            ))
          )}
          {hover !== null && (
            <>
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 w-px bg-border-secondary"
                style={{ left: `${hoverLeft}%` }}
              />
              <div
                role="status"
                className={cn(
                  'pointer-events-none absolute top-0 z-10 min-w-28 rounded-md border border-border bg-popover px-2 py-1.5 text-xs shadow-elevation-3',
                  hoverLeft > 60 ? '-translate-x-[calc(100%+8px)]' : 'translate-x-2'
                )}
                style={{ left: `${hoverLeft}%` }}
              >
                <p className="text-muted-foreground">{String(data[hover]?.[x] ?? '')}</p>
                {keys.map((key) => (
                  <p key={key} className="flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        aria-hidden="true"
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ background: COLOR[series[key].color] }}
                      />
                      {series[key].label}
                    </span>
                    <span className="[font-variant-numeric:tabular-nums]">
                      {data[hover]?.[key] == null ? 'No sample' : format(Number(data[hover][key]))}
                    </span>
                  </p>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      {/* X labels: first, middle, last. */}
      <div
        aria-hidden="true"
        className={cn(
          'ml-11 flex justify-between text-[11px] text-muted-foreground',
          compact && 'hidden'
        )}
      >
        <span>{String(data[0]?.[x] ?? '')}</span>
        {data.length > 2 && <span>{String(data[Math.floor(last / 2)]?.[x] ?? '')}</span>}
        <span>{String(data[last]?.[x] ?? '')}</span>
      </div>
    </figure>
  );
}

/** A trend in a stat or a row: one line, no axes. */
export function Sparkline({
  data,
  color = 'green',
  className,
}: {
  data: number[];
  color?: ChartColor;
  className?: string;
}) {
  const path = useMemo(() => {
    if (data.length < 2) return '';
    const max = Math.max(...data);
    const min = Math.min(...data);
    const span = max - min || 1;
    const pts: [number, number][] = data.map((v, i) => [
      (i / (data.length - 1)) * 100,
      100 - ((v - min) / span) * 100,
    ]);
    return line().curve(curveMonotoneX)(pts) ?? '';
  }, [data]);
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
      className={cn('overflow-visible', className)}
    >
      <path
        d={path}
        fill="none"
        stroke={COLOR[color]}
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
