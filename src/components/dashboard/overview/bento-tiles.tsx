import '../bento.css';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowRight, ArrowUpRight, Check, Refresh, Xmark } from 'iconoir-react';
import { formatRelative, type Deployment } from '@/lib/mock-data';
import { cn } from '@/lib/utils';
import { InlinePhase, type QueryPhase } from '../primitives';
import { compareRequestHalves } from '../analytics-data';
import { DotNumeral, compactFigure } from './dot-numeral';
import {
  coldBootTicks,
  completeHours,
  dayMarks,
  errorTicks,
  fieldRows,
  gaugeTicks,
  streamGeometry,
  sumSeries,
  totalsOf,
  FIELD_ERROR_PCT,
  type AppSeries,
  type Tick,
} from './overview-data';

type Tone = 'traffic' | 'compute' | 'errors' | 'release' | 'field' | 'plain';

export function Tile({
  span,
  tone = 'plain',
  className,
  children,
}: {
  span: 3 | 4 | 8;
  tone?: Tone;
  className?: string;
  children: (headingId: string) => ReactNode;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      data-span={span}
      data-tone={tone}
      className={cn('bento-tile', className)}
    >
      {children(id)}
    </section>
  );
}

const hour = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', {
    timeZone: 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

function Ticks({ ticks, label }: { ticks: Tick[]; label: string }) {
  if (ticks.length === 0) return null;
  return (
    <div role="img" aria-label={label} className="bento-ticks bento-arrive mt-auto pt-4">
      {ticks.map((t, i) => (
        <span
          key={i}
          title={t.label}
          className="bento-tick"
          data-hot={t.hot || undefined}
          data-empty={t.height === 0 || undefined}
          style={{ height: `${t.height}%` }}
        />
      ))}
    </div>
  );
}

function PlanLocked({ feature }: { feature: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm font-medium">{feature} is available on Hobby and above</p>
      <p className="max-w-md text-sm text-muted-foreground">
        Request history, error rates and cold boots are recorded from the Hobby plan up.
      </p>
      <Link
        to="/dashboard/plans"
        className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline"
      >
        Compare plans
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

export interface SeriesState {
  paid: boolean;
  phase: QueryPhase;
  series: AppSeries[];
  uncharted: number;
  from?: string;
  until?: string;
  clamped: boolean;
  since?: string;
  error: unknown;
  refetch: () => unknown;
}

/* ------------------------------------------------------------------ *
 * Requests — the hero
 * ------------------------------------------------------------------ */

export function RequestsTile({ state, windowLabel }: { state: SeriesState; windowLabel: string }) {
  const totals = sumSeries(state.series);
  const sum = totalsOf(totals);
  const geometry = streamGeometry(completeHours(state.series, state.until), 1000, 200);
  const halves =
    state.uncharted === 0
      ? compareRequestHalves(totals, 'requests', state.from, state.until)
      : null;
  const ready = state.paid && state.phase === 'ready';

  return (
    <Tile span={8} tone="traffic" className="min-h-[25rem] !p-0">
      {(id) => (
        <>
          <div className="relative z-[1] flex flex-wrap justify-between gap-4 px-6 pt-6">
            <div className="flex flex-col gap-3.5">
              <h2 id={id} className="text-lg font-semibold">
                Requests
              </h2>
              {!state.paid ? (
                <PlanLocked feature="Metrics" />
              ) : state.phase !== 'ready' ? (
                <InlinePhase
                  phase={state.phase}
                  error={state.error}
                  onRetry={state.refetch}
                  loadingMessage="Reading request history…"
                  emptyMessage="No apps to chart yet."
                />
              ) : (
                <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
                  <DotNumeral
                    text={compactFigure(sum.requests)}
                    label={`${sum.requests.toLocaleString('en')} requests`}
                  />
                  <div className="flex flex-col pb-0.5 text-[13px] leading-[18px]">
                    {halves?.delta != null && (
                      <span className="font-mono tabular-nums">
                        {halves.delta >= 0 ? '↑' : '↓'} {Math.abs(halves.delta).toFixed(1)}%
                      </span>
                    )}
                    <span className="text-foreground/75">
                      {halves?.delta != null
                        ? `last ${halves.hours} h vs the ${halves.hours} h before`
                        : state.uncharted > 0
                          ? `busiest ${state.series.length} apps · ${windowLabel}`
                          : windowLabel}
                    </span>
                  </div>
                </div>
              )}
            </div>
            {ready && geometry.bands.length > 0 && (
              <ul
                aria-label="Apps in the stream"
                className="flex max-w-md list-none flex-wrap content-start gap-x-4 gap-y-1.5 self-start text-[13px] text-foreground/85"
              >
                {geometry.bands.slice(0, 4).map((band, i) => (
                  <li key={band.slug} className="flex items-center gap-1.5">
                    <span aria-hidden className="bento-swatch h-2 w-2 rounded-full" data-band={i} />
                    {band.name}
                  </li>
                ))}
                {geometry.bands.length > 4 && <li>+{geometry.bands.length - 4} more</li>}
                {state.uncharted > 0 && (
                  <li className="text-foreground/60">{state.uncharted} quieter apps not drawn</li>
                )}
              </ul>
            )}
          </div>

          {ready && geometry.bands.length > 0 && sum.requests > 0 ? (
            <figure
              className="bento-arrive relative mt-auto h-[250px]"
              role="img"
              aria-label={`Hourly requests stacked by app, ${windowLabel}${geometry.pins[0] ? `, peaking at ${geometry.pins[0].requests.toLocaleString('en')} at ${hour(geometry.pins[0].start)} UTC` : ''}`}
            >
              <svg
                viewBox="0 0 1000 200"
                preserveAspectRatio="none"
                aria-hidden
                className="bento-stream absolute inset-x-0 top-3 h-[200px] w-full"
              >
                {geometry.bands.map((band, i) => (
                  <path key={band.slug} d={band.d} data-band={i % 8} />
                ))}
              </svg>
              {geometry.pins.map((pin) => (
                <div
                  key={pin.kind}
                  aria-hidden
                  className={cn(
                    'absolute top-0 bottom-6 flex flex-col items-center',
                    pin.x > 0.92 ? '-translate-x-full' : '-translate-x-1/2'
                  )}
                  style={{ left: `${Math.min(pin.x, 0.985) * 100}%` }}
                >
                  <span className="bento-chip tabular-nums">{compactFigure(pin.requests)}</span>
                  <span className="bento-pin-line w-px flex-1" />
                  <span className="bento-chip">{hour(pin.start)}</span>
                </div>
              ))}
            </figure>
          ) : (
            ready && (
              <p className="mt-auto px-6 pb-6 text-sm text-foreground/75">
                No requests in this window.
              </p>
            )
          )}
          {ready && state.clamped && state.since && (
            <p className="px-6 pb-4 text-xs text-foreground/70">
              Limited to your plan’s {state.since} of history.
            </p>
          )}
        </>
      )}
    </Tile>
  );
}

/* ------------------------------------------------------------------ *
 * Compute allowance
 * ------------------------------------------------------------------ */

export interface AllowanceState {
  phase: QueryPhase;
  error: unknown;
  usedGbHours: number;
  /** null: a company with no usage this month carries no allowance yet. */
  includedGbHours: number | null;
  overGbHours: number;
  overageLabel?: string;
  byApp: { slug: string; gbHours: number }[] | null;
}

const gbh = (v: number) => v.toLocaleString('en', { maximumFractionDigits: 1 });

export function AllowanceTile({ state }: { state: AllowanceState }) {
  const fraction =
    state.includedGbHours && state.includedGbHours > 0
      ? state.usedGbHours / state.includedGbHours
      : null;
  const over = state.overGbHours > 0;
  const ticks = gaugeTicks(over ? 1 : (fraction ?? 0));
  const top = (state.byApp ?? []).slice(0, 2);
  const rest = (state.byApp ?? []).slice(2).reduce((sum, row) => sum + row.gbHours, 0);
  const restCount = Math.max(0, (state.byApp ?? []).length - 2);
  // Shares of the per-app rows themselves: the summary and the rows are
  // separate reads and need not agree to the decimal.
  const appsTotal = (state.byApp ?? []).reduce((sum, row) => sum + row.gbHours, 0);
  const shareOf = (v: number) => (appsTotal > 0 ? `${Math.round((v / appsTotal) * 100)}%` : '—');

  return (
    <Tile span={4} tone="compute" className="min-h-[25rem]">
      {(id) => (
        <>
          <div className="flex items-center justify-between gap-3">
            <h2 id={id} className="text-lg font-semibold">
              Compute allowance
            </h2>
            {state.includedGbHours != null && (
              <span className="bento-chip">{gbh(state.includedGbHours)} GB-h included</span>
            )}
          </div>
          {state.phase !== 'ready' ? (
            <div className="mt-6">
              <InlinePhase
                phase={state.phase}
                error={state.error}
                loadingMessage="Reading this billing period…"
              />
            </div>
          ) : (
            <>
              <div className="relative mx-auto mt-5 mb-2 h-[150px] w-[260px] max-w-full">
                <svg
                  viewBox="0 0 260 140"
                  aria-hidden
                  className="bento-gauge absolute inset-x-0 top-0 h-[140px] w-full"
                  data-over={over || undefined}
                >
                  {ticks.map((t, i) => {
                    const a = (t.angle * Math.PI) / 180;
                    return (
                      <line
                        key={i}
                        x1={130 + Math.sin(a) * 100}
                        y1={130 - Math.cos(a) * 100}
                        x2={130 + Math.sin(a) * 120}
                        y2={130 - Math.cos(a) * 120}
                        data-lit={t.lit || undefined}
                      />
                    );
                  })}
                </svg>
                <div className="absolute inset-x-0 bottom-0 text-center">
                  {over ? (
                    <>
                      <p className="text-[40px] leading-[48px] font-normal tracking-[-0.03em] tabular-nums">
                        +{gbh(state.overGbHours)}
                      </p>
                      <p className="text-[13px] text-muted-foreground">
                        GB-h over{state.overageLabel ? ` · ${state.overageLabel}` : ''}
                      </p>
                    </>
                  ) : fraction != null ? (
                    <>
                      <p className="text-[52px] leading-[52px] font-normal tracking-[-0.03em] tabular-nums">
                        {Math.round(fraction * 100)}
                        <span className="align-top text-xl text-muted-foreground">%</span>
                      </p>
                      <p className="text-[13px] text-muted-foreground">
                        {gbh(state.usedGbHours)} GB-h used
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-[40px] leading-[48px] tabular-nums">
                        {gbh(state.usedGbHours)}
                      </p>
                      <p className="text-[13px] text-muted-foreground">
                        GB-h used this billing period
                      </p>
                    </>
                  )}
                </div>
              </div>
              <span className="sr-only">
                {fraction != null
                  ? `${Math.round(fraction * 100)} percent of ${gbh(state.includedGbHours ?? 0)} included GB-hours used`
                  : `${gbh(state.usedGbHours)} GB-hours used`}
              </span>
              {state.byApp && state.byApp.length > 0 ? (
                <ul className="mt-auto flex list-none flex-col">
                  {top.map((row, i) => (
                    <li
                      key={row.slug}
                      className="grid min-h-[38px] grid-cols-[12px_1fr_auto_auto] items-center gap-2.5 border-b border-border"
                    >
                      <span
                        aria-hidden
                        className="bento-share h-2 w-2 rounded-full"
                        data-rank={i}
                      />
                      <span className="truncate">{row.slug}</span>
                      <span className="font-mono text-[13px] text-muted-foreground tabular-nums">
                        {shareOf(row.gbHours)}
                      </span>
                      <span className="min-w-16 text-right font-medium tabular-nums">
                        {gbh(row.gbHours)}
                      </span>
                    </li>
                  ))}
                  {restCount > 0 && (
                    <li className="grid min-h-[38px] grid-cols-[12px_1fr_auto_auto] items-center gap-2.5">
                      <span
                        aria-hidden
                        className="bento-share h-2 w-2 rounded-full"
                        data-rank={2}
                      />
                      <span>
                        {restCount} {restCount === 1 ? 'other' : 'others'}
                      </span>
                      <span className="font-mono text-[13px] text-muted-foreground tabular-nums">
                        {shareOf(rest)}
                      </span>
                      <span className="min-w-16 text-right font-medium tabular-nums">
                        {gbh(rest)}
                      </span>
                    </li>
                  )}
                </ul>
              ) : (
                <Link
                  to="/dashboard/usage"
                  className="mt-auto inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
                >
                  Usage by app
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              )}
            </>
          )}
        </>
      )}
    </Tile>
  );
}

/* ------------------------------------------------------------------ *
 * Small tiles
 * ------------------------------------------------------------------ */

function SmallHead({ id, label, aside }: { id: string; label: string; aside?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 id={id} className="bento-label">
        {label}
      </h2>
      {aside}
    </div>
  );
}

const Big = ({ children }: { children: ReactNode }) => (
  <p className="mt-3 text-[40px] leading-[48px] tracking-[-0.02em] tabular-nums">{children}</p>
);

export function ErrorsTile({ state }: { state: SeriesState }) {
  const totals = sumSeries(state.series);
  const sum = totalsOf(totals);
  const worst = state.series
    .map((app) => ({ app, t: totalsOf(app.points) }))
    .filter(
      ({ t }) => t.requests >= 20 && t.errorRatePct != null && t.errorRatePct >= FIELD_ERROR_PCT
    )
    .sort((a, b) => (b.t.errorRatePct ?? 0) - (a.t.errorRatePct ?? 0))[0];
  const ready = state.paid && state.phase === 'ready';
  return (
    <Tile span={3} tone="errors" className="min-h-[12.25rem]">
      {(id) => (
        <>
          <SmallHead
            id={id}
            label="Error rate"
            aside={ready && worst && <span className="bento-chip">{worst.app.name}</span>}
          />
          <Big>
            {ready && sum.errorRatePct != null ? (
              <>
                {sum.errorRatePct.toFixed(2)}
                <span className="text-xl text-foreground/70">%</span>
              </>
            ) : (
              '—'
            )}
          </Big>
          {ready && (
            <Ticks
              ticks={errorTicks(sumSeries(completeHours(state.series, state.until)))}
              label="Error rate for each hour of the window"
            />
          )}
          {!state.paid && <p className="mt-auto text-xs text-muted-foreground">Hobby and above</p>}
        </>
      )}
    </Tile>
  );
}

export function ColdBootsTile({
  state,
  wakeP95Ms,
}: {
  state: SeriesState;
  /** Fleet-wide: `/v1/apps/metrics` reports the platform's wake p95, not one app's. */
  wakeP95Ms: number | null;
}) {
  const totals = sumSeries(state.series);
  const ready = state.paid && state.phase === 'ready';
  return (
    <Tile span={3} className="min-h-[12.25rem]">
      {(id) => (
        <>
          <SmallHead id={id} label="Cold boots" />
          <Big>{ready ? totalsOf(totals).coldBoots.toLocaleString('en') : '—'}</Big>
          {wakeP95Ms != null && (
            <p className="font-mono text-xs text-muted-foreground tabular-nums">
              wake p95 {Math.round(wakeP95Ms)} ms · fleet-wide
            </p>
          )}
          {ready && (
            <Ticks
              ticks={coldBootTicks(sumSeries(completeHours(state.series, state.until)))}
              label="Cold boots for each hour of the window"
            />
          )}
          {!state.paid && <p className="mt-auto text-xs text-muted-foreground">Hobby and above</p>}
        </>
      )}
    </Tile>
  );
}

export interface InstancesState {
  known: boolean;
  partial: boolean;
  failed: boolean;
  residentCount: number;
  residentMb: number;
  parkedCount: number;
}

const MAX_BLOCKS = 24;

/** True after the first paint, so only blocks added later animate in. */
function useSettled() {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setSettled(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return settled;
}

export function InstancesTile({ state }: { state: InstancesState }) {
  const settled = useSettled();
  const blocks = [
    ...Array.from({ length: state.residentCount }, () => 'resident' as const),
    ...Array.from({ length: state.parkedCount }, () => 'parked' as const),
  ];
  return (
    <Tile span={3} className="min-h-[12.25rem]">
      {(id) => (
        <>
          <SmallHead
            id={id}
            label="Instances now"
            aside={
              state.known && (
                <span className="font-mono text-xs text-muted-foreground tabular-nums">
                  {state.residentMb.toLocaleString('en')} MB
                </span>
              )
            }
          />
          <Big>
            {state.known ? (
              <>
                {state.residentCount}
                <span className="text-base text-muted-foreground">
                  {' '}
                  resident{state.parkedCount > 0 ? ` · ${state.parkedCount} parked` : ''}
                </span>
              </>
            ) : (
              '—'
            )}
          </Big>
          {state.known ? (
            <div
              role="img"
              aria-label={`${state.residentCount} resident and ${state.parkedCount} parked instances`}
              className="bento-instances mt-auto flex flex-wrap gap-1.5 pt-4"
              data-settled={settled || undefined}
            >
              {blocks.slice(0, MAX_BLOCKS).map((kind, i) => (
                <span key={i} className="bento-instance" data-state={kind} />
              ))}
              {blocks.length > MAX_BLOCKS && (
                <span className="self-end text-xs text-muted-foreground">
                  +{blocks.length - MAX_BLOCKS}
                </span>
              )}
            </div>
          ) : (
            <p className="mt-auto text-xs text-muted-foreground">
              {state.partial ? (
                <Link to="/dashboard/instances" className="hover:text-foreground">
                  More instances than fit here — see Instances
                </Link>
              ) : state.failed ? (
                'Instance usage unavailable'
              ) : (
                'Reading instances…'
              )}
            </p>
          )}
        </>
      )}
    </Tile>
  );
}

/** A small line of one app's hourly requests, scaled to its own peak. */
function sparkPath(values: number[], width: number, height: number) {
  if (values.length < 2) return '';
  const max = Math.max(1, ...values);
  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - 1 - (v / max) * (height - 2);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}

/** The busiest apps in the window, each with its own hourly line. */
export function AppsTile({ state, appCount }: { state: SeriesState; appCount: number }) {
  const whole = completeHours(state.series, state.until);
  const rows = state.series
    .map((app, i) => ({
      app,
      totals: totalsOf(app.points),
      spark: sparkPath(
        whole[i].points.map((p) => p.requests),
        64,
        20
      ),
    }))
    .sort((a, b) => b.totals.requests - a.totals.requests)
    .slice(0, 4);
  const ready = state.paid && state.phase === 'ready';
  return (
    <Tile span={3} className="min-h-[12.25rem]">
      {(id) => (
        <>
          <SmallHead
            id={id}
            label="Apps"
            aside={
              <Link
                to="/dashboard/apps"
                className="font-mono text-xs text-muted-foreground tabular-nums hover:text-foreground"
              >
                {appCount} ↗
              </Link>
            }
          />
          {!ready ? (
            <p className="mt-auto text-xs text-muted-foreground">
              {state.paid ? 'Reading request history…' : 'Per-app history starts on Hobby.'}
            </p>
          ) : (
            <ul className="bento-arrive mt-2.5 flex list-none flex-col">
              {rows.map(({ app, totals, spark }) => {
                const hot =
                  totals.requests >= 20 &&
                  totals.errorRatePct != null &&
                  totals.errorRatePct >= FIELD_ERROR_PCT;
                return (
                  <li key={app.slug}>
                    <Link
                      to="/dashboard/apps/$appSlug"
                      params={{ appSlug: app.slug }}
                      className="pressable bento-row flex min-h-9 items-center gap-3 rounded-lg text-sm"
                    >
                      <span className="min-w-0 flex-1 truncate">{app.name}</span>
                      <svg
                        viewBox="0 0 64 20"
                        aria-hidden
                        className="bento-spark h-5 w-16 shrink-0"
                        data-hot={hot || undefined}
                      >
                        <path d={spark} />
                      </svg>
                      <span className="w-12 shrink-0 text-right font-mono text-xs tabular-nums">
                        {compactFigure(totals.requests)}
                      </span>
                      <span className="sr-only">
                        requests
                        {totals.errorRatePct != null
                          ? `, ${totals.errorRatePct.toFixed(1)}% errors`
                          : ''}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </Tile>
  );
}

/* ------------------------------------------------------------------ *
 * Every app, every hour
 * ------------------------------------------------------------------ */

export function HourFieldTile({ state, windowLabel }: { state: SeriesState; windowLabel: string }) {
  const whole = completeHours(state.series, state.until);
  const rows = fieldRows(whole);
  const columns = rows[0]?.cells.length ?? 0;
  const marks = dayMarks(sumSeries(whole));
  const ready = state.paid && state.phase === 'ready' && columns > 0;
  const gap = columns > 72 ? 2 : columns > 36 ? 3 : 5;
  return (
    <Tile span={8} tone="field" className="min-h-[22.5rem]">
      {(id) => (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div className="flex flex-wrap items-baseline gap-3">
              <h2 id={id} className="text-lg font-semibold">
                Every app, every hour
              </h2>
              <span className="text-[13px] text-muted-foreground">{windowLabel}</span>
            </div>
            <Link
              to="/dashboard/analytics"
              className="pressable inline-flex h-8 items-center gap-1 rounded-full bg-muted px-3 text-[13px] text-foreground"
            >
              Analytics
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          {!state.paid ? (
            <p className="mt-4 text-sm text-muted-foreground">Hourly history starts on Hobby.</p>
          ) : !ready ? (
            <div className="mt-4">
              <InlinePhase
                phase={state.phase === 'ready' ? 'empty' : state.phase}
                error={state.error}
                onRetry={state.refetch}
                loadingMessage="Reading hourly history…"
                emptyMessage="No hourly history in this window."
              />
            </div>
          ) : (
            <>
              <div
                role="img"
                aria-label={`Requests per hour for ${rows.length} apps, ${windowLabel}. Brighter means more requests; hollow means none; amber means at least ${FIELD_ERROR_PCT}% errors.`}
                className="bento-field bento-arrive mt-5"
                style={{ gridTemplateColumns: 'minmax(6rem, 9rem) minmax(0, 1fr)' }}
              >
                <span aria-hidden />
                <div
                  aria-hidden
                  className="bento-field__cells text-[13px]"
                  style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
                >
                  {marks.map((mark, i) => (
                    <span
                      key={mark.index}
                      className="truncate font-medium"
                      style={{
                        gridColumn: `${mark.index + 1} / span ${(marks[i + 1]?.index ?? columns) - mark.index}`,
                      }}
                    >
                      {mark.label}
                    </span>
                  ))}
                </div>
                {rows.map((row) => (
                  <FieldRow key={row.slug} row={row} columns={columns} gap={gap} />
                ))}
              </div>
              <div className="mt-auto flex flex-wrap gap-x-5 gap-y-2 pt-4 text-[13px] text-muted-foreground">
                <span className="flex items-center gap-2 whitespace-nowrap">
                  <span aria-hidden className="bento-legend-ramp h-1.5 w-14 rounded-full" />
                  requests per hour
                </span>
                <span className="flex items-center gap-2 whitespace-nowrap">
                  <span aria-hidden className="bento-cell w-2 shrink-0" data-kind="empty" />
                  no requests
                </span>
                <span className="flex items-center gap-2 whitespace-nowrap">
                  <span aria-hidden className="bento-cell w-2 shrink-0" data-kind="errors" />
                  {FIELD_ERROR_PCT}% errors or more
                </span>
              </div>
            </>
          )}
        </>
      )}
    </Tile>
  );
}

function FieldRow({
  row,
  columns,
  gap,
}: {
  row: ReturnType<typeof fieldRows>[number];
  columns: number;
  gap: number;
}) {
  return (
    <>
      <Link
        to="/dashboard/apps/$appSlug"
        params={{ appSlug: row.slug }}
        className="truncate text-[13px] text-muted-foreground hover:text-foreground"
      >
        {row.name}
      </Link>
      <div
        aria-hidden
        className="bento-field__cells"
        style={{
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          ['--cell-gap' as string]: `${gap}px`,
        }}
      >
        {row.cells.map((cell, i) => (
          <span
            key={i}
            title={cell.title}
            className="bento-cell"
            data-kind={cell.kind}
            style={
              cell.kind === 'traffic'
                ? {
                    background: `color-mix(in oklch, var(--brand) ${Math.round(16 + cell.level * 84)}%, transparent)`,
                  }
                : undefined
            }
          />
        ))}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Deployments
 * ------------------------------------------------------------------ */

const DEPLOY_STATE = {
  succeeded: { label: 'live', tone: 'good', Icon: Check },
  failed: { label: 'failed', tone: 'critical', Icon: Xmark },
  building: { label: 'building', tone: 'warning', Icon: Refresh },
} as const;

const seconds = (ms: number) =>
  ms >= 60_000
    ? `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
    : `${Math.round(ms / 1000)} s`;

/**
 * Ids that arrived after the first render. The list is capped, so its length
 * never grows; a set difference catches a new deployment pushing an old out.
 */
function useArrivals(ids: string[]) {
  const seen = useRef<Set<string> | null>(null);
  const [arrived, setArrived] = useState<Set<string>>(new Set());
  const key = ids.join(',');
  useEffect(() => {
    const now = key ? key.split(',') : [];
    if (seen.current) {
      const fresh = now.filter((id) => !seen.current!.has(id));
      if (fresh.length) setArrived(new Set(fresh));
    }
    seen.current = new Set(now);
  }, [key]);
  return arrived;
}

export function DeploymentsTile({ recent }: { recent: Deployment[] }) {
  const arrived = useArrivals(recent.map((d) => d.id));
  return (
    <Tile span={4} tone="release" className="min-h-[22.5rem]">
      {(id) => (
        <>
          <div className="flex items-center justify-between">
            <h2 id={id} className="text-lg font-semibold">
              Deployments
            </h2>
            <Link
              to="/dashboard/releases"
              className="pressable inline-flex h-8 items-center gap-1 rounded-full bg-muted px-3 text-[13px] text-foreground"
            >
              Releases
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          {recent.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">Nothing deployed yet.</p>
          ) : (
            <ul className="mt-3 flex list-none flex-col">
              {recent.map((d) => {
                const s = DEPLOY_STATE[d.state] ?? DEPLOY_STATE.building;
                return (
                  <li key={d.id}>
                    <Link
                      to="/dashboard/releases"
                      search={{ deployment: d.id }}
                      className={cn(
                        'pressable bento-row flex min-h-[52px] items-center gap-3 rounded-lg',
                        arrived.has(d.id) && 'animate-row-arrive'
                      )}
                    >
                      <span
                        className="bento-dot-icon h-[30px] w-[30px]"
                        data-tone={s.tone}
                        aria-hidden
                      >
                        <s.Icon
                          className={cn(
                            'h-3.5 w-3.5',
                            d.state === 'building' && 'animate-spin motion-reduce:animate-none'
                          )}
                        />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col leading-[18px]">
                        <span className="truncate font-medium">
                          {d.workflowId}{' '}
                          <span
                            className={cn(
                              'font-normal',
                              s.tone === 'good'
                                ? 'text-muted-foreground'
                                : 'text-[var(--status-warning)]',
                              s.tone === 'critical' && 'text-[var(--status-critical)]'
                            )}
                          >
                            · {s.label}
                          </span>
                        </span>
                        <span className="truncate font-mono text-xs text-muted-foreground">
                          {d.id}
                          {d.durationMs > 0 ? ` · ${seconds(d.durationMs)}` : ''}
                        </span>
                      </span>
                      <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
                        {formatRelative(d.createdAt)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </Tile>
  );
}
