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

it('submits changed live articles and leaves research alone', () => {
  const code = `
    const paths = ['/research', '/research/first', '/articles', '/articles/one', '/articles/two'];
    process.stdout.write(JSON.stringify([
      script.changedPaths(['content/articles/one.md', 'content/articles/gone.md'], paths),
      script.changedPaths(['src/lib/articles.ts'], paths),
      script.changedPaths(['scripts/prerender.mjs'], paths),
    ]));
  `;
  expect(JSON.parse(runScript('submit-research-indexnow.mjs', code, fixture))).toEqual([
    ['/articles/one'],
    ['/articles', '/articles/one', '/articles/two'],
    ['/research', '/research/first', '/articles', '/articles/one', '/articles/two'],
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
    '/research',
    '/research/one',
    '/articles',
    '/articles/one',
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
