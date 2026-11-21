import type { ReactNode } from 'react';
import { CopyableId } from '@/components/ui/copyable-id';
import { formatRelative } from '@/lib/mock-data';
import { InlinePhase, type QueryPhase } from '../primitives';
import { ReleaseStatusLabel } from '../release-status-label';
import { sourceSize } from '../releases-search';
import type { Build, ReleaseContext } from './release-page';

export function relativeTime(value?: string | null): string {
  if (!value) return '—';
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? value : formatRelative(timestamp);
}

export function EvidenceFields({ values }: { values: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {values.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="label-mono text-muted-foreground">{label}</dt>
          <dd
            className="mt-1 font-mono text-xs leading-relaxed [overflow-wrap:anywhere]"
            title={typeof value === 'string' ? value : undefined}
          >
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** IDs and the created time, copyable in full; the rest is one click away. */
export function ReleaseFacts({
  deployment,
  build,
  onOpenDetails,
}: Pick<ReleaseContext, 'deployment' | 'build'> & { onOpenDetails: () => void }) {
  const buildId = deployment.build_id ?? build?.id;
  return (
    <section
      aria-label="Release facts"
      className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl px-1 text-xs text-muted-foreground"
    >
      <Fact label="Deployment">
        <CopyableId value={deployment.id} label="deployment ID" />
      </Fact>
      {buildId && (
        <Fact label="Build">
          <CopyableId value={buildId} label="build ID" />
        </Fact>
      )}
      {deployment.image_digest && (
        <Fact label="Image">
          <CopyableId value={deployment.image_digest} label="image digest" />
        </Fact>
      )}
      <Fact label="Created">{relativeTime(deployment.created_at)}</Fact>
      <button
        type="button"
        onClick={onOpenDetails}
        className="ml-auto text-brand underline-offset-4 hover:underline"
      >
        All details
      </button>
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span className="bento-label">{label}</span>
      {children}
    </span>
  );
}

/** Every recorded fact about the release and its build, as the old Overview tab listed them. */
export function ReleaseDetailsPopup({
  deployment,
  build,
  buildPhase,
  buildError,
  onRetryBuild,
}: Pick<ReleaseContext, 'deployment' | 'build'> & {
  buildPhase: QueryPhase;
  buildError?: unknown;
  onRetryBuild?: () => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <EvidenceFields
        values={[
          ['Deployment ID', <CopyableId value={deployment.id} label="deployment ID" full />],
          ['Kind', deployment.kind],
          [
            'Build ID',
            (deployment.build_id ?? build?.id) ? (
              <CopyableId value={(deployment.build_id ?? build?.id)!} label="build ID" full />
            ) : (
              '—'
            ),
          ],
          [
            'Image',
            deployment.image_digest ? (
              <CopyableId value={deployment.image_digest} label="image digest" full />
            ) : (
              '—'
            ),
          ],
          ['Created', relativeTime(deployment.created_at)],
          ['Error code', deployment.error_code ?? '—'],
          [
            'Canary',
            deployment.canary_total_steps
              ? `${deployment.canary_preset ?? ''} step ${deployment.canary_step ?? 0}/${deployment.canary_total_steps} · ${deployment.rollout_state ?? ''}`.trim()
              : '—',
          ],
          ['Traffic', deployment.traffic_percent != null ? `${deployment.traffic_percent}%` : '—'],
        ]}
      />
      {build ? (
        <BuildFields build={build} />
      ) : buildPhase === 'empty' ? (
        <p className="text-sm text-muted-foreground">No build is recorded for this release.</p>
      ) : (
        <InlinePhase
          phase={buildPhase}
          error={buildError}
          loadingMessage="Loading build…"
          onRetry={onRetryBuild}
        />
      )}
    </div>
  );
}

export function BuildFields({ build }: { build: Build }) {
  return (
    <EvidenceFields
      values={[
        ['Build status', <ReleaseStatusLabel status={build.status} />],
        ['Source', build.kind],
        ['Failure class', build.failure_class ?? '—'],
        ['Source size', sourceSize(build.source_bytes)],
        ['Build duration', build.duration_seconds == null ? '—' : `${build.duration_seconds}s`],
        ['Enqueued', relativeTime(build.enqueued_at)],
        ['Started', relativeTime(build.started_at)],
        ['Finished', relativeTime(build.finished_at)],
      ]}
    />
  );
}
