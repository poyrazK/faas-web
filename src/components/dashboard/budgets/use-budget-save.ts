import { useQueryClient } from '@tanstack/react-query';
import { useConfirm } from '@/components/ui/confirm';
import { ApiError } from '@/lib/api/errors';
import {
  budgetKeys,
  useCreateBudget,
  useOperationKey,
  usePreviewBudget,
  useUpdateBudget,
  type BudgetSubject,
} from '@/lib/api/budgets';
import {
  budgetLevel,
  budgetRefusal,
  budgetUnit,
  formatBudgetAmount,
  stopSummary,
  type Budget,
  type BudgetPreview,
  type BudgetSpec,
} from '@/lib/budgets';
import type { ScopeLabel } from './budget-bits';

export type SaveOutcome =
  | { kind: 'saved'; budget: Budget }
  | { kind: 'cancelled' }
  | { kind: 'refused'; error: unknown; message: string; strictNotReleased: boolean };

/** Whether two specs ask for the same thing; a preview of one stands for the other. */
export const sameSpec = (a: BudgetSpec, b: BudgetSpec) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Saves a budget the way every write of one should go: an automatic stop is
 * confirmed first, naming what it stops from a preview of this exact spec,
 * and a refusal comes back in words, with "not released" told apart so the
 * page stops offering what apid refuses.
 */
export function useBudgetSave(subject: BudgetSubject, scopeLabel: ScopeLabel) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const preview = usePreviewBudget(subject);
  const create = useCreateBudget(subject);
  const update = useUpdateBudget(subject);
  const { keyFor, settle } = useOperationKey();

  const save = async (
    spec: BudgetSpec,
    existing?: Budget,
    known?: { spec: BudgetSpec; preview: BudgetPreview }
  ): Promise<SaveOutcome & { preview?: BudgetPreview }> => {
    const level = budgetLevel(spec);
    let seen = known && sameSpec(known.spec, spec) ? known.preview : undefined;
    if (spec.enabled && (level === 'stop-previews' || level === 'strict')) {
      // The names are what make the confirm worth reading; without a preview
      // the summary names the scope instead of guessing its members.
      seen ??= await preview.mutateAsync(spec).catch(() => undefined);
      const already =
        level === 'stop-previews' && seen?.known_limit_reached
          ? `Known compute this month is already ${formatBudgetAmount(seen.known_millicents, budgetUnit(spec.meters))}, so this happens at the next evaluation. `
          : '';
      const ok = await confirm({
        title: existing?.spec.enabled ? `Save ${spec.name}?` : `Turn on ${spec.name}?`,
        description: already + stopSummary(spec, scopeLabel(spec.scope), seen),
        confirmLabel: level === 'strict' ? 'Turn on strict cap' : 'Turn on preview stop',
        destructive: true,
      });
      if (!ok) return { kind: 'cancelled', preview: seen };
    }
    const key = keyFor(JSON.stringify(existing ? [existing.id, existing.revision, spec] : spec));
    try {
      const budget = existing
        ? await update.mutateAsync({ id: existing.id, revision: existing.revision, spec, key })
        : await create.mutateAsync({ spec, key });
      settle();
      return { kind: 'saved', budget, preview: seen };
    } catch (error) {
      settle(error);
      // A stale revision: read the current one so the next attempt is against it.
      if (existing && error instanceof ApiError && error.code === 'conflict')
        void qc.invalidateQueries({ queryKey: budgetKeys.detail(subject, existing.id) });
      return {
        kind: 'refused',
        error,
        ...budgetRefusal(error, spec, refusalSubject(subject)),
        preview: seen,
      };
    }
  };

  return {
    save,
    pending: preview.isPending || create.isPending || update.isPending,
  };
}

/** Who an organization's refusal names; undefined for the account. */
export const refusalSubject = (subject: BudgetSubject) =>
  subject.kind === 'org'
    ? { kind: 'org' as const, label: subject.label ?? subject.slug }
    : undefined;
