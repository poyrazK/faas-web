import { gzipSync } from 'node:zlib';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
const manifest = JSON.parse(readFileSync(resolve(dist, '.vite/manifest.json'), 'utf8'));
const failures = [];

function fail(message) {
  failures.push(message);
}

function bytes(path) {
  return statSync(resolve(root, path)).size;
}

function collectImports(keys, seen = new Set()) {
  for (const key of keys) {
    if (seen.has(key)) continue;
    const chunk = manifest[key];
    if (!chunk) {
      fail(`manifest entry is missing: ${key}`);
      continue;
    }
    seen.add(key);
    collectImports(chunk.imports ?? [], seen);
  }
  return seen;
}

const entryKey = Object.keys(manifest).find((key) => manifest[key].isEntry);
const landingKey = 'src/landing-main.tsx';
const routeKey = Object.keys(manifest).find((key) =>
  key.startsWith('src/routes/index.tsx?tsr-split=component')
);

if (!entryKey) fail('could not find the browser entry in the Vite manifest');
if (!manifest[landingKey]) fail('could not find the landing bootstrap in the Vite manifest');
if (!routeKey) fail('could not find the landing route component in the Vite manifest');

const graphKeys = collectImports([entryKey, landingKey, routeKey].filter(Boolean));
const jsFiles = [...graphKeys]
  .map((key) => manifest[key]?.file)
  .filter((file) => file?.endsWith('.js'));
const jsGzipBytes = jsFiles.reduce(
  (total, file) => total + gzipSync(readFileSync(resolve(dist, file))).byteLength,
  0
);
const jsBudget = 215 * 1024;
if (jsGzipBytes > jsBudget) {
  fail(`landing JavaScript is ${jsGzipBytes} B gzip; budget is ${jsBudget} B`);
}

const landingCode = jsFiles.map((file) => readFileSync(resolve(dist, file), 'utf8')).join('\n');
for (const endpoint of ['/v1/apps', '/v1/deployments', '/v1/apps/metrics']) {
  if (landingCode.includes(endpoint))
    fail(`landing JavaScript contains console endpoint ${endpoint}`);
}

const imageBudgets = [
  ['src/assets/landing/gregale-frosted-600.avif', 65 * 1024],
  ['src/assets/landing/gregale-frosted-1040.avif', 160 * 1024],
  ['src/assets/landing/mark-64.webp', 4 * 1024],
];
for (const [path, budget] of imageBudgets) {
  const size = bytes(path);
  if (size > budget) fail(`${path} is ${size} B; budget is ${budget} B`);
}

const html = readFileSync(resolve(dist, 'index.html'), 'utf8');
for (const required of [
  'data-prerender-path="/"',
  'rel="preload"',
  'type="image/avif"',
  'fetchPriority="high"',
]) {
  if (!html.includes(required)) fail(`prerendered landing HTML is missing ${required}`);
}
for (const obsolete of ['/gregale-frosted.png', '/favicon.png']) {
  if (html.includes(obsolete)) fail(`prerendered landing HTML still references ${obsolete}`);
}

console.log(`landing JavaScript: ${(jsGzipBytes / 1024).toFixed(1)} KiB gzip / 215 KiB budget`);
for (const [path, budget] of imageBudgets) {
  console.log(
    `${path}: ${(bytes(path) / 1024).toFixed(1)} KiB / ${(budget / 1024).toFixed(0)} KiB budget`
  );
}

if (failures.length) {
  console.error('\nPerformance budget failed:');
  for (const message of failures) console.error(`- ${message}`);
  process.exitCode = 1;
} else {
  console.log('Performance budget passed.');
}
