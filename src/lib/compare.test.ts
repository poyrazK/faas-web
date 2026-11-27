import { describe, expect, it } from 'vitest';
import { COMPARISON_SLUGS, COMPARISONS_CHECKED, comparisons } from './compare';
import { PLAN_CATALOG, formatPlanPrice } from './plan-catalog';
import { DOC_ENTRIES } from './docs-manifest';
import { comparisonGuides } from './articles';

const ALL = comparisons(PLAN_CATALOG);

describe('comparison pages', () => {
  it('lists every page in the route slugs, and nothing else', () => {
    expect(ALL.map((c) => c.slug)).toEqual([...COMPARISON_SLUGS]);
  });

  it('dates the competitor figures', () => {
    expect(COMPARISONS_CHECKED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('gives every comparison its own set of guides', () => {
    const sets = ALL.map((c) => [...c.articles].sort().join(','));
    expect(new Set(sets).size).toBe(ALL.length);
  });

  for (const comparison of ALL) {
    describe(comparison.competitor, () => {
      it('cites the competitor’s own pages over https', () => {
        expect(comparison.sources.length).toBeGreaterThan(0);
        for (const source of comparison.sources) expect(source.url).toMatch(/^https:\/\//);
      });

      it('links three to five answer articles, all published', () => {
        expect(comparison.articles.length).toBeGreaterThanOrEqual(3);
        expect(comparison.articles.length).toBeLessThanOrEqual(5);
        expect(comparisonGuides(comparison).map((a) => a.slug)).toEqual(comparison.articles);
      });

      it('says where the competitor is the better fit, not only Gregale', () => {
        expect(comparison.theyFit.length).toBeGreaterThan(0);
        expect(comparison.gregaleFits.length).toBeGreaterThan(0);
      });

      it('fills both columns of every row', () => {
        for (const row of comparison.rows) {
          expect(row.gregale.trim()).not.toBe('');
          expect(row.them.trim()).not.toBe('');
        }
      });

      it('quotes Gregale prices from the generated catalog', () => {
        const text = comparison.rows.map((row) => row.gregale).join(' ');
        const hobby = PLAN_CATALOG.plans[1];
        expect(text).toContain(`${formatPlanPrice(hobby.monthly)} a month`);
        expect(text).toContain(`${formatPlanPrice(PLAN_CATALOG.overagePerGbHour)} per GB-RAM-hour`);
      });

      it('compares releases: the rollout ladder and automatic rollback', () => {
        const row = comparison.rows.find((r) => r.topic === 'Releases');
        expect(row?.gregale).toMatch(/1%, then 10%, 50% and 100%/);
        expect(row?.gregale).toMatch(/rolling back on its own/);
        expect(comparison.faq.some((entry) => entry.question.includes('release breaks'))).toBe(
          true
        );
      });

      it('says billing stops about a second after the last request', () => {
        const idle = comparison.rows.find((r) => r.topic === 'Idle apps');
        expect(idle?.gregale).toMatch(/About a second after its last request/);
        expect(idle?.gregale).toMatch(/stops being billed/);
      });

      it('links to a published docs page for the move', () => {
        expect(DOC_ENTRIES.some((entry) => entry.slug === comparison.migrateDoc)).toBe(true);
      });
    });
  }
});
