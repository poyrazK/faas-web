import { Fragment, useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Button } from '@/components/ui/button';
import { CopyIconButton } from '@/components/ui/copy-button';
import { FIELD } from '@/components/ui/field';
import { ApiError } from '@/lib/api/errors';
import { useWakeTimeline } from '@/lib/api/queries';
import { formatUsageBytes } from '@/lib/usage-format';
import { cn } from '@/lib/utils';
import {
  parseWake,
  SOURCE_LABELS,
  type RawWakeEvent,
  type WakeArtifact,
  type WakeBreakdown,
  type WakeFirstByte,
  type WakeGeneration,
  type WakePhase,
} from '@/lib/wake-anatomy';
import { EASE } from './motion';
import { PlanGated } from './plan-gated';
import { InlinePhase, queryPhase } from './primitives';
import { Pill } from './resource-table';

const METHOD_LABEL: Record<WakeGeneration['method'], string> = {
  restore: 'Restore',
  cold_boot: 'Cold boot',
  thaw: 'Thaw',
  unknown: 'Unknown method',
};
const OUTCOME: Record<WakeGeneration['outcome']['status'], [string, string]> = {
  ready: ['Ready', 'var(--status-good)'],
  failed: ['Failed', 'var(--status-serious)'],
  stalled: ['Stalled', 'var(--status-warning)'],
  in_progress: ['In progress', 'var(--status-idle)'],
};
const PHASE_TITLE: Record<WakeBreakdown['kind'], string> = {
  restore: 'Restore phases',
  cold_boot: 'Cold boot phases',
  thaw: 'Thaw phases',
};
const KIND_NOUN: Record<WakeBreakdown['kind'], string> = {
  restore: 'restore',
  cold_boot: 'cold boot',
  thaw: 'thaw',
};
const TABULAR = 'font-mono [font-variant-numeric:tabular-nums]';

const frameKey = (e: RawWakeEvent) => `${e.at}|${e.kind}|${e.actor ?? ''}`;

/** Where one wake spent its time: real milestones on an axis, then its phases. */
export function WakeWaterfall({ slug, wakeId }: { slug: string; wakeId: string }) {
  const q = useWakeTimeline(slug, wakeId);
  const events = useMemo(() => {
    const seen = new Set<string>();
    return (q.data?.pages ?? [])
      .flatMap((page) => page.events as RawWakeEvent[])
      .filter((e) => {
        const key = frameKey(e);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [q.data]);
  const anatomy = useMemo(() => parseWake(events), [events]);
  const [picked, setPicked] = useState<number | null>(null);
  // apid answers an unknown or aged-out wake with 404 not_found (it refuses to
  // reveal whether the ID ever existed), which is the empty state, not a fault.
  const gone = q.error instanceof ApiError && q.error.code === 'not_found';
  const phase = gone
    ? 'empty'
    : queryPhase({ error: q.error, loading: q.isPending, isEmpty: events.length === 0 });
  const gens = anatomy.generations;
  const index = picked !== null && picked < gens.length ? picked : gens.length - 1;
  const gen = gens[index];
  const origin = Math.min(...events.map((e) => Date.parse(e.at)).filter((t) => Number.isFinite(t)));

  return (
    <PlanGated error={q.error} feature="Wake timeline">
      <div className="flex flex-col gap-5">
        {phase !== 'ready' ? (
          <>
            <InlinePhase
              phase={phase}
              error={gone ? undefined : q.error}
              loadingMessage="Reading the timeline…"
              emptyMessage="No frames recorded for this wake. It may have aged out. Check the debugger for request evidence."
            />
            {q.error && !gone && (
              <Button
                size="xs"
                variant="outline"
                className="self-start"
                onClick={() => void q.refetch()}
              >
                Retry timeline
              </Button>
            )}
          </>
        ) : (
          <>
            {gens.length > 1 && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                Wake generation
                <select
                  className={cn(FIELD, 'w-auto')}
                  value={index}
                  onChange={(e) => setPicked(Number(e.target.value))}
                >
                  {gens.map((_, i) => (
                    <option key={i} value={i}>
                      {i === 0 ? 'First boot' : `Thaw ${i}`}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {gen ? (
              <>
                <Summary gen={gen} wakeId={wakeId} />
                <Stages gen={gen} />
                {gen.firstByte && <FirstByte firstByte={gen.firstByte} />}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No canonical wake stages were recorded. The raw frames are below.
              </p>
            )}
            <OtherFrames frames={anatomy.otherFrames} origin={origin} open={!gen} />
            {q.hasNextPage && (
              <Button
                size="xs"
                variant="outline"
                busy={q.isFetchingNextPage}
                onClick={() => void q.fetchNextPage()}
              >
                Load later frames
              </Button>
            )}
          </>
        )}
      </div>
    </PlanGated>
  );
}

function Summary({ gen, wakeId }: { gen: WakeGeneration; wakeId: string }) {
  const [outcomeLabel, outcomeColor] = OUTCOME[gen.outcome.status];
  return (
    <section aria-label="Wake summary" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-3">
        <span className={cn(TABULAR, 'text-3xl font-semibold tracking-tight')}>
          {gen.totalMs !== undefined ? `${gen.totalMs} ms` : '—'}
        </span>
        <Pill label={METHOD_LABEL[gen.method]} />
        <Pill label={outcomeLabel} color={outcomeColor} />
      </div>
      <Headline gen={gen} />
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Started {new Date(gen.t0).toLocaleString()}</span>
        <span aria-hidden="true">·</span>
        <span className="font-mono">{wakeId}</span>
        <CopyIconButton text={wakeId} label={`wake ID ${wakeId}`} />
      </div>
    </section>
  );
}

function Headline({ gen }: { gen: WakeGeneration }) {
  const o = gen.outcome;
  if (o.status === 'failed' || o.status === 'stalled' || gen.fallback) {
    const failed = o.status === 'failed';
    const text = failed
      ? 'The boot failed'
      : o.status === 'stalled'
        ? 'The wake stalled'
        : 'The restore fell back to a cold boot because the app’s after-restore callback failed';
    const code = o.status === 'failed' || o.status === 'stalled' ? o.reason : gen.fallback;
    const tone = failed ? 'var(--status-serious)' : 'var(--status-warning)';
    return (
      <p
        role="status"
        className="rounded-md border px-3 py-2 text-sm"
        style={{ borderColor: `color-mix(in oklab, ${tone} 35%, transparent)`, color: tone }}
      >
        {text}
        {code && (
          <>
            {' ('}
            <code className="font-mono text-xs">{code}</code>
            {')'}
          </>
        )}
        .
      </p>
    );
  }
  const bd = gen.breakdown;
  if (bd?.largest && bd.totalMs > 0) {
    return (
      <p className="text-sm">
        Most of the {KIND_NOUN[bd.kind]}: <strong>{bd.largest.label}</strong>, {bd.largest.ms} ms (
        {Math.round(bd.largest.share * 100)}%).
      </p>
    );
  }
  const longest = gen.segments.reduce<WakeGeneration['segments'][number] | undefined>(
    (best, s) => (!best || s.endMs - s.startMs > best.endMs - best.startMs ? s : best),
    undefined
  );
  return longest ? (
    <p className="text-sm">
      Longest stage: <strong>{longest.label}</strong>, {longest.endMs - longest.startMs} ms.
    </p>
  ) : null;
}

function Bar({
  left,
  width,
  tone = 'neutral',
}: {
  left: number;
  width: number;
  tone?: 'brand' | 'neutral' | 'warning';
}) {
  const reduce = useReducedMotion();
  const pct = (v: number) => `${Math.min(100, Math.max(0, v * 100))}%`;
  return (
    <motion.span
      aria-hidden="true"
      className={cn(
        'absolute inset-y-1 min-w-[2px] rounded-sm',
        tone === 'brand' ? 'bg-brand' : 'bg-muted-foreground/40'
      )}
      style={{
        left: pct(left),
        ...(tone === 'warning' ? { backgroundColor: 'var(--status-warning)' } : {}),
      }}
      initial={reduce ? false : { width: 0 }}
      animate={{ width: pct(width) }}
      transition={{ duration: reduce ? 0 : 0.4, ease: EASE }}
    />
  );
}

function Stages({ gen }: { gen: WakeGeneration }) {
  const [open, setOpen] = useState(true);
  const span = Math.max(1, ...gen.segments.map((s) => s.endMs));
  const hosted = Boolean(gen.breakdown && gen.segments.some((s) => s.key === gen.breakdownAt));
  return (
    <>
      {gen.segments.length > 0 && (
        <table className="w-full border-separate border-spacing-y-1 text-xs">
          <caption className="label-mono mb-2 text-left text-muted-foreground">Stages</caption>
          <thead className="sr-only">
            <tr>
              <th>Stage</th>
              <th>Timeline</th>
              <th>Duration</th>
              <th>Recorded by</th>
            </tr>
          </thead>
          <tbody>
            {gen.segments.map((s) => {
              const isHost = hosted && s.key === gen.breakdownAt;
              return (
                <Fragment key={`${s.key}-${s.startMs}`}>
                  <tr>
                    <th scope="row" className="w-36 pr-3 text-left font-normal">
                      {isHost ? (
                        <button
                          type="button"
                          aria-expanded={open}
                          onClick={() => setOpen((v) => !v)}
                          className="pressable rounded text-left underline decoration-dotted underline-offset-2 focus-visible:outline-2 focus-visible:outline-brand"
                        >
                          {s.label}
                        </button>
                      ) : (
                        s.label
                      )}
                    </th>
                    <td className="relative h-6">
                      <Bar left={s.startMs / span} width={(s.endMs - s.startMs) / span} />
                    </td>
                    <td className={cn(TABULAR, 'w-20 text-right')}>{s.endMs - s.startMs} ms</td>
                    <td className="hidden w-20 pl-3 text-muted-foreground sm:table-cell">
                      {s.actor}
                    </td>
                  </tr>
                  {isHost && open && gen.breakdown && (
                    <tr>
                      <td colSpan={4}>
                        <Breakdown bd={gen.breakdown} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
      {gen.breakdown && !hosted && <Breakdown bd={gen.breakdown} />}
    </>
  );
}

function Breakdown({ bd }: { bd: WakeBreakdown }) {
  return (
    <div className="flex flex-col gap-3 py-2 sm:pl-4">
      {bd.beforeWindow.length > 0 && (
        <PhaseTable
          caption="Before restore (not in the total)"
          phases={bd.beforeWindow}
          total={bd.totalMs}
        />
      )}
      <PhaseTable
        caption={`${PHASE_TITLE[bd.kind]}, ${bd.totalMs} ms total`}
        phases={bd.phases}
        total={bd.totalMs}
        largest={bd.largest}
        artifacts={bd.artifacts}
      />
      {bd.totalMs > 0 && bd.phaseSumMs !== bd.totalMs && (
        <p className="text-xs text-muted-foreground">
          Phases can overlap. Their durations add up to {bd.phaseSumMs} ms against a total of{' '}
          {bd.totalMs} ms.
        </p>
      )}
    </div>
  );
}

function PhaseTable({
  caption,
  phases,
  total,
  largest,
  artifacts = [],
}: {
  caption: string;
  phases: WakePhase[];
  total: number;
  largest?: WakePhase;
  artifacts?: WakeArtifact[];
}) {
  const hasResolve = phases.some((p) => p.key === 'resolve_images_ms');
  return (
    <table className="w-full text-xs">
      <caption className="label-mono mb-1 text-left text-muted-foreground">{caption}</caption>
      <thead className="sr-only">
        <tr>
          <th>Phase</th>
          <th>Share of total</th>
          <th>Duration</th>
        </tr>
      </thead>
      <tbody>
        {phases.map((p) => (
          <Fragment key={p.key}>
            <tr>
              <th scope="row" className="py-1 pr-3 text-left font-normal sm:w-64">
                <span>{p.label}</span>{' '}
                <span className="font-mono text-[10px] text-muted-foreground">{p.key}</span>
              </th>
              <td className="relative h-6">
                <Bar left={0} width={p.share} tone={p.key === largest?.key ? 'brand' : 'neutral'} />
              </td>
              <td className={cn(TABULAR, 'w-20 text-right')}>{p.ms} ms</td>
            </tr>
            {p.key === 'resolve_images_ms' &&
              artifacts.map((a) => <ArtifactRow key={a.artifact} artifact={a} total={total} />)}
          </Fragment>
        ))}
        {!hasResolve &&
          artifacts.map((a) => <ArtifactRow key={a.artifact} artifact={a} total={total} />)}
      </tbody>
    </table>
  );
}

function ArtifactRow({ artifact, total }: { artifact: WakeArtifact; total: number }) {
  const fetched = artifact.source === 'materialized';
  return (
    <tr>
      <th scope="row" className="py-1 pl-4 pr-3 text-left font-normal">
        <span className="font-mono">{artifact.artifact}</span>{' '}
        <Pill
          label={SOURCE_LABELS[artifact.source]}
          color={fetched ? 'var(--status-warning)' : undefined}
        />
        {artifact.bytes !== undefined && (
          <span className="text-muted-foreground"> {formatUsageBytes(artifact.bytes)}</span>
        )}
      </th>
      <td className="relative h-6">
        <Bar
          left={0}
          width={total > 0 ? artifact.durationMs / total : 0}
          tone={fetched ? 'warning' : 'neutral'}
        />
      </td>
      <td className={cn(TABULAR, 'w-20 text-right')}>{artifact.durationMs} ms</td>
    </tr>
  );
}

function FirstByte({ firstByte }: { firstByte: WakeFirstByte }) {
  const phases = Object.entries(firstByte.gatewayPhasesMs);
  if (firstByte.latencyMs === undefined && firstByte.proxyLatencyMs === undefined && !phases.length)
    return null;
  const rows: [string, number][] = [
    ...(firstByte.latencyMs !== undefined
      ? [['Request to first byte', firstByte.latencyMs] as [string, number]]
      : []),
    ...(firstByte.proxyLatencyMs !== undefined
      ? [['Final proxy hop', firstByte.proxyLatencyMs] as [string, number]]
      : []),
    ...phases,
  ];
  return (
    <section aria-label="First byte" className="flex flex-col gap-2">
      <h3 className="label-mono text-muted-foreground">First byte</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-xs">
        {rows.map(([label, ms]) => (
          <Fragment key={label}>
            <dt className="font-mono text-muted-foreground">{label}</dt>
            <dd className={TABULAR}>{ms} ms</dd>
          </Fragment>
        ))}
      </dl>
    </section>
  );
}

function OtherFrames({
  frames,
  origin,
  open,
}: {
  frames: RawWakeEvent[];
  origin: number;
  open: boolean;
}) {
  if (!frames.length) return null;
  return (
    <details open={open} className="text-xs">
      <summary className="cursor-pointer text-muted-foreground">
        Other frames ({frames.length})
      </summary>
      <ol className="mt-2 flex flex-col">
        {frames.map((e, i) => {
          const t = Date.parse(e.at);
          const dt = Number.isFinite(t) && Number.isFinite(origin) ? Math.max(0, t - origin) : null;
          return (
            <li
              key={`${e.at}-${e.kind}-${i}`}
              className="flex items-baseline gap-4 border-b border-border py-2 last:border-0"
            >
              <span className={cn(TABULAR, 'w-16 shrink-0 text-right text-muted-foreground')}>
                {dt === null ? '—' : `+${dt} ms`}
              </span>
              <span className="font-mono">{e.kind}</span>
              {e.actor && <span className="text-muted-foreground">{e.actor}</span>}
            </li>
          );
        })}
      </ol>
    </details>
  );
}
