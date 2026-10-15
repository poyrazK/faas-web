import type { components } from '@/lib/api/schema';
import type { EdgeRule } from '@/lib/api/queries';

type CacheAction = components['schemas']['EdgeRuleCacheAction'];
export type CacheEdgeRule = Omit<EdgeRule, 'action' | 'kind'> & {
  kind: 'cache';
  action: CacheAction;
};

/**
 * The upstream spec leaves `EdgeRuleCacheAction` out of the edge-rule action
 * union (and `cache` from the kind enum), although apid accepts and returns `kind: 'cache'` rules (ADR-122).
 * Fixtures are written against the real cache schema and widened here, once,
 * so a test never has to pretend a cache rule is some other kind.
 */
export function cacheEdgeRule(rule: CacheEdgeRule): EdgeRule {
  return rule as unknown as EdgeRule;
}
