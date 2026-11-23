import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AGENT_CORE_SLUGS,
  LLMS_SMALL_MAX_BYTES,
  absoluteLinks,
  llmsFull,
  llmsIndex,
  llmsSmall,
  markdownPage,
  markdownUrl,
  renderIntro,
} from './agent-docs';
import { DOC_ENTRIES, findDoc } from './docs-manifest';
import {
  PLATFORM_AVAILABILITY,
  INSTALL_COMMAND,
  RESTORE_CONTEXT,
  RESTORE_TARGET,
} from './platform-claims';

const SITE = 'https://gregale.dev';

describe('absoluteLinks', () => {
  const rewrite = (markdown: string) => absoluteLinks(markdown, 'docs/agents.md', SITE);

  it('points a published page at its Markdown copy', () => {
    expect(rewrite('See [domains](domains.md#verify).')).toBe(
      'See [domains](https://gregale.dev/docs/custom-domains.md#verify).'
    );
  });

  it('sends an unpublished page to GitHub', () => {
    expect(rewrite('See [config](cli-config.md).')).toBe(
      'See [config](https://github.com/poyrazK/faas/blob/main/docs/cli-config.md).'
    );
  });

  it('makes site paths absolute, using the Markdown copy for a published page', () => {
    expect(rewrite('[plans](/docs/plans) and [status](/status)')).toBe(
      '[plans](https://gregale.dev/docs/plans.md) and [status](https://gregale.dev/status)'
    );
  });

  it('rewrites reference definitions and keeps link titles', () => {
    expect(rewrite('[d]: domains.md\n[x](domains.md "Domains")')).toBe(
      '[d]: https://gregale.dev/docs/custom-domains.md\n' +
        '[x](https://gregale.dev/docs/custom-domains.md "Domains")'
    );
  });

  it('leaves external links, anchors, and code exactly as written', () => {
    const untouched = [
      '[site](https://example.com/a.md) [top](#install)',
      '`[not](a-link.md)`',
      '```md\n[inside](domains.md)\n```',
      '````\n```\n[still inside](domains.md)\n```\n````',
    ].join('\n');
    expect(rewrite(untouched)).toBe(untouched);
  });
});

describe('markdownPage', () => {
  it('replaces the source title with the manifest title and summary', () => {
    const entry = findDoc('custom-domains')!;
    const page = markdownPage(entry, '# Domains\r\n\r\nAttach [a domain](deploys.md).\r\n', SITE);
    expect(page).toBe(
      [
        `# ${entry.title}`,
        `> ${entry.summary}`,
        'Attach [a domain](https://gregale.dev/docs/deploy-from-github.md).',
        'Source: https://gregale.dev/docs/custom-domains',
      ].join('\n\n') + '\n'
    );
  });
});

describe('llmsIndex', () => {
  const index = llmsIndex('# Gregale\n\n> Summary.\n', SITE);

  it('starts with the intro and points agents at their guide', () => {
    expect(index.startsWith('# Gregale\n\n> Summary.\n\nCoding agents: start with')).toBe(true);
    expect(index).toContain(`(${markdownUrl(SITE, 'agents')})`);
  });

  it('names the small and full bundles', () => {
    expect(index).toContain(`[llms-small.txt](${SITE}/llms-small.txt)`);
    expect(index).toContain(`[llms-full.txt](${SITE}/llms-full.txt)`);
  });

  it('links every published page exactly once, as Markdown', () => {
    for (const entry of DOC_ENTRIES) {
      const link = `](${markdownUrl(SITE, entry.slug)}): `;
      expect(index.split(link).length - 1, entry.slug).toBe(1);
    }
  });

  it('ends with the trust pages under Optional', () => {
    const optional = index.slice(index.indexOf('\n## Optional\n'));
    expect(index.lastIndexOf('\n## ')).toBe(index.indexOf('\n## Optional\n'));
    expect(optional).toContain(markdownUrl(SITE, 'dpa'));
    expect(index).not.toContain('## Trust');
  });
});

describe('llmsFull', () => {
  it('joins the intro and pages with blank lines', () => {
    expect(llmsFull('# Gregale\n', ['# A\n\nbody\n', '# B\n'])).toBe(
      '# Gregale\n\n# A\n\nbody\n\n# B\n'
    );
  });
});

describe('llmsSmall', () => {
  const pages = new Map(AGENT_CORE_SLUGS.map((slug) => [slug as string, `# ${slug}\n`]));

  it('is the intro and the core pages in reading order', () => {
    expect(llmsSmall('# Gregale\n', pages)).toBe(
      ['# Gregale', ...AGENT_CORE_SLUGS.map((slug) => `# ${slug}`)].join('\n\n') + '\n'
    );
  });

  it('fails the build when a core page is not published', () => {
    const missing = new Map(pages);
    missing.delete('errors');
    expect(() => llmsSmall('# Gregale\n', missing)).toThrow(/core page errors/);
  });

  it('names only published pages and stays small enough to read at once', () => {
    const real = new Map<string, string>();
    for (const slug of AGENT_CORE_SLUGS) {
      const entry = findDoc(slug);
      expect(entry, slug).toBeDefined();
      real.set(
        slug,
        markdownPage(entry!, readFileSync(resolve('content/docs', `${slug}.md`), 'utf8'), SITE)
      );
    }
    const intro = readFileSync(resolve('content/llms-intro.md'), 'utf8');
    const bytes = Buffer.byteLength(llmsSmall(intro, real));
    expect(bytes).toBeLessThanOrEqual(LLMS_SMALL_MAX_BYTES);
  });
});

describe('renderIntro', () => {
  it('fills each claim from its one home', () => {
    expect(
      renderIntro('A ({{RESTORE_TARGET}}). {{RESTORE_CONTEXT}} {{PLATFORM_AVAILABILITY}}\n')
    ).toBe(`A (${RESTORE_TARGET}). ${RESTORE_CONTEXT} ${PLATFORM_AVAILABILITY}`);
  });

  it('refuses a placeholder it does not know rather than shipping braces', () => {
    expect(() => renderIntro('{{FASTEST_COLD_START}}')).toThrow(/unknown placeholder/);
  });

  it('renders the real intro with every claim filled', () => {
    const intro = renderIntro(readFileSync(resolve('content/llms-intro.md'), 'utf8'));
    expect(intro).not.toContain('{{');
    expect(intro).toContain(RESTORE_TARGET);
    expect(intro).toContain(INSTALL_COMMAND);
    expect(llmsIndex(readFileSync(resolve('content/llms-intro.md'), 'utf8'), SITE)).toContain(
      RESTORE_TARGET
    );
  });
});
