import { describe, expect, it } from 'vitest';
import { ANSWER_ARTICLES, ARTICLES, alternativesArticle, comparisonArticles } from './articles';
import { COMPARISON_SLUGS } from './compare';
import { PLAN_CATALOG, formatPlanPrice } from './plan-catalog';

const bodies = import.meta.glob<string>('../../content/articles/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const body = (slug: string) => bodies[`../../content/articles/${slug}.md`];

const ROUNDUPS = ARTICLES.filter((article) => article.alternativesTo);

describe('articles', () => {
  it('has a Markdown body for every article', () => {
    for (const article of ARTICLES) expect(body(article.slug), article.slug).toBeTruthy();
  });

  it('has one alternatives roundup per comparison page, and keeps them out of the answer list', () => {
    for (const slug of COMPARISON_SLUGS) expect(alternativesArticle(slug), slug).toBeDefined();
    expect(ROUNDUPS.map((article) => article.alternativesTo).sort()).toEqual(
      [...COMPARISON_SLUGS].sort()
    );
    expect(ANSWER_ARTICLES.some((article) => article.alternativesTo)).toBe(false);
  });

  it('links each head-to-head only to real comparison pages, and keeps it out of the answer list', () => {
    const headToHeads = ARTICLES.filter((article) => article.comparison);
    expect(headToHeads.length).toBeGreaterThan(0);
    for (const article of headToHeads) {
      for (const slug of article.comparison ?? []) {
        expect(COMPARISON_SLUGS, `${article.slug} -> ${slug}`).toContain(slug);
        expect(comparisonArticles(slug)).toContain(article);
      }
    }
    expect(ANSWER_ARTICLES.some((article) => article.comparison)).toBe(false);
  });

  it("quotes Gregale's plans in the roundups exactly as the plan catalog states them", () => {
    const [free, hobby, pro, scale] = PLAN_CATALOG.plans;
    const usd = formatPlanPrice;
    const freePlan = `1 app with ${free.ramMb} MB and ${free.includedGbHours} GB-RAM-hours a month`;
    expect(free.deployedApps).toBe(1);
    for (const article of ROUNDUPS) {
      // Prose wraps, so compare with runs of whitespace collapsed.
      const text = body(article.slug).replace(/\s+/g, ' ');
      expect(text).toContain(`Gregale Free: ${freePlan}`);
      expect(text).toContain(`Gregale Free is ${usd(free.monthly)} for ${freePlan}`);
      expect(text).toContain(
        `Gregale Hobby: ${usd(hobby.monthly)} a month for ${hobby.deployedApps} apps`
      );
      expect(text).toContain(
        `Hobby ${usd(hobby.monthly)}, Pro ${usd(pro.monthly)} and Scale ${usd(scale.monthly)} a month; ` +
          `Hobby covers ${hobby.deployedApps} apps with ${hobby.ramMb} MB each and ` +
          `${hobby.includedGbHours} GB-RAM-hours`
      );
      const freeAnswers = article.faq.filter((entry) => entry.answer.includes('Gregale Free'));
      for (const entry of freeAnswers)
        expect(entry.answer).toContain(`Gregale Free covers ${freePlan}`);
    }
  });

  it('quotes plan limits in the answer pages exactly as the plan catalog states them', () => {
    const [free, hobby, pro, scale] = PLAN_CATALOG.plans;
    const previews = body('preview-environments').replace(/\s+/g, ' ');
    expect(previews).toContain(
      `Free includes ${free.previewEnvironments}, Hobby ${hobby.previewEnvironments}, ` +
        `Pro ${pro.previewEnvironments} and Scale ${scale.previewEnvironments}.`
    );
    const seconds = (limit: string) => {
      const match = /^(\d+)(s|m)$/.exec(limit);
      if (!match) throw new Error(`unexpected request timeout ${limit}`);
      return Number(match[1]) * (match[2] === 'm' ? 60 : 1);
    };
    const mcp = body('mcp-server-hosting').replace(/\s+/g, ' ');
    expect(mcp).toContain(
      `(${seconds(hobby.maxRequestTimeout)} seconds on Hobby, the plan's maximum)`
    );
    expect(mcp).toContain(
      `on Scale you can raise it to ${seconds(scale.maxRequestTimeout)} seconds`
    );
    const minutes = (limit: string) => seconds(limit) / 60;
    const fastapi = body('fastapi-background-jobs-postgres').replace(/\s+/g, ' ');
    expect(fastapi).toContain(
      `(${seconds(hobby.maxRequestTimeout)} seconds on Hobby, ${minutes(pro.maxRequestTimeout)} minutes on Pro)`
    );
  });

  it('quotes Hobby in the API and worker pages exactly as the plan catalog states it', () => {
    const [, hobby] = PLAN_CATALOG.plans;
    const usd = formatPlanPrice;
    const hobbyRow = `Gregale Hobby: ${usd(hobby.monthly)} a month for ${hobby.deployedApps} apps`;
    const hobbyPlan =
      `Hobby is ${usd(hobby.monthly)} a month for ${hobby.deployedApps} apps with ` +
      `${hobby.ramMb} MB each and ${hobby.includedGbHours} GB-RAM-hours`;
    const fastapiPlan =
      `Hobby is ${usd(hobby.monthly)} a month for up to ${hobby.deployedApps} apps with ` +
      `${hobby.ramMb} MB each and ${hobby.includedGbHours} GB-RAM-hours`;
    const overage = `$${PLAN_CATALOG.overagePerGbHour.toFixed(2)} per GB-RAM-hour`;
    const text = (slug: string) => body(slug).replace(/\s+/g, ' ');

    expect(text('render-vs-railway-vs-flyio')).toContain(hobbyRow);
    expect(text('render-vs-railway-vs-flyio')).toContain(hobbyPlan);
    expect(text('nodejs-api-and-worker')).toContain(hobbyRow);
    expect(text('nodejs-api-and-worker')).toContain(
      `Hobby includes ${hobby.includedGbHours} GB-RAM-hours a month`
    );
    expect(text('fastapi-background-jobs-postgres')).toContain(fastapiPlan);
    for (const slug of [
      'render-vs-railway-vs-flyio',
      'nodejs-api-and-worker',
      'fastapi-background-jobs-postgres',
    ])
      expect(text(slug), slug).toContain(overage);
  });
});
