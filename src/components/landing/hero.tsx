import { motion, useReducedMotion } from 'motion/react';
import { Link } from '@tanstack/react-router';
import { ArrowRight } from 'iconoir-react';
import { SweepLink } from '@/components/sweep-link';
import { RestoreTarget } from '@/components/restore-target';
import { RESTORE_CONTEXT } from '@/lib/platform-claims';
import { DeployTerminal } from './deploy-terminal';
import { EASE } from './reveal';
import { LIQUID_PRESETS, LiquidField } from './liquid-field';
import { HeroHeadline } from './hero-headline';

/**
 * The hero: one full screen of light with the words alone in the middle of
 * it, then the deploy terminal as the next block.
 *
 * The light is `LiquidField` — a liquid-gradient shader in the site's mint —
 * with the frosted-glass mark behind the headline. The command pill holds the
 * docs link on the left and the primary action on the right.
 */

/**
 * The emblem behind the headline: the frosted-glass Gregale mark, overlaid
 * on the light the way the reference overlays its flare. Overlay over paper
 * is paper, so at rest the mark is barely there; it shows where the shader's
 * beam passes through it, and only then.
 */
function Emblem() {
  return (
    <div
      aria-hidden="true"
      data-emblem
      className="pointer-events-none absolute inset-x-0 top-[72px] flex justify-center sm:top-[96px]"
      style={{ mixBlendMode: 'overlay', opacity: 1 }}
    >
      <img
        src="/gregale-frosted.png"
        alt=""
        width={1246}
        height={1246}
        className="h-[300px] w-[300px] sm:h-[520px] sm:w-[520px]"
      />
    </div>
  );
}

export function Hero() {
  const reduce = useReducedMotion();

  return (
    <>
      <section
        aria-label="Gregale backend platform"
        className="relative isolate flex min-h-[100svh] w-full flex-col items-center justify-center overflow-hidden px-4 pt-24 pb-36 sm:px-6 sm:pb-44"
      >
        <LiquidField params={LIQUID_PRESETS.gregale} fadeBottom={0.28} />
        <Emblem />

        <div className="relative z-10 flex w-full max-w-[54rem] flex-col items-center text-center">
          <HeroHeadline />

          <p
            className="animate-hero-enter relative mt-6 max-w-[30rem] text-pretty text-[15px] leading-[1.5] text-[#3d4a45] sm:text-[17px]"
            style={{ animationDelay: '0.12s' }}
          >
            Deploy your API on Gregale. Bring services, background work and AI tools onto the same
            platform as your product grows.
          </p>

          {/* Keep the joined pill, with docs on the left and signup on the right. */}
          <div
            className="animate-hero-enter relative mt-8 flex w-full max-w-[29rem] items-center rounded-full bg-[color-mix(in_srgb,var(--secondary)_78%,transparent)] p-1 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.7),0_1px_2px_rgba(13,21,18,0.05)] backdrop-blur-md"
            style={{ animationDelay: '0.18s' }}
          >
            <Link
              to="/docs"
              className="group relative isolate flex h-12 min-w-0 flex-1 items-center overflow-hidden rounded-full pl-5 pr-3 text-left font-mono text-sm text-foreground/80 outline-none transition-[box-shadow,border-color] duration-300 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none"
            >
              Read the docs
            </Link>
            <SweepLink
              to="/signup"
              className="group inline-flex h-12 shrink-0 items-center gap-2 rounded-full bg-[#1c2622] px-6 text-[15px] font-semibold text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12),0_8px_24px_-10px_rgba(13,21,18,0.6)] outline-none transition-[background-color,transform] duration-200 hover:bg-[#0d1512] focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.98] motion-reduce:transform-none"
            >
              Join the beta
              <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none" />
            </SweepLink>
          </div>
          <p className="mt-6 max-w-[34rem] text-center font-mono text-[11px] text-muted-foreground">
            Hosting and PR previews are in public beta. Connected work, MCP hosting and isolated
            runs are in preview; plan and rollout limits apply.
          </p>
        </div>
      </section>

      {/* The terminal, alone on the page. No block and no field under it: the
          light belongs to the first screen, and the session is the one dark
          object on the paper, lifted by its shadow rather than framed. It
          rises into the bottom of the hero so the fold shows its top edge. */}
      <section
        aria-label="Example deploy session"
        className="relative z-10 mx-auto w-full max-w-3xl px-4 sm:px-6"
      >
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 28 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-40px' }}
          transition={{ duration: 0.9, ease: EASE }}
          className="relative -mt-24 mb-6 rounded-2xl shadow-[0_0_0_1px_color-mix(in_srgb,var(--foreground)_8%,transparent),0_2px_6px_color-mix(in_srgb,var(--foreground)_10%,transparent),0_24px_60px_-16px_color-mix(in_srgb,var(--foreground)_38%,transparent),0_48px_120px_-40px_color-mix(in_srgb,var(--brand)_30%,transparent)] sm:-mt-32"
        >
          <DeployTerminal />
        </motion.div>
        <p className="mb-8 text-center font-mono text-[11px] text-muted-foreground">
          Example deployment and requests; timings are illustrative. <RestoreTarget />.{' '}
          <span>{RESTORE_CONTEXT}</span>
        </p>
      </section>
    </>
  );
}
