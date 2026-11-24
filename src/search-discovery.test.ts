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
