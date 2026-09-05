import { Reveal } from './reveal';
import { WakePulse } from './shaders/wake-pulse';

/**
 * The life of a request, staged like the pricing section: a framed panel
 * pairing the headline with a shader figure — the lifecycle drawn as a
 * slatted area curve. The curve itself tells the sequence (sleeping, waking,
 * running, parked); the step-by-step prose that used to sit below it was
 * removed in favour of letting the figure carry it.
 */

export function HowItWorks() {
  return (
    <section id="how" className="landing-deferred relative scroll-mt-24 border-t border-border">
      <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {/* Hero panel: headline left, the lifecycle figure right. */}
          <div className="grid gap-8 p-6 sm:p-10 lg:grid-cols-2 lg:gap-4 lg:p-0">
            <div className="flex flex-col justify-center lg:p-12">
              <Reveal y={12}>
                <p className="label-mono mb-5 text-brand">How a request is served</p>
              </Reveal>
              <Reveal y={12} delay={0.08}>
                <h2 className="text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.02em] text-foreground sm:text-5xl">
                  Nothing runs until something asks
                </h2>
              </Reveal>
              <Reveal y={12} delay={0.16}>
                <p className="mt-5 max-w-sm text-base leading-relaxed text-muted-foreground">
                  Every app is a snapshot until its first request, and a microVM from then until it
                  is idle again.
                </p>
              </Reveal>
            </div>
            {/* The figure gets the whole right half; the shader draws the
                request riding the sleep -> wake -> run -> park curve. */}
            <div className="flex items-end lg:pt-12">
              <WakePulse className="h-56 w-full sm:h-72 lg:h-full" />
            </div>
          </div>

          {/* Tick strip, the figure's baseline echoed as a ruler. */}
          <div
            aria-hidden
            className="h-10 border-t border-border"
            style={{
              backgroundImage:
                'repeating-linear-gradient(90deg, var(--border) 0 1px, transparent 1px 8px)',
            }}
          />
        </div>
      </div>
    </section>
  );
}
