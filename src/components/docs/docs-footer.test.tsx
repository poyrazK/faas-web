import { describe, expect, it } from 'vitest';
import { ARTICLES } from '@/lib/articles';
import { COMPARISON_SLUGS } from '@/lib/compare';
import { DOCS_FOOTER_GROUPS } from './docs-footer';

const links = DOCS_FOOTER_GROUPS.flatMap((group) => group.links);

describe('docs footer', () => {
  it('lists every comparison page', () => {
    const listed = links.flatMap((link) => (link.compare ? [link.compare] : []));
    expect([...listed].sort()).toEqual([...COMPARISON_SLUGS].sort());
  });

  it('links only published articles, at their own paths', () => {
    const published = new Set(ARTICLES.map((article) => article.slug));
    const articleLinks = links.filter((link) => link.article);
    expect(articleLinks.length).toBeGreaterThan(0);
    for (const link of articleLinks) {
      expect(published.has(link.article!), link.article).toBe(true);
      expect(link.href).toBe(`/articles/${link.article}`);
    }
  });

  it('links the pricing, features and solutions pages', () => {
    const routes = links.map((link) => link.publicRoute);
    expect(routes).toEqual(expect.arrayContaining(['/pricing', '/features', '/solutions']));
  });
});
