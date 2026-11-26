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
    '../../content/docs/code-workflows.md',
    '../../content/docs/secrets.md',
    '../../content/docs/companions.md',
    '../../content/docs/queue-pull-leases.md',
    '../../content/docs/cost-controls.md',
    '../../content/docs/tracing.md',
    '../../content/docs/scaling-policy.md',
    '../../content/docs/synthetic-checks.md',
    '../../content/docs/static-egress-ip.md',
    '../../content/docs/project-releases.md',
    '../../content/docs/service-release-graphs.md',
    '../../content/docs/service-bindings.md',
    '../../content/docs/binding-verification-runs.md',
    '../../content/docs/release-controls.md',
    '../../content/docs/edge-rules.md',
    '../../content/docs/edge-rule-trace.md',
    '../../content/docs/crons.md',
    '../../content/docs/event-driven.md',
    '../../content/docs/object-storage.md',
    '../../content/docs/egress-denylist.md',
    '../../content/docs/stored-workflows-recovery.md',
    '../../content/docs/container-compatibility.md',
    '../../content/docs/registry-credentials.md',
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

  it('quotes limits and maturity labels in Batch 2 capability articles as docs state them', () => {
    const workflowsDoc = sources['../../content/docs/code-workflows.md'].replace(/\s+/g, ' ');
    const workflowsText = body('durable-code-workflows-scale-to-zero').replace(/\s+/g, ' ');
    expect(workflowsDoc).toContain('preview feature on Hobby and higher plans');
    expect(workflowsText).toContain('**Preview:** Workflow execution is a preview capability');
    expect(workflowsDoc).toContain('30 days on Hobby, 90 on Pro, 365 on Scale');
    expect(workflowsText).toContain('30 days on Hobby, 90 on Pro, 365 on Scale');
    for (const limit of ['1,000', '1.5 MiB', '960 KiB']) {
      expect(workflowsDoc).toContain(limit);
      expect(workflowsText).toContain(limit);
    }

    const secretsDoc = sources['../../content/docs/secrets.md'].replace(/\s+/g, ' ');
    const secretsText = body('zero-restart-secret-rotation').replace(/\s+/g, ' ');
    expect(secretsDoc).toContain('Free 8, Hobby 25, Pro 50, Scale 100');
    expect(secretsText).toContain('Free 8`, `Hobby 25`, `Pro 50`, `Scale 100');
    expect(secretsDoc).toContain('com.gregale.secret-reload-signal');
    expect(secretsText).toContain('com.gregale.secret-reload-signal');

    const companionsDoc = sources['../../content/docs/companions.md'].replace(/\s+/g, ' ');
    const companionsText = body('sidecar-companions-without-kubernetes').replace(/\s+/g, ' ');
    for (const phrase of [
      'four long-running companions',
      'one one-shot setup helper',
      'opentelemetry',
      'sentry',
      'datadog-dogstatsd',
    ]) {
      expect(companionsDoc).toContain(phrase);
      expect(companionsText).toContain(phrase);
    }

    const pullDoc = sources['../../content/docs/queue-pull-leases.md'].replace(/\s+/g, ' ');
    const pullText = body('pull-queue-workers-workload-identity').replace(/\s+/g, ' ');
    expect(pullDoc).toContain('gregale:queues');
    expect(pullText).toContain('gregale:queues');
    for (const snippet of ['`100` messages', '`8 MiB`', '`20` seconds', '`64`']) {
      expect(pullText).toContain(snippet);
    }
  });

  it('quotes limits and figures in Batch 3 capability articles as docs state them', () => {
    const costDoc = sources['../../content/docs/cost-controls.md'].replace(/\s+/g, ' ');
    const costText = body('hard-cloud-spend-caps').replace(/\s+/g, ' ');
    for (const [plan, included, defCap, maxCap] of [
      ['Hobby', '200', '\\$10', '\\$75'],
      ['Pro', '1,000', '\\$50', '\\$200'],
      ['Scale', '3,000', '\\$150', '\\$1,000'],
    ]) {
      expect(costDoc).toMatch(
        new RegExp(
          `\\|\\s*${plan}\\s*\\|\\s*${included}\\s*\\|\\s*${defCap}\\s*\\|\\s*${maxCap}\\s*\\|`
        )
      );
      expect(costText).toMatch(
        new RegExp(
          `\\|\\s*${plan}\\s*\\|\\s*${included}\\s*\\|\\s*${defCap}\\s*\\|\\s*${maxCap}\\s*\\|`
        )
      );
    }
    expect(costText).toContain('HTTP 402');

    const tracingDoc = sources['../../content/docs/tracing.md'].replace(/\s+/g, ' ');
    const tracingText = body('zero-code-otel-sql-regression-tracing').replace(/\s+/g, ' ');
    for (const snippet of [
      'enabled: true',
      '127.0.0.1:4318',
      '127.0.0.1:4317',
      'failure_regression',
    ]) {
      expect(tracingDoc).toContain(snippet);
      expect(tracingText).toContain(snippet);
    }

    const scalingDoc = sources['../../content/docs/scaling-policy.md'].replace(/\s+/g, ' ');
    const scalingText = body('autoscale-from-zero-kafka-lag-custom-metrics').replace(/\s+/g, ' ');
    expect(scalingDoc).toContain('20 on Hobby, 50 on Pro, 200 on Scale');
    expect(scalingText).toContain('`20` names on Hobby, `50` on Pro, and `200` on Scale');
    for (const signal of ['queue_lag', 'queue_depth']) {
      expect(scalingDoc).toContain(signal);
      expect(scalingText).toContain(signal);
    }

    const synthDoc = sources['../../content/docs/synthetic-checks.md'].replace(/\s+/g, ' ');
    const synthText = body('synthetic-uptime-checks-scale-to-zero').replace(/\s+/g, ' ');
    for (const snippet of ['~73 GB-h', '~726 GB-h', '~1,446 GB-h', 'Gregale-Synthetics/1']) {
      expect(synthDoc).toContain(snippet);
      expect(synthText).toContain(snippet);
    }
  });

  it('quotes CLI commands, flags and limits in Batch 4 problem-solution articles as docs state them', () => {
    const egressDoc = sources['../../content/docs/static-egress-ip.md'].replace(/\s+/g, ' ');
    const egressText = body('static-egress-ip-scale-to-zero').replace(/\s+/g, ' ');
    expect(egressDoc).toContain('gregale app APP_ID static-egress-ip set');
    expect(egressText).toContain('gregale app APP_ID static-egress-ip set');

    const projectDoc = sources['../../content/docs/project-releases.md'].replace(/\s+/g, ' ');
    const graphDoc = sources['../../content/docs/service-release-graphs.md'].replace(/\s+/g, ' ');
    const atomicText = body('atomic-multi-service-releases').replace(/\s+/g, ' ');
    expect(projectDoc).toContain('gregale deploy check --project');
    expect(atomicText).toContain('gregale deploy check --project');
    expect(graphDoc).toContain('X-Gregale-Release');
    expect(atomicText).toContain('X-Gregale-Release');
    expect(graphDoc).toContain('__Host-gregale_release');
    expect(atomicText).toContain('__Host-gregale_release');

    const bindingsDoc = sources['../../content/docs/service-bindings.md'].replace(/\s+/g, ' ');
    const runsDoc = sources['../../content/docs/binding-verification-runs.md'].replace(/\s+/g, ' ');
    const bindingsText = body('pre-traffic-service-binding-verification').replace(/\s+/g, ' ');
    for (const snippet of ['SELECT 1', 'ListObjectsV2', '--require-bindings']) {
      expect(bindingsDoc).toContain(snippet);
      expect(bindingsText).toContain(snippet);
    }
    expect(runsDoc).toContain('--durable');
    expect(bindingsText).toContain('--durable');

    const controlsDoc = sources['../../content/docs/release-controls.md'].replace(/\s+/g, ' ');
    const controlsText = body('deploy-freezes-release-approvals-schedules').replace(/\s+/g, ' ');
    for (const snippet of [
      'release_approval_session_required',
      'release_frozen',
      '--after-rollback 1h',
    ]) {
      expect(controlsDoc).toContain(snippet);
      expect(controlsText).toContain(snippet);
    }

    const edgeDoc = sources['../../content/docs/edge-rules.md'].replace(/\s+/g, ' ');
    const edgeText = body('edge-rules-rate-limiting-trace-testing').replace(/\s+/g, ' ');
    for (const [label, f, h, p, s] of [
      ['Total edge rules', '5', '25', '100', '500'],
      ['`geo` rules', '1', '5', '25', '100'],
      ['`throttle` rules', '1', '5', '25', '100'],
      ['`cache` rules', '0', '1', '5', '20'],
    ]) {
      expect(edgeText).toMatch(
        new RegExp(
          `\\|\\s*${label}\\s*\\|\\s*${f}\\s*\\|\\s*${h}\\s*\\|\\s*${p}\\s*\\|\\s*${s}\\s*\\|`
        )
      );
    }
    expect(edgeDoc).toContain('request_validation_failed');
    expect(edgeText).toContain('request_validation_failed');
  });

  it('quotes tables, CIDR ranges and contracts in Batch 5 problem-solution articles as docs state them', () => {
    const cronsDoc = sources['../../content/docs/crons.md'].replace(/\s+/g, ' ');
    const cronsText = body('scale-to-zero-cron-jobs-event-triggers').replace(/\s+/g, ' ');
    for (const [plan, perApp, perAccount] of [
      ['Hobby', '5', '10'],
      ['Pro', '20', '50'],
      ['Scale', '100', '500'],
    ]) {
      expect(cronsDoc).toMatch(
        new RegExp(`\\|\\s*${plan}\\s*\\|\\s*${perApp}\\s*\\|\\s*${perAccount}\\s*\\|`)
      );
      expect(cronsText).toMatch(
        new RegExp(`\\|\\s*${plan}\\s*\\|\\s*${perApp}\\s*\\|\\s*${perAccount}\\s*\\|`)
      );
    }
    expect(cronsText).toContain('gregale delayed-task add');

    const storageDoc = sources['../../content/docs/object-storage.md'].replace(/\s+/g, ' ');
    const storageText = body('private-object-storage-without-s3-iam').replace(/\s+/g, ' ');
    for (const [plan, inc, ceil] of [
      ['Free', '1 GiB', '1 GiB'],
      ['Hobby', '10 GiB', '20 GiB'],
      ['Pro', '50 GiB', '250 GiB'],
      ['Scale', '200 GiB', '1,000 GiB'],
    ]) {
      expect(storageDoc).toMatch(
        new RegExp(`\\|\\s*${plan}\\s*\\|\\s*${inc}\\s*\\|\\s*${ceil}\\s*\\|`)
      );
      expect(storageText).toMatch(
        new RegExp(`\\|\\s*${plan}\\s*\\|\\s*${inc}\\s*\\|\\s*${ceil}\\s*\\|`)
      );
    }
    expect(storageText).toContain('https://s3.gregale.dev');

    const denyDoc = sources['../../content/docs/egress-denylist.md'].replace(/\s+/g, ' ');
    const denyText = body('ssrf-protection-egress-denylist-paas').replace(/\s+/g, ' ');
    for (const range of ['169.254.169.254', '10.0.0.0/8', '64:ff9b:1::/48', '198.18.0.0/15']) {
      expect(denyDoc).toContain(range);
      expect(denyText).toContain(range);
    }

    const recoveryDoc = sources['../../content/docs/stored-workflows-recovery.md'].replace(
      /\s+/g,
      ' '
    );
    const recoveryText = body('stored-workflow-recovery-missed-schedules').replace(/\s+/g, ' ');
    for (const snippet of [
      'gregale workflow diagnose',
      'expected_resume_count',
      'catch_up: latest',
    ]) {
      expect(recoveryDoc).toContain(snippet);
      expect(recoveryText).toContain(snippet);
    }

    const compatDoc = sources['../../content/docs/container-compatibility.md'].replace(/\s+/g, ' ');
    const compatText = body('deploy-docker-container-scale-to-zero-no-rewrite').replace(
      /\s+/g,
      ' '
    );
    for (const snippet of [
      '0.0.0.0:$PORT',
      'GREGALE_GUNICORN_FREEZE_GUARD',
      'image_manifest_invalid',
    ]) {
      expect(compatDoc).toContain(snippet);
      expect(compatText).toContain(snippet);
    }
  });
});
