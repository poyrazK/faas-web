import { readFileSync } from 'node:fs';
import { coverage } from '../src/lib/parity/coverage.ts';
import { parseInventory } from '../src/lib/parity/inventory.ts';
import { LEDGER } from '../src/lib/parity/ledger.ts';

/**
 * Console coverage of faas's customer capabilities, by tier: the progress
 * number for the parity plan. "covered" is full, or ambient platform behaviour
 * with nothing to operate; a row that defers to the CLI still has a gap.
 *
 *   npm run parity
 */
const inventory = parseInventory(
  readFileSync('content/capabilities/ga-capability-inventory.md', 'utf8')
);
for (const [tier, c] of Object.entries(coverage(inventory, LEDGER))) {
  const covered = c.full + c.platform;
  const pct = c.total ? Math.round((covered / c.total) * 100) : 100;
  console.log(
    `${tier.padEnd(8)} ${String(pct).padStart(3)}% covered  ` +
      `full ${c.full}  platform ${c.platform}  partial ${c.partial}  cli ${c.cli}  none ${c.none}  of ${c.total}`
  );
}
