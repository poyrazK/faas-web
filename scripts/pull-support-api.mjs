import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { load } from 'js-yaml';

// A scoped vendor refresh while the separate Automations → Workflows migration
// still blocks a full api:pull. Copy upstream blocks verbatim; never invent DTOs.
// Usage: node scripts/pull-support-api.mjs /absolute/path/to/faas
const root = process.argv[2];
if (!root) throw new Error('Pass the path to a current faas checkout.');
execFileSync('git', ['-C', root, 'diff', '--quiet', 'HEAD', '--', 'api/openapi.yaml', 'pkg/productcap/catalog.json', 'docs/ga-capability-inventory.md']);
const source = readFileSync(`${root}/api/openapi.yaml`, 'utf8');
let target = readFileSync('api/openapi.yaml', 'utf8');
const upstream = load(source);

function blocks(text, indent) {
  const pattern = new RegExp(`^ {${indent}}([^\\s].*):\\s*$`, 'gm');
  const headings = [...text.matchAll(pattern)];
  return headings.map((match) => {
    const start = match.index;
    const rest = text.slice(start + match[0].length);
    const end = rest.search(new RegExp(`^ {0,${indent}}\\S`, 'm'));
    return [match[1], text.slice(start, end < 0 ? text.length : start + match[0].length + end)];
  });
}

function merge(section, indent, selected) {
  const boundary = new RegExp(`^ {0,${indent - 2}}\\S`, 'm');
  const marker = `${' '.repeat(indent - 2)}${section}:\n`;
  const heading = new RegExp(`^${marker}`, 'm').exec(target);
  if (!heading) throw new Error(`Missing ${section}`);
  const start = heading.index + marker.length;
  const offset = target.slice(start).search(boundary);
  const end = offset < 0 ? target.length : start + offset;
  let contents = target.slice(start, end);
  const existing = new Map(blocks(contents, indent));
  for (const [name, block] of selected) {
    const old = existing.get(name);
    contents = old ? contents.replace(old, block) : block + contents;
  }
  target = target.slice(0, start) + contents + target.slice(end);
}

merge('paths', 2, blocks(source, 2).filter(([name]) => /^\/v1\/(?:orgs\/\{org\}\/)?support\//.test(name)));
const supportName = /^(?:Support|CreateSupport|CloseSupport|ReopenSupport)/;
for (const section of ['schemas', 'responses']) {
  const names = new Set(Object.keys(upstream.components[section]).filter((name) => supportName.test(name)));
  merge(section, 4, blocks(source, 4).filter(([name]) => names.has(name)));
}
if (!load(target).tags.some((tag) => tag.name === 'support')) {
  target = target.replace('tags:\n', 'tags:\n  - name: support\n    description: Gregale customer assistance, public conversations and resolution episodes.\n');
}
const merged = load(target);
for (const ref of target.matchAll(/\$ref: ['"]?(#\/[^'"\s]+)/g)) {
  const found = ref[1].slice(2).split('/').reduce((value, key) => value?.[key], merged);
  if (found === undefined) throw new Error(`Unresolved reference ${ref[1]}`);
}
writeFileSync('api/openapi.yaml', target);

// Keep the matching capability and inventory row at the same upstream revision.
const catalogPath = 'content/capabilities/catalog.json';
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
const entry = JSON.parse(readFileSync(`${root}/pkg/productcap/catalog.json`, 'utf8')).capabilities.find((c) => c.id === 'customer-support');
catalog.capabilities = [...catalog.capabilities.filter((c) => c.id !== entry.id), entry];
writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + '\n');
const inventoryPath = 'content/capabilities/ga-capability-inventory.md';
let inventory = readFileSync(inventoryPath, 'utf8');
const row = readFileSync(`${root}/docs/ga-capability-inventory.md`, 'utf8').split('\n').find((line) => line.startsWith('| ') && line.includes('Native customer support:'));
if (!row) throw new Error('Missing upstream support inventory row');
inventory = inventory.split('\n').filter((line) => !line.includes('Native customer support:')).join('\n');
const section = inventory.indexOf('## I.');
if (section < 0) throw new Error('Missing customer experience inventory section');
const lastRow = [...inventory.slice(section).matchAll(/^\| \d+ .*$/gm)].at(-1);
const insert = section + lastRow.index + lastRow[0].length;
inventory = inventory.slice(0, insert) + '\n' + row + inventory.slice(insert);
writeFileSync(inventoryPath, inventory);
const revision = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
writeFileSync('api/support-source.json', JSON.stringify({ repository: 'poyrazK/faas', revision, refresh: 'node scripts/pull-support-api.mjs /path/to/faas && npm run api:types' }, null, 2) + '\n');
console.log(`Vendored Support from faas@${revision}`);
