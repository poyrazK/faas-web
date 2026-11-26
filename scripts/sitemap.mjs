import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

function git(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30_000,
  }).trim();
}

export function docsLastModified() {
  const dates = new Map();
  try {
    const shallowFile = git(['rev-parse', '--git-path', 'shallow']);
    if (process.env.VERCEL_ENV === 'production' && existsSync(shallowFile)) {
      // Vercel clones ten levels. Fetch the remaining history for stable dates
      // across production deploys, with a fallback if the remote is unavailable.
      try {
        git(['fetch', '--unshallow', '--no-tags', '--filter=blob:none', 'origin', 'main']);
      } catch {
        console.warn('  sitemap: full Git history unavailable; using locally verifiable dates');
      }
    }
    const shallowCommits = new Set(
      existsSync(shallowFile) ? readFileSync(shallowFile, 'utf8').trim().split('\n') : []
    );
    const edited = new Set(git(['diff', '--name-only', 'HEAD', '--', 'content/docs']).split('\n'));
    const history = git([
      'log',
      '--first-parent',
      '--diff-merges=first-parent',
      '--no-show-signature',
      '--no-renames',
      '--format=%x1e%H%x09%cs',
      '--name-only',
      '--',
      'content/docs',
    ]);
    for (const entry of history.split('\x1e')) {
      const [header, ...paths] = entry.trim().split('\n');
      const [sha, date] = header.split('\t');
      // A shallow boundary looks like it added every file in its tree.
      if (shallowCommits.has(sha) || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) continue;
      for (const path of paths) {
        const match = /^content\/docs\/([a-z0-9_-]+)\.md$/.exec(path);
        if (!match || edited.has(path)) continue;
        const route = `/docs/${match[1]}`;
        if (!dates.has(route)) dates.set(route, date);
      }
    }
  } catch {
    console.warn('  sitemap: Git history unavailable; omitting modification dates');
  }
  return dates;
}

/**
 * `dates` gives routes outside the docs the date their registry states.
 * `datedLike` dates a route by a docs page it renders, e.g. /pricing by the
 * plan catalog in /docs/plans. A docs date from Git always wins.
 */
export function sitemapXml(siteUrl, routes, { dates = new Map(), datedLike = {}, docDates } = {}) {
  const lastModified = docDates ?? docsLastModified();
  const urls = routes.map((route) => {
    const location = (siteUrl + route)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
    const date =
      lastModified.get(route) ??
      dates.get(route) ??
      (datedLike[route] ? lastModified.get(datedLike[route]) : undefined);
    return [
      '  <url>',
      `    <loc>${location}</loc>`,
      ...(date ? [`    <lastmod>${date}</lastmod>`] : []),
      '  </url>',
    ].join('\n');
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
}
