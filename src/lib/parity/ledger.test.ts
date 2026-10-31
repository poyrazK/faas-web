import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_DETAIL_TABS } from '@/components/dashboard/app-tab-navigation';
import { SETTINGS_SECTIONS } from '@/components/dashboard/settings-search';
import { parseInventory } from './inventory';
import { LEDGER } from './ledger';

const inventory = parseInventory(
  readFileSync(resolve('content/capabilities/ga-capability-inventory.md'), 'utf8')
);
const catalog = new Set(
  (
    JSON.parse(readFileSync(resolve('content/capabilities/catalog.json'), 'utf8')) as {
      capabilities: { id: string }[];
    }
  ).capabilities.map((c) => c.id)
);
const routes = new Set(
  [
    ...readFileSync(resolve('src/routeTree.gen.ts'), 'utf8').matchAll(/^\s+'(\/[^']*)': typeof /gm),
  ].map((m) => m[1])
);
const byRow = new Map(LEDGER.map((e) => [e.row, e]));
const customer = inventory.filter((r) => r.tier !== 'internal');

describe('parity ledger', () => {
  it('has an entry for every GA, beta and preview capability', () => {
    const missing = customer
      .filter((r) => !byRow.has(r.row))
      .map((r) => `${r.section}${r.row} ${r.name}`);
    expect(missing).toEqual([]);
  });
  it('names each row exactly as upstream does, so a renumber is caught', () => {
    const drift = LEDGER.flatMap((e) => {
      const up = inventory.find((r) => r.row === e.row);
      return up && up.name !== e.name
        ? [`row ${e.row}: ledger "${e.name}" vs upstream "${up.name}"`]
        : [];
    });
    expect(drift).toEqual([]);
  });
  it('lists no row upstream no longer has', () => {
    const rows = new Set(inventory.map((r) => r.row));
    expect(LEDGER.filter((e) => !rows.has(e.row)).map((e) => e.row)).toEqual([]);
  });
  it('lists each row once', () => {
    expect(LEDGER.length).toBe(byRow.size);
  });
  it('points every surface at a real route, tab or settings section', () => {
    const bad = LEDGER.flatMap((e) =>
      e.surfaces.flatMap((s) => {
        const [path, query = ''] = s.split('?');
        const params = new URLSearchParams(query);
        const tab = params.get('tab');
        const section = params.get('section');
        const ok =
          routes.has(path) &&
          (!tab || (APP_DETAIL_TABS as readonly string[]).includes(tab)) &&
          (!section || SETTINGS_SECTIONS.some(([id]) => id === section));
        return ok ? [] : [`row ${e.row}: ${s}`];
      })
    );
    expect(bad).toEqual([]);
  });
  it('keeps status, gap, CLI and capability consistent', () => {
    const bad = LEDGER.flatMap((e) => {
      const up = inventory.find((r) => r.row === e.row);
      const problems: string[] = [];
      const covered = e.status === 'full' || e.status === 'platform';
      if (covered && e.gap) problems.push(`${e.status} with a gap`);
      if (!covered && !e.gap) problems.push('not covered but no gap');
      if (!covered && e.wave === undefined) problems.push('a gap with no wave');
      if (e.status === 'cli' && !e.cli) problems.push('cli without a command');
      if ((e.status === 'full' || e.status === 'partial') && e.surfaces.length === 0)
        problems.push('no surface');
      if (
        up?.tier === 'preview' &&
        (e.status === 'full' || e.status === 'partial') &&
        !e.capability
      )
        problems.push('preview surface without a capability gate');
      if (e.capability && !catalog.has(e.capability))
        problems.push(`unknown catalog id ${e.capability}`);
      return problems.map((p) => `row ${e.row}: ${p}`);
    });
    expect(bad).toEqual([]);
  });
});
