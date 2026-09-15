import { Link } from '@tanstack/react-router';
import { SweepLink } from '@/components/sweep-link';
import { PLAN_CATALOG, formatPlanPrice } from '@/lib/plan-catalog';

/** Prices and quotas come from the API's generated, vendored plan table. */
export function Pricing() {
  return (
    <section id="pricing" aria-labelledby="beta-pricing-title" className="relative scroll-mt-24">
      <div className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="p-6 sm:p-10 lg:p-12">
            <p className="label-mono text-brand">Public beta</p>
            <h2
              id="beta-pricing-title"
              className="mt-3 text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.02em] text-foreground sm:text-5xl"
            >
              Plans and pricing
            </h2>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground">
              Paid billing and checkout are disabled during beta. Start on Free; the platform
              catalog below shows monthly prices in euros and the limits for each plan.
            </p>
            <SweepLink
              to="/signup"
              className="mt-7 inline-flex min-h-11 items-center border-b border-brand text-sm font-medium text-brand hover:text-foreground"
            >
              Join the beta
            </SweepLink>
          </div>
          <div className="grid divide-y divide-border border-t border-border sm:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-y-0">
            {PLAN_CATALOG.plans.map((plan) => (
              <article key={plan.name} aria-label={plan.name} className="flex flex-col px-5 py-6">
                <h3 className="text-sm font-medium text-foreground">{plan.name}</h3>
                <p className="mt-4 text-4xl font-semibold tracking-tight text-foreground">
                  {formatPlanPrice(plan.monthly)}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">/ month</span>
                </p>
                <div aria-hidden className="mt-4 h-[3px] bg-brand" />
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
              </article>
            ))}
          </div>
        </div>
        <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
          Free stops at its included compute allowance. The catalog rate for paid-plan overage is{' '}
          {formatPlanPrice(PLAN_CATALOG.overagePerGbHour)} per GB-RAM-hour.{' '}
          <Link
            to="/docs/$slug"
            params={{ slug: 'plans' }}
            className="text-brand underline underline-offset-4"
          >
            Plan limits and billing details
          </Link>
          .
        </p>
      </div>
    </section>
  );
}
