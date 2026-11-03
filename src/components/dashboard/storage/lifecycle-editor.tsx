import { useId } from 'react';
import { Plus } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { FIELD, FieldError, Select } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import { blankDraft, fromDraft, MAX_RULES, ruleSentences, type RuleDraft } from './lifecycle-draft';

const LABEL = 'flex flex-col gap-1 text-xs text-muted-foreground';
const CHECK = 'flex items-center gap-2 text-sm';
const NUMBER = cn(FIELD, 'w-28 tabular-nums');

/**
 * The whole lifecycle policy as editable rules. apid replaces the policy as a
 * unit (PUT takes every rule), so the form edits a copy and saves it at once.
 */
export function LifecycleEditor({
  drafts,
  problems,
  showProblems,
  onChange,
}: {
  drafts: RuleDraft[];
  problems: string[][];
  showProblems: boolean;
  onChange: (next: RuleDraft[]) => void;
}) {
  const update = (index: number, patch: Partial<RuleDraft>) =>
    onChange(drafts.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  return (
    <div className="flex flex-col gap-4">
      {drafts.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No rules. Saving now removes every rule from this bucket.
        </p>
      )}
      {drafts.map((draft, i) => (
        <RuleFields
          key={i}
          index={i}
          draft={draft}
          problems={showProblems ? (problems[i] ?? []) : []}
          onChange={(patch) => update(i, patch)}
          onRemove={() => onChange(drafts.filter((_, j) => j !== i))}
        />
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        disabled={drafts.length >= MAX_RULES}
        onClick={() => onChange([...drafts, blankDraft()])}
      >
        <Plus aria-hidden="true" className="h-3.5 w-3.5" />
        Add rule
      </Button>
    </div>
  );
}

function RuleFields({
  index,
  draft,
  problems,
  onChange,
  onRemove,
}: {
  index: number;
  draft: RuleDraft;
  problems: string[];
  onChange: (patch: Partial<RuleDraft>) => void;
  onRemove: () => void;
}) {
  const errorId = useId();
  const name = `Rule ${index + 1}`;
  const preview = problems.length === 0 ? ruleSentences(fromDraft(draft)) : [];
  return (
    <fieldset
      aria-describedby={problems.length ? errorId : undefined}
      className="storage-rule-edit flex min-w-0 flex-col gap-4 rounded-xl border border-border p-4"
    >
      <legend className="px-1 text-xs font-medium">{name}</legend>
      <div className="flex flex-wrap items-end gap-3">
        <label className={LABEL}>
          Rule ID
          <input
            className={cn(FIELD, 'font-mono')}
            value={draft.id}
            maxLength={255}
            placeholder="Generated if empty"
            spellCheck={false}
            onChange={(e) => onChange({ id: e.target.value })}
          />
        </label>
        <label className={cn(CHECK, 'h-9')}>
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => onChange({ enabled: e.target.checked })}
          />
          Active
        </label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto"
          aria-label={`Remove ${name.toLowerCase()}`}
          onClick={onRemove}
        >
          Remove
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={LABEL}>
          Only keys starting with
          <input
            className={cn(FIELD, 'font-mono')}
            value={draft.prefix}
            placeholder="Every key"
            spellCheck={false}
            onChange={(e) => onChange({ prefix: e.target.value })}
          />
        </label>
        <label className={LABEL}>
          Only objects tagged (key=value, comma separated)
          <input
            className={cn(FIELD, 'font-mono')}
            value={draft.tags}
            placeholder="Any tags"
            spellCheck={false}
            onChange={(e) => onChange({ tags: e.target.value })}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className={LABEL}>
          Current objects
          <Select
            value={draft.expire}
            onChange={(e) => onChange({ expire: e.target.value as RuleDraft['expire'] })}
          >
            <option value="none">Keep them</option>
            <option value="days">Delete a number of days after writing</option>
            <option value="date">Delete on a date</option>
            <option value="markers">Clear delete markers left alone</option>
          </Select>
        </label>
        {draft.expire === 'days' && (
          <label className={LABEL}>
            Days after writing
            <input
              type="number"
              inputMode="numeric"
              min={1}
              className={NUMBER}
              value={draft.expireDays}
              onChange={(e) => onChange({ expireDays: e.target.value })}
            />
          </label>
        )}
        {draft.expire === 'date' && (
          <label className={LABEL}>
            Date (UTC)
            <input
              type="date"
              className={FIELD}
              value={draft.expireDate}
              onChange={(e) => onChange({ expireDate: e.target.value })}
            />
          </label>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className={cn(CHECK, 'h-9')}>
          <input
            type="checkbox"
            checked={draft.noncurrent}
            onChange={(e) => onChange({ noncurrent: e.target.checked })}
          />
          Delete old versions
        </label>
        {draft.noncurrent && (
          <>
            <label className={LABEL}>
              Days after replacement
              <input
                type="number"
                inputMode="numeric"
                min={1}
                className={NUMBER}
                value={draft.noncurrentDays}
                onChange={(e) => onChange({ noncurrentDays: e.target.value })}
              />
            </label>
            <label className={LABEL}>
              Always keep newest
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={100}
                placeholder="None"
                className={NUMBER}
                value={draft.keepNewer}
                onChange={(e) => onChange({ keepNewer: e.target.value })}
              />
            </label>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className={cn(CHECK, 'h-9')}>
          <input
            type="checkbox"
            checked={draft.abort}
            onChange={(e) => onChange({ abort: e.target.checked })}
          />
          Abort unfinished multipart uploads
        </label>
        {draft.abort && (
          <label className={LABEL}>
            Days after starting
            <input
              type="number"
              inputMode="numeric"
              min={1}
              className={NUMBER}
              value={draft.abortDays}
              onChange={(e) => onChange({ abortDays: e.target.value })}
            />
          </label>
        )}
      </div>

      {problems.length > 0 ? (
        <div id={errorId} className="flex flex-col gap-1">
          {problems.map((p) => (
            <FieldError key={p} id={`${errorId}-${p}`}>
              {p}
            </FieldError>
          ))}
        </div>
      ) : (
        preview.length > 0 && (
          <ul aria-label={`What ${name.toLowerCase()} does`} className="flex flex-col gap-1">
            {preview.map((sentence) => (
              <li key={sentence} className="storage-rule flex gap-3 text-sm text-muted-foreground">
                <span aria-hidden="true" className="storage-rule__tick mt-2 h-px w-3 shrink-0" />
                <span>{sentence}</span>
              </li>
            ))}
          </ul>
        )
      )}
    </fieldset>
  );
}
