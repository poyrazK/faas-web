import { describe, expect, it } from 'vitest';
import { faqJsonLd, LANDING_FAQ, pricingFaq, pricingJsonLd } from './faq';
import { PLAN_CATALOG, formatPlanPrice } from './plan-catalog';

describe('pricing FAQ', () => {
  it('quotes the generated catalog rather than fixed figures', () => {
    const text = pricingFaq(PLAN_CATALOG)
      .map((entry) => entry.answer)
      .join(' ');
    const [free, hobby] = PLAN_CATALOG.plans;
    expect(text).toContain(`${free.includedGbHours} GB-RAM-hours`);
    expect(text).toContain(`${formatPlanPrice(PLAN_CATALOG.overagePerGbHour)} per GB-RAM-hour`);
    expect(text).toContain(`${hobby.name} costs ${formatPlanPrice(hobby.monthly)} a month`);
  });

  it('offers every catalog plan at its catalog price', () => {
    const ld = pricingJsonLd(PLAN_CATALOG, 'https://gregale.dev');
    expect(ld.offers.map((offer) => [offer.name, Number(offer.price)])).toEqual(
      PLAN_CATALOG.plans.map((plan) => [plan.name, plan.monthly])
    );
  });
});

describe('faqJsonLd', () => {
  it('maps each entry to a schema.org Question with its visible answer', () => {
    const ld = faqJsonLd(LANDING_FAQ);
    expect(ld['@type']).toBe('FAQPage');
    expect(ld.mainEntity).toHaveLength(LANDING_FAQ.length);
    expect(ld.mainEntity[0]).toEqual({
      '@type': 'Question',
      name: LANDING_FAQ[0].question,
      acceptedAnswer: { '@type': 'Answer', text: LANDING_FAQ[0].answer },
    });
  });
});
