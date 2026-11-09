import { useState, type ReactNode } from 'react';
import { NavArrowDown, Undo } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Timestamp } from '@/components/ui/timestamp';
import { InlinePhase, Panel, queryPhase } from '@/components/dashboard/primitives';
import { useRestartAction } from '@/components/dashboard/app-lifecycle';
import { useAppEnv } from '@/lib/api/queries';
import {
  useConfigGuard,
  useConfigRevision,
  useConfigRevisions,
  useRollbackConfig,
} from '@/lib/api/config-history';
import { ApiError, errorMessage } from '@/lib/api/errors';
import {
  planRollback,
  rollbackSummary,
  type ConfigGuard,
  type ConfigRevision,
  type ConfigSecretDifference,
} from '@/lib/config-history';
import { cn } from '@/lib/utils';
import {
  groupByDay,
  guardWord,
  guardState,
  guardWords,
  revisionGuardState,
  isEmptyDiff,
  revisionDiff,
  revisionWords,
  secretChangeWords,
} from './environment-words';
import { Lead, RowMenu, ToneDot, ToneWord } from './environment-parts';

type RollbackResult = NonNullable<ReturnType<typeof useRollbackConfig>['data']>;

/** A quiet "Show …" / "Hide …" toggle. */
function Disclosure({
  open,
  onToggle,
  show,
  hide,
  label,
}: {
  open: boolean;
  onToggle: () => void;
  show: string;
  hide: string;
  label?: string;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={label}
      onClick={onToggle}
      className="pressable inline-flex items-center gap-1 rounded text-[13px] text-muted-foreground hover:text-foreground"
    >
      {open ? hide : show}
      <NavArrowDown
        aria-hidden="true"
        className={cn('size-3.5 transition-transform', open && 'rotate-180')}
      />
    </button>
  );
}

/**
 * History, rollback and the config guard for one app's variables and secrets
 * (faas ADR-1451), read in plain English: what the guard is doing about the
 * newest change, then every change as a timeline grouped by day. Values never
 * appear: rows name keys, and "Show changes" and the rollback review compare
 * revisions by value without printing either side.
 */
export function ConfigHistory({ slug }: { slug: string }) {
  const [target, setTarget] = useState<number | null>(null);
  const [result, setResult] = useState<RollbackResult | null>(null);
  return (
    <div className="flex flex-col gap-4">
      <GuardWell slug={slug} />
      <Timeline
        slug={slug}
        target={target}
        onRollback={(revision) => {
          setResult(null);
          setTarget(revision);
        }}
        review={
          target != null && (
            <RollbackReview
              key={target}
              slug={slug}
              revision={target}
              onCancel={() => setTarget(null)}
              onDone={(out) => {
                setTarget(null);
                setResult(out);
              }}
            />
          )
        }
      />
      {result && <RollbackOutcome slug={slug} result={result} />}
    </div>
  );
}

function GuardWell({ slug }: { slug: string }) {
  const guard = useConfigGuard(slug);
  const revisions = useConfigRevisions(slug);
  const phase = queryPhase({ error: guard.error, loading: guard.isPending });
  const newest = revisions.data?.revisions[0]?.revision;
  return (
    <section aria-label="Config guard" className="flex flex-col gap-2">
      {phase !== 'ready' ? (
        <InlinePhase
          phase={phase}
          error={guard.error}
          loadingMessage="Reading the config guard…"
          onRetry={() => void guard.refetch()}
        />
      ) : guard.data ? (
        <GuardBody
          guard={guard.data}
          latest={newest == null || newest === guard.data.head_revision}
        />
      ) : (
        <Lead>
          No change has been watched yet. After each change, Gregale watches the app and puts the
          previous values back if it starts failing.
        </Lead>
      )}
    </section>
  );
}

function GuardBody({ guard, latest }: { guard: ConfigGuard; latest: boolean }) {
  const [open, setOpen] = useState(false);
  // Read once per mount: the guard query refetches while it watches.
  const [now] = useState(() => Date.now());
  const words = guardWords(guard, latest, now);
  const windowOpen = guardState(guard, now) === 'watching' && Boolean(guard.window_ends_at);
  const d = guard.decision;
  return (
    <div className="flex flex-col gap-2">
      <span className="bento-label flex items-center gap-2" title={`Config guard: ${guard.status}`}>
        <ToneDot tone={words.tone} />
        {words.word}
      </span>
      <Lead>{words.sentence}</Lead>
      {(words.next || windowOpen) && (
        <p className="text-sm text-muted-foreground">
          {words.next}
          {windowOpen && (
            <>
              {words.next && ' '}
              The watch ends <Timestamp value={guard.window_ends_at} />.
            </>
          )}
        </p>
      )}
      <div>
        <Disclosure
          open={open}
          onToggle={() => setOpen((v) => !v)}
          show="Show details"
          hide="Hide details"
        />
      </div>
      {open && (
        <div className="well flex flex-col gap-2 rounded-xl bg-muted/40 p-3 text-[13px]">
          {d?.summary && <p>{d.summary}</p>}
          {d && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-muted-foreground">With the new values</dt>
              <dd className="[font-variant-numeric:tabular-nums]">
                {d.new_server_errors} of {d.new_requests} requests answered 5xx
              </dd>
              <dt className="text-muted-foreground">Before the change</dt>
              <dd className="[font-variant-numeric:tabular-nums]">
                {d.old_server_errors} of {d.old_requests} requests answered 5xx
              </dd>
            </dl>
          )}
          <p className="text-muted-foreground">
            Watch started <Timestamp value={guard.opened_at} />
            {guard.closed_at && (
              <>
                , ended <Timestamp value={guard.closed_at} />
              </>
            )}
            . Compares revision {guard.head_revision} with revision {guard.base_revision}.
          </p>
          <p className="font-mono text-xs text-muted-foreground">config guard · {guard.status}</p>
        </div>
      )}
    </div>
  );
}

function Timeline({
  slug,
  target,
  onRollback,
  review,
}: {
  slug: string;
  target: number | null;
  onRollback: (revision: number) => void;
  review: ReactNode;
}) {
  const revisions = useConfigRevisions(slug);
  const guard = useConfigGuard(slug);
  const rows = revisions.data?.revisions ?? [];
  // Read once per mount, so day headings do not shift while the page is open.
  const [now] = useState(() => Date.now());
  const phase = queryPhase({
    error: revisions.error,
    loading: revisions.isPending,
    isEmpty: rows.length === 0,
  });
  return (
    <section aria-label="Revisions" className="flex flex-col">
      {phase !== 'ready' ? (
        <InlinePhase
          phase={phase}
          error={revisions.error}
          loadingMessage="Reading config history…"
          emptyMessage="No config changes recorded yet."
          onRetry={() => void revisions.refetch()}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {groupByDay(rows, now).map((group) => (
            <div key={group.label} className="flex flex-col">
              <h3 className="bento-label mb-1">{group.label}</h3>
              <ol className="flex flex-col">
                {group.items.map((r) => {
                  const index = rows.indexOf(r);
                  return (
                    <li key={r.revision} className="relative flex flex-col pl-5">
                      <span
                        aria-hidden="true"
                        className="absolute top-0 bottom-0 left-[3px] w-px bg-border"
                      />
                      <RevisionItem
                        slug={slug}
                        revision={r}
                        previous={rows[index + 1]}
                        current={index === 0}
                        guardStatus={revisionGuardState(r, guard.data, now)}
                        selected={target === r.revision}
                        onRollback={() => onRollback(r.revision)}
                      />
                      {target === r.revision && review}
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">Only the newest 100 changes are kept.</p>
        </div>
      )}
    </section>
  );
}

function RevisionItem({
  slug,
  revision: r,
  previous,
  current,
  guardStatus,
  selected,
  onRollback,
}: {
  slug: string;
  revision: ConfigRevision;
  previous: ConfigRevision | undefined;
  current: boolean;
  /** The row's guard verdict as words should read it (see `revisionGuardState`). */
  guardStatus: string | undefined;
  selected: boolean;
  onRollback: () => void;
}) {
  const [open, setOpen] = useState(false);
  const words = revisionWords(r);
  const guard = guardStatus ? guardWord(guardStatus) : null;
  return (
    <div className="flex flex-col gap-2 py-2.5">
      <div className="flex items-start gap-3">
        <span className="absolute top-[18px] left-0 flex">
          <ToneDot tone={guard?.tone ?? (current ? 'active' : 'idle')} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="text-sm break-words" title={words.term}>
            {words.lead}
            {words.key && (
              <>
                {' '}
                <span className="font-mono text-[13px]">{words.key}</span>
              </>
            )}
          </p>
          <p className="flex flex-wrap items-center gap-x-1.5 text-[13px] text-muted-foreground">
            <span className="max-w-full truncate" title={r.actor}>
              by {r.actor}
            </span>
            <span aria-hidden="true">·</span>
            <Timestamp value={r.created_at} />
            {current && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-foreground">Current</span>
              </>
            )}
          </p>
          <div>
            <Disclosure
              open={open}
              onToggle={() => setOpen((v) => !v)}
              show="Show changes"
              hide="Hide changes"
              label={`${open ? 'Hide' : 'Show'} changes in revision ${r.revision}`}
            />
          </div>
        </div>
        {guard && (
          <span className="pt-0.5">
            <ToneWord
              tone={guard.tone}
              word={guard.word}
              term={`Config guard: ${r.guard_status ?? guardStatus}`}
            />
          </span>
        )}
        {!current && (
          <RowMenu label={`Actions for revision ${r.revision}`}>
            <DropdownMenuItem disabled={selected} onSelect={onRollback}>
              <Undo aria-hidden="true" className="size-4" />
              Roll back to revision {r.revision}
            </DropdownMenuItem>
          </RowMenu>
        )}
      </div>
      {open && <RevisionChanges slug={slug} revision={r} previous={previous} />}
    </div>
  );
}

function RevisionChanges({
  slug,
  revision,
  previous,
}: {
  slug: string;
  revision: ConfigRevision;
  previous: ConfigRevision | undefined;
}) {
  const after = useConfigRevision(slug, revision.revision);
  const before = useConfigRevision(slug, previous?.revision ?? null);
  const error = after.error ?? (previous ? before.error : null);
  // A disabled query reports pending forever, so only wait for one that runs.
  const phase = queryPhase({
    error,
    loading: after.isPending || (previous != null && before.isPending),
  });
  const diff = after.data && before.data ? revisionDiff(before.data, after.data) : null;
  return (
    <div
      role="region"
      aria-label={`Changes in revision ${revision.revision}`}
      className="well flex flex-col gap-1.5 rounded-xl bg-muted/40 p-3 text-[13px]"
    >
      {phase !== 'ready' ? (
        <InlinePhase
          phase={phase}
          error={error}
          loadingMessage="Comparing with the change before…"
          onRetry={() => {
            void after.refetch();
            if (previous) void before.refetch();
          }}
        />
      ) : !previous ? (
        <p className="text-muted-foreground">No earlier change is kept to compare with.</p>
      ) : diff && isEmptyDiff(diff) ? (
        <p className="text-muted-foreground">No variable or secret changed.</p>
      ) : diff ? (
        <>
          <KeyLine label="Added" keys={diff.added} />
          <KeyLine label="Changed" keys={diff.changed} />
          <KeyLine label="Removed" keys={diff.removed} />
          {diff.secrets.map((s) => (
            <p key={s.key}>
              <span className="text-muted-foreground">Secret </span>
              <span className="font-mono text-xs">{s.key}</span>
              <span className="text-muted-foreground">: {secretChangeWords(s)}</span>
            </p>
          ))}
        </>
      ) : null}
      <p className="text-xs text-muted-foreground">
        After this change: {revision.variable_count}{' '}
        {revision.variable_count === 1 ? 'variable' : 'variables'}, {revision.secret_count}{' '}
        {revision.secret_count === 1 ? 'secret' : 'secrets'}. Values are never shown.{' '}
        <span className="font-mono">#{revision.revision}</span>
      </p>
    </div>
  );
}

function KeyLine({ label, keys }: { label: string; keys: string[] }) {
  if (keys.length === 0) return null;
  return (
    <p className="text-sm">
      <span className="text-muted-foreground">{label} </span>
      <span className="font-mono text-xs break-all">{keys.join(', ')}</span>
    </p>
  );
}

function SecretLines({
  secrets,
  rollback,
}: {
  secrets: ConfigSecretDifference[];
  rollback: number;
}) {
  if (secrets.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 text-sm">
      <p className="text-muted-foreground">
        Secrets are never kept in a revision, so these stay as they are:
      </p>
      <ul className="flex flex-col gap-0.5 text-xs">
        {secrets.map((s) => (
          <li key={s.key}>
            <span className="font-mono">{s.key}</span>{' '}
            <span className="text-muted-foreground">
              {s.target_version == null || s.target_version === 0
                ? `— added after revision ${rollback} (now version ${s.current_version}); delete it in Secrets if it should go.`
                : s.current_version == null || s.current_version === 0
                  ? `— revision ${rollback} had version ${s.target_version}, now deleted; set it again in Secrets.`
                  : `— revision ${rollback} had version ${s.target_version}, now ${s.current_version}; set it again in Secrets if the old value is needed.`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RollbackReview({
  slug,
  revision,
  onCancel,
  onDone,
}: {
  slug: string;
  revision: number;
  onCancel: () => void;
  onDone: (result: RollbackResult) => void;
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const revisions = useConfigRevisions(slug);
  const newestNumber = revisions.data?.revisions[0]?.revision ?? null;
  const target = useConfigRevision(slug, revision);
  const newest = useConfigRevision(slug, newestNumber);
  const env = useAppEnv(slug);
  const rollback = useRollbackConfig(slug);

  const error = target.error ?? newest.error ?? env.error;
  const phase = queryPhase({
    error,
    loading: target.isPending || newest.isPending || env.isPending,
  });
  const plan =
    target.data && newest.data && env.data
      ? planRollback(
          target.data,
          newest.data,
          (env.data.env ?? []).map((v) => v.key)
        )
      : null;
  const nothing = plan != null && plan.set.length === 0 && plan.deleted.length === 0;

  const run = async () => {
    if (!plan) return;
    if (
      !(await confirm({
        title: `Roll back to revision ${revision}?`,
        description: rollbackSummary(revision, plan),
        confirmLabel: 'Roll back variables',
        destructive: true,
      }))
    )
      return;
    try {
      onDone(await rollback.mutateAsync(revision));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'config_revision_not_found') {
        toast({
          kind: 'error',
          title: `Revision ${revision} is no longer kept`,
          description: 'Only the newest 100 revisions are kept. Pick a newer one.',
        });
        return;
      }
      if (err instanceof ApiError && err.code === 'environment_field_git_managed') {
        toast({
          kind: 'error',
          title: 'Managed by Git',
          description:
            'A variable here comes from the environment definition in Git. Change it there, or add a temporary override.',
        });
        return;
      }
      toast({ kind: 'error', title: 'Could not roll back', description: errorMessage(err) });
    }
  };

  return (
    <section
      aria-label={`Roll back to revision ${revision}`}
      className="mx-5 mb-4 flex flex-col gap-3 rounded-lg border border-border bg-background p-4"
    >
      {phase !== 'ready' || !plan ? (
        <InlinePhase
          phase={phase === 'ready' ? 'loading' : phase}
          error={error}
          loadingMessage="Comparing with the current config…"
          onRetry={() => {
            void target.refetch();
            void newest.refetch();
            void env.refetch();
          }}
        />
      ) : (
        <>
          <p className="text-sm">
            {nothing
              ? `Variables already match revision ${revision}; a rollback changes nothing.`
              : `Rolling back restores the variables of revision ${revision}, as a new revision the config guard watches.`}
          </p>
          <KeyLine label="Sets" keys={plan.set} />
          <KeyLine label="Deletes" keys={plan.deleted} />
          <SecretLines secrets={plan.secrets} rollback={revision} />
          {!nothing && (
            <p className="text-xs text-muted-foreground">
              Running instances keep their current values until they restart; you can restart once
              the rollback lands.
            </p>
          )}
        </>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="destructive"
          disabled={!plan || nothing}
          busy={rollback.isPending}
          onClick={() => void run()}
        >
          Roll back
        </Button>
      </div>
    </section>
  );
}

function RollbackOutcome({ slug, result }: { slug: string; result: RollbackResult }) {
  const restart = useRestartAction(slug);
  const changed = result.set.length > 0 || result.deleted.length > 0;
  const guard = result.change?.guard;
  return (
    <section aria-label="Rollback result">
      <Panel title="Rollback">
        <div className="flex flex-col gap-3 text-sm">
          <p>
            {!changed
              ? `Variables already matched revision ${result.restored_revision}; nothing changed.`
              : result.change
                ? `Restored the variables of revision ${result.restored_revision} as revision ${result.change.revision}.`
                : `Restored the variables of revision ${result.restored_revision}.`}
          </p>
          <KeyLine label="Set" keys={result.set} />
          <KeyLine label="Deleted" keys={result.deleted} />
          {guard && (
            <p className="text-muted-foreground">
              The config guard watches the first {guard.window_minutes ?? 10} minutes of traffic
              with the restored values.
            </p>
          )}
          <SecretLines secrets={result.secrets_not_restored} rollback={result.restored_revision} />
          {changed && (
            <div className="flex flex-wrap items-center justify-between gap-3 well rounded-xl bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">
                Running instances still have the old values. New wakes boot with the restored ones;
                restart to replace the running instances now.
              </p>
              <Button size="sm" busy={restart.pending} onClick={() => void restart.run()}>
                Restart now
              </Button>
            </div>
          )}
        </div>
      </Panel>
    </section>
  );
}
