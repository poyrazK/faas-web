import { createFileRoute, Link } from '@tanstack/react-router';
import { MotionConfig } from 'motion/react';
import { Nav } from '@/components/landing/nav';
import { Pricing } from '@/components/landing/pricing';
import { Footer } from '@/components/landing/footer';
import { pricingDescription, pricingFaq } from '@/lib/faq';
import { FREE_PLAN, PLAN_CATALOG } from '@/lib/plan-catalog';
import { IDLE_BILLING_CLAIM } from '@/lib/platform-claims';
import { FASTAPI_COST_SLUG } from '@/lib/research';
import { pageHead } from '@/lib/seo';

/**
 * A standalone pricing page. The landing page's #pricing section is the same
 * component, but a section on `/` cannot rank for "gregale pricing" and
 * cannot be linked as its own result. Every figure on this page — the plan
 * columns and the answers below — comes from the generated plan catalog, so it
 * changes when the API's limits do.
 */
export const Route = createFileRoute('/pricing')({
  head: () => pageHead({ title: 'Pricing', description: pricingDescription(PLAN_CATALOG) }),
  component: PricingPage,
});

function PricingPage() {
  const faq = pricingFaq(PLAN_CATALOG);
  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen bg-background text-foreground">
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <Nav />
        <main id="main">
          <header className="mx-auto max-w-6xl px-4 pb-16 pt-36 sm:px-6 lg:pt-44">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-brand">Pricing</p>
            <h1 className="mt-6 max-w-3xl text-balance text-5xl font-medium leading-tight tracking-tight sm:text-6xl">
              Gregale pricing: start free, pay for the compute you use.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
              {FREE_PLAN.name} runs a small API at no cost. Paid plans add apps, memory, preview
              environments and included compute, billed by RAM and time rather than per request.
              {IDLE_BILLING_CLAIM} An idle app pauses and resumes in milliseconds when the next one
              arrives.
            </p>
          </header>
          <Pricing />
          <section aria-labelledby="pricing-faq-title" className="border-t border-border">
            <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
              <h2
                id="pricing-faq-title"
                className="text-balance text-[36px] font-medium leading-[1.05] tracking-[-0.02em] sm:text-[44px]"
              >
                Pricing questions
              </h2>
              <dl className="mt-10 grid gap-x-12 gap-y-10 md:grid-cols-2">
                {faq.map((entry) => (
                  <div key={entry.question}>
                    <dt className="text-base font-medium text-foreground">{entry.question}</dt>
                    <dd className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      {entry.answer}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-12 text-sm text-muted-foreground">
                See measured compute usage and monthly estimates in the{' '}
                <Link
                  to="/research/$slug"
                  params={{ slug: FASTAPI_COST_SLUG }}
                  className="text-brand underline underline-offset-4"
                >
                  intermittent FastAPI cost study
                </Link>
                .
              </p>
              <p className="mt-4 text-sm text-muted-foreground">
                Every limit, including builds, realtime and object storage, is listed in{' '}
                <Link
                  to="/docs/$slug"
                  params={{ slug: 'plans' }}
                  className="text-brand underline underline-offset-4"
                >
                  plans and pricing
                </Link>{' '}
                and{' '}
                <Link
                  to="/docs/$slug"
                  params={{ slug: 'billing' }}
                  className="text-brand underline underline-offset-4"
                >
                  billing
                </Link>
                .
              </p>
            </div>
          </section>
        </main>
        <Footer />
      </div>
    </MotionConfig>
  );
}
