import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight } from 'iconoir-react';
import { DotCutCanvas } from '@/components/dotcut/dot-cut-canvas';
import type { Scene } from '@/components/dotcut/scenes';
import { SweepLink } from '@/components/sweep-link';
import { Button } from '@/components/ui/button';
import { DeployTerminal } from './deploy-terminal';
import { InstallCommand } from './install-command';
import { EASE } from './reveal';

/**
 * The hero's scene cycle.
 *
 * The auth screen spells the wordmark; the hero does not, because the
 * headline is already the largest text on the page and a second GREGALE
 * behind it would compete. These are the abstract scenes only — rings for the
 * wake, columns for the fleet, the rest for rhythm. Module scope on purpose:
 * `DotCutCanvas` rebuilds when this array's identity changes.
 */
const HERO_SCENES: Scene[] = [
  { kind: 'rings', transition: 'ripple', palette: 5, style: 'swell' },
  { kind: 'columns', transition: 'columns', palette: 0, style: 'streak' },
  { kind: 'bars', transition: 'wipe', palette: 4, style: 'drift' },
  { kind: 'boxes', transition: 'collapse', palette: 1, style: 'grain' },
  { kind: 'checker', transition: 'scatter', palette: 0, style: 'swell' },
];

export function Hero() {
  const reduceMotion = useReducedMotion();

  const reveal = (delay: number) =>
    reduceMotion
      ? { initial: { opacity: 1 }, animate: { opacity: 1 } }
      : {
          initial: { opacity: 0, y: 14, filter: 'blur(4px)' },
          animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
          transition: { duration: 0.55, ease: EASE, delay },
        };

  return (
    <section
      aria-label="Gregale serverless platform"
      className="relative isolate w-full overflow-hidden bg-background"
    >
      <div className="relative mx-auto flex w-full max-w-6xl flex-col items-center px-4 pt-32 sm:px-6 sm:pt-40">
        <div className="flex w-full max-w-3xl flex-col items-center gap-6 text-center">
          <motion.h1
            {...reveal(0)}
            className="text-balance text-[42px] font-semibold leading-[1.04] tracking-[-0.03em] text-foreground sm:text-[58px] lg:text-[68px]"
          >
            Serverless on real microVMs. Scale to zero. Wake in{' '}
            <span className="text-brand">under 350&nbsp;ms.</span>
          </motion.h1>

          <motion.p
            {...reveal(0.08)}
            className="max-w-[34rem] text-pretty text-base leading-[1.5] text-muted-foreground sm:text-lg"
          >
            Deploy functions to Firecracker microVMs on bare metal. They snapshot when idle and
            restore on the next request — one CLI and one API for humans and the agents they run.
          </motion.p>

          <motion.div
            {...reveal(0.16)}
            className="flex w-full flex-col items-stretch gap-3 pt-2 sm:w-auto sm:flex-row sm:items-center"
          >
            <Button
              asChild
              variant="cta"
              className="group h-11 gap-2 rounded-full px-6 text-[15px] sm:w-auto"
            >
              <SweepLink to="/signup">
                Start deploying
                <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none" />
              </SweepLink>
            </Button>
            <InstallCommand className="justify-center" />
          </motion.div>
        </div>

        {/* The stage: the dither field as a mint block, the terminal on top.
            The one dark plate on a light page — the session really does run
            in a dark terminal, and the card gives the hero its anchor. */}
        <motion.div
          {...reveal(0.4)}
          className="relative mt-14 mb-6 w-full overflow-hidden rounded-2xl border border-border bg-mint-1 p-3 sm:mt-16 sm:p-8 lg:p-12"
        >
          <DotCutCanvas
            columns={96}
            scenes={HERO_SCENES}
            className="absolute inset-0 h-full w-full"
          />
          {/* Lift the block's corners toward paper so the dither reads as a
              wash under the card, not a poster behind it. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'radial-gradient(80% 70% at 50% 55%, transparent 30%, color-mix(in srgb, var(--background) 55%, transparent) 100%)',
            }}
          />
          <div className="relative mx-auto max-w-3xl">
            <DeployTerminal />
          </div>
        </motion.div>
        <p className="mb-8 text-center font-mono text-[11px] text-muted-foreground">
          Example session. Timings illustrate the documented p50 — they are not measured in your
          browser.
        </p>
      </div>
    </section>
  );
}
