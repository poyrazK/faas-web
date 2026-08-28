import { useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '@/components/dashboard/primitives';
import { Pill, ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { Download } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/api/errors';
import { useBuilds, useFetchBuildSbom } from '@/lib/api/queries';
import { useLogStream } from '@/lib/api/logs';
import { LogView } from '@/components/dashboard/log-view';
import { formatRelative } from '@/lib/mock-data';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/builds')({
  component: BuildsPage,
  head: () => consoleHead('builds'),
});

/**
 * Image builds, from `/v1/builds`.
 *
 * `failure_class` is the useful column on a bad day: the API separates a build
 * the customer broke (`user_error`) from one the platform broke (`oom`,
 * `timeout`, `infra`), which is the difference between "fix your Dockerfile"
 * and "retry". Flattening both into "failed" would throw that away.
 */
interface BuildRow {
  id: string;
  /** The build log is served per deployment, so the row carries it. */
  deploymentId: string;
  kind: string;
  status: string;
  failureClass: string;
  sourceBytes: number;
  duration: number;
  enqueuedAt: string;
}

const STATUS_COLOR: Record<string, string> = {
  succeeded: 'var(--status-good)',
  running: 'var(--status-warning)',
  queued: 'var(--chart-muted)',
  failed: 'var(--status-critical)',
};

function formatBytes(bytes: number): string {
  if (!bytes) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatWhen(value: string | undefined): string {
  if (!value) return '—';
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? '—' : formatRelative(ms);
}

/**
 * One build, with its SBOM as a download. `useBuildSbom` existed and had no
 * caller; the SBOM is the one artefact a security review asks for and it was
 * only reachable through the API.
 */
function BuildDrawer({ build, onClose }: { build: BuildRow | null; onClose: () => void }) {
  const { toast } = useToast();
  const sbom = useFetchBuildSbom();
  // The build's own output, from the second SSE endpoint. A failed build's
  // reason lives here and nowhere else the console could reach.
  const source = useMemo(
    () => ({ kind: 'build' as const, deploymentId: build?.deploymentId ?? '' }),
    [build?.deploymentId]
  );
  const { lines, status } = useLogStream(source, build !== null);

  const download = () => {
    if (!build) return;
    void sbom
      .mutateAsync(build.id)
      .then((data) => {
        // Hand the JSON to the browser as a file; nothing here has to parse it.
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `sbom-${build.id.slice(0, 12)}.cdx.json`;
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch((err: unknown) =>
        toast({ kind: 'error', title: 'No SBOM for this build', description: errorMessage(err) })
      );
  };

  return (
    <Modal
      open={build !== null}
      onClose={onClose}
      title={build ? `Build ${build.id.slice(0, 12)}` : ''}
      description={build ? `${build.kind} · ${build.status}` : undefined}
      width="max-w-2xl"

      footer={
        build?.status === 'succeeded' ? (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            busy={sbom.isPending}
            onClick={download}
          >
            <Download className="h-3.5 w-3.5" />
            Download SBOM
          </Button>
        ) : undefined
      }
    >
      {build && (
        <div className="flex flex-col gap-5">
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {[
              ['Status', build.status],
              ['Source', build.kind],
              ['Failure class', build.failureClass || '—'],
              ['Source size', `${(build.sourceBytes / 1e6).toFixed(1)} MB`],
              ['Duration', build.duration ? `${build.duration}s` : '—'],
              ['Enqueued', formatRelative(Date.parse(build.enqueuedAt))],
            ].map(([k, v]) => (
              <div key={k} className="flex min-w-0 flex-col gap-0.5">
                <dt className="label-mono text-muted-foreground">{k}</dt>
                <dd className="truncate font-mono text-xs">{v}</dd>
              </div>
            ))}
          </dl>

          <div>
            <p className="label-mono mb-2 text-muted-foreground">Output</p>
            {lines.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {status === 'connecting' ? 'Reading the build log…' : 'No build output was kept.'}
              </p>
            ) : (
              <LogView lines={lines} className="max-h-64" />
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function BuildsPage() {
  const { data, isPending, error, refetch } = useBuilds();
  const [selected, setSelected] = useState<BuildRow | null>(null);

  const rows = useMemo<BuildRow[]>(
    () =>
      (data?.items ?? []).map((b) => ({
        id: b.id,
        deploymentId: b.deployment_id,
        kind: b.kind,
        status: b.status,
        failureClass: b.failure_class ?? '',
        sourceBytes: b.source_bytes,
        duration: b.duration_seconds ?? 0,
        enqueuedAt: b.enqueued_at,
      })),
    [data]
  );

  const columns: Column<BuildRow>[] = [
    {
      key: 'status',
      label: 'Status',
      width: 'w-32',
      render: (b) => <Pill label={b.status} color={STATUS_COLOR[b.status]} />,
    },
    { key: 'kind', label: 'Source', width: 'w-32', render: (b) => <Pill label={b.kind} /> },
    {
      key: 'failureClass',
      label: 'Failure',
      width: 'w-32',
      render: (b) =>
        b.failureClass ? (
          <Pill
            label={b.failureClass}
            // A user error is not an incident; an infra failure is.
            color={
              b.failureClass === 'user_error' ? 'var(--status-warning)' : 'var(--status-critical)'
            }
          />
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: 'sourceBytes',
      label: 'Source size',
      numeric: true,
      render: (b) => (
        <span className="[font-variant-numeric:tabular-nums]">{formatBytes(b.sourceBytes)}</span>
      ),
    },
    {
      key: 'duration',
      label: 'Duration',
      numeric: true,
      render: (b) => (
        <span className="[font-variant-numeric:tabular-nums]">
          {b.duration ? `${b.duration.toFixed(1)}s` : '—'}
        </span>
      ),
    },
    {
      key: 'enqueuedAt',
      label: 'Queued',
      numeric: true,
      render: (b) => (
        <span className="text-xs text-muted-foreground">{formatWhen(b.enqueuedAt)}</span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Builds"
        description="Image builds behind your deployments, and why any of them failed."
      />
      <ResourceTable
        rows={rows}
        columns={columns}
        initialSort={{ key: 'enqueuedAt', dir: 'desc' }}
        searchKeys={['id', 'kind', 'status']}
        searchPlaceholder="Filter by status or source…"
        emptyMessage="No builds yet."
        minWidth="min-w-[900px]"
        loading={isPending}
        error={error}
        onRetry={() => void refetch()}
        onRowClick={(b) => setSelected(b)}
      />

      <BuildDrawer build={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
