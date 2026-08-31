import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Check, Lock } from 'iconoir-react';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { EASE } from './reveal';

/**
 * Why Gregale — four reasons as a hover accordion.
 *
 * After Parley's "Why" row: four cards in a line, one open at a time. A
 * closed card is a quiet mint-grey slab — a faint numeral, a mosaic of mint
 * squares, the title at its foot. The card under the pointer (or focus)
 * opens: it grows a little, turns paper-white, lifts on a shadow, and shows
 * a small panel of the real product above a title and a sentence. The open
 * card stays open when the pointer leaves; the second is open to begin with.
 * On phones every card is open and they stack.
 */

export interface Reason {
  title: string;
  body: string;
  /** Cells of the mosaic on a 7×5 grid: [col, row, tint 0–2]. */
  mosaic: [number, number, number][];
  /** The panel the open card shows. */
  panel: ReactNode;
}

const MONO = 'font-mono text-[10.5px] leading-none';

/** A small paper panel in the reference's style, with a titled row list. */
function Panel({ title, rows }: { title: string; rows: ReactNode[] }) {
  return (
    <div className="w-[15.5rem] rounded-lg border border-border bg-card p-3 shadow-[0_10px_24px_-12px_rgba(13,21,18,0.25),0_1px_2px_rgba(13,21,18,0.06)]">
      <div
        className={cn(
          MONO,
          'flex items-center gap-1.5 uppercase tracking-[0.08em] text-muted-foreground'
        )}
      >
        <span className="size-1.5 rounded-full bg-brand-fill" />
        {title}
      </div>
      <div className="my-2 border-t border-dashed border-border" />
      <ul className="flex flex-col gap-1.5">
        {rows.map((r, i) => (
          <li key={i} className={cn(MONO, 'flex items-center gap-2 text-[11px] text-foreground')}>
            {r}
          </li>
        ))}
      </ul>
    </div>
  );
}

const Tick = () => <Check className="size-3 shrink-0 text-brand" />;

export const REASONS: readonly Reason[] = [
  {
    title: 'Hardware-isolated',
    body: 'Every app runs in its own Firecracker microVM on bare metal, with its own kernel. Noisy neighbours and shared runtimes are somebody else’s problem.',
    mosaic: [
      [4, 0, 0],
      [3, 1, 2],
      [5, 1, 1],
      [4, 2, 2],
      [4, 3, 1],
      [5, 4, 0],
    ],
    panel: (
      <Panel
        title="hello · microVM"
        rows={[
          <>
            <Tick /> Firecracker · own kernel
          </>,
          <>
            <Tick /> 2 vCPU · 512 MB
          </>,
          <>
            <Tick /> snapshot on idle
          </>,
          <>
            <Lock className="size-3 shrink-0 text-muted-foreground" />
            <span className="text-muted-foreground">egress: deny by default</span>
          </>,
        ]}
      />
    ),
  },
  {
    title: 'Back in under 350 ms',
    body: 'Idle apps snapshot to disk and park at zero. The next request restores the same snapshot in under 350 ms — scale-to-zero that costs a blink, not a cold start.',
    mosaic: [
      [5, 0, 0],
      [4, 1, 2],
      [3, 2, 0],
      [2, 3, 1],
      [4, 3, 1],
      [5, 4, 2],
      [6, 2, 2],
    ],
    panel: (
      <div className="w-[15.5rem] rounded-lg border border-border bg-card p-3 shadow-[0_10px_24px_-12px_rgba(13,21,18,0.25),0_1px_2px_rgba(13,21,18,0.06)]">
        <div className={cn(MONO, 'flex items-center justify-between text-foreground')}>
          <span>
            wake <span className="text-muted-foreground">wk_2f8a</span>
          </span>
          <span className="text-muted-foreground">340 ms · cold</span>
        </div>
        <div className="mt-2.5 flex h-2.5 w-full gap-px overflow-hidden rounded-sm">
          {[
            ['bg-border-secondary', 12],
            ['bg-brand-fill', 214],
            ['bg-mint-5', 58],
            ['bg-foreground/70', 46],
            ['bg-border-secondary', 10],
          ].map(([tone, ms], i) => (
            <span
              key={i}
              className={cn('h-full', tone as string)}
              style={{ width: `${((ms as number) / 340) * 100}%` }}
            />
          ))}
        </div>
        <div className={cn(MONO, 'mt-2 flex justify-between text-muted-foreground')}>
          <span>0</span>
          <span className="text-brand">restore 214 ms</span>
          <span>340 ms</span>
        </div>
      </div>
    ),
  },
  {
    title: 'One CLI, one API',
    body: 'Deploys, schedules, domains, secrets and logs behind one CLI and one API — the same surface for you and for the agents you run.',
    mosaic: [
      [1, 0, 2],
      [2, 1, 0],
      [1, 2, 1],
      [3, 2, 2],
      [4, 1, 1],
      [5, 0, 0],
      [4, 3, 0],
      [5, 4, 1],
      [2, 4, 2],
    ],
    panel: (
      <div className="w-[15.5rem] rounded-lg bg-[#0d1512] p-3 shadow-[0_10px_24px_-12px_rgba(13,21,18,0.4)]">
        <div className={cn(MONO, 'flex items-center gap-1.5 text-[#8fb3a6]')}>
          <span className="size-1.5 rounded-full bg-[#2a3d37]" />
          <span className="size-1.5 rounded-full bg-[#2a3d37]" />
          <span className="size-1.5 rounded-full bg-[#2a3d37]" />
          <span className="ml-1">hello — zsh</span>
        </div>
        <pre
          className={cn(
            MONO,
            'mt-2.5 whitespace-pre-wrap text-[11px] leading-[1.7] text-[#e6f4ee]'
          )}
        >
          <span className="text-brand-fill">$</span> gregale deploy --ref main{'\n'}
          <span className="text-[#8fb3a6]">Deployed hello · bld_9k2f</span>
          {'\n'}
          <span className="text-brand-fill">$</span> gregale cron add &quot;0 */6 * * *&quot;
        </pre>
      </div>
    ),
  },
  {
    title: 'Bring your own state',
    body: 'Stateless by design. Plug in the Postgres, object store or KV you already use — the URL is a sealed secret, the env var is what your code reads.',
    mosaic: [
      [5, 0, 0],
      [3, 1, 1],
      [5, 1, 2],
      [4, 2, 1],
      [5, 3, 0],
      [3, 4, 0],
      [4, 4, 1],
      [6, 4, 2],
    ],
    panel: (
      <Panel
        title="env · at wake"
        rows={[
          <>
            DATABASE_URL{' '}
            <span className="ml-auto tracking-[0.2em] text-muted-foreground">••••</span>
            <span className="rounded-full border border-mint-4 bg-mint-2 px-1.5 text-[9px] leading-[14px] text-brand">
              sealed
            </span>
          </>,
          <>
            S3_BUCKET_URL{' '}
            <span className="ml-auto tracking-[0.2em] text-muted-foreground">••••</span>
            <span className="rounded-full border border-mint-4 bg-mint-2 px-1.5 text-[9px] leading-[14px] text-brand">
              sealed
            </span>
          </>,
          <>
            REDIS_URL <span className="ml-auto tracking-[0.2em] text-muted-foreground">••••</span>
            <span className="rounded-full border border-mint-4 bg-mint-2 px-1.5 text-[9px] leading-[14px] text-brand">
              sealed
            </span>
          </>,
        ]}
      />
    ),
  },
];

const TINTS = ['bg-brand-fill', 'bg-mint-6', 'bg-mint-4'];

const LG = '(min-width: 1024px)';
const subscribe = (cb: () => void) => {
  const mq = window.matchMedia(LG);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
};
/**
 * Whether the row layout applies. One layout is rendered per card — the
 * open or the closed one — rather than both with one hidden, so assistive
 * tech sees each title once. Prerender assumes the row.
 */
function useRow() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(LG).matches,
    () => true
  );
}

/** Squares on a 7×5 grid — the reference's mosaic, in mint. */
function Mosaic({ cells }: { cells: Reason['mosaic'] }) {
  return (
    <div aria-hidden className="grid h-[11.5rem] w-full grid-cols-7 grid-rows-5 gap-1">
      {cells.map(([c, r, t]) => (
        <span
          key={`${c}-${r}`}
          className={cn('h-5 w-5 self-center justify-self-center rounded-[2px]', TINTS[t])}
          style={{ gridColumn: c + 1, gridRow: r + 1 }}
        />
      ))}
    </div>
  );
}

export function Why() {
  const reduce = useReducedMotion();
  const row = useRow();
  const [open, setOpen] = useState(1);

  return (
    <section id="why" className="relative scroll-mt-24 border-t border-border">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="mb-4 text-sm font-semibold text-brand">Why Gregale</p>
            <h2 className="max-w-[30rem] text-balance text-[40px] font-medium leading-[1.05] tracking-[-0.02em] text-foreground sm:text-[52px]">
              Real microVMs, not containers in disguise
            </h2>
          </div>
          <p className="max-w-[26rem] text-[15px] leading-[1.35] text-muted-foreground sm:text-base">
            Most serverless runs your code in a shared container and hopes. Gregale gives every
            function its own Firecracker VM — isolated, snapshotted when idle, and back in under 350
            ms.
          </p>
        </div>

        <div className="mt-10 flex flex-col gap-3 lg:mt-12 lg:flex-row lg:items-center">
          {REASONS.map((r, i) => {
            const isOpen = open === i;
            const showOpen = isOpen || !row;
            const numeral = `0${i + 1}.`;
            return (
              <motion.div
                key={r.title}
                role="button"
                tabIndex={0}
                aria-expanded={isOpen}
                onPointerEnter={() => setOpen(i)}
                onFocus={() => setOpen(i)}
                onClick={() => setOpen(i)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setOpen(i);
                  }
                }}
                layout
                transition={reduce ? { duration: 0 } : { duration: 0.28, ease: EASE }}
                className={cn(
                  'relative flex flex-col overflow-hidden outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  // phones: every card open and stacked; lg: one open, widths differ
                  'rounded-[20px] bg-card',
                  'lg:min-h-[26rem] lg:rounded-xl lg:bg-[#eef3f0]',
                  isOpen
                    ? 'lg:flex-[1.24] lg:rounded-[20px] lg:bg-card lg:shadow-[0_12px_16px_0_rgba(13,21,18,0.06),0_1px_0_0_rgba(13,21,18,0.04)]'
                    : 'lg:flex-1 lg:cursor-pointer'
                )}
              >
                {showOpen ? (
                  <div className="flex flex-col p-2">
                    <div className="flex h-[13.5rem] items-center justify-center rounded-xl bg-[radial-gradient(120%_100%_at_50%_0%,#f6faf8,#e6ede9)]">
                      <AnimatePresence mode="wait" initial={false}>
                        <motion.div
                          key={r.title}
                          initial={reduce ? false : { opacity: 0, y: 8, scale: 0.98 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          transition={{ duration: 0.35, delay: 0.1, ease: EASE }}
                        >
                          {r.panel}
                        </motion.div>
                      </AnimatePresence>
                    </div>
                    <div className="px-5 pb-5 pt-5">
                      <h3 className="text-[26px] font-medium leading-[1.1] tracking-[-0.02em] text-foreground sm:text-[32px]">
                        {r.title}
                      </h3>
                      <p className="mt-4 text-[14px] leading-[1.35] text-muted-foreground">
                        {r.body}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full flex-col px-5 pb-10 pt-5">
                    <span
                      aria-hidden
                      className="text-[52px] font-medium leading-none tracking-[-0.02em] text-[#c9d6d0]"
                    >
                      {numeral}
                    </span>
                    <div className="my-auto py-6">
                      <Mosaic cells={r.mosaic} />
                    </div>
                    <h3 className="text-[20px] font-medium leading-tight tracking-[-0.01em] text-foreground">
                      {r.title}
                    </h3>
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
