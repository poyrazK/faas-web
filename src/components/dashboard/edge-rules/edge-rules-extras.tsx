import { CapabilityGate } from '@/components/dashboard/capability-gate';
import { useEdgeRuleSetFollower } from '@/lib/api/edge-rules';
import type { EdgeRule } from '@/lib/api/queries';
import { EdgeRuleActivity } from './edge-rule-activity';
import { EdgeRuleLists } from './edge-rule-lists';
import { EdgeRuleRecipes } from './edge-rule-recipes-panel';
import { EdgeRuleSuggestions } from './edge-rule-suggestions';
import { EdgeRuleVersions } from './edge-rule-versions';
import { EdgeWAFReview } from './edge-waf-review';

/**
 * Everything on the Edge rules surface beyond the rules table. Activity (stats,
 * sampled events, trace), versions, suggestions, the recipe catalog and the WAF
 * review are per app, so they appear on an app's tab;
 * rule lists are account-wide and appear on both. Each part is its own catalog
 * capability (faas pkg/productcap/catalog.json: edge-rule-history,
 * edge-rule-suggestions, edge-rule-lists, all beta children of edge-rules);
 * the WAF review is shown once the app has a kind=waf rule to review.
 */
export function EdgeRulesExtras({ slug, rules }: { slug?: string; rules: EdgeRule[] }) {
  useEdgeRuleSetFollower(
    slug ?? '',
    rules
      .map((r) => `${r.id}@${r.updated_at}`)
      .sort()
      .join(',')
  );
  return (
    <>
      {slug && (
        <>
          <EdgeRuleActivity slug={slug} rules={rules} />
          <CapabilityGate capability="edge-rule-history" title="Versions">
            <EdgeRuleVersions slug={slug} />
          </CapabilityGate>
          <CapabilityGate capability="edge-rule-suggestions" title="Suggested protections">
            <EdgeRuleSuggestions slug={slug} />
          </CapabilityGate>
          <CapabilityGate capability="edge-rule-suggestions" title="Recipes">
            <EdgeRuleRecipes slug={slug} />
          </CapabilityGate>
          {rules.some((r) => r.kind === 'waf') && <EdgeWAFReview slug={slug} rules={rules} />}
        </>
      )}
      <CapabilityGate capability="edge-rule-lists" title="Rule lists">
        <EdgeRuleLists />
      </CapabilityGate>
    </>
  );
}
