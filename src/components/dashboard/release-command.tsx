import type { ComponentType, ReactNode, SVGProps } from 'react';
import { useReducedMotion } from 'motion/react';
import { CheckCircle, Circle, Minus, RefreshDouble, WarningTriangle } from 'iconoir-react';
import { Timestamp } from '@/components/ui/timestamp';
import { ApiError } from '@/lib/api/errors';
import { useCapabilityStage } from '@/lib/api/capabilities';
import { useReleaseDiff } from '@/lib/api/deployment-detail';
import {
  RELEASE_IN_FLIGHT,
  useReleaseTask,
  type AppTask,
  type ReleaseRun,
} from '@/lib/api/release-command';
import type { Deployment } from '@/lib/api/queries';
import { cn } from '@/lib/utils';
import { CliCommand } from './cli-command';
import { InlinePhase, queryPhase } from './primitives';

const STATUS: Record<
  ReleaseRun['status'],
  { label: string; color: string; icon: ComponentType<SVGProps<SVGSVGElement>> }
> = {
  pending: { label: 'Waiting for the image', color: 'var(--muted-foreground)', icon: Circle },
  queued: { label: 'Queued', color: 'var(--brand)', icon: RefreshDouble },
  restoring: { label: 'Starting', color: 'var(--brand)', icon: RefreshDouble },
  running: { label: 'Running', color: 'var(--brand)', icon: RefreshDouble },
  succeeded: { label: 'Succeeded', color: 'var(--status-good)', icon: CheckCircle },
  failed: { label: 'Failed', color: 'var(--status-critical)', icon: WarningTriangle },
  timed_out: { label: 'Timed out', color: 'var(--status-critical)', icon: WarningTriangle },
  cancelled: { label: 'Cancelled', color: 'var(--muted-foreground)', icon: Minus },
};
const UNAVAILABLE = {
  label: 'Could not run',
  color: 'var(--status-critical)',
  icon: WarningTriangle,
};

function seconds(from?: string | null, to?: string | null): string | undefined {
  const ms = Date.parse(to ?? '') - Date.parse(from ?? '');
  if (!(ms >= 0)) return undefined;
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

function StatusLabel({ status }: { status: ReleaseRun['status'] | 'unavailable' }) {
  const reduce = useReducedMotion();
  const view = status === 'unavailable' ? UNAVAILABLE : (STATUS[status] ?? STATUS.pending);
  const Icon = view.icon;
  const spinning = status !== 'unavailable' && RELEASE_IN_FLIGHT.includes(status);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: view.color }}>
      <Icon aria-hidden className={cn('h-3.5 w-3.5', spinning && !reduce && 'animate-spin')} />
      {view.label}
    </span>
  );
}

/**
 * A deployment's release command — typically database migrations — as the
 * API reports it: `release` on GET /v1/deployments/{id} (status, start and
 * finish, the databases it can migrate; faas release/migrations.go:118), and
 * the release task's receipt for the command, exit code, failure and output
 * tail. The command runs after the image is built and before the first
 * serving VM boots; while it runs and after it fails, the release it replaces
 * keeps serving (faas imaged/handler.go handoffSnapshotPrime,
 * applyReleaseTaskOutcome). Renders nothing for a deployment without one.
 */
export function ReleaseCommand({ slug, deployment }: { slug?: string; deployment: Deployment }) {
  const run = deployment.release;
  const unavailable = deployment.error_code === 'release_phase_unavailable';
  const stage = useCapabilityStage('release-commands');
  const inFlight = Boolean(run && RELEASE_IN_FLIGHT.includes(run.status));
  const admitted = Boolean(run && run.status !== 'pending');
  const task = useReleaseTask(slug ?? '', deployment.id, { enabled: admitted, poll: inFlight });
  const diff = useReleaseDiff(run || unavailable ? deployment.id : '');
  if (!run && !unavailable) return null;

  const receipt = admitted ? task.data?.task : undefined;
  const command = receipt?.command.join(' ') || diff.data?.database.to_release_command || undefined;
  const ref = deployment.revision ? `v${deployment.revision}` : deployment.id;
  const failed = deployment.error_code === 'release_command_failed';

  return (
    <section aria-label="Release command" className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="label-mono text-muted-foreground">Release command</p>
        {stage && (
          <span className="label-mono rounded-full border border-border px-2 py-0.5 text-muted-foreground">
            {stage}
          </span>
        )}
        <span className="ml-auto">
          <StatusLabel status={unavailable ? 'unavailable' : run!.status} />
        </span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Runs once the image is built, before the new version serves. The release it replaces keeps
        serving while it runs, and keeps serving if it fails.
      </p>
      {command && (
        <code className="mt-3 block rounded-md border border-border bg-muted/30 p-2 font-mono text-xs [overflow-wrap:anywhere]">
          {command}
        </code>
      )}

      {unavailable && (
        <p role="alert" className="mt-3 text-sm" style={{ color: 'var(--status-critical)' }}>
          Release commands are not enabled on this installation, so the deployment stopped before
          serving rather than skip its command. Deploy without the release declaration, or ask your
          operator to enable release commands.
        </p>
      )}
      {failed && (
        <p role="alert" className="mt-3 text-sm" style={{ color: 'var(--status-critical)' }}>
          The release command did not succeed, so this deployment never took traffic. The previous
          release keeps serving. A failed command may have committed part of its changes.
        </p>
      )}

      {run && (
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 text-xs sm:grid-cols-3">
          <Field label="Started">
            <Timestamp value={run.started_at} />
          </Field>
          <Field label="Finished">
            <Timestamp value={run.finished_at} />
          </Field>
          <Field label="Took">{seconds(run.started_at, run.finished_at) ?? '—'}</Field>
          {receipt?.exit_code != null && <Field label="Exit code">{receipt.exit_code}</Field>}
          {receipt && receipt.attempt_count > 1 && (
            <Field label="Attempts">{receipt.attempt_count}</Field>
          )}
          {(run.migration_databases?.length ?? 0) > 0 && (
            <Field label="Databases it can migrate">
              {run.migration_databases!.map((db) => db.name).join(', ')}
            </Field>
          )}
        </dl>
      )}

      {admitted && (
        <div className="mt-4 flex flex-col gap-2">
          <p className="text-sm font-medium">Output</p>
          <TaskOutput
            read={task}
            receipt={receipt}
            onRetry={() => void task.refetch()}
            noSlug={!slug}
          />
        </div>
      )}
      {run?.status === 'pending' && !unavailable && (
        <p className="mt-3 text-xs text-muted-foreground">
          Output appears once the command starts.
        </p>
      )}

      {slug && (
        <div className="mt-4">
          <CliCommand
            command={`gregale release summary ${ref} --app ${slug}`}
            label="The same run from the CLI"
            copyLabel={`release summary command for ${ref}`}
          />
        </div>
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="label-mono text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-mono [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

function TaskOutput({
  read,
  receipt,
  onRetry,
  noSlug,
}: {
  read: ReturnType<typeof useReleaseTask>;
  receipt?: AppTask;
  onRetry: () => void;
  noSlug: boolean;
}) {
  if (noSlug)
    return (
      <p className="text-xs text-muted-foreground">
        The output is read through the app, which could not be resolved for this deployment.
      </p>
    );
  // apid answers 501 when deployment-attached app tasks are off on this host.
  if (read.error instanceof ApiError && read.error.code === 'not_implemented')
    return (
      <p className="text-xs text-muted-foreground">
        Task output is not available on this installation. The status above is still current.
      </p>
    );
  const phase = queryPhase({ error: read.error, loading: read.isPending });
  if (phase !== 'ready')
    return (
      <InlinePhase
        phase={phase}
        error={read.error}
        loadingMessage="Reading the command's output…"
        onRetry={onRetry}
      />
    );
  if (!receipt)
    return (
      <p className="text-xs text-muted-foreground">
        {read.data?.complete
          ? 'No release task is recorded for this deployment among the app’s tasks.'
          : `The release task is not among the app’s ${read.data?.searched ?? 0} newest tasks.`}
      </p>
    );
  const stdout = receipt.stdout_tail?.trimEnd();
  const stderr = receipt.stderr_tail?.trimEnd();
  return (
    <div className="flex flex-col gap-3">
      {receipt.failure && (
        <p className="text-xs" role="status">
          <code className="font-mono" style={{ color: 'var(--status-critical)' }}>
            {receipt.failure.code}
          </code>{' '}
          {receipt.failure.message}
        </p>
      )}
      {!stdout && !stderr ? (
        <p className="text-xs text-muted-foreground">The command has written no output.</p>
      ) : (
        <>
          {stdout && <OutputBlock title="Standard output" text={stdout} />}
          {stderr && <OutputBlock title="Standard error" text={stderr} />}
        </>
      )}
      {receipt.output_truncated && (
        <p className="text-xs text-muted-foreground">
          Only the last {Math.round(receipt.max_output_bytes / 1024)} KB of output are kept.
        </p>
      )}
    </div>
  );
}

function OutputBlock({ title, text }: { title: string; text: string }) {
  return (
    <figure className="flex min-w-0 flex-col gap-1">
      <figcaption className="label-mono text-muted-foreground">{title}</figcaption>
      <pre className="max-h-64 overflow-auto rounded-md border border-border bg-muted/30 p-2 font-mono text-xs whitespace-pre-wrap [overflow-wrap:anywhere]">
        {text}
      </pre>
    </figure>
  );
}
