import { describe, expect, it } from 'vitest';
import { coverage } from './coverage';
import type { InventoryRow } from './inventory';
import type { LedgerEntry } from './ledger';

describe('coverage', () => {
  it('counts ledger statuses per tier and ignores internal rows', () => {
    const inv: InventoryRow[] = [
      { row: 1, section: 'A', name: 'a', tier: 'GA', catalog: [] },
      { row: 2, section: 'A', name: 'b', tier: 'GA', catalog: [] },
      { row: 3, section: 'A', name: 'c', tier: 'preview', catalog: [] },
      { row: 4, section: 'A', name: 'd', tier: 'internal', catalog: [] },
      { row: 5, section: 'C', name: 'e', tier: 'GA', catalog: [] },
    ];
    const led: LedgerEntry[] = [
      { row: 1, name: 'a', status: 'full', surfaces: ['/dashboard'] },
      { row: 2, name: 'b', status: 'none', surfaces: [], gap: 'x', wave: 1 },
      { row: 3, name: 'c', status: 'partial', surfaces: ['/dashboard'], gap: 'y', capability: 'z' },
      { row: 5, name: 'e', status: 'platform', surfaces: [] },
    ];
    expect(coverage(inv, led)).toEqual({
      GA: { total: 3, full: 1, partial: 0, cli: 0, none: 1, platform: 1 },
      beta: { total: 0, full: 0, partial: 0, cli: 0, none: 0, platform: 0 },
      preview: { total: 1, full: 0, partial: 1, cli: 0, none: 0, platform: 0 },
    });
  });
  it('counts a row the ledger has not caught up with as none', () => {
    const inv: InventoryRow[] = [{ row: 9, section: 'A', name: 'new', tier: 'beta', catalog: [] }];
    expect(coverage(inv, []).beta).toEqual({
      total: 1,
      full: 0,
      partial: 0,
      cli: 0,
      none: 1,
      platform: 0,
    });
  });
});
