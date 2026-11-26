import { describe, expect, it } from 'vitest';
import { ARTICLES } from './articles';
import { findDoc } from './docs-manifest';
import {
  FEATURES,
  FEATURES_DESCRIPTION,
  FEATURES_TITLE,
  findFeature,
  featureMarkdown,
} from './features';
import { RESEARCH_PUBLICATIONS } from './research';

describe('features catalog', () => {
  it('defines all 8 flagship feature pages with unique slugs and required fields', () => {
    expect(FEATURES).toHaveLength(8);
    expect(FEATURES_TITLE).toBe('Features');
    expect(FEATURES_DESCRIPTION.length).toBeGreaterThan(20);

    const slugs = new Set(FEATURES.map((feature) => feature.slug));
    expect(slugs.size).toBe(8);

    const articleSlugs = new Set(ARTICLES.map((article) => article.slug));
    const researchSlugs = new Set(RESEARCH_PUBLICATIONS.map((pub) => pub.slug));

    for (const feature of FEATURES) {
      expect(findFeature(feature.slug)).toBe(feature);
      expect(feature.title.trim().length).toBeGreaterThan(0);
      expect(feature.headline.trim().length).toBeGreaterThan(0);
      expect(feature.summary.trim().length).toBeGreaterThan(0);
      expect(feature.overview.trim().length).toBeGreaterThan(0);
      expect(feature.codeTitle.trim().length).toBeGreaterThan(0);
      expect(feature.codeSnippet.trim().length).toBeGreaterThan(0);
      expect(feature.updatedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(feature.highlights.length).toBeGreaterThanOrEqual(3);
      expect(feature.comparison.length).toBeGreaterThanOrEqual(3);
      expect(feature.faq.length).toBeGreaterThanOrEqual(2);
      expect(feature.docSlugs.length).toBeGreaterThanOrEqual(1);
      expect(feature.articleSlugs.length).toBeGreaterThanOrEqual(1);

      for (const doc of feature.docSlugs) {
        expect(findDoc(doc.slug), `${feature.slug}: missing doc ${doc.slug}`).toBeDefined();
      }
      for (const slug of feature.articleSlugs) {
        expect(articleSlugs.has(slug), `${feature.slug}: missing article ${slug}`).toBe(true);
      }
      for (const slug of feature.researchSlugs ?? []) {
        expect(researchSlugs.has(slug), `${feature.slug}: missing research ${slug}`).toBe(true);
      }
      for (const entry of feature.faq) {
        // FAQ JSON-LD tests forbid raw backticks in structured FAQ answers.
        expect(entry.question).not.toContain('`');
        expect(entry.answer).not.toContain('`');
      }

      const combined = JSON.stringify(feature).toLowerCase();
      expect(combined).not.toContain('open source');
      expect(combined).not.toContain('open-source');
      expect(combined).not.toContain('/solutions');
    }
  });

  it('renders valid Markdown copies for every feature', () => {
    for (const feature of FEATURES) {
      const md = featureMarkdown(feature, 'https://gregale.dev');
      expect(md.startsWith(`# ${feature.title}\n`)).toBe(true);
      expect(md).toContain(feature.summary);
      expect(md).toContain('## Typical PaaS vs. Gregale');
      expect(md).toContain(feature.codeSnippet);
      for (const question of feature.faq) {
        expect(md).toContain(`### ${question.question}\n\n${question.answer}`);
      }
      expect(
        md.trimEnd().endsWith(`Canonical URL: https://gregale.dev/features/${feature.slug}`)
      ).toBe(true);
    }
  });
});
