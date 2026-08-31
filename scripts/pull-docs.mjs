import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOC_ENTRIES } from '../src/lib/docs-manifest.ts';

/**
 * Vendors the customer-facing docs out of `poyrazK/faas`.
 *
 * The content is committed rather than fetched at runtime, for the same reason
 * `api/openapi.yaml` is: the site prerenders, so the markdown has to exist at
 * build time, and a docs page that depends on GitHub being reachable is a docs
 * page that breaks during an incident — exactly when people read it.
 *
 * Only the paths named in `docs-manifest.ts` are pulled. That file explains at
 * length why the rest of the repo's markdown stays out; the short version is
 * that runbooks and ADRs are internal and publishing them would leak
 * operational detail.
 *
 *   npm run docs:pull
 *
 * Re-running overwrites in place, so an upstream edit shows up as a reviewable
 * diff rather than a silent drift.
 */

const REPO = 'poyrazK/faas';
const REF = process.env.DOCS_REF ?? 'main';
const OUT_DIR = join('content', 'docs');

/**
 * Anonymous `raw.githubusercontent.com` fetches get rate-limited hard — a run
 * of this size 429s outright. The authenticated contents API does not, so a
 * token is used when one can be found: the environment first, then whatever
 * `gh` is already logged in with, which is the common local case.
 */
function githubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

const token = githubToken();
if (!token) {
  console.warn(
    'No GitHub token found — falling back to anonymous requests, which may be rate-limited.\n'
  );
}

const url = (path) =>
  `https://api.github.com/repos/${REPO}/contents/${path}?ref=${encodeURIComponent(REF)}`;

/** `raw` gives the file body rather than the base64 JSON envelope. */
const headers = {
  Accept: 'application/vnd.github.raw',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};

mkdirSync(OUT_DIR, { recursive: true });

let written = 0;
const failures = [];

const pullable = DOC_ENTRIES.filter((entry) => entry.source !== 'local');

for (const entry of pullable) {
  const response = await fetch(url(entry.source), { headers });

  if (!response.ok) {
    // Collect rather than throw: one moved file upstream should not stop the
    // other fifteen from refreshing, and the summary at the end names it.
    failures.push(`${entry.source} → HTTP ${response.status}`);
    continue;
  }

  const body = await response.text();
  writeFileSync(join(OUT_DIR, `${entry.slug}.md`), body);
  console.log(`  ${entry.slug.padEnd(24)} ${entry.source}`);
  written++;
}

console.log(`\npulled ${written}/${pullable.length} docs from ${REPO}@${REF}`);

if (failures.length) {
  console.error(`\n${failures.length} failed:`);
  for (const failure of failures) console.error(`  ${failure}`);
  // A missing source means the manifest is stale, which is a real problem —
  // the page would 404 for readers. Fail the command so CI catches it.
  process.exit(1);
}
