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

const sources = import.meta.glob<string>(
  [
    '../../content/docs/postgres.md',
    '../../content/docs/realtime.md',
    '../../content/docs/inbound-webhooks.md',
    '../../content/docs/outbound-integrations.md',
    '../../public/research/firecracker-snapshot-restore-ssd-2026-09-09/summary.json',
  ],
  { query: '?raw', import: 'default', eager: true }
);

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

  it('quotes managed PostgreSQL limits in the rollback article as the Postgres docs state them', () => {
    const doc = sources['../../content/docs/postgres.md'];
    const row = (plan: string) => {
      const cells = new RegExp(`^\\| ${plan} \\|(.+)\\|\\s*$`, 'm').exec(doc)?.[1].split('|');
      if (!cells) throw new Error(`postgres.md has no ${plan} row`);
      return { databases: cells[0].trim(), window: cells[4].trim() };
    };
    const [hobby, pro, scale] = ['Hobby', 'Pro', 'Scale'].map(row);
    const text = body('rollback-code-and-database').replace(/\s+/g, ' ');
    expect(text).toContain(
      `${hobby.databases} on Hobby, ${pro.databases} on Pro, ${scale.databases} on Scale`
    );
    for (const plan of [hobby, pro, scale]) expect(plan.window).toBe('7 days');
    expect(text).toContain('7-day restore window');
    expect(row('Free').databases).toBe('—');
    expect(text).toContain('the Free plan has no managed PostgreSQL');
  });

  it('quotes the snapshot restore benchmark as its published summary rounds it', () => {
    const summary = JSON.parse(
      sources['../../public/research/firecracker-snapshot-restore-ssd-2026-09-09/summary.json']
    ) as { snapshot_restores: number; platform_ms: { p50: number; p95: number; max: number } };
    const ms = (value: number) => `${Math.round(value)} ms`;
    const text = body('scale-to-zero-without-cold-starts').replace(/\s+/g, ' ');
    const claim =
      `${summary.snapshot_restores} snapshot restores of a 256 MiB app took ` +
      `${ms(summary.platform_ms.p50)} at the median and ${ms(summary.platform_ms.p95)} at p95`;
    expect(text).toContain(claim);
    expect(text).toContain(`${ms(summary.platform_ms.max)} at worst`);
    const faq = ARTICLES.find((a) => a.slug === 'scale-to-zero-without-cold-starts')!.faq;
    expect(faq.some((entry) => entry.answer.includes(claim))).toBe(true);
  });

  it('quotes plan limits and preview labels in the niche capability articles as the docs state them', () => {
    const realtimeDoc = sources['../../content/docs/realtime.md'];
    const realtimeText = body('websockets-sse-scale-to-zero').replace(/\s+/g, ' ');
    for (const [endpoints, connections] of [
      ['2 / 10', '200'],
      ['10 / 50', '1,000'],
      ['25 / 250', '5,000'],
    ]) {
      expect(realtimeDoc).toContain(`| ${endpoints} | ${connections} |`);
      expect(realtimeText).toMatch(
        new RegExp(`\\|\\s*${endpoints}\\s*\\|\\s*${connections}\\s*\\|`)
      );
    }

    const webhooksDoc = sources['../../content/docs/inbound-webhooks.md'];
    const webhooksText = body('durable-inbound-webhooks-scale-to-zero').replace(/\s+/g, ' ');
    expect(webhooksDoc).toContain('Free 60, Hobby 1,200, Pro 3,000, Scale 6,000');
    for (const limit of ['1,200', '3,000', '6,000', '60']) {
      expect(webhooksText).toContain(limit);
    }

    const outboundDoc = sources['../../content/docs/outbound-integrations.md'];
    const outboundText = body('zero-secret-outbound-api-relay').replace(/\s+/g, ' ');
    expect(outboundDoc).toContain('**Preview.** Outbound integrations are a preview capability');
    expect(outboundText).toContain('**Preview:** Outbound integrations are a preview capability');
    for (const [plan, daily] of [
      ['Hobby', '1,000,000'],
      ['Pro', '10,000,000'],
      ['Scale', '100,000,000'],
    ]) {
      expect(outboundDoc).toContain(`| ${plan} | ${daily} |`);
      expect(outboundText).toMatch(new RegExp(`\\|\\s*${plan}\\s*\\|\\s*${daily}\\s*\\|`));
    }
  });
});
