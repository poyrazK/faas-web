import { describe, expect, it } from 'vitest';
import { ARTICLE_TOPICS, ARTICLES } from './articles';
import { PLAN_CATALOG, formatPlanPrice } from './plan-catalog';

const bodies = import.meta.glob<string>('../../content/articles/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const sources = import.meta.glob<string>(
  [
    '../../content/docs/multi-service.md',
    '../../content/docs/container-compatibility.md',
    '../../content/docs/edge-rules.md',
    '../../content/docs/security.md',
    '../../content/docs/scale-to-zero.md',
    '../../public/research/firecracker-snapshot-restore-ssd-2026-09-09/summary.json',
  ],
  { query: '?raw', import: 'default', eager: true }
);

// Prose wraps, so compare with runs of whitespace collapsed.
const flat = (text: string) => text.replace(/\s+/g, ' ');
const body = (slug: string) => flat(bodies[`../../content/articles/${slug}.md`]);
const doc = (name: string) => flat(sources[`../../content/docs/${name}.md`]);
const faq = (slug: string) =>
  ARTICLES.find((article) => article.slug === slug)!
    .faq.map((entry) => entry.answer)
    .join(' ');

/** Cells of the docs table row whose first cell is `label`, as written. */
function row(text: string, label: string): string[] {
  const cells = text
    .split('\n')
    .map((line) => line.split('|').map((cell) => cell.trim()))
    .find((candidate) => candidate[0] === '' && candidate[1] === label);
  if (!cells) throw new Error(`no table row ${label}`);
  return cells.slice(2, -1);
}

const COMPOSE = 'deploy-docker-compose-app-to-production';
const WAKE_PAGE = 'show-waking-up-page-during-cold-start';
const CORS = 'fix-cors-errors-without-changing-backend-code';
const HEADERS = 'add-security-headers-hsts-csp-without-code';
const RATE_LIMIT = 'rate-limit-api-per-ip-without-code';
const NOT_SCALING = 'why-app-not-scaling-to-zero';
const DOMAIN_PENDING = 'custom-domain-stuck-pending-dns-ssl';
const ENV_UNDO = 'undo-bad-environment-variable-change';
const HOW_TO = [
  COMPOSE,
  WAKE_PAGE,
  CORS,
  HEADERS,
  RATE_LIMIT,
  NOT_SCALING,
  DOMAIN_PENDING,
  ENV_UNDO,
];

describe('how-to guides', () => {
  it('groups the how-to guides under their own topic', () => {
    const topic = ARTICLE_TOPICS.find((entry) => entry.id === 'how-to');
    expect([...topic!.slugs].sort()).toEqual([...HOW_TO].sort());
  });

  it('quotes Gregale prices as the plan catalog states them', () => {
    const [, hobby, pro, scale] = PLAN_CATALOG.plans;
    for (const slug of HOW_TO) {
      const text = body(slug);
      for (const plan of [hobby, pro, scale])
        expect(text, slug).toContain(formatPlanPrice(plan.monthly));
    }
  });

  it('quotes the Compose mapping as the multi-service and container docs state it', () => {
    const text = body(COMPOSE);
    const multi = doc('multi-service');
    const containers = doc('container-compatibility');
    for (const phrase of [
      'gregale deploy --repo octo/shop --ref main --project',
      'Add `--only api,web` or `--exclude worker` to deploy part of the project',
      'plus `compose.override.yaml` as `docker compose up` applies it',
      '(for example `shop-db`)',
      '`npm run migrate` runs once before each `api` release goes live, in the `api` image with its variables and secrets, and `migrate` is not deployed as a service',
      '.internal:10081',
      'Free supports a project with one service',
    ]) {
      expect(text, phrase).toContain(phrase);
      expect(multi, phrase).toContain(phrase);
    }
    for (const phrase of [
      'no persistent volumes or bind mounts; each start gets a fresh filesystem',
      '`x-gregale-env-import: true`',
    ]) {
      expect(text, phrase).toContain(phrase);
      expect(containers, phrase).toContain(phrase);
    }
  });

  it('quotes wake headers, warm instances and the restore benchmark as published', () => {
    const text = body(WAKE_PAGE);
    const scaleToZero = doc('scale-to-zero');
    expect(text).toContain('`x-faas-wake: hot`');
    expect(scaleToZero).toContain('`x-faas-wake: hot`');
    expect(text).toContain('--min 1 # always keep 1 instance warm');
    expect(scaleToZero).toContain('--min 1 # always keep 1 instance warm');
    expect(text).toContain('keep an instance running on Pro or Scale');
    expect(scaleToZero).toContain('Hobby and Free reject `--min > 0`');

    const summary = JSON.parse(
      sources['../../public/research/firecracker-snapshot-restore-ssd-2026-09-09/summary.json']
    ) as { snapshot_restores: number; platform_ms: { p50: number; p95: number } };
    const ms = (value: number) => `${Math.round(value)} ms`;
    expect(text).toContain(
      `${summary.snapshot_restores} snapshot restores of a 256 MiB app took ` +
        `${ms(summary.platform_ms.p50)} at the median and ${ms(summary.platform_ms.p95)} at p95`
    );
  });

  it('quotes CORS rules and edge-rule limits as the edge-rules docs state them', () => {
    const text = body(CORS);
    const raw = sources['../../content/docs/edge-rules.md'];
    const edge = flat(raw);
    for (const phrase of [
      'An origin is `*`, `https://host[:port]`, `https://*.host` for subdomains, or `https://host:*` for any port.',
      'at most 86400',
      '`/v1/cors-presets`',
      '"https://*.example.com"',
      'gregale edge cors allow',
    ]) {
      expect(text, phrase).toContain(phrase);
      expect(edge, phrase).toContain(phrase);
    }
    const preflight =
      'A matched OPTIONS preflight is answered with 204 at the edge, without waking the app';
    expect(faq(CORS)).toContain(preflight);
    expect(edge.replaceAll('`', '')).toContain(preflight);

    const [free, hobby, pro, scale] = row(raw, 'Rules per app');
    const perApp = `${free} on Free, ${hobby} on Hobby`;
    expect(text).toContain(perApp);
    expect(body(HEADERS)).toContain(perApp);
    expect(text).toContain(`${pro} on Pro`);
    expect(text).toContain(`${scale} on Scale`);
    expect(faq(CORS)).toContain(
      `${free} on Free, ${hobby} on Hobby, ${pro} on Pro and ${scale} on Scale`
    );
  });

  it('quotes default security headers and header rules as the security docs state them', () => {
    const text = body(HEADERS);
    const security = doc('security');
    const edge = doc('edge-rules');
    for (const phrase of [
      '`max-age=31536000; includeSubDomains`',
      '`strict-origin-when-cross-origin`',
      '`nosniff`',
      'because Gregale does not serve your other subdomains',
      "--headers-response-set 'X-Frame-Options:DENY'",
    ]) {
      expect(text, phrase).toContain(phrase);
      expect(security, phrase).toContain(phrase);
    }
    expect(text).toContain('matches only the root path');
    expect(edge).toContain('which matches only the root path');
    expect(text).toContain('appends a value');
    expect(edge).toContain('appends a value');
    expect(edge).toContain('{"name": "Server", "action": "remove"}');
  });

  it('quotes throttle keys, responses and plan limits as the edge-rules docs state them', () => {
    const text = body(RATE_LIMIT);
    const raw = sources['../../content/docs/edge-rules.md'];
    const edge = flat(raw);
    for (const phrase of [
      'client IP (IPv6 by /64)',
      'API consumer, across its rotated keys',
      '`X-RouteRateLimit-Limit`',
      '`rate_limited`',
      'counted across every gateway that serves',
      '--outcome logged',
      'gregale edge rule review',
      '"requests_per_second": 0.1, "burst": 5, "key_by": "composite",',
      '"key_fields": ["ip", "header:x-username"], "count_statuses": [401]',
      'a throttle rule can only tighten',
    ]) {
      expect(text, phrase).toContain(phrase);
      expect(edge, phrase).toContain(phrase);
    }

    const limits = [
      row(raw, '`throttle` rules per app'),
      row(raw, 'Throttle rate, requests per second'),
      row(raw, 'Throttle burst'),
      row(raw, 'Throttle buckets per rule'),
    ];
    const plans = ['Free', 'Hobby', 'Pro', 'Scale'];
    const articleRaw = bodies[`../../content/articles/${RATE_LIMIT}.md`];
    plans.forEach((plan, index) => {
      const cells = row(articleRaw, plan).map((cell) => cell.replaceAll(',', ''));
      // Plan, Monthly, then the four limits in the docs' order.
      expect(cells.slice(1), plan).toEqual(limits.map((limit) => limit[index]));
    });
  });
});
