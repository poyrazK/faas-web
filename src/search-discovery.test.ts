import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, expect, it } from 'vitest';

let fixture: string;

beforeEach(() => {
  fixture = mkdtempSync(join(tmpdir(), 'gregale-discovery-'));
});

afterEach(() => {
  rmSync(fixture, { recursive: true, force: true });
});

function runScript(file: string, code: string, cwd: string) {
  const url = pathToFileURL(resolve('scripts', file)).href;
  return execFileSync(
    process.execPath,
    ['--input-type=module', '--eval', `import * as script from ${JSON.stringify(url)};\n${code}`],
    { cwd, env: { ...process.env, VERCEL_ENV: 'preview' }, encoding: 'utf8', stdio: 'pipe' }
  );
}

it('dates guides from Git and omits dates beyond a shallow checkout boundary', () => {
  const source = join(fixture, 'source');
  const shallow = join(fixture, 'shallow');
  const docs = join(source, 'content', 'docs');
  mkdirSync(docs, { recursive: true });

  function git(...args: string[]) {
    execFileSync('git', args, { cwd: source, stdio: 'pipe' });
  }

  function commit(date: string) {
    git('add', '.');
    execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-m', date], {
      cwd: source,
      env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
      stdio: 'pipe',
    });
  }

  git('init', '--initial-branch=main');
  git('config', 'user.name', 'Sitemap fixture');
  git('config', 'user.email', 'sitemap@example.test');
  writeFileSync(join(docs, 'older.md'), 'Older guide');
  commit('2026-01-01T12:00:00Z');
  writeFileSync(join(docs, 'recent.md'), 'Initial guide');
  commit('2026-01-02T12:00:00Z');
  writeFileSync(join(docs, 'recent.md'), 'Updated guide');
  commit('2026-01-03T12:00:00Z');
  git('clone', '--depth=2', pathToFileURL(source).href, shallow);

  const code =
    "process.stdout.write(script.sitemapXml('https://example.test', ['/docs/older', '/docs/recent']));";
  const fullXml = runScript('sitemap.mjs', code, source);
  const shallowXml = runScript('sitemap.mjs', code, shallow);
  const recentDate =
    '<loc>https://example.test/docs/recent</loc>\n    <lastmod>2026-01-03</lastmod>';
  expect(fullXml).toContain(
    '<loc>https://example.test/docs/older</loc>\n    <lastmod>2026-01-01</lastmod>'
  );
  expect(fullXml).toContain(recentDate);
  expect(shallowXml).toContain('<loc>https://example.test/docs/older</loc>\n  </url>');
  expect(shallowXml).toContain(recentDate);

  // Routes outside the docs: a stated date, or the date of the docs page they render.
  const datedCode = `process.stdout.write(script.sitemapXml('https://example.test',
    ['/articles/one', '/pricing', '/docs/recent', '/status'], {
      dates: new Map([['/articles/one', '2026-11-25'], ['/docs/recent', '2020-01-01']]),
      datedLike: { '/pricing': '/docs/recent' },
    }));`;
  const datedXml = runScript('sitemap.mjs', datedCode, source);
  expect(datedXml).toContain(
    '<loc>https://example.test/articles/one</loc>\n    <lastmod>2026-11-25</lastmod>'
  );
  expect(datedXml).toContain(
    '<loc>https://example.test/pricing</loc>\n    <lastmod>2026-01-03</lastmod>'
  );
  // A docs date from Git wins over a stated one.
  expect(datedXml).toContain(recentDate);
  expect(datedXml).toContain('<loc>https://example.test/status</loc>\n  </url>');
});

it('writes an Atom feed newest first, with escaped text and registry dates', () => {
  const code = `process.stdout.write(script.atomFeed({
    siteUrl: 'https://example.test',
    path: '/feed.xml',
    title: 'Articles & research',
    entries: [
      { route: '/articles/old', title: 'Old', summary: 'A < B', published: '2026-11-01', updated: '2026-11-01' },
      { route: '/research/new', title: 'New "one"', summary: 'Fresh', published: '2026-11-20', updated: '2026-11-24' },
    ],
  }));`;
  const feed = runScript('feed.mjs', code, fixture);
  expect(feed).toContain('<title>Articles &amp; research</title>');
  expect(feed).toContain('<id>https://example.test/feed.xml</id>');
  expect(feed).toContain('<updated>2026-11-24T00:00:00Z</updated>');
  expect(feed.indexOf('/research/new')).toBeLessThan(feed.indexOf('/articles/old'));
  expect(feed).toContain('<summary>A &lt; B</summary>');
  expect(feed).toContain('<title>New &quot;one&quot;</title>');
  expect(feed).toContain('<published>2026-11-20T00:00:00Z</published>');
  expect(() =>
    runScript(
      'feed.mjs',
      `script.atomFeed({ siteUrl: 'x', path: '/f', title: 't', entries: [
        { route: '/a', title: 'a', summary: 's', published: 'soon', updated: '2026-11-01' }] });`,
      fixture
    )
  ).toThrow(/bad date soon/);
});

it('submits the home and pricing pages when their sources change', () => {
  const code = `
    const paths = ['/', '/pricing', '/research', '/vs/heroku', '/docs/plans'];
    process.stdout.write(JSON.stringify([
      script.changedPaths(['content/docs/plans.md'], paths),
      script.changedPaths(['src/routes/pricing.tsx'], paths),
      script.changedPaths(['src/components/landing/hero.tsx'], paths),
      script.changedPaths(['src/lib/faq.ts'], paths),
      script.changedPaths(['content/docs/billing.md'], paths),
    ]));
  `;
  expect(JSON.parse(runScript('submit-research-indexnow.mjs', code, fixture))).toEqual([
    ['/pricing', '/vs/heroku', '/docs/plans'],
    ['/pricing'],
    ['/'],
    ['/', '/pricing'],
    [],
  ]);
});

it('rejects an IndexNow ownership file that would overwrite a site asset', () => {
  const asset = join(fixture, 'llms-full.txt');
  writeFileSync(asset, 'Agent documentation');
  expect(() =>
    runScript('indexnow-key.mjs', "script.writeIndexNowKey('.', 'llms-full');", fixture)
  ).toThrow('EEXIST');
  expect(readFileSync(asset, 'utf8')).toBe('Agent documentation');
  runScript('indexnow-key.mjs', "script.writeIndexNowKey('.', 'abcd1234');", fixture);
  expect(readFileSync(join(fixture, 'abcd1234.txt'), 'utf8')).toBe('abcd1234\n');
});

it('submits changed live research reports after report or artifact edits', () => {
  const code = `
    const paths = ['/research', '/research/first', '/research/second'];
    const changed = script.changedPaths([
      'content/research/first.md',
      'public/research/first/sample.json',
      'content/research/removed.md',
      'content/docs/billing.md',
    ], paths);
    process.stdout.write(JSON.stringify(changed));
  `;
  expect(JSON.parse(runScript('submit-research-indexnow.mjs', code, fixture))).toEqual([
    '/research/first',
  ]);
});

it('includes the research index when the research registry changes', () => {
  const code = `
    const paths = ['/research', '/research/first'];
    process.stdout.write(JSON.stringify([
      script.changedPaths(['src/lib/research.ts'], paths),
      script.changedPaths(['src/routes/pricing.tsx'], paths),
    ]));
  `;
  expect(JSON.parse(runScript('submit-research-indexnow.mjs', code, fixture))).toEqual([
    ['/research', '/research/first'],
    [],
  ]);
});

it('submits changed live articles and features independently', () => {
  const code = `
    const paths = ['/research', '/research/first', '/articles', '/articles/one', '/articles/two', '/features', '/features/database-rollbacks'];
    process.stdout.write(JSON.stringify([
      script.changedPaths(['content/articles/one.md', 'content/articles/gone.md'], paths),
      script.changedPaths(['src/lib/articles.ts'], paths),
      script.changedPaths(['src/lib/features.ts'], paths),
      script.changedPaths(['scripts/prerender.mjs'], paths),
    ]));
  `;
  expect(JSON.parse(runScript('submit-research-indexnow.mjs', code, fixture))).toEqual([
    ['/articles/one'],
    ['/articles', '/articles/one', '/articles/two'],
    ['/features', '/features/database-rollbacks'],
    [
      '/research',
      '/research/first',
      '/articles',
      '/articles/one',
      '/articles/two',
      '/features',
      '/features/database-rollbacks',
    ],
  ]);
});

it('submits changed docs and comparison pages', () => {
  const code = `
    const paths = ['/research', '/vs/heroku', '/vs/fly', '/docs', '/docs/billing', '/docs/plans', '/docs/api/apps'];
    process.stdout.write(JSON.stringify([
      script.changedPaths(['content/docs/billing.md', 'content/docs/removed.md'], paths),
      script.changedPaths(['content/docs/plans.md'], paths),
      script.changedPaths(['src/lib/compare.ts'], paths),
      script.changedPaths(['src/lib/docs-manifest.ts'], paths),
      script.changedPaths(['api/openapi.yaml'], paths),
      script.changedPaths(['src/components/landing/hero.tsx'], paths),
    ]));
  `;
  expect(JSON.parse(runScript('submit-research-indexnow.mjs', code, fixture))).toEqual([
    ['/docs/billing'],
    ['/vs/heroku', '/vs/fly', '/docs/plans'],
    ['/vs/heroku', '/vs/fly'],
    ['/docs'],
    ['/docs/api/apps'],
    [],
  ]);
});

it('hashes what a search engine indexes, not the page template', () => {
  const code = `
    const page = (title, main, chrome = 'nav') =>
      '<html><head><title>' + title + '</title><meta name="description" content="Summary">' +
      '</head><body><header>' + chrome + '</header><main><h1>' + main + '</h1></main>' +
      '<footer>' + chrome + '</footer></body></html>';
    const base = script.contentHash(page('Title', 'Body'));
    const ld = '<script type="application/ld+json">{}</script></head>';
    process.stdout.write(JSON.stringify([
      /^[a-f0-9]{16}$/.test(base),
      base === script.contentHash(page('Title', 'Body', 'new footer links').replace('</head>', ld)),
      base === script.contentHash(page('Title', 'Body changed')),
      base === script.contentHash(page('New title', 'Body')),
      base === script.contentHash(page('Title', 'Body').replace('Summary', 'New summary')),
    ]));
  `;
  expect(JSON.parse(runScript('indexnow-content.mjs', code, fixture))).toEqual([
    true,
    true,
    false,
    false,
    false,
  ]);
});

it('submits only pages whose content is new or changed since the last release', () => {
  const code = `
    const before = { '/': 'aaaaaaaaaaaaaaaa', '/articles/one': 'bbbbbbbbbbbbbbbb', '/articles/gone': 'cccccccccccccccc' };
    const now = { '/': 'aaaaaaaaaaaaaaaa', '/articles/one': 'dddddddddddddddd', '/articles/new': 'eeeeeeeeeeeeeeee' };
    process.stdout.write(JSON.stringify([
      script.contentChangedPaths(before, now, ['/', '/articles/one', '/articles/new', '/docs/unhashed']),
      script.contentHashes(now, ['/', '/articles/one', '/articles/new']) !== undefined,
      script.contentHashes({ '/': 'not-a-hash' }) === undefined,
      script.contentHashes(now, ['/']) === undefined,
    ]));
  `;
  expect(JSON.parse(runScript('indexnow-content.mjs', code, fixture))).toEqual([
    ['/articles/one', '/articles/new', '/docs/unhashed'],
    true,
    true,
    true,
  ]);
});

it('accepts every path the release file can submit', () => {
  // The release job hands its paths to submit-indexnow.mjs. A path that script
  // refuses fails the whole submission, as /articles once did.
  function submit(path: string) {
    try {
      execFileSync(process.execPath, [resolve('scripts', 'submit-indexnow.mjs'), path], {
        cwd: fixture,
        env: { ...process.env, INDEXNOW_KEY: '' },
        encoding: 'utf8',
        stdio: 'pipe',
      });
      return '';
    } catch (error) {
      return String((error as { stderr?: string }).stderr);
    }
  }
  for (const path of [
    '/',
    '/pricing',
    '/research',
    '/research/one',
    '/articles',
    '/articles/one',
    '/features',
    '/features/database-rollbacks',
    '/vs/railway',
    '/docs',
    '/docs/rollouts',
    '/docs/api/apps',
  ]) {
    // Past the path check, it stops at the missing key instead.
    expect(submit(path)).toContain('INDEXNOW_KEY must contain');
  }
  expect(submit('/dashboard')).toContain('Pass changed public paths');
});
