import { useEffect, useRef } from 'react';
import { useDeployment } from '@/lib/api/queries';

const terminal = new Set(['failed', 'cancelled', 'superseded']);

export function WorkerReleaseProgress({
  slug,
  appId,
  deploymentId,
  onLive,
  onTerminal,
}: {
  slug: string;
  appId: string;
  deploymentId: string;
  onLive?: () => void;
  onTerminal?: () => void;
}) {
  const notified = useRef('');
  const result = useDeployment(deploymentId, {
    refetchInterval: (query) => {
      const status = query.state.data?.status?.toLowerCase();
      return status === 'live' || (status && terminal.has(status)) ? false : 2500;
    },
  });
  const deployment = result.data;
  const wrongApp = Boolean(deployment && deployment.app_id !== appId);
  const status = !wrongApp && !result.isError ? deployment?.status?.toLowerCase() : undefined;
  useEffect(() => {
    if (!status || notified.current === `${deploymentId}:${status}`) return;
    if (status === 'live') {
      notified.current = `${deploymentId}:${status}`;
      onLive?.();
    } else if (terminal.has(status)) {
      notified.current = `${deploymentId}:${status}`;
      onTerminal?.();
    }
  }, [deploymentId, status, onLive, onTerminal]);
  return (
    <section
      className="space-y-2 rounded border border-border p-3 text-sm"
      aria-label="Worker release"
    >
      <p>Release {deploymentId} accepted.</p>
      {wrongApp ? (
        <p role="alert">This release belongs to a different app. Inspect it before continuing.</p>
      ) : result.isError ? (
        <p role="status">Release status unavailable. Execution unverified.</p>
      ) : status === 'live' ? (
        <>
          <p role="status">
            Release live. This confirms deployment state, not worker execution health.
          </p>
          <p>
            Check runtime instances and consumer liveness separately before relying on queue
            delivery.
          </p>
        </>
      ) : status && terminal.has(status) ? (
        <p role="status">
          Release {status}. The app remains available for a reviewed new image attempt.
        </p>
      ) : (
        <p role="status">
          {status ? `Release ${status}.` : 'Reading release status.'} Execution unverified.
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <a
          className="text-brand underline"
          href={`/dashboard/deployments?deployment=${encodeURIComponent(deploymentId)}`}
        >
          Inspect release
        </a>
        <a
          className="text-brand underline"
          href={`/dashboard/workflows/${encodeURIComponent(slug)}?tab=Queues`}
        >
          Inspect consumers
        </a>
      </div>
    </section>
  );
}
