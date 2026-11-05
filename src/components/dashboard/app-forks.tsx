import { useId, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle,
  Clock,
  Prohibition,
  Refresh,
  Terminal,
  WarningTriangle,
  XmarkCircle,
} from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { CopyableId } from '@/components/ui/copyable-id';
import { Input } from '@/components/ui/input';
import { Timestamp } from '@/components/ui/timestamp';
import { useToast } from '@/components/ui/toast';
import { useOneTimeSecret } from '@/components/ui/one-time-secret';
import { useCapabilityAccess } from '@/lib/api/capabilities';
import { ApiError } from '@/lib/api/errors';
import {
  ACTIVE_FORK,
  FORK_TTL,
  createAppFork,
  forksKey,
  useAppForks,
  useCancelAppFork,
  useForkExecs,
  useRunForkExec,
  type AppFork,
  type ForkExec,
} from '@/lib/api/forks';
import { CapabilityGate } from './capability-gate';
import { CrashSnapshotsPanel } from './crash-snapshots';
import {
  ForkRequestHint,
  ForkToken,
  LifetimeSelect,
  StatusChip,
  forkConsequences,
  forkWriteFailure,
  lifetimeLabel,
} from './fork-shared';
import { MaturityLabel } from './maturity-label';
import { InlinePhase, Panel, queryPhase } from './primitives';

/**
 * The app's Forks tab: production forks (capability `production-forks`,
 * faas ADR-732, docs/forks.md) and, inside it, crash snapshots (capability
 * `crash-snapshots`, ADR-733), which are only ever opened as forks. Both are
 * Pro and Scale previews. Each panel mounts, and reads, only past its gate.
 */
export function ForksBody({ slug }: { slug: string }) {
  return (
    <CapabilityGate capability="production-forks" title="Production forks">
      <div className="flex flex-col gap-6">
        <ForksPanel slug={slug} />
        <CapabilityGate capability="crash-snapshots" title="Crash snapshots">
          <CrashSnapshotsPanel slug={slug} />
        </CapabilityGate>
      </div>
    </CapabilityGate>
  );
}

const FORK_STATUS: Record<
  AppFork['status'],
  { label: string; color: string; icon: typeof CheckCircle }
> = {
  queued: { label: 'Queued', color: 'var(--chart-muted)', icon: Clock },
  restoring: { label: 'Restoring', color: 'var(--status-warning)', icon: Refresh },
  running: { label: 'Running', color: 'var(--status-good)', icon: CheckCircle },
  expired: { label: 'Expired', color: 'var(--chart-muted)', icon: Clock },
  cancelled: { label: 'Cancelled', color: 'var(--chart-muted)', icon: Prohibition },
  failed: { label: 'Failed', color: 'var(--status-critical)', icon: WarningTriangle },
};

const EXEC_STATUS: Record<
  ForkExec['status'],
  { label: string; color: string; icon: typeof CheckCircle }
> = {
  queued: { label: 'Queued', color: 'var(--chart-muted)', icon: Clock },
  running: { label: 'Running', color: 'var(--status-warning)', icon: Refresh },
  succeeded: { label: 'Succeeded', color: 'var(--status-good)', icon: CheckCircle },
  failed: { label: 'Failed', color: 'var(--status-critical)', icon: XmarkCircle },
  timed_out: { label: 'Timed out', color: 'var(--status-critical)', icon: Clock },
};

/** `failure.code` on a failed fork (docs/forks.md, "Create a fork"). */
const FORK_FAILURE: Record<string, string> = {
  no_capture: 'The deployment has no snapshot yet. Send it some traffic first.',
  no_capacity: 'There was no room on the node. Forks never displace serving instances.',
  account_inactive: 'The account is suspended.',
  deployment_unavailable: 'The deployment the fork pinned is gone.',
  scheduler_lost: 'The scheduler restoring the fork stopped before it finished.',
};

function ForksPanel({ slug }: { slug: string }) {
  const { capability } = useCapabilityAccess('production-forks');
  const forks = useAppForks(slug);
  const confirm = useConfirm();
  const { toast } = useToast();
  const qc = useQueryClient();
  const token = useOneTimeSecret<{ forkId: string; token: string }>();
  const [ttl, setTtl] = useState<number>(FORK_TTL.default);
  const [live, setLive] = useState(false);
  const [creating, setCreating] = useState(false);
  const [openFork, setOpenFork] = useState<string | null>(null);
  const lifetimeId = useId();
  const items = forks.data?.items ?? [];
  const phase = queryPhase({
    error: forks.error,
    loading: forks.isPending,
    isEmpty: items.length === 0,
  });

  const create = async () => {
    const source = live
      ? "a capture of this app's newest running instance, taken now (it pauses the newest running instance for about a second per 512 MB of memory, then keeps serving)"
      : "this app's last snapshot";
    const ok = await confirm({
      title: 'Copy production into a fork?',
      description: `The fork restores ${source}: its memory and disk, with secrets already in memory and any of your users' data it holds. ${forkConsequences(ttl)}`,
      confirmLabel: 'Create fork',
    });
    if (!ok) return;
    const receive = token.capture();
    setCreating(true);
    try {
      const created = await createAppFork(slug, {
        ttl_seconds: ttl,
        ...(live ? { live: true } : {}),
      });
      if (created.access_token) receive({ forkId: created.id, token: created.access_token });
      else
        toast({
          kind: 'info',
          title: 'Fork queued',
          description: 'The response carried no access token, so there is nothing to copy.',
        });
    } catch (err) {
      toast({ kind: 'error', ...forkWriteFailure(err), error: err });
    } finally {
      setCreating(false);
      void qc.invalidateQueries({ queryKey: forksKey(slug) });
    }
  };

  return (
    <Panel title="Production forks" actions={<MaturityLabel capability={capability} />}>
      <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
        {'A private copy of this running app to send requests to while you debug.'}
      </p>

      <div className="flex flex-col gap-5">
        <p
          role="note"
          className="rounded-lg border border-border px-3 py-2.5 text-xs leading-relaxed"
        >
          <strong className="font-medium">A fork copies production data.</strong> It restores this
          app&apos;s memory and disk, secrets already in memory and your users&apos; data included,
          into a private VM with no network that never serves production traffic. Only requests
          carrying the fork&apos;s access token reach it, and the token is shown once. Creating a
          fork needs deploy:write and secrets:read; every create, cancel and command is in your
          audit log. It is destroyed when its lifetime ends (1 hour by default, at most 4) and is
          billed like a running instance while it runs. One active fork per app, two per account.
        </p>

        <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
          <LifetimeSelect id={lifetimeId} value={ttl} onChange={setTtl} />
          <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <legend className="sr-only">Restore from</legend>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name={`${lifetimeId}-source`}
                checked={!live}
                onChange={() => setLive(false)}
              />
              Last snapshot
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name={`${lifetimeId}-source`}
                checked={live}
                onChange={() => setLive(true)}
              />
              Live capture now
            </label>
          </fieldset>
          <Button size="sm" disabled={creating} onClick={() => void create()}>
            {creating ? 'Creating…' : 'Create fork'}
          </Button>
        </div>
        {live && (
          <p className="text-xs text-muted-foreground">
            A live fork captures the newest running instance when you create it, so it holds newer
            state than the last snapshot. The capture is encrypted and deleted about four hours
            later, after any fork of it has ended.
          </p>
        )}

        {token.secret && (
          <ForkToken
            key={token.version}
            forkId={token.secret.forkId}
            token={token.secret.token}
            onDismiss={token.dismiss}
          />
        )}

        {phase !== 'ready' ? (
          <InlinePhase
            phase={phase}
            error={forks.error}
            loadingMessage="Loading forks…"
            emptyMessage="No forks yet."
            onRetry={() => void forks.refetch()}
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {items.map((fork) => (
              <ForkRow
                key={fork.id}
                slug={slug}
                fork={fork}
                open={openFork === fork.id}
                onToggle={() => setOpenFork(openFork === fork.id ? null : fork.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

function ForkRow({
  slug,
  fork,
  open,
  onToggle,
}: {
  slug: string;
  fork: AppFork;
  open: boolean;
  onToggle: () => void;
}) {
  const confirm = useConfirm();
  const cancel = useCancelAppFork(slug);
  const status = FORK_STATUS[fork.status];
  const active = ACTIVE_FORK.has(fork.status);
  const short = fork.id.slice(0, 8);
  // Output is kept for 24 hours after a fork ends, so an ended fork that ran
  // keeps its command history readable.
  const hasCommands = fork.status === 'running' || Boolean(fork.started_at);

  const onCancel = async () => {
    const ok = await confirm({
      title: `Cancel fork ${short}?`,
      description:
        'A queued fork ends at once; a running one is destroyed within a few seconds, and its access token stops working. Command output stays readable for 24 hours.',
      confirmLabel: 'Cancel fork',
      destructive: true,
    });
    if (ok) cancel.mutate(fork.id);
  };

  return (
    <li className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        <StatusChip {...status} />
        <span className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Fork</span>
          <CopyableId value={fork.id} label="fork ID" />
        </span>
        <span className="text-xs text-muted-foreground">
          {fork.crash_capture_id ? (
            <span className="inline-flex items-center gap-1">
              From crash snapshot <CopyableId value={fork.crash_capture_id} label="snapshot ID" />
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              Last snapshot of deployment{' '}
              <CopyableId value={fork.deployment_id} label="deployment ID" />
            </span>
          )}
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {hasCommands && (
            <Button
              size="xs"
              variant="outline"
              aria-expanded={open}
              aria-label={`Commands for fork ${short}`}
              onClick={onToggle}
            >
              <Terminal aria-hidden className="size-3.5" />
              Commands
            </Button>
          )}
          {active && !fork.cancel_requested_at && (
            <Button
              size="xs"
              variant="ghost"
              aria-label={`Cancel fork ${short}`}
              disabled={cancel.isPending}
              onClick={() => void onCancel()}
            >
              Cancel
            </Button>
          )}
        </span>
      </div>
      <dl className="grid gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-3">
        <div className="flex gap-1.5">
          <dt>Created</dt>
          <dd>
            <Timestamp value={fork.created_at} />
          </dd>
        </div>
        <div className="flex gap-1.5">
          <dt>Lifetime</dt>
          <dd>{lifetimeLabel(fork.ttl_seconds)}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt>{active ? 'Destroyed' : 'Ended'}</dt>
          <dd>
            <Timestamp value={active ? fork.expires_at : (fork.finished_at ?? fork.updated_at)} />
          </dd>
        </div>
      </dl>
      {fork.cancel_requested_at && active && (
        <p className="text-xs text-muted-foreground">
          Cancellation requested <Timestamp value={fork.cancel_requested_at} />; the instance is
          being destroyed.
        </p>
      )}
      {fork.failure && (
        <p className="text-xs">
          <span style={{ color: 'var(--status-critical)' }}>
            {FORK_FAILURE[fork.failure.code] ?? fork.failure.message}
          </span>{' '}
          <code className="font-mono text-muted-foreground">{fork.failure.code}</code>
        </p>
      )}
      {fork.status === 'running' && !open && <ForkRequestHint forkId={fork.id} />}
      {open && hasCommands && <ForkCommands slug={slug} fork={fork} />}
    </li>
  );
}

const EXEC_TIMEOUT = { default: 60, max: 600 } as const;

function ForkCommands({ slug, fork }: { slug: string; fork: AppFork }) {
  const execs = useForkExecs(slug, fork.id);
  const runExec = useRunForkExec(slug, fork.id);
  const [command, setCommand] = useState('');
  const [shell, setShell] = useState(true);
  const [timeout, setTimeoutSeconds] = useState<number>(EXEC_TIMEOUT.default);
  const [error, setError] = useState<unknown>(null);
  const id = useId();
  const items = execs.data?.items ?? [];
  const phase = queryPhase({
    error: execs.error,
    loading: execs.isPending,
    isEmpty: items.length === 0,
  });
  const argv = shell ? [command.trim()] : command.trim().split(/\s+/).filter(Boolean);
  const timeoutValid = Number.isInteger(timeout) && timeout >= 1 && timeout <= EXEC_TIMEOUT.max;
  const valid = command.trim().length > 0 && argv.length <= 64 && timeoutValid;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || runExec.isPending) return;
    setError(null);
    try {
      await runExec.mutateAsync({ command: argv, shell, timeout_seconds: timeout });
      setCommand('');
    } catch (err) {
      setError(err);
    }
  };

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="flex flex-col gap-3 rounded-lg border border-border p-3"
    >
      <h3 id={`${id}-title`} className="text-sm font-medium">
        Commands in fork {fork.id.slice(0, 8)}
      </h3>
      <p className="text-xs text-muted-foreground">
        Commands run in the app&apos;s working directory and user, with its environment but no
        secrets, and cannot reach the network. One runs at a time and up to 4 can wait. Output is a
        copy of production data: it is kept for 24 hours after the fork ends, then emptied.
      </p>
      {fork.status === 'running' && (
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-2">
          <label htmlFor={`${id}-command`} className="text-xs text-muted-foreground">
            Command
          </label>
          <Input
            id={`${id}-command`}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="ls -la /tmp"
            className="font-mono"
            maxLength={4096}
          />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={shell} onChange={(e) => setShell(e.target.checked)} />
              Run through the app&apos;s shell
            </label>
            <label className="flex items-center gap-1.5 text-muted-foreground">
              Timeout (seconds)
              <Input
                type="number"
                min={1}
                max={EXEC_TIMEOUT.max}
                value={timeout}
                onChange={(e) => setTimeoutSeconds(Number(e.target.value))}
                className="h-8 w-20"
              />
            </label>
            <Button type="submit" size="xs" disabled={!valid || runExec.isPending}>
              {runExec.isPending ? 'Queuing…' : 'Run command'}
            </Button>
          </div>
          {!shell && (
            <p className="text-xs text-muted-foreground">
              Split on spaces into an argv, with no quoting; use the shell for quotes, pipes or
              globs.
            </p>
          )}
          {error !== null && (
            <p role="alert" className="text-xs" style={{ color: 'var(--status-critical)' }}>
              {error instanceof ApiError && error.code === 'app_fork_exec_refused'
                ? 'The fork is not running, or already has 4 commands waiting.'
                : error instanceof Error
                  ? error.message
                  : 'Could not queue the command.'}
            </p>
          )}
        </form>
      )}
      {phase !== 'ready' ? (
        <InlinePhase
          phase={phase}
          error={execs.error}
          loadingMessage="Loading commands…"
          emptyMessage="No commands have run in this fork."
          onRetry={() => void execs.refetch()}
        />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {items.map((exec) => (
            <ExecRow key={exec.id} exec={exec} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ExecRow({ exec }: { exec: ForkExec }) {
  return (
    <li className="flex flex-col gap-2 py-2.5 text-xs first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StatusChip {...EXEC_STATUS[exec.status]} />
        <code className="min-w-0 break-all font-mono">
          {exec.shell ? '$ ' : ''}
          {exec.command.join(' ')}
        </code>
        {exec.exit_code !== undefined && (
          <span className="text-muted-foreground">exit {exec.exit_code}</span>
        )}
        <span className="ml-auto text-muted-foreground">
          {exec.requested_by} · <Timestamp value={exec.created_at} />
        </span>
      </div>
      {exec.stdout && (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted px-2 py-1.5 font-mono">
          {exec.stdout}
        </pre>
      )}
      {exec.stderr && (
        <pre
          aria-label="Standard error"
          className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted px-2 py-1.5 font-mono"
          style={{ color: 'var(--status-warning)' }}
        >
          {exec.stderr}
        </pre>
      )}
      {exec.output_truncated && (
        <p className="text-muted-foreground">
          Older output was dropped; this is the last {Math.round(exec.max_output_bytes / 1024)} KiB.
        </p>
      )}
      {exec.failure && (
        <p>
          <span style={{ color: 'var(--status-critical)' }}>{exec.failure.message}</span>{' '}
          <code className="font-mono text-muted-foreground">{exec.failure.code}</code>
        </p>
      )}
    </li>
  );
}
