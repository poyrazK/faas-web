import { useState } from 'react';
import { motion } from 'motion/react';
import { Check, Flash, Globe, NavArrowDown, TableRows } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { SweepLink } from '@/components/sweep-link';
import { EASE, Reveal } from './reveal';
import { SteppedBars } from './shaders/stepped-bars';

/**
 * Plan-grid pricing, staged like a hardware spec sheet: a framed hero panel
 * with a stepped-bar figure, an "all plans include" strip, then five columns.
 *
 * **The dollar figures are marketing copy, not API data.** The API exposes
 * four plans (free, hobby, pro, scale) and their quotas but no prices — the
 * console's plans page deliberately quotes nothing and links to the billing
 * portal instead. This section names the same four real plans; Enterprise is
 * a sales conversation, not a fifth API plan, so its CTA opens the sales
 * inbox.
 */

interface Tier {
  name: string;
  price: string;
  cadence?: string;
  blurb: string;
  features: string[];
  /** Extra rows behind the "See all the features" disclosure. */
  more: string[];
  cta: { label: string; to?: '/signup'; href?: string };
  highlight?: boolean;
  /** Two mint-ramp steps for the rule under the price — deeper as tiers rise. */
  rule: [string, string];
}

const TIERS: Tier[] = [
  {
    name: 'Free',
    price: '$0',
    cadence: '/ month',
    blurb: 'Try the platform on real workloads — microVMs, not a sandbox.',
    features: [
      '1M invocations / month',
      '400K GB-seconds included',
      'Scale to zero',
      'Community support',
    ],
    more: ['Live log tail', 'One concurrent build'],
    cta: { label: 'Start free', to: '/signup' },
    rule: ['var(--mint-3)', 'var(--mint-6)'],
  },
  {
    name: 'Hobby',
    price: '$5',
    cadence: '/ month · billed monthly',
    blurb: 'Side projects that need to stay up, on your own domain.',
    features: ['Custom domains', 'Log archive', 'Streaming responses', 'Usage-based compute'],
    more: ['Managed TLS', 'Cron triggers'],
    cta: { label: 'Select Hobby', to: '/signup' },
    rule: ['var(--mint-4)', 'var(--mint-7)'],
  },
  {
    name: 'Pro',
    price: '$49',
    cadence: '/ month · billed monthly',
    blurb: 'For teams shipping to production and paging on it.',
    features: [
      'Higher concurrency',
      'CPU autoscaling',
      'Per-route metrics',
      'Longer log retention',
    ],
    more: ['Egress allowlist (16 CIDRs)', 'Priority builds'],
    cta: { label: 'Select Pro', to: '/signup' },
    highlight: true,
    rule: ['var(--mint-5)', 'var(--mint-8)'],
  },
  {
    name: 'Scale',
    price: '$299',
    cadence: '/ month · billed monthly',
    blurb: 'Committed capacity for high-traffic, many-service estates.',
    features: [
      'Reserved capacity',
      'Highest quotas',
      '90-day log retention',
      'High concurrency limits',
    ],
    more: ['Egress allowlist (64 CIDRs)', 'Longest trace retention'],
    cta: { label: 'Select Scale', to: '/signup' },
    rule: ['var(--mint-6)', 'var(--mint-9)'],
  },
  {
    name: 'Enterprise',
    price: 'Contact us',
    blurb: 'Custom capacity and guarantees for mission-critical fleets.',
    features: [
      'Custom usage pricing',
      'Custom concurrency',
      'Uptime & support guarantees',
      'Security review & compliance',
    ],
    more: ['Committed-use discounts', 'Onboarding with our engineers'],
    cta: { label: 'Contact us', href: 'mailto:sales@gregale.dev' },
    rule: ['var(--mint-8)', 'var(--mint-11)'],
  },
];

const INCLUDED = [
  { icon: Flash, label: 'Functions' },
  { icon: TableRows, label: 'Queues' },
  { icon: Globe, label: 'Edge' },
] as const;

function PlanColumn({ tier, index }: { tier: Tier; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const rows = expanded ? [...tier.features, ...tier.more] : tier.features;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.55, delay: index * 0.06, ease: EASE }}
      className="flex flex-col bg-card px-5 pb-6 pt-6"
    >
      <p className="text-sm font-medium text-foreground">{tier.name}</p>

      <div className="mt-4 flex min-h-14 items-start gap-2">
        <span className="text-4xl font-semibold tracking-tight text-foreground">{tier.price}</span>
        {tier.cadence && (
          <span className="label-mono mt-1.5 max-w-20 text-muted-foreground">{tier.cadence}</span>
        )}
      </div>

      {/* The tier's rung on the mint ramp — deeper as the plans climb. */}
      <div
        aria-hidden
        className="mt-4 h-[3px] w-full"
        style={{ background: `linear-gradient(90deg, ${tier.rule[0]}, ${tier.rule[1]})` }}
      />

      <p className="mt-5 min-h-16 text-sm leading-relaxed text-muted-foreground">{tier.blurb}</p>

      <ul className="mt-4 flex flex-col gap-3">
        {rows.map((feature) => (
          <li key={feature} className="flex items-start gap-2.5 text-sm text-foreground">
            <Check aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" />
            {feature}
          </li>
        ))}
      </ul>

      <div className="mt-auto flex flex-col items-center gap-3 pt-8">
        <Button
          asChild
          variant={tier.highlight ? 'cta' : 'outline'}
          className="h-10 w-full rounded-full"
        >
          {tier.cta.to ? (
            <SweepLink to={tier.cta.to}>{tier.cta.label}</SweepLink>
          ) : (
            <a href={tier.cta.href} target="_blank" rel="noreferrer">
              {tier.cta.label}
            </a>
          )}
        </Button>
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          See all the features
          <NavArrowDown
            aria-hidden
            className={`h-3.5 w-3.5 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
          />
        </button>
      </div>
    </motion.div>
  );
}

export function Pricing() {
  return (
    <section id="pricing" className="relative scroll-mt-24 border-t border-border">
      <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {/* Hero panel: headline left, the stepped-bar figure right. */}
          <div className="grid gap-8 p-6 sm:p-10 lg:grid-cols-2 lg:gap-4 lg:p-0">
            <div className="flex flex-col justify-center lg:p-12">
              <Reveal y={12}>
                <h2 className="text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.02em] text-foreground sm:text-5xl">
                  Flexible pricing for any scale
                </h2>
              </Reveal>
              <Reveal y={12} delay={0.1}>
                <p className="mt-5 max-w-sm text-base leading-relaxed text-muted-foreground">
                  Pick a plan, pay for the compute you actually use. Scale-to-zero means idle costs
                  nothing.
                </p>
              </Reveal>
            </div>
            {/* The figure gets the whole right half; the shader draws grain,
                slats, sheen, and a pointer light over the mint ramp. */}
            <div className="flex items-end lg:pt-12">
              <SteppedBars className="h-56 w-full sm:h-72 lg:h-full" />
            </div>
          </div>

          {/* Everything below any plan boundary. */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-2 border-t border-border px-6 py-4 text-sm text-foreground sm:px-10">
            <span>All plans give you access to</span>
            {INCLUDED.map(({ icon: Icon, label }, i) => (
              <span key={label} className="inline-flex items-center gap-1.5 font-medium">
                <Icon aria-hidden className="h-4 w-4 text-brand" />
                {label}
                {i < INCLUDED.length - 2 ? ',' : i === INCLUDED.length - 2 ? ' and' : ''}
              </span>
            ))}
          </div>

          {/* The five columns. */}
          <div className="grid divide-y divide-border border-t border-border lg:grid-cols-5 lg:divide-x lg:divide-y-0">
            {TIERS.map((tier, i) => (
              <PlanColumn key={tier.name} tier={tier} index={i} />
            ))}
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

        <p className="mt-6 text-sm text-muted-foreground">
          Prices are per workspace. Compute is metered the same on every plan — $0.000012 per
          GB-second, $0.20 per million invocations, $0.01 per GB egress.
        </p>
      </div>
    </section>
  );
}
