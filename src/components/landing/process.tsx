import {
  AnimatePresence,
  animate,
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
} from 'motion/react';
import { ArrowLeft, ArrowRight } from 'iconoir-react';
import { Link } from '@tanstack/react-router';
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';
import { EASE } from './reveal';

/**
 * The platform as one deploy, told in four stops.
 *
 * A stepper after the Framer "process section": a row of numbered tabs with a
 * progress rule under each, one panel at a time — eyebrow, title, body, the
 * docs links as chips — and the step's numeral set huge and faint beside it.
 * It plays itself, six seconds a stop. A click on a tab, PREV/NEXT or the
 * arrow keys jumps and restarts the clock; it does not stop for a hovering
 * pointer, because a reader's mouse is usually resting on what they read.
 * Off-screen and under reduced motion it holds still.
 *
 * The nine platform cards this replaces are all here, folded into the stops
 * they belong to, and every docs link they carried is a chip.
 */

export interface Step {
  title: string;
  /** A fact about the step, set small above the title. */
  fact: string;
  body: string;
  links: { label: string; doc: string }[];
}

export const STEPS: readonly Step[] = [
  {
    title: 'Deploy',
    fact: 'SHA-pinned · managed TLS',
    body: 'One-shot deploys from a Git ref, every build carrying an SBOM and provenance, secrets scanned on the way in and egress denied by default. Each pull request gets its own URL under your domain, covered by the wildcard cert; custom domains, routes and edge rules sit in front of any app.',
    links: [
      { label: 'Deploy from a ref', doc: 'deploy-from-source' },
      { label: 'Previews & domains', doc: 'preview-environments' },
      { label: 'Egress policy', doc: 'egress-denylist' },
    ],
  },
  {
    title: 'Wake',
    fact: 'Under 350 ms',
    body: 'Idle apps snapshot and park at zero. The next request — or a cron tick, or a message on a queue — restores the same snapshot in under 350 ms. Schedules, queues with dead-letter, and delayed tasks come with the platform, not a second service.',
    links: [{ label: 'How wakes work', doc: 'scale-to-zero' }],
  },
  {
    title: 'Run',
    fact: 'Node · Python · Go',
    body: 'Handlers run in hardware-isolated microVMs, invoked sync or async. Stateless by design: plug in the managed Postgres, object store or KV you already use — the URL is a sealed secret, the env var is what your code reads, rotatable from the CLI or console.',
    links: [
      { label: 'Runtimes', doc: 'runtime-node' },
      { label: 'Storage & secrets', doc: 'storage' },
    ],
  },
  {
    title: 'Observe',
    fact: 'Every invocation',
    body: 'Streamed logs, per-app metrics, a trace for every invocation and a timeline for every wake — alerts when it matters, and an audit log of every write.',
    links: [{ label: 'Tracing', doc: 'tracing' }],
  },
];

/** Seconds a stop stays before the stepper moves on by itself. */
const DWELL = 6;

const EYEBROW = 'font-mono text-[11px] uppercase tracking-[0.12em]';

export function Process() {
  const reduce = useReducedMotion();
  const id = useId();
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { margin: '-20% 0px' });
  const [index, setIndex] = useState(0);
  // Progress of the current stop, 0→1. A motion value, not state: it drives
  // the rule's scaleX directly and never re-renders the section.
  const progress = useMotionValue(0);

  const go = useCallback(
    (i: number) => {
      setIndex(((i % STEPS.length) + STEPS.length) % STEPS.length);
      progress.set(0);
    },
    [progress]
  );

  // Autoplay: the rule fills over DWELL seconds from wherever it was; when it
  // reaches the end the next stop begins.
  const playing = inView && !reduce;
  useEffect(() => {
    if (!playing) return;
    const remaining = (1 - progress.get()) * DWELL;
    const controls = animate(progress, 1, {
      duration: remaining,
      ease: 'linear',
      onComplete: () => go(index + 1),
    });
    return () => controls.stop();
  }, [playing, index, progress, go]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      go(index + 1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      go(index - 1);
    }
  };

  const step = STEPS[index];
  const numeral = String(index + 1).padStart(2, '0');

  return (
    <section
      ref={ref}
      id="deploy"
      aria-labelledby={`${id}-title`}
      className="relative scroll-mt-24 border-t border-border"
    >
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <h2
          id={`${id}-title`}
          className="text-[40px] font-semibold uppercase leading-none tracking-[-0.03em] text-foreground sm:text-5xl"
        >
          The platform
        </h2>

        {/* the stops */}
        <div
          role="tablist"
          aria-label="Steps"
          onKeyDown={onKey}
          className="mt-14 grid grid-cols-2 gap-x-8 gap-y-6 sm:mt-16 lg:grid-cols-4"
        >
          {STEPS.map((s, i) => {
            const state = i < index ? 'done' : i === index ? 'current' : 'later';
            return (
              <button
                key={s.title}
                type="button"
                role="tab"
                id={`${id}-tab-${i}`}
                aria-selected={i === index}
                aria-controls={`${id}-panel`}
                tabIndex={i === index ? 0 : -1}
                onClick={() => go(i)}
                className="group relative pb-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <span className={cn(EYEBROW, 'block text-muted-foreground')}>{numeralOf(i)}</span>
                <span
                  className={cn(
                    'mt-1 block text-[13px] font-medium uppercase tracking-[0.06em] transition-colors duration-300',
                    state === 'later'
                      ? 'text-muted-foreground group-hover:text-foreground'
                      : 'text-foreground'
                  )}
                >
                  {s.title}
                </span>
                {/* the rule: a track, and the fill that is the clock */}
                <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-foreground/10" />
                <motion.span
                  aria-hidden
                  className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-brand-fill"
                  style={state === 'current' && !reduce ? { scaleX: progress } : undefined}
                  animate={{ opacity: state === 'later' ? 0 : state === 'done' ? 0.45 : 1 }}
                  initial={false}
                  transition={{ duration: 0.3 }}
                />
              </button>
            );
          })}
        </div>

        {/* the panel */}
        <div className="relative mt-14 min-h-[16rem] sm:mt-16">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={index}
              id={`${id}-panel`}
              role="tabpanel"
              aria-labelledby={`${id}-tab-${index}`}
              initial={reduce ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0, y: -6 }}
              transition={{ duration: 0.35, ease: EASE }}
              className="max-w-[34rem]"
            >
              <p className={cn(EYEBROW, 'text-muted-foreground')}>{step.fact}</p>
              <h3 className="mt-3 text-[32px] font-medium uppercase leading-none tracking-[-0.02em] text-foreground sm:text-4xl">
                {step.title}
              </h3>
              <p className="mt-5 text-[15px] leading-relaxed text-muted-foreground">{step.body}</p>
              <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2">
                {step.links.map((l) => (
                  <li key={l.label}>
                    <Link
                      to="/docs/$slug"
                      params={{ slug: l.doc }}
                      className="group/link inline-flex items-center gap-1.5 rounded-sm font-mono text-[12px] text-brand outline-none transition-colors hover:text-brand-hover focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      {l.label}
                      <ArrowRight className="size-3 transition-transform duration-200 group-hover/link:translate-x-0.5" />
                    </Link>
                  </li>
                ))}
              </ul>
            </motion.div>
          </AnimatePresence>

          {/* the numeral, set huge and faint */}
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={numeral}
              aria-hidden
              initial={reduce ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0, y: -8 }}
              transition={{ duration: 0.4, ease: EASE }}
              className="pointer-events-none absolute right-0 top-0 hidden select-none font-sans text-[10rem] font-normal leading-none tracking-[-0.04em] text-mint-4 sm:block lg:text-[11rem]"
            >
              {numeral}
            </motion.span>
          </AnimatePresence>
        </div>

        {/* prev / next */}
        <div className="mt-14 flex items-center gap-6 sm:mt-20">
          <button
            type="button"
            onClick={() => go(index - 1)}
            className={cn(
              EYEBROW,
              'group inline-flex items-center gap-2 rounded-sm py-1 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50'
            )}
          >
            <ArrowLeft className="size-3.5 transition-transform duration-200 group-hover:-translate-x-0.5" />
            Prev
          </button>
          <button
            type="button"
            onClick={() => go(index + 1)}
            className={cn(
              EYEBROW,
              'group inline-flex items-center gap-2 rounded-sm py-1 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50'
            )}
          >
            Next
            <ArrowRight className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
          </button>
        </div>
      </div>
    </section>
  );
}

function numeralOf(i: number) {
  return String(i + 1).padStart(2, '0');
}
