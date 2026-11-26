import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import {
  CONTENT_ARTIFACT,
  CONTENT_FILE,
  contentChangedPaths,
  contentHashes,
} from './indexnow-content.mjs';

const origin = 'https://gregale.dev';
const commitSha = /^[a-f0-9]{40}$/;
// The home page, pricing, research reports, articles, comparison pages and docs
// share one release file and one submission.
const releasePath =
  /^\/(?:pricing|(?:research|articles|features)(?:\/[a-z0-9_-]+)?|vs\/[a-z0-9_-]+|docs(?:\/[a-z0-9_-]+){0,2})?$/;
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
  for (const collection of ['research', 'articles', 'features']) {
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
  // The pricing page renders the plan catalog and its own questions.
  if (
    files.some(
      (file) =>
        file === 'content/docs/plans.md' ||
        file === 'src/lib/faq.ts' ||
        file.startsWith('src/routes/pricing.')
    )
  ) {
    changed.add('/pricing');
  }
  // The home page is the landing components and their questions.
  if (
    files.some(
      (file) =>
        file === 'src/routes/index.tsx' ||
        file === 'src/lib/faq.ts' ||
        file.startsWith('src/components/landing/')
    )
  ) {
    changed.add('/');
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
      const { commit, paths, hashes } = await response.json();
      if (
        !commitSha.test(commit) ||
        !Array.isArray(paths) ||
        !paths.includes('/research') ||
        !paths.every((path) => releasePath.test(path)) ||
        (hashes !== undefined && !contentHashes(hashes, paths))
      ) {
        throw new Error('Invalid IndexNow release file from gregale.dev.');
      }
      // A later production deploy can go live before an older job starts.
      // In that case submit only routes that are still present on the domain.
      if (!expected || commit === expected || isAncestor(expected, commit)) {
        return { commit, paths, hashes };
      }
    } else if (response.status !== 404) {
      throw new Error(`Reading the production research release returned HTTP ${response.status}.`);
    }
    await delay(5000);
  }
  throw new Error('The expected research release did not become live on gregale.dev.');
}

/**
 * The page hashes the last successful run saved, or undefined when there is
 * none to compare with (first run, expired artifact, or an older format).
 */
function previousContent(repository) {
  const dir = mkdtempSync(join(tmpdir(), 'indexnow-'));
  try {
    const { artifacts } = github(
      repository,
      `actions/artifacts?name=${CONTENT_ARTIFACT}&per_page=10`
    );
    const latest = artifacts
      .filter((artifact) => !artifact.expired)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    if (!latest) return undefined;
    const zip = join(dir, 'content.zip');
    writeFileSync(
      zip,
      execFileSync('gh', ['api', `repos/${repository}/actions/artifacts/${latest.id}/zip`], {
        maxBuffer: 64 * 1024 * 1024,
      })
    );
    return contentHashes(
      JSON.parse(execFileSync('unzip', ['-p', zip, CONTENT_FILE], { encoding: 'utf8' }))
    );
  } catch (error) {
    console.log(`No earlier page hashes to compare with: ${error.message}`);
    return undefined;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function changedSince(previous, live) {
  return changedPaths(
    execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', previous, live.commit], {
      encoding: 'utf8',
    }).split('\0'),
    live.paths
  );
}

/** Saved for the next run's comparison, once this release's pages are submitted. */
function saveContent(live) {
  if (live.hashes) writeFileSync(CONTENT_FILE, JSON.stringify(live.hashes) + '\n');
}

async function main() {
  if (!process.env.INDEXNOW_KEY) throw new Error('The INDEXNOW_KEY Actions secret is required.');
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const manual = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch';
  const repository = process.env.GITHUB_REPOSITORY;
  const { deployment, deployment_status: status } = event;
  const live = await liveRelease(manual ? undefined : deployment.sha);
  // Compare what each page says with the last submitted release, so a
  // template or registry change does not resubmit pages that read the same.
  // Without earlier hashes, fall back to the files the release changed.
  const before = manual || !live.hashes ? undefined : previousContent(repository);
  let paths;
  if (manual) {
    paths = live.paths;
  } else if (before) {
    paths = contentChangedPaths(before, live.hashes, live.paths);
  } else {
    const previous = previousProduction(repository, deployment, status);
    paths = previous ? changedSince(previous, live) : live.paths;
  }
  if (!paths.length) {
    console.log(`No submitted URLs changed in production release ${live.commit}.`);
    saveContent(live);
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
  saveContent(live);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
