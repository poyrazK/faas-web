import { useMemo } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { InlinePhase, PageHeader, queryPhase } from '@/components/dashboard/primitives';
import { Pill, ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { Button } from '@/components/ui/button';
import { useInfiniteAuditLog } from '@/lib/api/queries';
import { formatRelative } from '@/lib/mock-data';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/audit')({
  component: AuditPage,
  head: () => consoleHead('audit'),
});

/**
 * The account audit trail, from `/v1/audit-log`.
 *
 * Append-only by design: there is no write path and nothing to edit here. The
 * opaque cursor lets the page inspect the full history without timestamp
 * duplicates when several events land in the same instant.
 */
interface AuditRow {
  id: string;
  at: string;
  actor: string;
  kind: string;
  detail: string;
}

function formatWhen(value: string): string {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? '—' : formatRelative(ms);
}

/**
 * Each entry carries a free-form `data` bag whose keys vary by event kind.
 * Rendering it as compact JSON keeps every event legible without pretending
 * there is a fixed schema to build columns from.
 */
function summarise(data: Record<string, unknown> | undefined): string {
  if (!data) return '';
  const parts = Object.entries(data)
    .filter(([, v]) => v !== null && v !== '')
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
  return parts.join(' ');
}

function AuditPage() {
  const auditLog = useInfiniteAuditLog();
  const data = useMemo(
    () => auditLog.data?.pages.flatMap((page) => page.entries) ?? [],
    [auditLog.data]
  );
  // Keep already loaded entries usable if an older page fails; only an
  // initial failure should replace the table with its full-page error state.
  const listError = data.length === 0 ? auditLog.error : undefined;
  const listLoading = auditLog.isPending && !auditLog.error && data.length === 0;

  const rows = useMemo<AuditRow[]>(
    () =>
      data.map((e) => ({
        id: e.id,
        at: e.received_at,
        actor: e.actor ?? e.account_email ?? '',
        kind: e.kind,
        detail: summarise(e.data),
      })),
    [data]
  );

  const columns: Column<AuditRow>[] = [
    {
      key: 'at',
      label: 'When',
      numeric: true,
      render: (e) => <span className="text-xs text-muted-foreground">{formatWhen(e.at)}</span>,
    },
    {
      key: 'kind',
      label: 'Event',
      width: 'w-56',
      render: (e) => <Pill label={e.kind} />,
    },
    {
      key: 'actor',
      label: 'Actor',
      render: (e) => <span className="text-xs text-muted-foreground">{e.actor || '—'}</span>,
    },
    {
      key: 'detail',
      label: 'Detail',
      render: (e) => (
        <span className="break-all font-mono text-xs text-muted-foreground">{e.detail || '—'}</span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Audit Log"
        description="Every account-level change, append-only. Who did what, and when."
      />
      <ResourceTable
        rows={rows}
        columns={columns}
        initialSort={{ key: 'at', dir: 'desc' }}
        searchKeys={['kind', 'actor', 'detail']}
        searchPlaceholder="Filter by event, actor, or subject…"
        emptyMessage="Nothing recorded yet."
        minWidth="min-w-[900px]"
        loading={listLoading}
        error={listError}
        onRetry={() => void auditLog.refetch()}
      />
      {data.length > 0 && Boolean(auditLog.error) && (
        <div className="flex flex-wrap items-center justify-center gap-3">
          <InlinePhase phase={queryPhase({ error: auditLog.error })} error={auditLog.error} />
          <Button
            size="xs"
            variant="ghost"
            onClick={() =>
              void (
                auditLog.isFetchNextPageError ? auditLog.fetchNextPage() : auditLog.refetch()
              ).catch(() => undefined)
            }
          >
            Retry
          </Button>
        </div>
      )}
      {auditLog.hasNextPage && (
        <div className="flex justify-center">
          <Button
            size="sm"
            variant="outline"
            busy={auditLog.isFetchingNextPage}
            onClick={() => void auditLog.fetchNextPage().catch(() => undefined)}
          >
            Load older events
          </Button>
        </div>
      )}
    </div>
  );
}
