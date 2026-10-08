import { Link } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'motion/react';
import { Button } from '@/components/ui/button';
import { SweepLink } from '@/components/sweep-link';
import { PLAN_CATALOG, formatPlanPrice } from '@/lib/plan-catalog';
import type { CatalogPlan } from '@/lib/plan-catalog-parser';
import { EASE, Reveal } from './reveal';
import { SteppedBars } from './shaders/stepped-bars';

/** Restore the original plan-grid material, using only the generated catalog. */
function PlanColumn({ plan, index }: { plan: CatalogPlan; index: number }) {
  const reduced = useReducedMotion();
  return (
    <motion.article
      aria-label={plan.name}
      initial={reduced ? false : { opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.55, delay: index * 0.06, ease: EASE }}
      className="flex flex-col bg-card px-5 pb-6 pt-6"
    >
      <h3 className="text-sm font-medium text-foreground">{plan.name}</h3>
      <div className="mt-4 flex min-h-14 items-start gap-2">
        <span className="text-4xl font-semibold tracking-tight text-foreground">
          {formatPlanPrice(plan.monthly)}
        </span>
        <span className="label-mono mt-1.5 max-w-20 text-muted-foreground">/ month</span>
      </div>
      <div
        aria-hidden
        className="mt-4 h-[3px] w-full"
        style={{
          background: `linear-gradient(90deg, var(--mint-${3 + index}), var(--mint-${6 + index}))`,
        }}
      />
      <dl className="mt-5 flex flex-col gap-3 text-sm">
        {Object.entries({
          'Deployed apps': plan.deployedApps,
          'Developer apps': plan.developerApps,
          'Concurrent instances / app': plan.concurrentInstances,
          'RAM / app': `${plan.ramMb} MB`,
          'Included GB-RAM-hours': plan.includedGbHours,
          'App layer': `${plan.appLayerMb} MB`,
          'Idle timeout': plan.idleTimeout,
        }).map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="shrink-0 font-medium text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-auto flex flex-col items-center gap-3 pt-8">
        <Button
          disabled
          variant={plan.name === 'Pro' ? 'cta' : 'outline'}
          className="h-10 w-full rounded-full"
        >
          {plan.name === 'Free' ? 'Start on Free' : 'Coming soon'}
        </Button>
      </div>
    </motion.article>
  );
}

/** The old vertical handoff, aligned with the four real plan columns. */
function PlanRisers() {
  const reduced = useReducedMotion();
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-full hidden h-14 lg:block"
    >
      {PLAN_CATALOG.plans.slice(1).map((plan, index) => (
        <motion.div
          key={plan.name}
          className="absolute bottom-0 w-px origin-bottom"
          style={{
            left: `${((index + 1) / PLAN_CATALOG.plans.length) * 100}%`,
            height: '100%',
            background: 'linear-gradient(to bottom, transparent, var(--border))',
          }}
          initial={reduced ? false : { scaleY: 0 }}
          whileInView={{ scaleY: 1 }}
          viewport={{ once: true, amount: 0.6 }}
          transition={{ duration: 0.5, delay: 0.1 + index * 0.08, ease: EASE }}
        />
      ))}
    </div>
  );
}

export function Pricing() {
  return (
    <section id="pricing" aria-labelledby="beta-pricing-title" className="relative scroll-mt-24">
      <div className="mx-auto max-w-6xl px-4 pb-24 pt-0 sm:px-6">
        <div className="relative isolate grid overflow-hidden">
          {/* Decorative preview only: no pointer, keyboard, or screen-reader access. */}
          <div
            inert
            aria-hidden="true"
            className="pointer-events-none col-start-1 row-start-1 max-h-[40rem] select-none overflow-hidden opacity-60 blur-md"
          >
            <div className="relative">
              <div className="overflow-hidden rounded-lg border border-border bg-card">
                <div className="grid gap-8 p-6 sm:p-10 lg:grid-cols-2 lg:gap-4 lg:p-0">
                  <div className="flex flex-col justify-center lg:p-12">
                    <Reveal y={12}>
                      <h2 className="text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.02em] text-foreground sm:text-5xl">
                        Flexible pricing for any scale
                      </h2>
                    </Reveal>
                    <Reveal y={12} delay={0.1}>
                      <p className="mt-5 max-w-sm text-base leading-relaxed text-muted-foreground">
                        Monthly plans and usage limits from the platform catalog. Start on Free
                        during the public beta.
                      </p>
                    </Reveal>
                  </div>
                  <div className="flex items-end lg:pt-12">
                    <SteppedBars className="h-56 w-full sm:h-72 lg:h-full" />
                  </div>
                </div>
                <div className="grid divide-y divide-border border-t border-border lg:grid-cols-4 lg:divide-x lg:divide-y-0">
                  {PLAN_CATALOG.plans.map((plan, index) => (
                    <PlanColumn key={plan.name} plan={plan} index={index} />
                  ))}
                </div>
              </div>
              <PlanRisers />
            </div>
            <p className="mt-6 text-sm text-muted-foreground">
              Free stops at its included compute allowance. The catalog rate for paid-plan overage
              is {formatPlanPrice(PLAN_CATALOG.overagePerGbHour)} per GB-RAM-hour.
            </p>
          </div>
          <div
            className="relative col-start-1 row-start-1 flex min-h-[34rem] flex-col justify-center px-5 py-16 sm:min-h-[40rem] sm:px-12 lg:px-16"
            style={{
              background:
                'linear-gradient(105deg, var(--background) 8%, color-mix(in srgb, var(--background) 94%, transparent) 38%, color-mix(in srgb, var(--background) 15%, transparent) 100%)',
            }}
          >
            <div className="max-w-lg">
              <h2
                id="beta-pricing-title"
                className="text-[54px] font-semibold leading-[0.97] tracking-[-0.06em] text-foreground sm:text-[76px] lg:text-[88px]"
              >
                Pricing <br />
                coming soon
              </h2>
              <p className="mt-7 max-w-[17rem] text-pretty text-[15px] leading-relaxed text-muted-foreground sm:max-w-[20rem] sm:text-base">
                We’re focused on the beta experience first. Paid billing and checkout are disabled
                during beta. Start on Free.
              </p>
              <SweepLink
                to="/signup"
                className="mt-9 inline-flex min-h-11 items-center border-b border-mint-11/40 text-sm font-medium text-mint-11 outline-none transition-colors hover:border-mint-11 hover:text-mint-12 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring motion-reduce:transition-none"
              >
                Join the beta
              </SweepLink>
              <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
                <Link
                  to="/docs/$slug"
                  params={{ slug: 'plans' }}
                  className="text-brand underline underline-offset-4"
                >
                  Plan limits and billing details
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
