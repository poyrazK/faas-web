import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { InlinePhase, Panel, queryPhase } from '@/components/dashboard/primitives';
import { PlanGated, isPlanGate } from '@/components/dashboard/plan-gated';
import { useEdgeRuleSuggestions } from '@/lib/api/edge-rules';
import { useCreateEdgeRule } from '@/lib/api/queries';
import { useCapabilityAccess, useCapabilityStage } from '@/lib/api/capabilities';
import { errorMessage } from '@/lib/api/errors';
import {
  RECIPES,
  buildRecipe,
  isRecipeId,
  recipeEffect,
  type RecipeId,
} from '@/lib/edge-rule-recipes';
import { TextField, ToggleRow } from './fields';

/**
 * Protections suggested from the app's own traffic over the last week, or the
 * plan's telemetry retention when shorter (faas suggestions.go:28-104). The
 * endpoint is read-only: a suggestion names a recipe and its parameters, and
 * applying it creates one ordinary rule through the create route, in log mode
 * unless the person enforces it now — as apid's own page and the CLI do
 * (handlers_dashboard_edge_rules.go:642-693). Plans without request analytics
 * get 402 `plan_feature_gated`.
 */
export function EdgeRuleSuggestions({ slug }: { slug: string }) {
  const stage = useCapabilityStage('edge-rule-suggestions');
  const q = useEdgeRuleSuggestions(slug);
  const [applying, setApplying] = useState<{
    recipe: RecipeId;
    params: Record<string, string>;
  } | null>(null);
  const suggestions = q.data?.suggestions ?? [];
  const days = q.data?.window?.replace(/d$/, '');
  const phase = queryPhase({
    error: isPlanGate(q.error) ? null : q.error,
    loading: q.isPending && !q.error,
    isEmpty: !suggestions.length,
  });

  return (
    <PlanGated error={q.error} feature="Suggested protections">
      <Panel
        title="Suggested protections"
        description={`${stage ? `${stage} · ` : ''}From the last ${days ? `${days} ${days === '1' ? 'day' : 'days'}` : 'week'} of this app's traffic. Each adds one rule, which counts before it refuses unless you enforce it now.`}
        padded={false}
      >
        {phase !== 'ready' ? (
          <div className="p-5">
            <InlinePhase
              phase={phase}
              error={q.error}
              loadingMessage="Reading traffic…"
              emptyMessage="Nothing to suggest: no bot surge, busy sign-in path, open admin area or scanner probes in the window."
              onRetry={() => void q.refetch()}
            />
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {suggestions.map((s) => (
              <li
                key={`${s.recipe}:${JSON.stringify(s.params ?? {})}`}
                className="flex flex-col gap-2 px-5 py-3"
              >
                <p className="text-sm font-medium">{s.title}</p>
                <p className="text-xs leading-relaxed text-muted-foreground">{s.reason}</p>
                <div className="flex flex-wrap items-center gap-3">
                  {isRecipeId(s.recipe) ? (
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`Add ${s.title}`}
                      onClick={() =>
                        setApplying({ recipe: s.recipe as RecipeId, params: s.params ?? {} })
                      }
                    >
                      Add
                    </Button>
                  ) : (
                    <code className="font-mono text-xs text-muted-foreground">
                      gregale edge rule recipe {s.recipe}
                    </code>
                  )}
                  {s.alternative && isRecipeId(s.alternative.recipe) && (
                    <button
                      type="button"
                      onClick={() =>
                        setApplying({
                          recipe: s.alternative!.recipe as RecipeId,
                          params: s.alternative!.params ?? {},
                        })
                      }
                      className="text-xs text-brand transition-colors hover:text-brand-hover"
                    >
                      {s.alternative.title} instead
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {applying && (
        <RecipeDialog
          key={`${applying.recipe}:${JSON.stringify(applying.params)}`}
          slug={slug}
          recipe={applying.recipe}
          params={applying.params}
          onClose={() => setApplying(null)}
        />
      )}
    </PlanGated>
  );
}

function RecipeDialog({
  slug,
  recipe,
  params,
  onClose,
}: {
  slug: string;
  recipe: RecipeId;
  params: Record<string, string>;
  onClose: () => void;
}) {
  const def = RECIPES[recipe];
  // apid's page leaves the penalty field out until penalties are released to
  // the account (handlers_dashboard_edge_rules.go:707-709); apid refuses one.
  const penalty = useCapabilityAccess('edge-penalty-box').access === 'on';
  const fields = def.params.filter((p) => p.name !== 'penalty_minutes' || penalty);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((p) => [p.name, params[p.name] ?? p.default ?? '']))
  );
  const [enforce, setEnforce] = useState(false);
  const [fieldError, setFieldError] = useState<{ field?: string; message: string } | null>(null);
  const [problem, setProblem] = useState<unknown>(null);
  const create = useCreateEdgeRule();
  const confirm = useConfirm();
  const { toast } = useToast();
  const input = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim()));

  const submit = async () => {
    const built = buildRecipe(recipe, input, enforce);
    if (!built.ok) {
      setFieldError(built);
      return;
    }
    setFieldError(null);
    if (
      !(await confirm({
        title: 'Add this rule?',
        description: recipeEffect(recipe, input, enforce),
        confirmLabel: 'Add rule',
        destructive: enforce,
      }))
    )
      return;
    setProblem(null);
    try {
      await create.mutateAsync({ slug, ...built.body });
      toast({
        kind: 'success',
        title: 'Rule added',
        description: enforce ? `${def.title}, enforced.` : `${def.title}, in log mode.`,
      });
      onClose();
    } catch (err) {
      setProblem(err);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={def.title}
      description="Applies to every host this app serves, including custom domains added later."
      width="max-w-xl"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={create.isPending} onClick={() => void submit()}>
            {create.isPending ? 'Adding…' : 'Add rule'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {problem != null && (
          <p role="alert" className="text-xs text-[color:var(--status-critical)]">
            {errorMessage(problem)}
          </p>
        )}
        {fieldError && !fieldError.field && (
          <p role="alert" className="text-xs text-[color:var(--status-critical)]">
            {fieldError.message}
          </p>
        )}
        {fields.map((p) => (
          <TextField
            key={p.name}
            label={p.label}
            hint={p.help}
            error={fieldError?.field === p.name ? fieldError.message : undefined}
            value={values[p.name] ?? ''}
            placeholder={p.placeholder}
            onChange={(v) => setValues((cur) => ({ ...cur, [p.name]: v }))}
          />
        ))}
        <div className="border-t border-border">
          <ToggleRow
            label="Enforce now"
            hint="Off, the rule only counts what it would refuse, so you can check it first. On, it refuses from the moment it is created."
            checked={enforce}
            onChange={setEnforce}
          />
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {recipeEffect(recipe, input, enforce)}
        </p>
      </div>
    </Modal>
  );
}
