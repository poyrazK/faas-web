import { useState } from 'react';
import { ApiError, errorMessage } from '@/lib/api/errors';
import {
  REQUEST_AUDIT_DEFAULT_LIMIT,
  REQUEST_AUDIT_MAX_LIMIT,
  REQUEST_AUDIT_WINDOWS,
  useRequestAudit,
  type RequestAuditRecord,
  type RequestAuditWindow,
} from '@/lib/api/request-audit';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { Timestamp } from './events/event-format';
import { InlinePhase, Panel, queryPhase } from './primitives';
import { Pill, ResourceTable, type Column } from './resource-table';
import { RouteCustomersPanel } from './route-customers';

const WINDOW_LABELS: Record<RequestAuditWindow, string> = {
  '1h': 'Last hour',
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
};

function explain(error: unknown): string {
  if (error instanceof ApiError) {
    // Sessions need MFA for this read (server.go requireMFA); the client also
    // opens the verify prompt, so this line only says why the list is missing.
    if (error.code === 'mfa_required')
      return 'Request audit is only shown to a verified session. Verify with your second factor, then try again.';
    if (error.code === 'capacity_unavailable')
      return 'Request audit is briefly unavailable. Try again in a moment.';
  }
  return errorMessage(error);
}

const statusColor = (status: number) =>
  status >= 500
    ? 'var(--status-critical)'
    : status >= 400
      ? 'var(--status-warning)'
      : 'var(--status-good)';

type Row = RequestAuditRecord & { id: string };

const mono = (value: string | undefined, short?: number) =>
  value ? (
    <span className="whitespace-nowrap font-mono text-xs" title={value}>
      {short ? value.slice(0, short) : value}
    </span>
  ) : (
    <span className="text-xs text-muted-foreground">—</span>
  );

// Method and route share the first column so a phone keeps request, status
// and time in view; everything else folds into the row's disclosure there.
const COLUMNS: Column<Row>[] = [
  {
    key: 'route_template',
    label: 'Request',
    render: (r) => (
      <span className="whitespace-nowrap font-mono text-xs">
        <span className="text-muted-foreground">{r.method}</span> {r.route_template}
      </span>
    ),
  },
  {
    key: 'http_status',
    label: 'Status',
    width: 'w-20',
    render: (r) => <Pill label={String(r.http_status)} color={statusColor(r.http_status)} />,
  },
  {
    key: 'occurred_at',
    label: 'When',
    render: (r) => (
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        <Timestamp iso={r.occurred_at} />
      </span>
    ),
  },
  {
    key: 'latency_ms',
    label: 'Latency',
    numeric: true,
    priority: 'secondary',
    render: (r) => (
      <span className="whitespace-nowrap [font-variant-numeric:tabular-nums]">
        {r.latency_ms} ms
      </span>
    ),
  },
  {
    key: 'source_ip',
    label: 'Source IP',
    priority: 'secondary',
    render: (r) => mono(r.source_ip),
  },
  {
    key: 'consumer_id',
    label: 'Consumer',
    priority: 'secondary',
    render: (r) => mono(r.consumer_id, 8),
  },
  {
    key: 'platform_tenant_id',
    label: 'Tenant',
    priority: 'secondary',
    render: (r) => mono(r.platform_tenant_id, 8),
  },
  {
    key: 'request_id',
    label: 'Request ID',
    priority: 'secondary',
    render: (r) => mono(r.request_id),
  },
  {
    key: 'commit_sha',
    label: 'Commit',
    priority: 'secondary',
    render: (r) => mono(r.commit_sha, 7),
  },
];

/**
 * The app's exact request trail (faas ADR-242): one record per completed
 * request the gateway served, not the sampled debugger rows. It is a gateway
 * activity trail, not a business audit log — the app's own users and actions
 * are not known to the platform.
 */
export function RequestAuditPanel({ slug }: { slug: string }) {
  const [window, setWindow] = useState<RequestAuditWindow>('24h');
  const [limit, setLimit] = useState(REQUEST_AUDIT_DEFAULT_LIMIT);
  const audit = useRequestAudit(slug, window, limit);
  const records = audit.data?.records ?? [];
  const phase = queryPhase({
    error: audit.error,
    loading: audit.isPending,
    isEmpty: records.length === 0,
  });
  const full = records.length >= limit;
  const rows: Row[] = records.map((r) => ({ ...r, id: r.event_id }));

  return (
    <Panel
      title="Request audit"
      description="One record per completed request the gateway served, kept 30 days. No query strings, headers or bodies are kept. Source IPs, and literal path segments in routes the app does not declare, can be personal data."
      actions={
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Window
          <Select
            aria-label="Window"
            value={window}
            onChange={(e) => {
              setWindow(e.target.value as RequestAuditWindow);
              setLimit(REQUEST_AUDIT_DEFAULT_LIMIT);
            }}
            className="h-8 text-xs"
          >
            {Object.keys(REQUEST_AUDIT_WINDOWS).map((key) => (
              <option key={key} value={key}>
                {WINDOW_LABELS[key as RequestAuditWindow]}
              </option>
            ))}
          </Select>
        </label>
      }
    >
      {phase === 'empty' ? (
        <div className="space-y-2 text-sm">
          <p className="font-medium">No audit records in this window.</p>
          <p className="max-w-2xl text-muted-foreground">
            Request audit is off by default. The platform operator turns it on for every app at
            once: it is not a per-app or gregale.yaml setting. If this app served requests in this
            window and none are listed, collection is off.
          </p>
        </div>
      ) : phase !== 'ready' ? (
        <InlinePhase
          phase={phase}
          // The explained sentence replaces the API's for the codes above.
          error={audit.error ? new Error(explain(audit.error)) : undefined}
          loadingMessage="Loading request audit…"
          onRetry={() => void audit.refetch()}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <ResourceTable
            rows={rows}
            columns={COLUMNS}
            searchKeys={['route_template', 'method', 'source_ip', 'consumer_id', 'request_id']}
            searchPlaceholder="Filter route, IP, consumer or request ID…"
            desktopMinWidth="md:min-w-[960px]"
          />
          {full && limit < REQUEST_AUDIT_MAX_LIMIT && (
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              Showing the newest {limit}.
              <Button
                size="xs"
                variant="outline"
                busy={audit.isFetching}
                onClick={() => setLimit(REQUEST_AUDIT_MAX_LIMIT)}
              >
                Show up to {REQUEST_AUDIT_MAX_LIMIT}
              </Button>
            </div>
          )}
          {full && limit >= REQUEST_AUDIT_MAX_LIMIT && (
            <p className="text-xs text-muted-foreground">
              Showing the newest {limit}. A read returns at most {REQUEST_AUDIT_MAX_LIMIT} records
              and there is no export yet, so choose a shorter window to reach older ones.
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}

/** The app's Observe › Request audit page: the exact trail, then customers by route. */
export function RequestAuditBody({ slug }: { slug: string }) {
  return (
    <div className="flex flex-col gap-6">
      <RequestAuditPanel slug={slug} />
      <RouteCustomersPanel slug={slug} />
    </div>
  );
}
