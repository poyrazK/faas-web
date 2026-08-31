// Fails when the vendored spec's path set differs from upstream main's, so a
// console that cannot see an endpoint is caught in CI rather than in a gap
// audit. Compares path keys only: the fast, dependency-free signal.
import { readFileSync } from 'node:fs';

const UPSTREAM = 'https://raw.githubusercontent.com/poyrazK/faas/main/api/openapi.yaml';
const paths = (yaml) =>
  new Set(
    yaml
      .split('\n')
      .filter((l) => /^  \/v1\//.test(l))
      .map((l) => l.trim().replace(/:$/, ''))
  );

const local = paths(readFileSync(new URL('../api/openapi.yaml', import.meta.url), 'utf8'));
const res = await fetch(UPSTREAM);
if (!res.ok) {
  console.error(`could not fetch upstream spec: ${res.status}`);
  process.exit(2);
}
const remote = paths(await res.text());

const missing = [...remote].filter((p) => !local.has(p)).sort();
const extra = [...local].filter((p) => !remote.has(p)).sort();

if (missing.length || extra.length) {
  if (missing.length)
    console.error(
      `Upstream has ${missing.length} path(s) the console cannot see:\n  ${missing.join('\n  ')}`
    );
  if (extra.length)
    console.error(
      `Console spec has ${extra.length} path(s) upstream lacks:\n  ${extra.join('\n  ')}`
    );
  console.error('\nRun `npm run api:pull` (and fix upstream if paths are only here).');
  process.exit(1);
}
console.log(`api spec in sync: ${local.size} paths`);
