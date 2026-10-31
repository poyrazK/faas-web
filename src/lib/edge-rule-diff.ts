import type { EdgeRule } from '@/lib/api/queries';

/**
 * The difference between an app's rules now and a recorded version of them.
 *
 * apid returns whole rule sets, never a diff (faas pkg/apid/edgerules/
 * versions.go:83-92). A rollback restores the version's rules "preserving
 * rule IDs" (openapi rollbackEdgeRules), so rules pair by id: one only in the
 * version comes back, one only in the current set is deleted, and one in both
 * may change. The attack-mode rule is left out on both sides, because a
 * restore keeps the current one (rollback_checks.go:32).
 */

export type RuleChange = 'changed' | 'added' | 'removed' | 'same';

export interface RuleDiff {
  id: string;
  change: RuleChange;
  /** The rule now; absent when the rollback brings it back. */
  before?: EdgeRule;
  /** The rule in the version; absent when the rollback deletes it. */
  after?: EdgeRule;
  /** The fields that differ, in this order, when `change` is `changed`. */
  fields: string[];
}

const FIELDS = [
  'kind',
  'match_host',
  'match_path',
  'match_methods',
  'match_headers',
  'match',
  'priority',
  'enabled',
  'mode',
  'validate_mode',
  'action',
  'penalty',
  'name',
  'description',
  'expires_at',
] as const satisfies readonly (keyof EdgeRule)[];

/** JSON with object keys sorted, so `{a,b}` and `{b,a}` compare equal. */
function canonical(value: unknown): string {
  return JSON.stringify(value ?? null, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
        )
      : v
  );
}

const managed = (r: EdgeRule) => r.managed_by === 'attack_mode';

export function diffRuleSets(current: EdgeRule[], target: EdgeRule[]): RuleDiff[] {
  const now = new Map(current.filter((r) => !managed(r)).map((r) => [r.id, r]));
  const then = target.filter((r) => !managed(r));
  const changed: RuleDiff[] = [];
  const added: RuleDiff[] = [];
  const same: RuleDiff[] = [];
  for (const after of then) {
    const before = now.get(after.id);
    if (!before) {
      added.push({ id: after.id, change: 'added', after, fields: [] });
      continue;
    }
    const fields = FIELDS.filter((f) => canonical(before[f]) !== canonical(after[f]));
    (fields.length ? changed : same).push({
      id: after.id,
      change: fields.length ? 'changed' : 'same',
      before,
      after,
      fields,
    });
  }
  const kept = new Set(then.map((r) => r.id));
  const removed: RuleDiff[] = [...now.values()]
    .filter((r) => !kept.has(r.id))
    .map((before) => ({ id: before.id, change: 'removed', before, fields: [] }));
  return [...changed, ...added, ...removed, ...same];
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "2 rules come back, 1 is deleted and 3 change." — for the confirmation. */
export function rollbackSummary(diff: RuleDiff[]): string {
  const n = (c: RuleChange) => diff.filter((d) => d.change === c).length;
  const parts: string[] = [];
  let noun = true;
  const push = (k: number, one: string, many: string) => {
    if (!k) return;
    parts.push(noun ? count(k, `rule ${one}`, `rules ${many}`) : count(k, one, many));
    noun = false;
  };
  push(n('added'), 'comes back', 'come back');
  push(n('removed'), 'is deleted', 'are deleted');
  push(n('changed'), 'changes', 'change');
  if (!parts.length) return 'The rules are the same as now.';
  const last = parts.pop()!;
  return `${parts.length ? `${parts.join(', ')} and ${last}` : last}.`.replace(/^./, (c) =>
    c.toUpperCase()
  );
}
