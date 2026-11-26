import { describe, expect, it } from 'vitest';
import { ARTICLES } from './articles';
import { DOC_ENTRIES } from './docs-manifest';
import { RESEARCH_PUBLICATIONS } from './research';
import { SOLUTIONS, solutionMarkdown } from './solutions';

describe('solutions', () => {
  const articlesBySlug = new Map(ARTICLES.map((article) => [article.slug, article]));
  const docSlugs = new Set(DOC_ENTRIES.map((doc) => doc.slug));
  const researchSlugs = new Set(RESEARCH_PUBLICATIONS.map((pub) => pub.slug));

  it('references only real articles, docs and research publications', () => {
    expect(SOLUTIONS.length).toBeGreaterThanOrEqual(6);
    const seen = new Set<string>();
    for (const solution of SOLUTIONS) {
      expect(seen.has(solution.slug), solution.slug).toBe(false);
      seen.add(solution.slug);
      expect(solution.painPoints.length).toBeGreaterThanOrEqual(3);
      expect(solution.faq.length).toBeGreaterThanOrEqual(3);
      for (const slug of solution.articleSlugs) {
        expect(articlesBySlug.has(slug), `${solution.slug} -> article ${slug}`).toBe(true);
      }
      for (const doc of solution.docSlugs) {
        expect(docSlugs.has(doc.slug), `${solution.slug} -> doc ${doc.slug}`).toBe(true);
      }
      for (const slug of solution.researchSlugs ?? []) {
        expect(researchSlugs.has(slug), `${solution.slug} -> research ${slug}`).toBe(true);
      }
      for (const entry of solution.faq) {
        expect(entry.question, `${solution.slug} question backtick`).not.toContain('`');
      }
    }
  });

  it('never calls Gregale open source', () => {
    const corpus = SOLUTIONS.map((solution) =>
      [
        solution.title,
        solution.summary,
        solution.problemStatement,
        ...solution.painPoints.flatMap((p) => [p.before, p.withGregale]),
        ...solution.faq.flatMap((f) => [f.question, f.answer]),
      ].join(' ')
    ).join('\n');
    expect(corpus).not.toMatch(/\bgregale\b[^.\n]{0,80}\bopen[\s-]?source\b/i);
  });

  it('renders a canonical Markdown page for every solution', () => {
    for (const solution of SOLUTIONS) {
      const md = solutionMarkdown(solution, articlesBySlug, 'https://gregale.dev');
      expect(md).toContain(`# ${solution.title}`);
      expect(md).toContain('## What breaks vs. how Gregale solves it');
      expect(md).toContain('## Deep-dive guides');
      expect(md).toContain(`Canonical URL: https://gregale.dev/solutions/${solution.slug}`);
    }
  });
});
