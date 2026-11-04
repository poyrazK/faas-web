import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, Circle, Plus } from 'iconoir-react';
import { InlinePhase, queryPhase } from '@/components/dashboard/primitives';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { FIELD, FieldError } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api/errors';
import { cn } from '@/lib/utils';
import {
  clearBucketNotifications,
  notificationsKey,
  setBucketNotifications,
  useBucketNotifications,
  type NotificationRule,
  type ObjectBucket,
} from '@/lib/api/object-storage';
import { storageRefusal } from './refusals';
import { StatusChip } from './status-chip';

type Event = NotificationRule['events'][number];

/** Every event apid routes, in the words the console uses for them. */
export const EVENTS: readonly { event: Event; label: string }[] = [
  { event: 's3:ObjectCreated:*', label: 'Any write' },
  { event: 's3:ObjectCreated:Put', label: 'Uploads' },
  { event: 's3:ObjectCreated:Copy', label: 'Copies' },
  { event: 's3:ObjectCreated:CompleteMultipartUpload', label: 'Finished multipart uploads' },
  { event: 's3:ObjectRemoved:*', label: 'Any delete' },
  { event: 's3:ObjectRemoved:Delete', label: 'Deletes' },
  { event: 's3:ObjectRemoved:DeleteMarkerCreated', label: 'Delete markers' },
  { event: 's3:LifecycleExpiration:*', label: 'Any cleanup-rule expiry' },
  { event: 's3:LifecycleExpiration:Delete', label: 'Cleanup-rule deletions' },
  { event: 's3:LifecycleExpiration:DeleteMarkerCreated', label: 'Cleanup-rule delete markers' },
];
const LABEL_OF = new Map(EVENTS.map((e) => [e.event, e.label]));
const LABEL = 'flex flex-col gap-1 text-xs text-muted-foreground';

/** A Gregale function or queue in this account (faas ObjectNotificationRule.destination). */
const DESTINATION =
  /^arn:gregale:(lambda:[^:\s]+:[^:\s]+:function:[0-9a-f-]{36}|sqs:[^:\s]+:[^:\s]+:[0-9a-f-]{36}\/\S+)$/;

interface Draft {
  id: string;
  destination: string;
  events: Event[];
  prefix: string;
  suffix: string;
}

const blank = (): Draft => ({
  id: '',
  destination: '',
  events: ['s3:ObjectCreated:*'],
  prefix: '',
  suffix: '',
});
const toDraft = (r: NotificationRule): Draft => ({
  id: r.id ?? '',
  destination: r.destination,
  events: [...r.events],
  prefix: r.prefix ?? '',
  suffix: r.suffix ?? '',
});
export function fromDraft(d: Draft): NotificationRule {
  return {
    ...(d.id.trim() ? { id: d.id.trim() } : {}),
    destination: d.destination.trim(),
    events: [...d.events],
    ...(d.prefix ? { prefix: d.prefix } : {}),
    ...(d.suffix ? { suffix: d.suffix } : {}),
  };
}

export function notificationProblems(drafts: Draft[]): string[][] {
  const ids = drafts.map((d) => d.id.trim()).filter(Boolean);
  const repeated = new Set(ids.filter((id, i) => ids.indexOf(id) !== i));
  return drafts.map((d) => {
    const out: string[] = [];
    if (!DESTINATION.test(d.destination.trim()))
      out.push(
        'The destination is a function ARN (arn:gregale:lambda:REGION:ACCOUNT:function:APP_ID) or a queue ARN (arn:gregale:sqs:REGION:ACCOUNT:APP_ID/QUEUE).'
      );
    if (d.events.length === 0) out.push('Choose at least one event.');
    if (d.prefix.length > 1024 || d.suffix.length > 1024)
      out.push('A prefix or suffix is at most 1024 characters.');
    if (repeated.has(d.id.trim())) out.push('Rule IDs must be unique.');
    return out;
  });
}

export function notificationSentence(r: NotificationRule): string {
  const events = r.events.map((e) => LABEL_OF.get(e) ?? e).join(', ');
  const filter = [r.prefix && `under ${r.prefix}`, r.suffix && `ending ${r.suffix}`]
    .filter(Boolean)
    .join(' ');
  const target = r.destination.startsWith('arn:gregale:sqs:') ? 'queue' : 'function';
  return `${events}${filter ? ` ${filter}` : ''} → ${target}`;
}

/**
 * Where this bucket's changes are sent: Gregale functions or queues in this
 * account and region. apid replaces the rule set as a unit; an empty set
 * clears it. Rules an app's compute triggers manage come from its manifest.
 */
export function NotificationsSetting({
  slug,
  bucket,
  enabled,
  onEditing,
}: {
  slug: string;
  bucket: ObjectBucket;
  enabled: boolean;
  onEditing: (editing: boolean) => void;
}) {
  const query = useBucketNotifications(slug, bucket.id);
  const phase = queryPhase({ loading: query.isPending, error: query.error });
  const rules = query.data?.rules ?? [];
  const managed = new Set(query.data?.managed_rule_ids ?? []);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [tried, setTried] = useState(false);
  const cache = useQueryClient();
  const confirm = useConfirm();
  const { toast } = useToast();
  const edit = (next: Draft[] | null) => {
    setDrafts(next);
    setTried(false);
    onEditing(next !== null);
  };
  const save = useMutation({
    mutationFn: (next: NotificationRule[]) =>
      next.length
        ? setBucketNotifications(slug, bucket.id, next)
        : clearBucketNotifications(slug, bucket.id),
    onSuccess: (stored) => {
      cache.setQueryData(notificationsKey(slug, bucket.id), stored);
      edit(null);
      toast({
        kind: 'success',
        title: stored.rules.length ? 'Notification rules saved' : 'Notification rules removed',
      });
    },
    onError: (error) =>
      toast({
        kind: 'error',
        title: 'Notification rules were not saved',
        description:
          error instanceof ApiError && error.code === 'validation_failed'
            ? 'apid refused a rule: each destination must be your own function or queue in this region, and two rules cannot send the same event for overlapping keys.'
            : storageRefusal(error),
        error,
      }),
  });
  const problems = drafts ? notificationProblems(drafts) : [];

  const submit = async () => {
    if (!drafts) return;
    setTried(true);
    if (problems.some((p) => p.length)) return;
    const keptManaged = rules.filter((r) => r.id && managed.has(r.id));
    const next = [...keptManaged, ...drafts.map(fromDraft)];
    if (keptManaged.length) {
      const ok = await confirm({
        title: 'Take over the rules your app manages?',
        description: `Saving replaces every rule. The ${keptManaged.length} your app's compute triggers manage are kept, but become ordinary rules that a later deploy cannot update until you remove them here.`,
        confirmLabel: 'Save rules',
        destructive: true,
      });
      if (!ok) return;
    } else if (next.length === 0) {
      const ok = await confirm({
        title: `Stop sending ${bucket.name}'s changes anywhere?`,
        description:
          'Every rule is removed. Changes already accepted are still delivered to the destinations they were captured with.',
        confirmLabel: 'Remove rules',
        destructive: true,
      });
      if (!ok) return;
    }
    save.mutate(next);
  };

  const own = rules.filter((r) => !(r.id && managed.has(r.id)));
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Change notifications</h3>
        {phase === 'ready' && !drafts && (
          <div className="flex items-center gap-2">
            {rules.length ? (
              <StatusChip
                tone="good"
                icon={Bell}
                label={`${rules.length} ${rules.length === 1 ? 'rule' : 'rules'}`}
              />
            ) : (
              <StatusChip tone="muted" icon={Circle} label="None" />
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={!enabled}
              onClick={() => edit(own.map(toDraft))}
            >
              {own.length ? 'Edit rules' : 'Add rules'}
            </Button>
          </div>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        Send writes and deletes in this bucket to a function or queue. Every confirmed write also
        emits <code className="font-mono">object.created</code> on the{' '}
        <code className="font-mono">gregale.storage</code> event source.
      </p>
      {phase !== 'ready' ? (
        <InlinePhase phase={phase} error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          {rules.length > 0 && (
            <ul className="flex flex-col gap-2">
              {rules
                .filter((r) => !drafts || (r.id && managed.has(r.id)))
                .map((r, i) => (
                  <li key={r.id ?? i} className="storage-rule flex flex-wrap gap-x-3 text-sm">
                    <span
                      aria-hidden="true"
                      className="storage-rule__tick mt-2 h-px w-3 shrink-0"
                    />
                    <span>{notificationSentence(r)}</span>
                    <code className="break-all font-mono text-xs text-muted-foreground">
                      {r.destination}
                    </code>
                    {r.id && managed.has(r.id) && (
                      <span className="text-xs text-muted-foreground">
                        From your app&apos;s compute triggers
                      </span>
                    )}
                  </li>
                ))}
            </ul>
          )}
          {rules.length === 0 && !drafts && (
            <p className="text-sm text-muted-foreground">No rules. Changes go nowhere.</p>
          )}
          {drafts && (
            <form
              aria-label={`Notification rules for ${bucket.name}`}
              noValidate
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              {drafts.map((draft, i) => (
                <RuleFields
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
                disabled={drafts.length >= 1000}
                onClick={() => setDrafts([...drafts, blank()])}
              >
                <Plus aria-hidden="true" className="h-3.5 w-3.5" />
                Add notification rule
              </Button>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" size="sm" disabled={save.isPending}>
                  {save.isPending ? 'Saving…' : 'Save notification rules'}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => edit(null)}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </>
      )}
    </>
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
  draft: Draft;
  problems: string[];
  onChange: (patch: Partial<Draft>) => void;
  onRemove: () => void;
}) {
  const errorId = useId();
  const name = `Notification rule ${index + 1}`;
  return (
    <fieldset
      aria-describedby={problems.length ? errorId : undefined}
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-border p-4"
    >
      <legend className="px-1 text-xs font-medium">{name}</legend>
      <div className="flex flex-wrap items-end gap-3">
        <label className={cn(LABEL, 'min-w-0 flex-1')}>
          Destination ARN
          <input
            className={cn(FIELD, 'font-mono')}
            value={draft.destination}
            placeholder="arn:gregale:lambda:REGION:ACCOUNT:function:APP_ID"
            spellCheck={false}
            onChange={(e) => onChange({ destination: e.target.value })}
          />
        </label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Remove ${name.toLowerCase()}`}
          onClick={onRemove}
        >
          Remove
        </Button>
      </div>
      <fieldset className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
        <legend className="mb-1 text-xs text-muted-foreground">Events</legend>
        {EVENTS.map(({ event, label }) => (
          <label key={event} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.events.includes(event)}
              onChange={(e) =>
                onChange({
                  events: e.target.checked
                    ? EVENTS.map((x) => x.event).filter(
                        (x) => x === event || draft.events.includes(x)
                      )
                    : draft.events.filter((x) => x !== event),
                })
              }
            />
            {label}
          </label>
        ))}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className={LABEL}>
          Rule ID
          <input
            className={cn(FIELD, 'font-mono')}
            value={draft.id}
            placeholder="Generated if empty"
            spellCheck={false}
            onChange={(e) => onChange({ id: e.target.value })}
          />
        </label>
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
          Only keys ending with
          <input
            className={cn(FIELD, 'font-mono')}
            value={draft.suffix}
            placeholder=".png"
            spellCheck={false}
            onChange={(e) => onChange({ suffix: e.target.value })}
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
