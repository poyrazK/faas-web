import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/dashboard/primitives';
import { useCapabilityAccess, useCapabilityStage } from '@/lib/api/capabilities';
import { useAuth } from '@/lib/auth';
import { RECIPES, type RecipeId } from '@/lib/edge-rule-recipes';
import { RecipeDialog } from './edge-rule-suggestions';

/**
 * The whole recipe catalog (faas pkg/api/edge_rule_recipes.go:96-188, what
 * `gregale edge rule recipes` lists), beside the suggestions drawn from it.
 * Each adds one ordinary rule, in log mode unless enforced now, through the
 * same dialog a suggestion opens. A recipe the account cannot use says why
 * instead of letting apid refuse it.
 */
export function EdgeRuleRecipes({ slug }: { slug: string }) {
  const stage = useCapabilityStage('edge-rule-suggestions');
  const { account } = useAuth();
  const plan = account?.plan ?? 'free';
  // Challenge rules and AI crawler conditions are released per account by
  // platform flags (faas edgerules/release.go:16-20); unreleased, a challenge
  // rule is refused and an AI crawler condition never matches.
  const challenge = useCapabilityAccess('edge-browser-challenge').access;
  const aiCrawlers = useCapabilityAccess('edge-ai-crawler-controls').access;
  const [adding, setAdding] = useState<RecipeId | null>(null);

  /** Why a recipe cannot be added here, or null. */
  const refusal = (id: RecipeId): string | null => {
    const r = RECIPES[id];
    if (id === 'control-ai-crawlers' && aiCrawlers !== 'on')
      return 'AI crawler conditions are not released to this account yet.';
    if (r.kind === 'challenge' && challenge !== 'on')
      return 'Challenge rules are not released to this account yet.';
    // jwt, ip and challenge have no Free quota (docs/edge-rules.md §Limits).
    if (plan === 'free' && r.kind === 'ip') return 'IP rules need a paid plan.';
    if (plan === 'free' && r.kind === 'challenge') return 'Challenge rules need a paid plan.';
    return null;
  };

  return (
    <div role="region" aria-label="Recipes">
      <Panel
        title="Recipes"
        help={`${stage ? `${stage} · ` : ''}Ready-made protections. Each adds one rule on every host this app serves, counting what it would refuse until you enforce it.`}
        padded={false}
      >
        <ul className="flex flex-col divide-y divide-border">
          {(Object.keys(RECIPES) as RecipeId[]).map((id) => {
            const r = RECIPES[id];
            const why = refusal(id);
            return (
              <li key={id} className="flex flex-col gap-1.5 px-5 py-3 sm:flex-row sm:items-start">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className="text-sm font-medium">{r.title}</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">{r.summary}</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">{r.logNote}</p>
                  {why && <p className="text-xs text-muted-foreground">{why}</p>}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 self-start"
                  aria-label={`Add ${r.title}`}
                  disabled={why !== null}
                  onClick={() => setAdding(id)}
                >
                  Add
                </Button>
              </li>
            );
          })}
        </ul>
      </Panel>
      {adding && (
        <RecipeDialog
          key={adding}
          slug={slug}
          recipe={adding}
          params={{}}
          onClose={() => setAdding(null)}
        />
      )}
    </div>
  );
}
