import { Plus, Trash } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { FIELD, FieldError, Select, fieldErrorProps } from '@/components/ui/field';
import { MAX_FAILURE_RULES, type FailureRuleDraft, type FailureRulesDraft } from '@/lib/job-drafts';

/**
 * The explicit failure classification a job, or one of its runs, applies to
 * a confirmed failed result (faas FailureRules; docs/jobs.md "Retry
 * classification can be explicit"). A rule maps exit codes, or the outcome
 * codes the task writes in its result manifest, to `retry` (keep the
 * remaining attempts) or `fail_partition` (stop retrying this input). A
 * mapped outcome code wins even over a zero exit.
 *
 * The lost-receipt choice is the one with a real cost, so its retry option
 * says it can run the work twice.
 */
export function FailureRulesFields({
  id,
  value,
  onChange,
  errors,
  lockedOn = false,
  toggleLabel,
  toggleHint,
}: {
  /** Prefix for control ids, so two editors on a page stay distinct. */
  id: string;
  value: FailureRulesDraft;
  onChange: (next: FailureRulesDraft) => void;
  errors?: { rules?: (string | undefined)[] };
  /** A stored policy can be replaced through PATCH but not removed. */
  lockedOn?: boolean;
  toggleLabel: string;
  toggleHint?: string;
}) {
  const set = (patch: Partial<FailureRulesDraft>) => onChange({ ...value, ...patch });
  const setRule = (index: number, patch: Partial<FailureRuleDraft>) =>
    set({ rules: value.rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)) });
  return (
    <div className="space-y-3">
      <label className="flex items-start gap-2 text-xs">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={value.enabled}
          disabled={lockedOn}
          onChange={(e) => set({ enabled: e.target.checked })}
        />
        <span>
          <span className="font-medium">{toggleLabel}</span>
          {toggleHint && <span className="block text-muted-foreground">{toggleHint}</span>}
          {lockedOn && (
            <span className="block text-muted-foreground">
              Rules once set can be changed but not removed.
            </span>
          )}
        </span>
      </label>
      {value.enabled && (
        <div className="space-y-4">
          {value.rules.length > 0 && (
            <ol aria-label="Failure rules" className="space-y-3">
              {value.rules.map((rule, index) => {
                const error = errors?.rules?.[index];
                const codesId = `${id}-rule-${index}-codes`;
                return (
                  <li
                    key={index}
                    className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-[9rem_1fr_10rem_auto] sm:items-start"
                  >
                    <Select
                      aria-label={`Rule ${index + 1} matches`}
                      value={rule.kind}
                      onChange={(e) =>
                        setRule(index, { kind: e.target.value as FailureRuleDraft['kind'] })
                      }
                    >
                      <option value="exit">Exit codes</option>
                      <option value="outcome">Outcome codes</option>
                    </Select>
                    <div className="space-y-1">
                      <input
                        id={codesId}
                        name={codesId}
                        aria-label={`Rule ${index + 1} codes`}
                        className={`${FIELD} w-full font-mono`}
                        placeholder={rule.kind === 'exit' ? '65, 66' : 'invalid_record'}
                        value={rule.codes}
                        onChange={(e) => setRule(index, { codes: e.target.value })}
                        {...fieldErrorProps(error, `${codesId}-error`)}
                      />
                      {error && <FieldError id={`${codesId}-error`}>{error}</FieldError>}
                    </div>
                    <Select
                      aria-label={`Rule ${index + 1} action`}
                      value={rule.action}
                      onChange={(e) =>
                        setRule(index, { action: e.target.value as FailureRuleDraft['action'] })
                      }
                    >
                      <option value="retry">Retry</option>
                      <option value="fail_partition">Fail the partition</option>
                    </Select>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Remove rule ${index + 1}`}
                      onClick={() => set({ rules: value.rules.filter((_, i) => i !== index) })}
                    >
                      <Trash className="h-4 w-4" />
                    </Button>
                  </li>
                );
              })}
            </ol>
          )}
          {errors?.rules?.[MAX_FAILURE_RULES] && (
            <FieldError id={`${id}-too-many`}>{errors.rules[MAX_FAILURE_RULES]}</FieldError>
          )}
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={value.rules.length >= MAX_FAILURE_RULES}
            onClick={() =>
              set({
                rules: [...value.rules, { kind: 'exit', codes: '', action: 'fail_partition' }],
              })
            }
          >
            <Plus className="h-3.5 w-3.5" />
            Add rule
          </Button>
          <p className="text-xs text-muted-foreground">
            Retry keeps the partition’s remaining attempts; Fail the partition stops retrying that
            input. Outcome codes are what the task writes as outcome_code in its result manifest,
            and a mapped one decides even when the command exits 0.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor={`${id}-unmatched`} className="text-xs font-medium">
                Any other failure
              </label>
              <Select
                id={`${id}-unmatched`}
                className="w-full"
                value={value.unmatched}
                onChange={(e) =>
                  set({ unmatched: e.target.value as FailureRulesDraft['unmatched'] })
                }
              >
                <option value="retry">Retry</option>
                <option value="fail_partition">Fail the partition</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor={`${id}-uncertain`} className="text-xs font-medium">
                Completion receipt lost
              </label>
              <Select
                id={`${id}-uncertain`}
                className="w-full"
                value={value.uncertain}
                onChange={(e) =>
                  set({ uncertain: e.target.value as FailureRulesDraft['uncertain'] })
                }
              >
                <option value="hold">Hold for reconciliation</option>
                <option value="retry">Retry (may run twice)</option>
              </Select>
              {value.uncertain === 'retry' && (
                <p className="text-xs text-[color:var(--status-warning)]">
                  Retrying a lost receipt can repeat work that already committed. Use it only for
                  tasks that are safe to run again.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
