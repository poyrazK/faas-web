import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { InlinePhase, Panel, queryPhase } from '@/components/dashboard/primitives';
import { Pill } from '@/components/dashboard/resource-table';
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
  GUARD_STATUS_LABEL,
  guardHeadline,
  planRollback,
  revisionChange,
  rollbackSummary,
  type ConfigGuard,
  type ConfigRevision,
  type ConfigSecretDifference,
} from '@/lib/config-history';
import { formatRelative } from '@/lib/mock-data';

type RollbackResult = NonNullable<ReturnType<typeof useRollbackConfig>['data']>;

const GUARD_COLOR: Record<string, string> = {
  watching: 'var(--status-warning)',
  clean: 'var(--status-good)',
  restored: 'var(--status-critical)',
  regressed: 'var(--status-critical)',
  no_traffic: 'var(--status-idle)',
  superseded: 'var(--status-idle)',
};

function When({ at }: { at: string | undefined }) {
  // Read once per mount: the guard query refetches while it watches.
  const [now] = useState(() => Date.now());
  if (!at) return <span>—</span>;
  const ms = Date.parse(at);
  // formatRelative reads a future time as "just now"; a guard window ends ahead.
  const ahead = ms - now;
  return (
    <time dateTime={at} title={at}>
      {Number.isNaN(ms)
        ? at
        : ahead > 60_000
          ? `in ${Math.ceil(ahead / 60_000)} min`
          : formatRelative(ms)}
    </time>
  );
}

function GuardPill({ status }: { status: string }) {
  return (
    <Pill
      label={GUARD_STATUS_LABEL[status] ?? status}
      color={GUARD_COLOR[status] ?? 'var(--status-idle)'}
    />
  );
}

/**
 * History, rollback and the config guard for one app's variables and secrets
 * (faas ADR-1451). Values never appear: rows name keys, and the rollback
 * review compares revisions by value without printing either side.
 */
export function ConfigHistory({ slug }: { slug: string }) {
  const [target, setTarget] = useState<number | null>(null);
  const [result, setResult] = useState<RollbackResult | null>(null);
  return (
    <div className="flex flex-col gap-4">
      <GuardPanel slug={slug} />
      <RevisionsPanel
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

function GuardPanel({ slug }: { slug: string }) {
  const guard = useConfigGuard(slug);
  const phase = queryPhase({ error: guard.error, loading: guard.isPending });
  return (
    <section aria-label="Config guard">
      <Panel
        title="Config guard"
        description="A change to variables or secrets of an app with a live deployment opens a guard. It compares the first 10 minutes of traffic with the new values against the hour before, and restores the previous values and restarts the app if the new ones fail."
        actions={guard.data && <GuardPill status={guard.data.status} />}
      >
        {phase !== 'ready' ? (
          <InlinePhase
            phase={phase}
            error={guard.error}
            loadingMessage="Reading the config guard…"
            onRetry={() => void guard.refetch()}
          />
        ) : guard.data ? (
          <GuardBody guard={guard.data} />
        ) : (
          <p className="text-sm text-muted-foreground">
            No change has been guarded yet. The next change opens a guard once the app has a live
            deployment.
          </p>
        )}
      </Panel>
    </section>
  );
}

function GuardBody({ guard }: { guard: ConfigGuard }) {
  const d = guard.decision;
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p>{guardHeadline(guard)}</p>
      {guard.status === 'watching' && (
        <p className="text-muted-foreground">
          Nothing to do: if the app starts failing with the new values, the guard restores the
          previous values and restarts it.
          {guard.window_ends_at && (
            <>
              {' '}
              The window closes <When at={guard.window_ends_at} />.
            </>
          )}
          {!guard.restorable &&
            ' This change deleted or rotated a secret, so the guard can report a failure but not undo it.'}
        </p>
      )}
      {guard.status === 'regressed' && (
        <p className="text-muted-foreground">
          Fix the config by hand: set the secret again, or roll the variables back below.
        </p>
      )}
      {d && (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
          <dt className="label-mono text-muted-foreground">New values</dt>
          <dd className="font-mono">
            {d.new_server_errors} of {d.new_requests} 5xx
          </dd>
          <dt className="label-mono text-muted-foreground">Before</dt>
          <dd className="font-mono">
            {d.old_server_errors} of {d.old_requests} 5xx
          </dd>
        </dl>
      )}
      <p className="text-xs text-muted-foreground">
        Opened <When at={guard.opened_at} />
        {guard.closed_at && (
          <>
            , closed <When at={guard.closed_at} />
          </>
        )}
        . Opt a change out with <code className="font-mono">--no-guard</code> on{' '}
        <code className="font-mono">gregale env set</code>.
      </p>
    </div>
  );
}

function RevisionsPanel({
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
  const rows = revisions.data?.revisions ?? [];
  const phase = queryPhase({
    error: revisions.error,
    loading: revisions.isPending,
    isEmpty: rows.length === 0,
  });
  return (
    <section aria-label="Revisions">
      <Panel
        title="Revisions"
        description="Every change to this app's variables and secrets, newest first. The newest 100 are kept. Same as gregale env history."
        padded={false}
      >
        {phase !== 'ready' ? (
          <div className="p-5">
            <InlinePhase
              phase={phase}
              error={revisions.error}
              loadingMessage="Reading config history…"
              emptyMessage="No config changes recorded yet. The first change records the config before it, so it can be undone too."
              onRetry={() => void revisions.refetch()}
            />
          </div>
        ) : (
          <ol className="divide-y divide-border">
            {rows.map((r, i) => (
              <li key={r.revision} className="flex flex-col">
                <RevisionRow
                  revision={r}
                  current={i === 0}
                  selected={target === r.revision}
                  onRollback={() => onRollback(r.revision)}
                />
                {target === r.revision && review}
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </section>
  );
}

function RevisionRow({
  revision: r,
  current,
  selected,
  onRollback,
}: {
  revision: ConfigRevision;
  current: boolean;
  selected: boolean;
  onRollback: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3 text-sm">
      <span className="w-10 shrink-0 font-mono text-xs text-muted-foreground">#{r.revision}</span>
      <span className="min-w-0 flex-1 basis-48 font-mono text-xs break-words">
        {revisionChange(r)}
      </span>
      <span
        className="min-w-0 truncate text-xs text-muted-foreground sm:w-44 sm:text-right"
        title={r.actor}
      >
        {r.actor}
      </span>
      <span className="text-xs text-muted-foreground sm:w-16">
        <When at={r.created_at} />
      </span>
      <span className="w-28">{r.guard_status && <GuardPill status={r.guard_status} />}</span>
      <span className="ml-auto w-24 text-right">
        {current ? (
          <span className="text-xs text-muted-foreground">Current</span>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Roll back to revision ${r.revision}`}
            aria-expanded={selected}
            onClick={onRollback}
            disabled={selected}
          >
            Roll back
          </Button>
        )}
      </span>
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
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
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
