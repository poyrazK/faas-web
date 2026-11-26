import {
  DOC_SECTIONS,
  DOCS_DESCRIPTION,
  findDoc,
  type DocEntry,
  type DocSection,
} from './docs-manifest.ts';
import { resolveDocHref } from './docs-links.ts';
import { ARTICLES, ARTICLES_DESCRIPTION, ARTICLES_TITLE, withRelatedArticles } from './articles.ts';
import {
  FASTAPI_COST_SLUG,
  RESEARCH_DESCRIPTION,
  RESEARCH_PUBLICATIONS,
  RESEARCH_TITLE,
  withRelatedResearch,
} from './research.ts';
import { FEATURES, FEATURES_DESCRIPTION, FEATURES_TITLE } from './features.ts';
import { SOLUTIONS, SOLUTIONS_DESCRIPTION, SOLUTIONS_TITLE } from './solutions.ts';
import {
  PUBLIC_TEMPLATES,
  TEMPLATE_CATEGORIES,
  TEMPLATES_DESCRIPTION,
  TEMPLATES_TITLE,
} from './public-templates.ts';
import type { Comparison } from './compare.ts';
import type { FaqEntry } from './faq.ts';
import { formatCatalogPrice, type CatalogPlan } from './plan-catalog-parser.ts';
import {
  PLATFORM_AVAILABILITY,
  INSTALL_COMMAND,
  RESTORE_CONTEXT,
  RESTORE_TARGET,
} from './platform-claims.ts';

/**
 * Documentation for coding agents, written by `scripts/prerender.mjs`:
 *
 * - `/llms.txt` — the llmstxt.org index: the hand-written intro in
 *   `content/llms-intro.md`, then every page in manifest order.
 * - `/llms-full.txt` — the intro and every page in one file.
 * - `/llms-small.txt` — the intro and the pages an agent needs to deploy and
 *   debug an app (`AGENT_CORE_SLUGS`), small enough for one context window.
 * - `/docs/<slug>.md` — each page as Markdown.
 * - `/vs/<slug>.md` — each comparison page as Markdown, from the same
 *   module the page renders (`comparisonPage`).
 * - `/index.md`, `/pricing.md`, `/docs.md`, `/articles.md`, `/research.md` —
 *   the home, pricing and index pages, served to a request for `/`, `/pricing`
 *   and so on that asks for `Accept: text/markdown` (see `vercel.json`).
 *
 * Generated from the manifest for the same reason as the sitemap: adding a
 * page to the table of contents cannot leave it out of what agents read. The
 * curation is the manifest's too — nothing unpublished reaches these files.
 *
 * Imported by plain Node at build time, so imports use explicit `.ts`
 * extensions and nothing here touches `import.meta.glob`.
 */

/** Background reading. llms.txt calls this section "Optional": agents may skip it. */
const OPTIONAL_SECTION = 'Trust';

const AGENTS_SLUG = 'agents';

/**
 * The pages in `/llms-small.txt`, in reading order: install, deploy, configure,
 * debug, limits. llms-full.txt is over 1 MB, more than most agents can read
 * at once; this subset stays under `LLMS_SMALL_MAX_BYTES` (a test holds it
 * there), so an agent that reads one file still gets the deploy path.
 */
export const AGENT_CORE_SLUGS = [
  'agents',
  'install',
  'getting-started',
  'quickstart',
  'deploy-overrides',
  'build',
  'env',
  'logs',
  'errors',
  'plans',
] as const;

/** About 32k tokens at four bytes a token. */
export const LLMS_SMALL_MAX_BYTES = 128_000;

export const markdownUrl = (siteUrl: string, slug: string): string => `${siteUrl}/docs/${slug}.md`;

/** One docs page as Markdown, with the manifest's title and summary. */
export function markdownPage(entry: DocEntry, source: string, siteUrl: string): string {
  const body = withRelatedArticles(
    entry.slug,
    withRelatedResearch(entry.slug, source.replace(/\r\n/g, '\n').replace(/^#\s+.+?\n+/, ''))
  );
  return (
    [
      `# ${entry.title}`,
      `> ${entry.summary}`,
      absoluteLinks(body, entry.source, siteUrl).trim(),
      `Source: ${siteUrl}/docs/${entry.slug}`,
    ].join('\n\n') + '\n'
  );
}

/**
 * Claims the intro may carry, by placeholder. The intro is hand-written prose,
 * but a figure in it is still public copy: `platform-claims.ts` stays its one
 * home, and the intro names it as `{{RESTORE_TARGET}}` rather than retyping
 * it. An unknown placeholder fails the build instead of shipping braces.
 */
const INTRO_CLAIMS: Record<string, string> = {
  PLATFORM_AVAILABILITY,
  INSTALL_COMMAND,
  RESTORE_CONTEXT,
  RESTORE_TARGET,
};

export function renderIntro(intro: string): string {
  return intro.trim().replace(/\{\{([A-Z_]+)\}\}/g, (match, name: string) => {
    const claim = INTRO_CLAIMS[name];
    if (claim === undefined) throw new Error(`llms intro: unknown placeholder ${match}`);
    return claim;
  });
}

export const COMPARISONS_TITLE = 'Comparisons';

export const comparisonTitle = (comparison: Pick<Comparison, 'competitor'>): string =>
  `Gregale vs ${comparison.competitor}`;

/** A table cell: one line, with pipes escaped. */
const cell = (text: string): string => text.replace(/\s+/g, ' ').replaceAll('|', '\\|').trim();

/**
 * One comparison page as Markdown: the table, where each side fits, the
 * questions and the sources, from the same `Comparison` the page renders, so
 * an agent reads exactly the facts a person sees.
 */
export function comparisonPage(comparison: Comparison, checkedOn: string, siteUrl: string): string {
  const them = comparison.competitor;
  const table = [
    `| | Gregale | ${cell(them)} |`,
    '|---|---|---|',
    ...comparison.rows.map(
      (row) => `| ${cell(row.topic)} | ${cell(row.gregale)} | ${cell(row.them)} |`
    ),
  ].join('\n');
  const list = (items: readonly string[]) => items.map((item) => `- ${item}`).join('\n');
  const faq = comparison.faq.map((item) => `### ${item.question}\n\n${item.answer}`).join('\n\n');
  const sources = comparison.sources.map((source) => `- [${source.label}](${source.url})`);
  return (
    [
      `# ${comparisonTitle(comparison)}`,
      `Gregale · Checked ${checkedOn}`,
      comparison.summary,
      table,
      `## When ${them} fits\n\n${list(comparison.theyFit)}`,
      `## When Gregale fits\n\n${list(comparison.gregaleFits)}`,
      `## Moving over\n\n[${comparison.migrateLabel}](${markdownUrl(siteUrl, comparison.migrateDoc)})`,
      `## Questions\n\n${faq}`,
      `## Sources\n\n${sources.join('\n')}`,
      `Canonical URL: ${siteUrl}/vs/${comparison.slug}`,
    ].join('\n\n') + '\n'
  );
}

export function llmsIndex(
  intro: string,
  siteUrl: string,
  comparisons: readonly Pick<Comparison, 'slug' | 'competitor' | 'summary'>[] = []
): string {
  const parts = [renderIntro(intro)];
  if (findDoc(AGENTS_SLUG)) {
    parts.push(
      `Coding agents: start with [Use Gregale from coding agents](${markdownUrl(siteUrl, AGENTS_SLUG)}). ` +
        `[llms-small.txt](${siteUrl}/llms-small.txt) holds the pages needed to deploy and debug an app in one file; ` +
        `[llms-full.txt](${siteUrl}/llms-full.txt) holds every page below, over 1 MB.`
    );
  }
  const features = FEATURES.map(
    (entry) => `- [${entry.title}](${siteUrl}/features/${entry.slug}.md): ${entry.summary}`
  );
  parts.push(`## ${FEATURES_TITLE}\n\n${features.join('\n')}`);
  const solutions = SOLUTIONS.map(
    (entry) => `- [${entry.title}](${siteUrl}/solutions/${entry.slug}.md): ${entry.summary}`
  );
  parts.push(`## ${SOLUTIONS_TITLE}\n\n${solutions.join('\n')}`);
  const templates = PUBLIC_TEMPLATES.map(
    (entry) => `- [${entry.title}](${entry.repoUrl}) (${entry.runtime}): ${entry.summary}`
  );
  parts.push(
    `## ${TEMPLATES_TITLE}\n\n- [All templates & starters](${siteUrl}/templates.md): ${TEMPLATES_DESCRIPTION}\n${templates.join('\n')}`
  );
  const research = RESEARCH_PUBLICATIONS.map(
    (entry) => `- [${entry.title}](${siteUrl}/research/${entry.slug}.md): ${entry.summary}`
  );
  parts.push(`## ${RESEARCH_TITLE}\n\n${research.join('\n')}`);
  const articles = ARTICLES.map(
    (entry) => `- [${entry.title}](${siteUrl}/articles/${entry.slug}.md): ${entry.summary}`
  );
  parts.push(`## ${ARTICLES_TITLE}\n\n${articles.join('\n')}`);
  if (comparisons.length) {
    const links = comparisons.map(
      (entry) => `- [${comparisonTitle(entry)}](${siteUrl}/vs/${entry.slug}.md): ${entry.summary}`
    );
    parts.push(`## ${COMPARISONS_TITLE}\n\n${links.join('\n')}`);
  }
  const sections = [
    ...DOC_SECTIONS.filter((section) => section.title !== OPTIONAL_SECTION),
    ...DOC_SECTIONS.filter((section) => section.title === OPTIONAL_SECTION),
  ];
  for (const section of sections) {
    const heading = section.title === OPTIONAL_SECTION ? 'Optional' : section.title;
    parts.push(`## ${heading}\n\n${docLinks(section, siteUrl)}`);
  }
  return parts.join('\n\n') + '\n';
}

/** A docs section's pages as a Markdown list of their Markdown copies. */
function docLinks(section: DocSection, siteUrl: string): string {
  return section.entries
    .map((entry) => `- [${entry.title}](${markdownUrl(siteUrl, entry.slug)}): ${entry.summary}`)
    .join('\n');
}

const questions = (faq: readonly FaqEntry[]): string =>
  `## Questions\n\n${faq.map((item) => `### ${item.question}\n\n${item.answer}`).join('\n\n')}`;

const page = (parts: string[]): string => parts.join('\n\n') + '\n';

/**
 * The home page for an agent that asks for Markdown: the llms.txt intro, where
 * to read next, and the landing page's questions.
 */
export function homePage(intro: string, faq: readonly FaqEntry[], siteUrl: string): string {
  const next = [
    `- [${FEATURES_TITLE}](${siteUrl}/features.md): ${FEATURES_DESCRIPTION}`,
    `- [${TEMPLATES_TITLE}](${siteUrl}/templates.md): ${TEMPLATES_DESCRIPTION}`,
    `- [Pricing](${siteUrl}/pricing.md): plans, included compute and pricing questions`,
    `- [Documentation](${siteUrl}/docs.md): every guide, by section`,
    `- [${SOLUTIONS_TITLE}](${siteUrl}/solutions.md): ${SOLUTIONS_DESCRIPTION}`,
    `- [${ARTICLES_TITLE}](${siteUrl}/articles.md): ${ARTICLES_DESCRIPTION}`,
    `- [${RESEARCH_TITLE}](${siteUrl}/research.md): ${RESEARCH_DESCRIPTION}`,
    `- [llms.txt](${siteUrl}/llms.txt): every page on this site, as Markdown links`,
  ];
  return page([
    renderIntro(intro),
    `## Where to read next\n\n${next.join('\n')}`,
    questions(faq),
    `Canonical URL: ${siteUrl}/`,
  ]);
}

interface PricingCatalog {
  currency: string;
  plans: CatalogPlan[];
}

/**
 * The pricing page as Markdown: the plan table and questions, from the same
 * generated catalog the page renders, so an agent quotes the prices a person sees.
 */
export function pricingPage(
  catalog: PricingCatalog,
  description: string,
  faq: readonly FaqEntry[],
  siteUrl: string
): string {
  const price = (amount: number) => formatCatalogPrice(amount, catalog.currency);
  const table = [
    '| Plan | Monthly | Deployed apps | PR preview environments | Developer apps | Concurrent instances | RAM / app | Included GB-RAM-hours | App egress / month | App layer | Idle timeout | Max request timeout |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...catalog.plans.map((plan) =>
      [
        '',
        plan.name,
        price(plan.monthly),
        plan.deployedApps,
        plan.previewEnvironments,
        plan.developerApps,
        plan.concurrentInstances,
        `${plan.ramMb} MB`,
        plan.includedGbHours,
        `${plan.appEgressGib.toLocaleString('en-US')} GiB`,
        `${plan.appLayerMb} MB`,
        plan.idleTimeout,
        plan.maxRequestTimeout,
        '',
      ]
        .join(' | ')
        .trim()
    ),
  ].join('\n');
  return page([
    '# Gregale pricing',
    `> ${description}`,
    table,
    `Every limit, plan by plan: [Plans and limits](${markdownUrl(siteUrl, 'plans')}). ` +
      `The same plans as JSON: [pricing.json](${siteUrl}/pricing.json). ` +
      `Measured compute use and monthly estimates: [intermittent FastAPI cost study](${siteUrl}/research/${FASTAPI_COST_SLUG}.md).`,
    questions(faq),
    `Canonical URL: ${siteUrl}/pricing`,
  ]);
}

/** The docs index as Markdown: every section, with links to each page's Markdown copy. */
export function docsIndexPage(siteUrl: string): string {
  return page([
    '# Documentation',
    `> ${DOCS_DESCRIPTION}`,
    ...DOC_SECTIONS.map(
      (section) => `## ${section.title}\n\n${section.blurb}\n\n${docLinks(section, siteUrl)}`
    ),
    `Canonical URL: ${siteUrl}/docs`,
  ]);
}

/** The articles index as Markdown. */
export function articlesIndexPage(siteUrl: string): string {
  return page([
    `# ${ARTICLES_TITLE}`,
    `> ${ARTICLES_DESCRIPTION}`,
    ARTICLES.map(
      (entry) =>
        `- [${entry.title}](${siteUrl}/articles/${entry.slug}.md) · Updated ${entry.updatedOn}: ${entry.summary}`
    ).join('\n'),
    `Canonical URL: ${siteUrl}/articles`,
  ]);
}

/** The features index as Markdown. */
export function featuresIndexPage(siteUrl: string): string {
  return page([
    `# ${FEATURES_TITLE}`,
    `> ${FEATURES_DESCRIPTION}`,
    FEATURES.map(
      (entry) =>
        `- [${entry.title}](${siteUrl}/features/${entry.slug}.md) · ${entry.maturity} · ${entry.plans}: ${entry.summary}`
    ).join('\n'),
    `Canonical URL: ${siteUrl}/features`,
  ]);
}

/** The solutions index as Markdown. */
export function solutionsIndexPage(siteUrl: string): string {
  return page([
    `# ${SOLUTIONS_TITLE}`,
    `> ${SOLUTIONS_DESCRIPTION}`,
    SOLUTIONS.map(
      (entry) =>
        `- [${entry.title}](${siteUrl}/solutions/${entry.slug}.md) · Updated ${entry.updatedOn}: ${entry.summary}`
    ).join('\n'),
    `Canonical URL: ${siteUrl}/solutions`,
  ]);
}

/** The templates index as Markdown. */
export function templatesIndexPage(siteUrl: string): string {
  const sections = TEMPLATE_CATEGORIES.map((category) => {
    const rows = PUBLIC_TEMPLATES.filter((entry) => entry.category === category).map(
      (entry) =>
        `- [${entry.title}](${entry.repoUrl}) (${entry.runtime}): ${entry.summary} (\`${entry.command}\`)`
    );
    return `## ${category}\n\n${rows.join('\n')}`;
  });
  return page([
    `# ${TEMPLATES_TITLE}`,
    `> ${TEMPLATES_DESCRIPTION}`,
    ...sections,
    `Canonical URL: ${siteUrl}/templates`,
  ]);
}

/** The research index as Markdown. */
export function researchIndexPage(siteUrl: string): string {
  return page([
    `# ${RESEARCH_TITLE}`,
    `> ${RESEARCH_DESCRIPTION}`,
    RESEARCH_PUBLICATIONS.map(
      (entry) =>
        `- [${entry.title}](${siteUrl}/research/${entry.slug}.md) · Published ${entry.publishedOn}: ${entry.summary}`
    ).join('\n'),
    `Canonical URL: ${siteUrl}/research`,
  ]);
}

export function llmsFull(intro: string, pages: string[]): string {
  return [renderIntro(intro), ...pages.map((page) => page.trim())].join('\n\n') + '\n';
}

/**
 * The intro and the `AGENT_CORE_SLUGS` pages, from the same Markdown copies
 * llms-full.txt uses. A core slug the manifest no longer publishes fails the
 * build rather than shipping a smaller file without saying so.
 */
export function llmsSmall(intro: string, pagesBySlug: ReadonlyMap<string, string>): string {
  const pages = AGENT_CORE_SLUGS.map((slug) => {
    const page = pagesBySlug.get(slug);
    if (page === undefined) throw new Error(`llms-small: core page ${slug} is not published`);
    return page;
  });
  return llmsFull(intro, pages);
}

/**
 * Makes every link in `markdown` work outside the site: published pages point
 * at their Markdown copy, unpublished ones at GitHub, root-relative paths at
 * the site. Fenced code and inline code spans are left exactly as written.
 */
export function absoluteLinks(markdown: string, sourcePath: string, siteUrl: string): string {
  const target = (href: string): string => {
    const resolved = resolveDocHref(href, sourcePath, (slug) => markdownUrl(siteUrl, slug));
    const route = /^\/docs\/([^/#?]+)(.*)$/.exec(resolved);
    if (route && findDoc(route[1])) return markdownUrl(siteUrl, route[1]) + route[2];
    return resolved.startsWith('/') && !resolved.startsWith('//') ? siteUrl + resolved : resolved;
  };

  let fence: string | undefined;
  return markdown
    .split('\n')
    .map((line) => {
      const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
      if (marker && !fence) {
        fence = marker;
        return line;
      }
      if (fence) {
        if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
        return line;
      }

      const definition = /^(\s*\[[^\]]+\]:\s*)(\S+)(.*)$/.exec(line);
      if (definition) return definition[1] + target(definition[2]) + definition[3];

      return line
        .split(/(`+[^`]*`+)/)
        .map((part) =>
          part.startsWith('`')
            ? part
            : part.replace(
                /\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g,
                (_, href: string, title: string) => `](${target(href)}${title})`
              )
        )
        .join('');
    })
    .join('\n');
}
