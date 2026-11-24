import { formatCatalogPrice, type CatalogPlan } from './plan-catalog-parser.ts';

/**
 * Question-and-answer copy shown on public pages, kept in plain TypeScript.
 *
 * Two readers need the same strings: the page components that render them,
 * and `scripts/prerender.mjs`, which writes them out as schema.org `FAQPage`
 * structured data. Google only honours FAQ markup whose answers match the
 * visible page, so the text lives here once rather than being restated in the
 * build script. Nothing in this file may import JSX or a Vite-only module
 * (`?raw`): the prerender script loads it with plain Node.
 */

export interface FaqEntry {
  question: string;
  answer: string;
}

interface Catalog {
  currency: string;
  overagePerGbHour: number;
  plans: CatalogPlan[];
}

/** Landing page "A few practical questions", in display order. */
export const LANDING_FAQ = [
  {
    question: 'Can I start using Gregale today?',
    answer:
      'Yes. Sign up, deploy from your terminal or GitHub, and your API is live on a Gregale URL with TLS.',
  },
  {
    question: 'What stays in my application?',
    answer:
      'Your business logic, user authorization and data-isolation rules. You also handle effects in external systems, including duplicate requests where needed.',
  },
  {
    question: 'Does my application have to run all the time?',
    answer:
      'With scale-to-zero enabled, eligible idle applications can stop consuming compute and wake when traffic returns. The first request waits for the wake. Long-running workers have different lifecycle behavior.',
  },
  {
    question: 'What does it cost?',
    answer:
      'Start on Free. Plan prices and included usage come from the platform catalog, listed on the pricing page.',
  },
] as const satisfies readonly FaqEntry[];

/** The cheapest paid plan, by monthly price. Shared by the FAQ and the page's
 * meta description so the two cannot quote different plans. */
export function cheapestPaidPlan(catalog: Catalog): CatalogPlan {
  const paid = catalog.plans.slice(1);
  return paid.reduce((low, plan) => (plan.monthly < low.monthly ? plan : low), paid[0]);
}

/**
 * Pricing page questions. Every number is read from the generated plan
 * catalog (`content/docs/plans.md`), so a price change cannot leave a stale
 * figure in the copy or in the structured data.
 */
export function pricingFaq(catalog: Catalog): FaqEntry[] {
  const usd = (amount: number) => formatCatalogPrice(amount, catalog.currency);
  const [free] = catalog.plans;
  const cheapest = cheapestPaidPlan(catalog);
  return [
    {
      question: 'Is there a free plan?',
      answer:
        `Yes. ${free.name} costs ${usd(free.monthly)} and runs ${free.deployedApps} deployed ${free.deployedApps === 1 ? 'app' : 'apps'} ` +
        `with ${free.ramMb} MB of RAM and ${free.includedGbHours} GB-RAM-hours of compute a month. ` +
        `It stops at its included allowance instead of billing overage, so it never charges you.`,
    },
    {
      question: 'How is compute billed?',
      answer:
        'By memory and time, in GB-RAM-hours. CPU follows each instance’s RAM and is not billed ' +
        'separately. Each plan includes a monthly allowance; on paid plans, usage beyond it costs ' +
        `${usd(catalog.overagePerGbHour)} per GB-RAM-hour, up to a spend cap you control.`,
    },
    {
      question: 'Do I pay while my app is idle?',
      answer:
        'An inactive app is parked after its plan’s idle timeout and stops using compute. The ' +
        'next request wakes it from a snapshot, so an API with occasional traffic only uses ' +
        'compute while it is serving.',
    },
    {
      question: 'Are builds charged?',
      answer:
        'No. Builds are free. Each plan includes build minutes per month, and deploying a ' +
        'prebuilt image uses none.',
    },
    {
      question: 'What does the cheapest paid plan cost?',
      answer:
        `${cheapest.name} costs ${usd(cheapest.monthly)} a month for up to ${cheapest.deployedApps} ` +
        `deployed apps with ${cheapest.ramMb} MB of RAM each and ${cheapest.includedGbHours} ` +
        'included GB-RAM-hours.',
    },
    {
      question: 'Do prices include tax?',
      answer:
        'Prices are monthly in US dollars, before tax. The billing provider adds any sales tax ' +
        'or VAT that applies where you live at checkout.',
    },
  ];
}

/** schema.org `FAQPage` for a list of entries. */
export function faqJsonLd(entries: readonly FaqEntry[]) {
  return {
    '@type': 'FAQPage',
    mainEntity: entries.map((entry) => ({
      '@type': 'Question',
      name: entry.question,
      acceptedAnswer: { '@type': 'Answer', text: entry.answer },
    })),
  };
}

/** schema.org `SoftwareApplication` carrying one `Offer` per plan. */
export function pricingJsonLd(catalog: Catalog, siteUrl: string) {
  return {
    '@type': 'SoftwareApplication',
    // Same node as the home page's, so the offers attach to one product.
    '@id': `${siteUrl}/#software`,
    publisher: { '@id': `${siteUrl}/#org` },
    name: 'Gregale',
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Linux',
    url: `${siteUrl}/`,
    offers: catalog.plans.map((plan) => ({
      '@type': 'Offer',
      name: plan.name,
      price: plan.monthly.toFixed(2),
      priceCurrency: catalog.currency,
      url: `${siteUrl}/pricing`,
      // No priceSpecification: Google's software-app parser rejects a
      // UnitPriceSpecification there ("invalid object type", Rich Results
      // Test 2026-11-24). The billing period is stated in plain text instead.
      description: `${plan.name} plan, billed monthly, before tax`,
    })),
  };
}
