import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { CopyableId } from '@/components/ui/copyable-id';
import { useDebugReplay } from '@/lib/api/debug';
import { ApiError } from '@/lib/api/errors';
import { InlinePhase } from './primitives';

/**
 * Replay one retained request through its mirror rule
 * (POST .../debug/requests/{req_id}/replay, handlers_debug_telemetry.go:2540).
 *
 * It is a write that sends traffic: apid reissues the request's method and
 * route to the enabled mirror target of the deployment that served it, with
 * an empty body and platform replay metadata only, because bodies and
 * credentials are never retained. So it is confirmed first and says so. 409
 * `debug_replay_unsupported` means no enabled mirror rule targets that
 * deployment (or the route cannot be replayed safely); apid's detail says
 * which, and Mirrors is where a rule is added.
 */
export function DebugReplayAction({
  slug,
  reqId,
  method,
  route,
}: {
  slug: string;
  reqId: string;
  method?: string;
  route?: string;
}) {
  const confirm = useConfirm();
  const replay = useDebugReplay(slug);
  const unsupported =
    replay.error instanceof ApiError && replay.error.code === 'debug_replay_unsupported';

  const run = async () => {
    const ok = await confirm({
      title: `Replay ${method ?? 'this request'} ${route ?? ''} through its mirror?`.trim(),
      description:
        "Gregale queues a new invocation that reissues this request's method and route through the enabled mirror rule of the deployment that served it. The mirror target runs it for real, with an empty body and no credentials, because neither was kept, so anything that route does can happen again there.",
      confirmLabel: 'Replay request',
    });
    if (ok) replay.mutate(reqId);
  };

  return (
    <div className="flex flex-col items-start gap-2">
      <Button size="sm" variant="outline" disabled={replay.isPending} onClick={() => void run()}>
        {replay.isPending ? 'Queuing replay…' : 'Replay through mirror'}
      </Button>
      {replay.data ? (
        <p role="status" className="flex flex-wrap items-center gap-x-1.5 text-xs">
          Replay {replay.data.status}.
          {replay.data.mirror_invocation_id && (
            <>
              <span className="text-muted-foreground">Invocation</span>
              <CopyableId value={replay.data.mirror_invocation_id} label="invocation ID" />
              <Link
                to="/dashboard/invocations"
                search={{ invocation: replay.data.mirror_invocation_id }}
                className="text-brand underline-offset-2 hover:underline"
              >
                Follow the replay
              </Link>
            </>
          )}
        </p>
      ) : unsupported ? (
        <p role="alert" className="text-xs">
          <span style={{ color: 'var(--status-warning)' }}>
            {(replay.error as ApiError).detail ?? 'This request cannot be replayed.'}
          </span>{' '}
          <Link
            to="/dashboard/apps/$appSlug"
            params={{ appSlug: slug }}
            search={{ tab: 'Mirrors' }}
            className="text-brand underline-offset-2 hover:underline"
          >
            Set up a mirror rule
          </Link>
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
