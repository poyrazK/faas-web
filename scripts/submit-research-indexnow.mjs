import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const origin = 'https://gregale.dev';
const commitSha = /^[a-f0-9]{40}$/;
// Research reports, articles, comparison pages and docs share one release file
// and one submission.
const releasePath =
  /^\/(?:(?:research|articles)(?:\/[a-z0-9_-]+)?|vs\/[a-z0-9_-]+|docs(?:\/[a-z0-9_-]+){0,2})$/;
const vercel = 'vercel[bot]';

function isAncestor(before, after) {
  return (
    commitSha.test(before) &&
    commitSha.test(after) &&
    spawnSync('git', ['merge-base', '--is-ancestor', before, after], {
      stdio: 'ignore',
    }).status === 0
  );
}

function github(repository, endpoint) {
  return JSON.parse(
    execFileSync('gh', ['api', `repos/${repository}/${endpoint}`], { encoding: 'utf8' })
  );
}

function previousProduction(repository, deployment, status) {
  const deployments = github(repository, 'deployments?environment=Production&per_page=100');
  for (const candidate of deployments) {
    if (candidate.id >= deployment.id || candidate.creator?.login !== vercel) continue;
    if (!isAncestor(candidate.sha, deployment.sha)) continue;
    const statuses = github(repository, `deployments/${candidate.id}/statuses?per_page=100`);
    if (
      statuses.some(
        (row) =>
          row.state === 'success' &&
          row.creator?.login === vercel &&
          row.created_at <= status.created_at
      )
    ) {
      return candidate.sha;
    }
  }
}

function under(prefix, livePaths) {
  return livePaths.filter((path) => path === prefix || path.startsWith(`${prefix}/`));
}

/** The live pages a set of changed repository files can have changed. */
export function changedPaths(files, livePaths) {
  if (files.includes('scripts/prerender.mjs')) return livePaths;
  const changed = new Set();
  const add = (paths) => paths.forEach((path) => changed.add(path));
  for (const collection of ['research', 'articles']) {
    if (
      files.some(
        (file) =>
          file === `src/lib/${collection}.ts` || file.startsWith(`src/routes/${collection}.`)
      )
    ) {
      add(under(`/${collection}`, livePaths));
    }
  }
  // Comparison pages compute Gregale's figures from the plan catalog.
  if (
    files.some(
      (file) =>
        file === 'src/lib/compare.ts' ||
        file.startsWith('src/routes/vs.') ||
        file === 'content/docs/plans.md'
    )
  ) {
    add(livePaths.filter((path) => path.startsWith('/vs/')));
  }
  if (files.includes('src/lib/docs-manifest.ts')) changed.add('/docs');
  if (files.includes('api/openapi.yaml')) add(under('/docs/api', livePaths));
  for (const file of files) {
    const page = /^content\/(research|articles|docs)\/([a-z0-9_-]+)\.md$/.exec(file);
    const artifact = /^public\/(research)\/([a-z0-9_-]+)\//.exec(file);
    const match = page ?? artifact;
    if (match) changed.add(`/${match[1]}/${match[2]}`);
  }
  return livePaths.filter((path) => changed.has(path));
}

async function readPublic(path) {
  return fetch(origin + path, {
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  });
}

async function liveRelease(expected) {
  for (let attempt = 0; attempt < 15; attempt++) {
    const response = await readPublic('/indexnow-research.json');
    if (response.ok) {
      const { commit, paths } = await response.json();
      if (
        !commitSha.test(commit) ||
        !Array.isArray(paths) ||
        !paths.includes('/research') ||
        !paths.every((path) => releasePath.test(path))
      ) {
        throw new Error('Invalid IndexNow release file from gregale.dev.');
      }
      // A later production deploy can go live before an older job starts.
      // In that case submit only routes that are still present on the domain.
      if (!expected || commit === expected || isAncestor(expected, commit)) {
        return { commit, paths };
      }
    } else if (response.status !== 404) {
      throw new Error(`Reading the production research release returned HTTP ${response.status}.`);
    }
    await delay(5000);
  }
  throw new Error('The expected research release did not become live on gregale.dev.');
}

async function main() {
  if (!process.env.INDEXNOW_KEY) throw new Error('The INDEXNOW_KEY Actions secret is required.');
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const manual = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch';
  const { deployment, deployment_status: status } = event;
  const live = await liveRelease(manual ? undefined : deployment.sha);
  const previous = manual
    ? undefined
    : previousProduction(process.env.GITHUB_REPOSITORY, deployment, status);
  const paths = previous
    ? changedPaths(
        execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', previous, live.commit], {
          encoding: 'utf8',
        }).split('\0'),
        live.paths
      )
    : live.paths;
  if (!paths.length) {
    console.log(`No submitted URLs changed in production release ${live.commit}.`);
    return;
  }

  for (const path of paths) {
    const response = await readPublic(path);
    const canonical = `rel="canonical" href="${origin}${path}"`;
    if (!response.ok || !(await response.text()).includes(canonical)) {
      throw new Error(`The production URL ${path} did not serve its canonical page.`);
    }
  }
  console.log(`Production release ${live.commit}: ${paths.join(', ')}`);
  execFileSync(process.execPath, ['scripts/submit-indexnow.mjs', ...paths], { stdio: 'inherit' });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
