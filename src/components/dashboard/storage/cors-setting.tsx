import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, Circle, Plus } from 'iconoir-react';
import { InlinePhase, queryPhase } from '@/components/dashboard/primitives';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { FIELD, FieldError, Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import {
  clearBucketCors,
  corsKey,
  setBucketCors,
  useBucketCors,
  type ObjectBucket,
} from '@/lib/api/object-storage';
import {
  blankCorsDraft,
  CORS_METHODS,
  corsFromDraft,
  corsProblems,
  corsSentence,
  corsToDraft,
  MAX_CORS_RULES,
  type CorsDraft,
} from './cors-draft';
import { storageRefusal } from './refusals';
import { StatusChip } from './status-chip';

const LABEL = 'flex flex-col gap-1 text-xs text-muted-foreground';

/**
 * Which of your own sites may use this bucket's signed URLs and upload grants
 * from a browser (faas ADR-20261025202805). The branded S3 endpoint applies
 * the first rule matching a request's origin, method and headers.
 */
export function CorsSetting({
  slug,
  bucket,
  onEditing,
}: {
  slug: string;
  bucket: ObjectBucket;
  onEditing: (editing: boolean) => void;
}) {
  const cors = useBucketCors(slug, bucket.id);
  const phase = queryPhase({ loading: cors.isPending, error: cors.error });
  const rules = cors.data?.rules ?? [];
  const [drafts, setDrafts] = useState<CorsDraft[] | null>(null);
  const [tried, setTried] = useState(false);
  const cache = useQueryClient();
  const confirm = useConfirm();
  const { toast } = useToast();
  const edit = (next: CorsDraft[] | null) => {
    setDrafts(next);
    setTried(false);
    onEditing(next !== null);
  };
  const save = useMutation({
    mutationFn: async (next: CorsDraft[]) => {
      if (next.length) return setBucketCors(slug, bucket.id, next.map(corsFromDraft));
      await clearBucketCors(slug, bucket.id);
      return null;
    },
    onSuccess: (stored) => {
      if (stored) cache.setQueryData(corsKey(slug, bucket.id), stored);
      else void cache.invalidateQueries({ queryKey: corsKey(slug, bucket.id) });
      edit(null);
      toast({ kind: 'success', title: stored ? 'CORS rules saved' : 'CORS rules removed' });
    },
    onError: (error) =>
      toast({
        kind: 'error',
        title: 'CORS rules were not saved',
        description: storageRefusal(error),
        error,
      }),
  });
  const problems = drafts ? corsProblems(drafts) : [];

  const submit = async () => {
    if (!drafts) return;
    setTried(true);
    if (problems.some((p) => p.length)) return;
    if (drafts.length === 0) {
      const ok = await confirm({
        title: `Remove every CORS rule from ${bucket.name}?`,
        description:
          "Pages on your own sites can no longer use this bucket's signed URLs or upload grants from a browser. The console's own pages stay allowed.",
        confirmLabel: 'Remove rules',
        destructive: true,
      });
      if (!ok) return;
    }
    save.mutate(drafts);
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Browser access (CORS)</h3>
        {phase === 'ready' && !drafts && (
          <div className="flex items-center gap-2">
            {rules.length > 0 ? (
              <StatusChip
                tone="good"
                icon={CheckCircle}
                label={`${rules.length} ${rules.length === 1 ? 'rule' : 'rules'}`}
              />
            ) : (
              <StatusChip tone="muted" icon={Circle} label="Console only" />
            )}
            <Button variant="outline" size="sm" onClick={() => edit(rules.map(corsToDraft))}>
              {rules.length ? 'Edit rules' : 'Add rules'}
            </Button>
          </div>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        Lets pages on your own sites use this bucket&apos;s signed URLs and upload grants from a
        browser. CORS is not authorization: every request still needs a signature or grant.
      </p>
      {phase !== 'ready' ? (
        <InlinePhase phase={phase} error={cors.error} onRetry={() => void cors.refetch()} />
      ) : drafts ? (
        <form
          aria-label={`CORS rules for ${bucket.name}`}
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {drafts.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No rules. Saving now removes every rule from this bucket.
            </p>
          )}
          {drafts.map((draft, i) => (
            <CorsRuleFields
              key={i}
              index={i}
              draft={draft}
              problems={tried ? (problems[i] ?? []) : []}
              onChange={(patch) =>
                setDrafts(drafts.map((d, j) => (j === i ? { ...d, ...patch } : d)))
              }
              onRemove={() => setDrafts(drafts.filter((_, j) => j !== i))}
            />
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            disabled={drafts.length >= MAX_CORS_RULES}
            onClick={() => setDrafts([...drafts, blankCorsDraft()])}
          >
            <Plus aria-hidden="true" className="h-3.5 w-3.5" />
            Add CORS rule
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save CORS rules'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={save.isPending}
              onClick={() => edit(null)}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : rules.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No rules. Only the Gregale console&apos;s own pages can use signed URLs from a browser.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rules.map((rule, i) => (
            <li key={rule.id ?? i} className="storage-rule flex gap-3 text-sm">
              <span aria-hidden="true" className="storage-rule__tick mt-2 h-px w-3 shrink-0" />
              <span className="break-all">{corsSentence(rule)}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function CorsRuleFields({
  index,
  draft,
  problems,
  onChange,
  onRemove,
}: {
  index: number;
  draft: CorsDraft;
  problems: string[];
  onChange: (patch: Partial<CorsDraft>) => void;
  onRemove: () => void;
}) {
  const errorId = useId();
  const name = `CORS rule ${index + 1}`;
  return (
    <fieldset
      aria-describedby={problems.length ? errorId : undefined}
      className="flex min-w-0 flex-col gap-3 well rounded-xl bg-muted/40 p-4"
    >
      <legend className="px-1 text-xs font-medium">{name}</legend>
      <div className="flex flex-wrap items-end gap-3">
        <label className={LABEL}>
          Rule ID
          <input
            className={cn(FIELD, 'font-mono')}
            value={draft.id}
            maxLength={255}
            placeholder="Optional"
            spellCheck={false}
            onChange={(e) => onChange({ id: e.target.value })}
          />
        </label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto"
          aria-label={`Remove ${name}`}
          onClick={onRemove}
        >
          Remove
        </Button>
      </div>
      <label className={LABEL}>
        Allowed origins, one per line
        <Textarea
          rows={2}
          className="font-mono"
          value={draft.origins}
          placeholder="https://app.example.com"
          spellCheck={false}
          onChange={(e) => onChange({ origins: e.target.value })}
        />
      </label>
      <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <legend className="mb-1 text-xs text-muted-foreground">Allowed methods</legend>
        {CORS_METHODS.map((method) => (
          <label key={method} className="flex items-center gap-2 font-mono text-xs">
            <input
              type="checkbox"
              checked={draft.methods.includes(method)}
              onChange={(e) =>
                onChange({
                  methods: e.target.checked
                    ? CORS_METHODS.filter((m) => m === method || draft.methods.includes(m))
                    : draft.methods.filter((m) => m !== method),
                })
              }
            />
            {method}
          </label>
        ))}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className={LABEL}>
          Request headers allowed
          <input
            className={cn(FIELD, 'font-mono')}
            value={draft.headers}
            placeholder="content-type"
            spellCheck={false}
            onChange={(e) => onChange({ headers: e.target.value })}
          />
        </label>
        <label className={LABEL}>
          Response headers exposed
          <input
            className={cn(FIELD, 'font-mono')}
            value={draft.expose}
            placeholder="ETag"
            spellCheck={false}
            onChange={(e) => onChange({ expose: e.target.value })}
          />
        </label>
        <label className={LABEL}>
          Preflight cache (seconds)
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={86400}
            className={cn(FIELD, 'tabular-nums')}
            value={draft.maxAge}
            placeholder="Browser default"
            onChange={(e) => onChange({ maxAge: e.target.value })}
          />
        </label>
      </div>
      {problems.length > 0 && (
        <div id={errorId} className="flex flex-col gap-1">
          {problems.map((p) => (
            <FieldError key={p} id={`${errorId}-${p}`}>
              {p}
            </FieldError>
          ))}
        </div>
      )}
    </fieldset>
  );
}
