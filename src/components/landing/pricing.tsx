import { Link } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'motion/react';
import { Button } from '@/components/ui/button';
import { SweepLink } from '@/components/sweep-link';
import { PLAN_CATALOG, formatPlanPrice } from '@/lib/plan-catalog';
import type { CatalogPlan } from '@/lib/plan-catalog-parser';
import { START_FREE_CTA } from '@/lib/platform-claims';
import { EASE, Reveal } from './reveal';
import { SteppedBars } from './shaders/stepped-bars';

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
          'PR preview environments': plan.previewEnvironments,
          'Developer apps': plan.developerApps,
          'Concurrent instances / app': plan.concurrentInstances,
          'RAM / app': `${plan.ramMb} MB`,
          'Included GB-RAM-hours': plan.includedGbHours,
          'App layer': `${plan.appLayerMb} MB`,
          'Idle timeout': plan.idleTimeout,
          'Max request timeout': plan.maxRequestTimeout,
        }).map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="shrink-0 font-medium text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </motion.article>
  );
}

function PlanRisers() {
  const reduced = useReducedMotion();
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-full hidden h-14 xl:block"
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
    <section id="pricing" aria-labelledby="pricing-title" className="relative scroll-mt-24">
      <div className="mx-auto max-w-6xl px-4 pb-24 pt-0 sm:px-6">
        <div className="relative">
          <PlanRisers />
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="grid lg:grid-cols-2">
              <div className="flex flex-col justify-center px-6 py-8 sm:px-10 lg:px-12 lg:py-12">
                <Reveal y={12}>
                  <h2
                    id="pricing-title"
                    className="text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.02em] text-foreground sm:text-5xl"
                  >
                    Plans and pricing
                  </h2>
                  <p className="mt-4 max-w-sm text-base leading-relaxed text-muted-foreground">
                    Start with one app on Free. Upgrade from the console when you need more apps,
                    memory, or compute.
                  </p>
                  <div className="mt-6 flex flex-wrap items-center gap-2">
                    <Button asChild variant="cta" className="h-10 rounded-full px-5">
                      <SweepLink to="/signup">{START_FREE_CTA}</SweepLink>
                    </Button>
                    <Button asChild variant="outline" className="h-10 rounded-full px-5">
                      <Link to="/dashboard/plans">View plans in console</Link>
                    </Button>
                  </div>
                </Reveal>
              </div>
              <div className="flex items-end" aria-hidden>
                <SteppedBars className="h-40 w-full sm:h-48 lg:h-full" />
              </div>
            </div>
            <div className="grid gap-px border-t border-border bg-border sm:grid-cols-2 xl:grid-cols-4">
              {PLAN_CATALOG.plans.map((plan, index) => (
                <PlanColumn key={plan.name} plan={plan} index={index} />
              ))}
            </div>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-start justify-between gap-3 text-sm leading-relaxed">
          <p className="max-w-2xl text-muted-foreground">
            Prices are in USD per month before tax. Free stops at its included compute allowance.
            Paid compute overage costs {formatPlanPrice(PLAN_CATALOG.overagePerGbHour)} per
            GB-RAM-hour, up to your spend cap.
          </p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <Link
              to="/docs/$slug"
              params={{ slug: 'plans' }}
              className="text-brand underline underline-offset-4"
            >
              Plan limits and billing details
            </Link>
            <Link to="/contact" className="text-brand underline underline-offset-4">
              Talk to a founder
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
