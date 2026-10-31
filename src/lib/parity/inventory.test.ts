import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseInventory } from './inventory';

const SAMPLE = `
## A. Deploy and build

| # | Capability | Where it lives | Catalog | Gate today | Tier |
|---|---|---|---|---|---|
| 13 | Per-app deploy tokens for CI | \`deploy-tokens\` | **MISSING** | — | GA |
| 20 | Environments and Environment GitOps (field ownership) | x | \`environments\` preview, \`environment-gitops\` preview | — | preview |

## G. Observability

| # | Capability | Where it lives | Catalog | Gate today | Tier |
|---|---|---|---|---|---|
| 168 | On-demand profile captures | x | \`profile-captures\` preview | — | preview |
`;

describe('parseInventory', () => {
  it('reads row number, section, name, tier and catalog ids', () => {
    expect(parseInventory(SAMPLE)).toEqual([
      { row: 13, section: 'A', name: 'Per-app deploy tokens for CI', tier: 'GA', catalog: [] },
      {
        row: 20,
        section: 'A',
        name: 'Environments and Environment GitOps (field ownership)',
        tier: 'preview',
        catalog: ['environments', 'environment-gitops'],
      },
      {
        row: 168,
        section: 'G',
        name: 'On-demand profile captures',
        tier: 'preview',
        catalog: ['profile-captures'],
      },
    ]);
  });
  it('parses the vendored inventory into unique row numbers with known tiers', () => {
    const rows = parseInventory(
      readFileSync(resolve('content/capabilities/ga-capability-inventory.md'), 'utf8')
    );
    expect(rows.length).toBeGreaterThanOrEqual(167);
    expect(new Set(rows.map((r) => r.row)).size).toBe(rows.length);
    expect(rows.every((r) => ['GA', 'beta', 'preview', 'internal'].includes(r.tier))).toBe(true);
  });
});
