import { useMemo, useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { InlinePhase, queryPhase } from './primitives';
import { Pill, ResourceTable, type Column } from './resource-table';
import { useAppErrorRequests, useAppErrorSample, useAppErrors } from '@/lib/api/queries';
import { formatRelative } from '@/lib/mock-data';

/**
 * Automatic error grouping for one app — `/v1/apps/{slug}/errors/*`
 * (ADR-096). The platform fingerprints failing requests server-side; this
 * surface is read-only: the groups, the recent requests behind one, and the
 * oldest sample with its redacted headers. No SDK, nothing to install —
 * which is the point, so the copy says so when the table is empty.
 */

interface ErrorRow {
  id: string;
  route: string;
  errorClass: string;
  httpStatus: number;
  count: number;
  lastSeenAt: string;
  sample: string;
}

function when(value: string | undefined): string {
  if (!value) return '—';
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? '—' : formatRelative(ms);
}

function FingerprintModal({
  slug,
  row,
  onClose,
}: {
  slug: string;
  row: ErrorRow | null;
  onClose: () => void;
}) {
  const requests = useAppErrorRequests(slug, row?.id ?? '');
  const sample = useAppErrorSample(slug, row?.id ?? '');
  const requestRows = requests.data?.requests ?? [];
  const requestsPhase = queryPhase({
    error: requests.error,
    loading: requests.isPending,
    isEmpty: requestRows.length === 0,
  });
  const samplePhase = queryPhase({ error: sample.error, loading: sample.isPending });
  const headers = Object.entries(sample.data?.headers_sample ?? {});

  return (
    <Modal
      open={row !== null}
      onClose={onClose}
      title={row ? `${row.errorClass} on ${row.route}` : ''}
      description={row ? `HTTP ${row.httpStatus} · fingerprint ${row.id.slice(0, 12)}` : undefined}
      width="max-w-2xl"
    >
      <div className="flex flex-col gap-5">
        <div>
          <p className="label-mono mb-2 text-muted-foreground">Oldest sample</p>
          {samplePhase !== 'ready' ? (
            <InlinePhase
              phase={samplePhase}
              error={sample.error}
              loadingMessage="Reading sample…"
            />
          ) : (
            <>
              <p className="rounded-md border border-border bg-background px-3 py-2 font-mono text-xs leading-relaxed break-all">
                {sample.data?.sample_message}
              </p>
              {headers.length > 0 && (
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                  {headers.map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="font-mono text-xs text-muted-foreground">{k}</dt>
                      <dd className="truncate font-mono text-xs">{String(v)}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {(sample.data?.redactions_applied?.length ?? 0) > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Redacted before storage: {sample.data?.redactions_applied?.join(', ')}.
                </p>
              )}
            </>
          )}
        </div>

        <div>
          <p className="label-mono mb-2 text-muted-foreground">Recent requests</p>
          {requestsPhase !== 'ready' ? (
            <InlinePhase
              phase={requestsPhase}
              error={requests.error}
              loadingMessage="Reading requests…"
              emptyMessage="No requests recorded for this group."
            />
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {requestRows.slice(0, 8).map((r) => (
                <li
                  key={r.request_id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-xs"
                >
                  <span className="font-mono text-muted-foreground">
                    {r.request_id.slice(0, 12)}
                  </span>
                  <span className="[font-variant-numeric:tabular-nums]">HTTP {r.http_status}</span>
                  <span className="text-muted-foreground">{when(r.received_at)}</span>
                  {r.deployment_id && (
                    <span className="font-mono text-muted-foreground">
                      deploy {r.deployment_id.slice(0, 8)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}

export function ErrorsBody({ slug }: { slug: string }) {
  const { data, isPending, error, refetch } = useAppErrors(slug);
  const [selected, setSelected] = useState<ErrorRow | null>(null);

  const rows = useMemo<ErrorRow[]>(
    () =>
      (data?.items ?? []).map((item) => ({
        id: item.fingerprint,
        route: item.route,
        errorClass: item.error_class,
        httpStatus: item.http_status,
        count: item.count,
        lastSeenAt: item.last_seen_at,
        sample: item.sample_message,
      })),
    [data]
  );

  const columns: Column<ErrorRow>[] = [
    {
      key: 'route',
      label: 'Route',
      render: (r) => (
        <>
          <span className="font-mono text-xs">{r.route}</span>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{r.sample}</p>
        </>
      ),
    },
    {
      key: 'errorClass',
      label: 'Class',
      width: 'w-36',
      render: (r) => <Pill label={r.errorClass} color="var(--status-critical)" />,
    },
    {
      key: 'httpStatus',
      label: 'Status',
      numeric: true,
      width: 'w-24',
      render: (r) => <span className="[font-variant-numeric:tabular-nums]">{r.httpStatus}</span>,
    },
    {
      key: 'count',
      label: 'Count',
      numeric: true,
      width: 'w-24',
      render: (r) => (
        <span className="[font-variant-numeric:tabular-nums]">{r.count.toLocaleString()}</span>
      ),
    },
    {
      key: 'lastSeenAt',
      label: 'Last seen',
      numeric: true,
      render: (r) => <span className="text-xs text-muted-foreground">{when(r.lastSeenAt)}</span>,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <ResourceTable
        rows={rows}
        columns={columns}
        initialSort={{ key: 'count', dir: 'desc' }}
        searchKeys={['route', 'errorClass', 'sample']}
        searchPlaceholder="Filter by route or class…"
        emptyMessage="No errors grouped in this window — grouping is automatic, nothing to install."
        minWidth="min-w-[760px]"
        loading={isPending}
        error={error}
        onRetry={() => void refetch()}
        onRowClick={setSelected}
      />
      <FingerprintModal slug={slug} row={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
