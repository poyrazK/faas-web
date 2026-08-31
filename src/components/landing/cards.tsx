import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowRight } from 'iconoir-react';
import { Link } from '@tanstack/react-router';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { EASE } from './reveal';

/**
 * A row of cards, one open at a time — the landing page's hover accordion,
 * after Parley's "Why" row.
 *
 * A closed card is a quiet mint-grey slab: a faint numeral, a mosaic of mint
 * squares, the title at its foot. The card under the pointer (or focus)
 * opens: it grows a little, turns paper-white, lifts on a shadow, and shows
 * a small panel of the real product above a title, a sentence, and — when
 * the card has them — its docs links as chips. The open card stays open when
 * the pointer leaves. On phones every card is open and they stack.
 */

export interface CardItem {
  title: string;
  body: string;
  /** Cells of the mosaic on a 7×5 grid: [col, row, tint 0–2]. */
  mosaic: [number, number, number][];
  /** The panel the open card shows. */
  panel: ReactNode;
  /** Docs the card points at, as chips under the body. */
  links?: { label: string; doc: string }[];
}

const MONO = 'font-mono text-[10.5px] leading-none';

/** A small paper panel in the reference's style, with a titled row list. */
export function Panel({ title, rows }: { title: string; rows: ReactNode[] }) {
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

/** The panel surface for anything that is not a row list. */
export const PANEL_CLASS =
  'w-[15.5rem] rounded-lg border border-border bg-card p-3 shadow-[0_10px_24px_-12px_rgba(13,21,18,0.25),0_1px_2px_rgba(13,21,18,0.06)]';

export { MONO as PANEL_MONO };

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
function Mosaic({ cells }: { cells: CardItem['mosaic'] }) {
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

export function Cards({
  items,
  defaultOpen = 0,
  className,
}: {
  items: readonly CardItem[];
  defaultOpen?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const row = useRow();
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={cn('flex flex-col gap-3 lg:flex-row lg:items-center', className)}>
      {items.map((item, i) => {
        const isOpen = open === i;
        const showOpen = isOpen || !row;
        const numeral = `0${i + 1}.`;
        return (
          <motion.div
            key={item.title}
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
                      key={item.title}
                      initial={reduce ? false : { opacity: 0, y: 8, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ duration: 0.35, delay: 0.1, ease: EASE }}
                    >
                      {item.panel}
                    </motion.div>
                  </AnimatePresence>
                </div>
                <div className="px-5 pb-5 pt-5">
                  <h3 className="text-[26px] font-medium leading-[1.1] tracking-[-0.02em] text-foreground sm:text-[32px]">
                    {item.title}
                  </h3>
                  <p className="mt-4 text-[14px] leading-[1.35] text-muted-foreground">
                    {item.body}
                  </p>
                  {item.links && item.links.length > 0 && (
                    <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5">
                      {item.links.map((l) => (
                        <li key={l.label}>
                          <Link
                            to="/docs/$slug"
                            params={{ slug: l.doc }}
                            onClick={(e) => e.stopPropagation()}
                            className="group/link inline-flex items-center gap-1 rounded-sm font-mono text-[11.5px] text-brand outline-none transition-colors hover:text-brand-hover focus-visible:ring-2 focus-visible:ring-ring/50"
                          >
                            {l.label}
                            <ArrowRight className="size-3 transition-transform duration-200 group-hover/link:translate-x-0.5" />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
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
                  <Mosaic cells={item.mosaic} />
                </div>
                <h3 className="text-[20px] font-medium leading-tight tracking-[-0.01em] text-foreground">
                  {item.title}
                </h3>
              </div>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}
