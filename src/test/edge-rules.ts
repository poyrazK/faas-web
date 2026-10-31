import type { components } from '@/lib/api/schema';
import type { EdgeRule } from '@/lib/api/queries';

type CacheAction = components['schemas']['EdgeRuleCacheAction'];
export type CacheEdgeRule = Omit<EdgeRule, 'action' | 'kind'> & {
  kind: 'cache';
  action: CacheAction;
};

/**
 * A cache edge rule fixture. The upstream union carries `EdgeRuleCacheAction`
 * and the `cache` kind again (ADR-122), so the fixture is an EdgeRule as it is.
 */
export function cacheEdgeRule(rule: CacheEdgeRule): EdgeRule {
  return rule;
}
