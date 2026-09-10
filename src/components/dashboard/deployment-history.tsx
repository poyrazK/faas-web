import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  EmptyState,
  ErrorState,
  InlinePhase,
  Panel,
  UnreachableState,
  queryPhase,
} from './primitives';
import { Pill } from './resource-table';
import { useAppDeployments } from '@/lib/api/queries';
import { formatRelative } from '@/lib/mock-data';

const STATUS_COLOR: Record<string, string> = {
  active: 'var(--status-good)',
  complete: 'var(--status-good)',
  completed: 'var(--status-good)',
  live: 'var(--status-good)',
  succeeded: 'var(--status-good)',
  superseded: 'var(--status-good)',
  cancelled: 'var(--status-critical)',
  crashed: 'var(--status-critical)',
  error: 'var(--status-critical)',
  failed: 'var(--status-critical)',
};

function shortDigest(digest: string): string {
  const bare = digest.includes(':') ? digest.slice(digest.indexOf(':') + 1) : digest;
  return bare.slice(0, 7);
}

function relativeTime(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? value : formatRelative(timestamp);
}

export interface DeploymentHistoryTiming {
  durationSeconds?: number;
}

/**
 * App-scoped deployment history. The API owns ordering and pagination, so an
 * app with thousands of releases is not truncated by the account-wide feed.
 */
export function DeploymentHistoryPanel({
  slug,
  selectedDeploymentId,
  buildTimings,
  onSelect,
  actions,
}: {
  slug: string;
  selectedDeploymentId?: string;
  buildTimings: ReadonlyMap<string, DeploymentHistoryTiming>;
  onSelect: (id: string) => void;
  actions?: ReactNode;
}) {
  const deployments = useAppDeployments(slug);
  const items = deployments.data?.pages.flatMap((page) => page.items) ?? [];
  const phase = queryPhase({
    error: items.length === 0 ? deployments.error : undefined,
    loading: deployments.isPending,
  });
  const nextPagePhase = queryPhase({ error: deployments.error });
  const loadedLabel = `${items.length}${deployments.hasNextPage ? '+' : ''} deployments loaded`;

  let body: ReactNode;
  if (phase === 'unreachable') {
    body = <UnreachableState onRetry={() => void deployments.refetch()} />;
  } else if (phase === 'error') {
    body = <ErrorState error={deployments.error} onRetry={() => void deployments.refetch()} />;
  } else if (phase === 'loading') {
    body = <p className="text-sm text-muted-foreground">Loading deployment history…</p>;
  } else if (items.length === 0) {
    body = <EmptyState message="No deployments yet. Deploy a Git ref or use the CLI." />;
  } else {
    body = (
      <>
        <ul className="flex flex-col divide-y divide-border">
          {items.map((deployment) => {
            const status = deployment.status.toLowerCase();
            const timing = buildTimings.get(deployment.id);
            return (
              <li key={deployment.id}>
                <button
                  type="button"
                  aria-current={selectedDeploymentId === deployment.id ? 'true' : undefined}
                  onClick={() => onSelect(deployment.id)}
                  className="flex w-full flex-wrap items-center gap-3 py-3 text-left transition-colors first:pt-0 last:pb-0 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
                  <Pill
                    label={deployment.status}
                    color={STATUS_COLOR[status] ?? 'var(--status-warning)'}
                  />
                  <span className="font-mono text-xs text-muted-foreground">
                    image {shortDigest(deployment.image_digest) || '—'}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {deployment.error || deployment.kind || 'Deployment'}
                  </span>
                  <span className="w-20 text-right text-xs text-muted-foreground [font-variant-numeric:tabular-nums]">
                    {timing?.durationSeconds == null
                      ? '—'
                      : `${timing.durationSeconds.toFixed(1)}s`}
                  </span>
                  <span className="w-16 text-right text-xs text-muted-foreground [font-variant-numeric:tabular-nums]">
                    {relativeTime(deployment.created_at)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {deployments.error && (
          <div className="mt-3">
            <InlinePageError phase={nextPagePhase} error={deployments.error} />
          </div>
        )}
        {deployments.hasNextPage && (
          <div className="mt-4 flex justify-center">
            <Button
              size="xs"
              variant="outline"
              busy={deployments.isFetchingNextPage}
              onClick={() => void deployments.fetchNextPage().catch(() => undefined)}
            >
              Load older
            </Button>
          </div>
        )}
      </>
    );
  }

  return (
    <Panel
      title="Deployment history"
      description={phase === 'loading' ? undefined : loadedLabel}
      actions={actions}
    >
      {body}
    </Panel>
  );
}

function InlinePageError({
  phase,
  error,
}: {
  phase: ReturnType<typeof queryPhase>;
  error: unknown;
}) {
  return <InlinePhase phase={phase} error={error} />;
}
