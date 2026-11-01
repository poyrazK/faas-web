import type { InventoryRow } from './inventory';
import type { LedgerEntry, ParityStatus } from './ledger';

type Counts = { total: number } & Record<ParityStatus, number>;
const empty = (): Counts => ({ total: 0, full: 0, partial: 0, cli: 0, none: 0, platform: 0 });

/** Ledger statuses per customer tier; a row the ledger lacks counts as none. */
export function coverage(inventory: InventoryRow[], ledger: LedgerEntry[]) {
  const out = { GA: empty(), beta: empty(), preview: empty() };
  const byRow = new Map(ledger.map((entry) => [entry.row, entry]));
  for (const row of inventory) {
    if (row.tier === 'internal') continue;
    const counts = out[row.tier];
    counts.total += 1;
    counts[byRow.get(row.row)?.status ?? 'none'] += 1;
  }
  return out;
}
