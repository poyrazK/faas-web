import { useId } from 'react';
import { useCapability } from '@/lib/api/capabilities';
import { useWorkerRolloutObservation } from '@/lib/api/deployment-detail';
import { useApp, type Deployment } from '@/lib/api/queries';
import { CapabilityNotice } from './capability-notice';
import { InlinePhase, queryPhase } from './primitives';

/**
 * Where a worker release's residents are: a database snapshot of the selected
 * generation and the ones it replaces (GET /v1/apps/{slug}/rollouts/{id}/observation,
 * scoped_telemetry.go:129). The route answers only for worker apps and is part
 * of `progressive-rollouts`. It is one snapshot, re-read every 10 s, so it is
 * shown as counts rather than drawn as a series.
 */
export function RolloutObservation({ slug, deployment }: { slug: string; deployment: Deployment }) {
  const app = useApp(slug);
  const capability = useCapability('progressive-rollouts');
  const worker = app.data?.manifest?.execution_mode === 'worker';
  const available = capability.state === 'available';
  const query = useWorkerRolloutObservation(
    slug,
    deployment.id,
    deployment.scope,
    worker && available
  );
  if (!worker) return null;
  const data = query.data;

  return (
    <section
      aria-label="Worker rollout"
      className="flex flex-col gap-3 rounded-lg border border-border p-4"
    >
      <p className="label-mono text-muted-foreground">Worker rollout</p>
      {!available ? (
        <CapabilityNotice
          capability={capability.capability}
          state={capability.state}
          onRetry={capability.refresh}
        />
      ) : !data ? (
        <InlinePhase
          phase={queryPhase({ error: query.error, loading: query.isPending })}
          error={query.error}
          loadingMessage="Reading the worker generation…"
          onRetry={() => void query.refetch()}
        />
      ) : (
        <>
          <p className="text-sm">
            {data.generation_converged
              ? 'Converged: every resident runs this release.'
              : data.running + data.starting + data.draining === 0
                ? 'No resident runs this release now.'
                : 'Still converging: some residents run another release or are moving.'}
          </p>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Count label="Running" value={data.running} />
            <Count label="Starting" value={data.starting} />
            <Count label="Draining" value={data.draining} />
            <Count label="Other residents" value={data.other_residents} />
            <Count label="Retired" value={data.retired_residents} />
          </dl>
          <p className="text-xs text-muted-foreground">
            Snapshot from {data.checked_at.replace('T', ' ').slice(0, 19)} UTC. Residents of this
            release, not deliveries: the snapshot does not confirm queue processing or that external
            consumers finished.
          </p>
        </>
      )}
    </section>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  const id = useId();
  return (
    <div className="rounded-md bg-muted px-3 py-2">
      <dt id={id} className="label-mono text-muted-foreground">
        {label}
      </dt>
      <dd aria-labelledby={id} className="mt-1 font-mono text-lg tabular-nums">
        {value}
      </dd>
    </div>
  );
}
