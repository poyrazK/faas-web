import { describe, expect, it } from 'vitest';
import { ARTICLES } from './articles';
import { comparisons } from './compare';
import { FEATURES, FEATURES_DESCRIPTION } from './features';
import { META_DESCRIPTIONS, metaDescriptionFor } from './meta-descriptions';
import { PLAN_CATALOG } from './plan-catalog';
import { RESEARCH_PUBLICATIONS } from './research';
import { META_DESCRIPTION_MAX } from './seo';
import { SOLUTIONS } from './solutions';

/** Every public page whose description comes from a hand-written summary. */
const PAGES = new Map<string, string>([
  ['/features', FEATURES_DESCRIPTION],
  ...ARTICLES.map((page) => [`/articles/${page.slug}`, page.summary] as const),
  ...FEATURES.map((page) => [`/features/${page.slug}`, page.summary] as const),
  ...SOLUTIONS.map((page) => [`/solutions/${page.slug}`, page.summary] as const),
  ...RESEARCH_PUBLICATIONS.map((page) => [`/research/${page.slug}`, page.summary] as const),
  ...comparisons(PLAN_CATALOG).map((page) => [`/vs/${page.slug}`, page.summary] as const),
]);

describe('public page descriptions', () => {
  // Bing reports a description outside 25–160 characters as an error. A
  // summary past the limit needs an entry in META_DESCRIPTIONS rather than
  // the generic cut in fitMetaDescription, which ends mid-sentence.
  it.each([...PAGES])('%s fits a search snippet', (path, summary) => {
    const description = metaDescriptionFor(path, summary) ?? '';
    expect(description.length).toBeLessThanOrEqual(META_DESCRIPTION_MAX);
    expect(description.length).toBeGreaterThanOrEqual(50);
  });

  it('has entries only for live pages whose summary is too long', () => {
    for (const path of Object.keys(META_DESCRIPTIONS)) {
      expect(PAGES.has(path), `${path} is not a public page`).toBe(true);
      expect(PAGES.get(path)!.length, `${path} summary already fits`).toBeGreaterThan(
        META_DESCRIPTION_MAX
      );
    }
  });
});
