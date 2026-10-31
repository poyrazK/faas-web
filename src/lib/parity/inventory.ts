export type Tier = 'GA' | 'beta' | 'preview' | 'internal';
export interface InventoryRow {
  row: number;
  section: string;
  name: string;
  tier: Tier;
  /** Catalog ids named in the row (faas pkg/productcap/catalog.json); empty when MISSING. */
  catalog: string[];
}

const TIERS: readonly Tier[] = ['GA', 'beta', 'preview', 'internal'];

/**
 * Reads faas docs/ga-capability-inventory.md. Rows are `| # | Capability |
 * Where | Catalog | Gate | Tier |` under `## <Letter>. <Title>` headings.
 * Upstream appends new rows rather than renumbering (row 168 sits in G), so
 * the row number is the stable key.
 */
export function parseInventory(markdown: string): InventoryRow[] {
  const rows: InventoryRow[] = [];
  let section = '';
  for (const line of markdown.split('\n')) {
    const heading = /^## ([A-J])\. /.exec(line);
    if (heading) {
      section = heading[1];
      continue;
    }
    if (!section || !/^\| \d+ \|/.test(line)) continue;
    const cells = line
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((cell) => cell.trim());
    const tier = cells[cells.length - 1].replace(/[`*]/g, '') as Tier;
    if (!TIERS.includes(tier)) continue;
    const catalog = cells[3].includes('MISSING')
      ? []
      : [...cells[3].matchAll(/`([a-z0-9-]+)`/g)].map((match) => match[1]);
    rows.push({ row: Number(cells[0]), section, name: cells[1], tier, catalog });
  }
  return rows;
}
