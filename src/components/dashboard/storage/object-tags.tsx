import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'iconoir-react';
import { InlinePhase, queryPhase } from '@/components/dashboard/primitives';
import { Button } from '@/components/ui/button';
import { FIELD } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import {
  clearObjectTags,
  setObjectTags,
  tagsKey,
  useObjectTags,
  type ObjectBucket,
} from '@/lib/api/object-storage';
import { storageRefusal } from './refusals';

export const MAX_TAGS = 10;
const bytes = (s: string) => new TextEncoder().encode(s).length;

/** apid's tag limits (ObjectTaggingRequest): ten tags, keys 1-128 bytes, values up to 256. */
export function tagProblems(rows: [string, string][]): string[] {
  const out: string[] = [];
  const keys = rows.map(([k]) => k.trim());
  if (rows.length > MAX_TAGS) out.push(`An object holds at most ${MAX_TAGS} tags.`);
  if (keys.some((k) => !k)) out.push('Every tag needs a key.');
  if (keys.some((k) => bytes(k) > 128)) out.push('A tag key can be at most 128 bytes.');
  if (rows.some(([, v]) => bytes(v) > 256)) out.push('A tag value can be at most 256 bytes.');
  if (new Set(keys).size !== keys.length) out.push('Tag keys must be unique.');
  return out;
}

/**
 * The current object's tags, which lifecycle rules can filter on. A change
 * replaces the whole set in place: no new version is written.
 */
export function ObjectTags({
  slug,
  bucket,
  objectKey,
  writable,
}: {
  slug: string;
  bucket: ObjectBucket;
  objectKey: string;
  writable: boolean;
}) {
  const tags = useObjectTags(slug, bucket.id, objectKey);
  const phase = queryPhase({ loading: tags.isPending, error: tags.error });
  const [rows, setRows] = useState<[string, string][] | null>(null);
  const [tried, setTried] = useState(false);
  const cache = useQueryClient();
  const { toast } = useToast();
  const save = useMutation({
    mutationFn: (next: [string, string][]) =>
      next.length
        ? setObjectTags(
            slug,
            bucket.id,
            objectKey,
            Object.fromEntries(next.map(([k, v]) => [k.trim(), v]))
          )
        : clearObjectTags(slug, bucket.id, objectKey),
    onSuccess: (result) => {
      cache.setQueryData(tagsKey(slug, bucket.id, objectKey), result);
      setRows(null);
      toast({ kind: 'success', title: `Tags saved on ${objectKey}` });
    },
    onError: (error) =>
      toast({
        kind: 'error',
        title: 'Tags were not saved',
        description: storageRefusal(error),
        error,
      }),
  });
  const current = Object.entries(tags.data?.tags ?? {});
  const problems = rows ? tagProblems(rows) : [];

  return (
    <div
      role="group"
      aria-label={`Tags on ${objectKey}`}
      className="flex basis-full flex-col gap-3 well rounded-xl bg-muted/40 p-4"
    >
      {phase !== 'ready' ? (
        <InlinePhase
          phase={phase}
          error={tags.error}
          loadingMessage="Loading tags…"
          onRetry={() => void tags.refetch()}
        />
      ) : rows ? (
        <form
          aria-label={`Edit tags on ${objectKey}`}
          noValidate
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setTried(true);
            if (problems.length === 0) save.mutate(rows);
          }}
        >
          {rows.length === 0 && (
            <p className="text-sm text-muted-foreground">No tags. Saving removes every tag.</p>
          )}
          {rows.map(([k, v], i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <input
                aria-label={`Tag ${i + 1} key`}
                className={cn(FIELD, 'w-40 font-mono')}
                value={k}
                spellCheck={false}
                onChange={(e) =>
                  setRows(rows.map((row, j) => (j === i ? [e.target.value, row[1]] : row)))
                }
              />
              <span aria-hidden="true" className="text-muted-foreground">
                =
              </span>
              <input
                aria-label={`Tag ${i + 1} value`}
                className={cn(FIELD, 'w-48 font-mono')}
                value={v}
                spellCheck={false}
                onChange={(e) =>
                  setRows(rows.map((row, j) => (j === i ? [row[0], e.target.value] : row)))
                }
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`Remove tag ${i + 1}`}
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
              >
                Remove
              </Button>
            </div>
          ))}
          {tried &&
            problems.map((p) => (
              <p key={p} className="text-xs" style={{ color: 'var(--status-critical)' }}>
                {p}
              </p>
            ))}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={rows.length >= MAX_TAGS}
              onClick={() => setRows([...rows, ['', '']])}
            >
              <Plus aria-hidden="true" className="h-3.5 w-3.5" />
              Add tag
            </Button>
            <Button type="submit" size="sm" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save tags'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setRows(null)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {current.length === 0 ? (
            <span className="text-sm text-muted-foreground">No tags.</span>
          ) : (
            <ul aria-label={`Tags of ${objectKey}`} className="flex flex-wrap gap-1.5">
              {current.map(([k, v]) => (
                <li key={k} className="well rounded-xl bg-muted/40 px-2 py-0.5 font-mono text-xs">
                  {k}={v}
                </li>
              ))}
            </ul>
          )}
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            disabled={!writable}
            onClick={() => {
              setTried(false);
              setRows(current);
            }}
          >
            Edit tags
          </Button>
        </div>
      )}
    </div>
  );
}
