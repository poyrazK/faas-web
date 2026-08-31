import type { components } from '@/lib/api/schema';

export type EnvDiff = components['schemas']['EnvDiffResponse'];
export type EnvDiffRow = components['schemas']['EnvDiffRow'];
type Cell = components['schemas']['EnvDiffCell'];
export type CellState = 'missing' | 'same' | 'differs' | 'only';

/** Secrets carry a hash, plain env may carry the value; either fingerprints equality. */
const fingerprint = (c: Cell) => c.value_hash ?? c.value ?? '';

export function cellState(row: Pick<EnvDiffRow, 'cells'>, scope: string): CellState {
  const cells = row.cells as Record<string, Cell>;
  const me = cells[scope];
  if (!me?.present) return 'missing';
  const others = Object.entries(cells).filter(([s, c]) => s !== scope && c.present);
  if (others.length === 0) return 'only';
  return others.every(([, c]) => fingerprint(c) === fingerprint(me)) ? 'same' : 'differs';
}

/** `uneven` = keys that are not present-and-identical in every scope. */
export function diffSummary(resp: EnvDiff): { keys: number; uneven: number } {
  const uneven = resp.rows.filter((r) =>
    resp.scopes.some((s) => cellState(r, s) !== 'same')
  ).length;
  return { keys: resp.rows.length, uneven };
}
