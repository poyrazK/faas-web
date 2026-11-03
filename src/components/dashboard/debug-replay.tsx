import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { CheckCircle, Clock, Refresh, WarningTriangle } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { CopyableId } from '@/components/ui/copyable-id';
import { useCapabilityAccess } from '@/lib/api/capabilities';
import { useDebugReplay, useReplayTargets } from '@/lib/api/debug';
import { ApiError } from '@/lib/api/errors';
import { useInvocation } from '@/lib/api/queries';
import { EvidenceChip } from './debug-evidence-detail';
import { InlinePhase } from './primitives';

/**
 * Replay one retained request through a mirror rule
 * (POST .../debug/requests/{req_id}/replay, handlers_debug_telemetry.go:2540-2705).
 *
 * It is a write that sends traffic: apid reissues the request's method and
 * route to an enabled mirror target of the deployment that served it, with
 * an empty body and platform replay metadata only, because bodies and
 * credentials are never retained. So it is confirmed first and says so.
 *
 * Only an enabled rule whose source is the serving deployment can take the
 * replay (selectDebugReplayMirrorRule, :2707-2716). While mirror rules can be
 * read, the targets are listed and one is chosen; with none there is nothing
 * to send, and Mirrors is where a rule is added. Otherwise apid picks the
 * first match, and 409 `debug_replay_unsupported` says when there is none.
 * The queued invocation is then followed to its end.
 */
export function DebugReplayAction({
  slug,
  reqId,
  method,
  route,
  deploymentId,
  onCompare,
}: {
  slug: string;
  reqId: string;
  method?: string;
  route?: string;
  /** The deployment that served the request, whose mirror rules can take the replay. */
  deploymentId?: string;
  onCompare?: (source: string, mirror: string) => void;
}) {
  const confirm = useConfirm();
  const replay = useDebugReplay(slug);
  const mirroring = useCapabilityAccess('traffic-mirroring').access === 'on';
  const targets = useReplayTargets(slug, deploymentId, mirroring);
  const known = mirroring && Boolean(deploymentId) && targets.data !== undefined;
  const rules = targets.data ?? [];
  const [chosen, setChosen] = useState<string>('');
  const target = known
    ? (rules.find((r) => r.mirror_deployment_id === chosen) ?? rules[0])
    : undefined;
  const unsupported =
    replay.error instanceof ApiError && replay.error.code === 'debug_replay_unsupported';
  const gone = replay.error instanceof ApiError && replay.error.code === 'not_found';

  const run = async () => {
    const ok = await confirm({
      title: `Replay ${method ?? 'this request'} ${route ?? ''} through its mirror?`.trim(),
      description: `Gregale queues a new invocation that reissues this request's method and route through ${target ? `the mirror rule sending ${target.percent}% of this deployment's traffic to deployment ${target.mirror_deployment_id.slice(0, 8)}` : 'the enabled mirror rule of the deployment that served it'}. The mirror target runs it for real, with an empty body and no credentials, because neither was kept, so anything that route does can happen again there.`,
      confirmLabel: 'Replay request',
    });
    if (ok) replay.mutate({ reqId, mirrorDeploymentId: target?.mirror_deployment_id });
  };

  if (known && rules.length === 0 && !replay.data)
    return (
      <p role="status" className="text-xs">
        <span className="text-muted-foreground">
          No enabled mirror rule sends the traffic of the deployment that served this request
          anywhere, so it cannot be replayed.
        </span>{' '}
        <MirrorsLink slug={slug} />
      </p>
    );

  return (
    <div className="flex flex-col items-start gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {known && rules.length > 1 && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Mirror target
            <select
              aria-label="Mirror target"
              value={target?.mirror_deployment_id ?? ''}
              onChange={(e) => setChosen(e.target.value)}
              className="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground"
            >
              {rules.map((rule) => (
                <option key={rule.id} value={rule.mirror_deployment_id}>
                  {rule.mirror_deployment_id.slice(0, 8)} · {rule.percent}%
                </option>
              ))}
            </select>
          </label>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={replay.isPending || (mirroring && Boolean(deploymentId) && targets.isPending)}
          onClick={() => void run()}
        >
          {replay.isPending ? 'Queuing replay…' : 'Replay through mirror'}
        </Button>
      </div>
      {known && target && rules.length === 1 && (
        <p className="text-xs text-muted-foreground">
          Goes to deployment {target.mirror_deployment_id.slice(0, 8)}, the target of this
          deployment&apos;s mirror rule.
        </p>
      )}
      {replay.data ? (
        <ReplayProgress reply={replay.data} onCompare={onCompare} />
      ) : unsupported ? (
        <p role="alert" className="text-xs">
          <span style={{ color: 'var(--status-warning)' }}>
            {(replay.error as ApiError).detail ?? 'This request cannot be replayed.'}
          </span>{' '}
          <MirrorsLink slug={slug} />
        </p>
      ) : gone ? (
        <p role="alert" className="text-xs" style={{ color: 'var(--status-warning)' }}>
          This request&apos;s telemetry is no longer retained, so there is nothing to replay.
        </p>
      ) : (
        replay.error && (
          <InlinePhase phase="error" error={replay.error} onRetry={() => void run()} />
        )
      )}
      <p className="text-xs text-muted-foreground">
        Needs an enabled mirror rule for the serving deployment. Bodies and credentials are not
        retained, so the replay carries neither.
      </p>
    </div>
  );
}

function MirrorsLink({ slug }: { slug: string }) {
  return (
    <Link
      to="/dashboard/apps/$appSlug"
      params={{ appSlug: slug }}
      search={{ tab: 'Mirrors' }}
      className="text-brand underline-offset-2 hover:underline"
    >
      Set up a mirror rule
    </Link>
  );
}

const INVOCATION_STATE: Record<string, { label: string; color: string; icon: typeof CheckCircle }> =
  {
    pending: { label: 'Queued', color: 'var(--chart-muted)', icon: Clock },
    running: { label: 'Running', color: 'var(--status-warning)', icon: Refresh },
    completed: { label: 'Completed', color: 'var(--status-good)', icon: CheckCircle },
    failed: { label: 'Failed', color: 'var(--status-critical)', icon: WarningTriangle },
    dead_letter: { label: 'Dead-lettered', color: 'var(--status-critical)', icon: WarningTriangle },
    cancelled: { label: 'Cancelled', color: 'var(--chart-muted)', icon: Clock },
  };

/** The queued replay, followed through its invocation until it ends. */
function ReplayProgress({
  reply,
  onCompare,
}: {
  reply: NonNullable<ReturnType<typeof useDebugReplay>['data']>;
  onCompare?: (source: string, mirror: string) => void;
}) {
  const id = reply.mirror_invocation_id ?? '';
  const invocation = useInvocation(id, true);
  const state = invocation.data?.state;
  const chip = state ? (INVOCATION_STATE[state] ?? INVOCATION_STATE.pending) : undefined;
  return (
    <div role="status" className="flex flex-col gap-1.5 text-xs">
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        Replay {reply.status}.
        {id && (
          <>
            <span className="text-muted-foreground">Invocation</span>
            <CopyableId value={id} label="invocation ID" />
            {chip && <EvidenceChip {...chip} />}
            <Link
              to="/dashboard/invocations"
              search={{ invocation: id }}
              className="text-brand underline-offset-2 hover:underline"
            >
              Follow the replay
            </Link>
          </>
        )}
      </p>
      {invocation.data?.last_error && (
        <p style={{ color: 'var(--status-critical)' }}>{invocation.data.last_error}</p>
      )}
      {invocation.error ? <InlinePhase phase="error" error={invocation.error} /> : null}
      {reply.source_deployment_id && reply.mirror_deployment_id && onCompare && (
        <button
          type="button"
          className="self-start text-brand underline underline-offset-2"
          onClick={() => onCompare(reply.source_deployment_id!, reply.mirror_deployment_id!)}
        >
          Compare deployment {reply.source_deployment_id.slice(0, 8)} with its mirror{' '}
          {reply.mirror_deployment_id.slice(0, 8)}
        </button>
      )}
    </div>
  );
}
