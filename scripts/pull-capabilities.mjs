import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Vendors faas's capability inventory and product catalog.
 *
 * `docs/ga-capability-inventory.md` lists every customer-reachable capability
 * on faas `main`, with a tier (GA, beta, preview, internal), and a faas CI gate
 * keeps it complete. `pkg/productcap/catalog.json` holds the catalog ids the
 * console gates on (`/v1/capabilities`, `hidden_capabilities`). The console's
 * parity ledger (`src/lib/parity/ledger.ts`) is checked against both, so they
 * are committed rather than fetched: a refresh is a reviewable diff, and the
 * ledger test names every new or renamed capability.
 *
 *   npm run capabilities:pull
 */

const REPO = 'poyrazK/faas';
const REF = process.env.CAPABILITIES_REF ?? 'main';
const OUT_DIR = join('content', 'capabilities');
const FILES = [
  ['docs/ga-capability-inventory.md', 'ga-capability-inventory.md'],
  ['pkg/productcap/catalog.json', 'catalog.json'],
];

/** The authenticated contents API is not rate-limited the way raw fetches are. */
function githubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

const token = githubToken();
const headers = {
  Accept: 'application/vnd.github.raw',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};
const url = (path) =>
  `https://api.github.com/repos/${REPO}/contents/${path}?ref=${encodeURIComponent(REF)}`;

mkdirSync(OUT_DIR, { recursive: true });
for (const [source, target] of FILES) {
  const response = await fetch(url(source), { headers });
  if (!response.ok) {
    console.error(`${source} → HTTP ${response.status}`);
    process.exit(1);
  }
  writeFileSync(join(OUT_DIR, target), await response.text());
  console.log(`  ${target.padEnd(28)} ${source}`);
}
console.log(`\npulled the capability inventory and catalog from ${REPO}@${REF}`);
