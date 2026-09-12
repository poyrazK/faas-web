import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight, Check, Copy } from 'iconoir-react';
import { useEffect, useRef, useState } from 'react';
import { SweepLink } from '@/components/sweep-link';
import { DeployTerminal } from './deploy-terminal';
import { INSTALL_COMMAND } from './install-command';
import { EASE } from './reveal';
import { LIQUID_PRESETS, LiquidField } from './liquid-field';

/**
 * The hero: one full screen of light with the words alone in the middle of
 * it, then the deploy terminal as the next block.
 *
 * The light is `LiquidField` — a liquid-gradient shader in the site's mint —
 * with the frosted-glass mark behind the headline. The command pill holds the
 * install command on the left, copyable, and the primary action on the right.
 */

function CopyCommand() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked — the command stays visible to select by hand.
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy install command: ${INSTALL_COMMAND}`}
      className="group flex h-12 min-w-0 flex-1 items-center gap-3 rounded-full pl-5 pr-3 text-left font-mono text-[14px] text-foreground/80 outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <span aria-hidden className="text-brand">
        $
      </span>
      <span className="truncate tracking-tight">{INSTALL_COMMAND}</span>
      <span className="ml-auto flex size-7 shrink-0 items-center justify-center rounded-full bg-background/70 text-muted-foreground transition-colors group-hover:text-foreground">
        {copied ? <Check className="size-3.5 text-brand" /> : <Copy className="size-3.5" />}
      </span>
      <span aria-live="polite" className="sr-only">
        {copied ? 'Copied to clipboard' : ''}
      </span>
    </button>
  );
}

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
        aria-label="Gregale serverless platform"
        className="relative isolate flex min-h-[100svh] w-full flex-col items-center justify-center overflow-hidden px-4 pt-24 pb-36 sm:px-6 sm:pb-44"
      >
        <LiquidField params={LIQUID_PRESETS.gregale} fadeBottom={0.28} />
        <Emblem />

        <div className="relative z-10 flex w-full max-w-[46rem] flex-col items-center text-center">
          <p className="relative mb-7 inline-flex items-start gap-1.5 text-[25px] font-semibold leading-none tracking-[-0.055em] text-[#212121]">
            Gregale
            <span className="mt-0.5 text-[11px] font-medium tracking-normal text-mint-11">
              Beta
            </span>
          </p>
          <h1
            className="animate-hero-enter relative text-balance text-[40px] font-semibold leading-[0.98] tracking-[-0.065em] text-[#212121] sm:text-[58px] lg:text-[62px]"
            style={{ animationDelay: '0.06s' }}
          >
            Build the API. <br />
            <span className="bg-gradient-to-r from-[color-mix(in_oklab,var(--brand)_70%,#3987e5)] via-brand to-[#2f9d86] bg-clip-text text-transparent">
              We’ll run it.
            </span>
          </h1>

          <p
            className="animate-hero-enter relative mt-6 max-w-[30rem] text-pretty text-[15px] leading-[1.5] text-[#3d4a45] sm:text-[17px]"
            style={{ animationDelay: '0.12s' }}
          >
            Deploy APIs and functions from your repository. Gregale runs them in isolated microVMs,
            scales them to zero when idle, and wakes them when requests arrive.
          </p>

          {/* the pill: install command on the left, the action on the right */}
          <div
            className="animate-hero-enter relative mt-8 flex w-full max-w-[29rem] items-center rounded-full bg-[color-mix(in_srgb,var(--secondary)_78%,transparent)] p-1 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.7),0_1px_2px_rgba(13,21,18,0.05)] backdrop-blur-md"
            style={{ animationDelay: '0.18s' }}
          >
            <CopyCommand />
            <SweepLink
              to="/signup"
              className="group inline-flex h-12 shrink-0 items-center gap-2 rounded-full bg-[#1c2622] px-6 text-[15px] font-semibold text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12),0_8px_24px_-10px_rgba(13,21,18,0.6)] outline-none transition-[background-color,transform] duration-200 hover:bg-[#0d1512] focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.98] motion-reduce:transform-none"
            >
              Join the beta
              <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none" />
            </SweepLink>
          </div>
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
          Example deployment and requests. Timings are illustrative, not a performance guarantee.
        </p>
      </section>
    </>
  );
}
