import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const origin = 'https://gregale.dev';
const commitSha = /^[a-f0-9]{40}$/;
const researchPath = /^\/research(?:\/[a-z0-9_-]+)?$/;
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

export function changedResearchPaths(files, livePaths) {
  if (
    files.some(
      (file) =>
        file === 'src/lib/research.ts' ||
        file === 'scripts/prerender.mjs' ||
        file.startsWith('src/routes/research.')
    )
  ) {
    return livePaths;
  }
  const changed = new Set();
  for (const file of files) {
    const report = /^content\/research\/([a-z0-9_-]+)\.md$/.exec(file);
    const artifact = /^public\/research\/([a-z0-9_-]+)\//.exec(file);
    const slug = (report ?? artifact)?.[1];
    if (slug) changed.add(`/research/${slug}`);
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
        !paths.every((path) => researchPath.test(path))
      ) {
        throw new Error('Invalid research release file from gregale.dev.');
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
    ? changedResearchPaths(
        execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', previous, live.commit], {
          encoding: 'utf8',
        }).split('\0'),
        live.paths
      )
    : live.paths;
  if (!paths.length) {
    console.log(`No research URLs changed in production release ${live.commit}.`);
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
