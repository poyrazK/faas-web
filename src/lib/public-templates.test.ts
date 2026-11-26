import { describe, expect, it } from 'vitest';
import { FEATURES } from './features';
import { PUBLIC_TEMPLATES, TEMPLATE_CATEGORIES, templatesForFeature } from './public-templates';

describe('public templates registry', () => {
  it('has unique slugs and GitHub URLs under github.com/gregale-dev', () => {
    const slugs = PUBLIC_TEMPLATES.map((t) => t.slug);
    const urls = PUBLIC_TEMPLATES.map((t) => t.repoUrl);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(urls).size).toBe(urls.length);
    for (const template of PUBLIC_TEMPLATES) {
      expect(template.repoUrl.startsWith('https://github.com/gregale-dev/')).toBe(true);
      expect(TEMPLATE_CATEGORIES).toContain(template.category);
    }
  });

  it('references only valid feature slugs and links back from features', () => {
    const validFeatures = new Set(FEATURES.map((f) => f.slug));
    for (const template of PUBLIC_TEMPLATES) {
      expect(template.featureSlugs.length).toBeGreaterThan(0);
      for (const featureSlug of template.featureSlugs) {
        expect(validFeatures.has(featureSlug)).toBe(true);
      }
    }
    expect(templatesForFeature('database-rollbacks').length).toBeGreaterThanOrEqual(3);
    expect(templatesForFeature('mcp-hosting').length).toBeGreaterThanOrEqual(6);
  });
});
