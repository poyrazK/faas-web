import { useState } from 'react';
import { Plus } from 'iconoir-react';
import { PageHeader, Panel, Skeleton } from '@/components/dashboard/primitives';
import { Pill, ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { Tabs } from '@/components/dashboard/tabs';
import { Button } from '@/components/ui/button';
import { useCapability } from '@/lib/api/capabilities';
import {
  useOutboundIntegrations,
  useOutboundUsages,
  type OutboundIntegration,
  type OutboundUsage,
} from '@/lib/api/outbound';
import { useAuth } from '@/lib/auth';
import { formatNumber } from '@/lib/mock-data';
import { AIGatewayView } from './ai-gateway';
import { CreateIntegrationDialog } from './integration-create';
import { IntegrationDetail, type DetailSection } from './integration-detail';
import { AI_PROVIDER_LABELS, CredentialPill } from './outbound-format';

export type IntegrationsView = 'integrations' | 'ai';

type Row = OutboundIntegration & {
  usage?: OutboundUsage;
  usageState: 'loading' | 'ready' | 'unavailable';
  /** Sortable copy of today's count; unknown sorts last. */
  today: number;
};

function UsageCell({ row }: { row: Row }) {
  if (row.usageState === 'loading') return <Skeleton className="ml-auto h-4 w-20" />;
  if (!row.usage)
    return (
      <span className="text-muted-foreground" title="Usage could not be read.">
        —
      </span>
    );
  const { daily_request_count: count, daily_request_limit: limit } = row.usage;
  const near = limit != null && count >= limit * 0.8;
  return (
    <span
      className="[font-variant-numeric:tabular-nums]"
      style={near ? { color: 'var(--status-warning)' } : undefined}
    >
      {formatNumber(count)}
      <span className="text-muted-foreground">
        {' '}
        / {limit == null ? 'no limit' : formatNumber(limit)}
      </span>
      {near && <span className="sr-only"> (at or above 80% of the daily limit)</span>}
    </span>
  );
}

const COLUMNS: Column<Row>[] = [
  {
    key: 'name',
    label: 'Integration',
    sortable: true,
    render: (row) => (
      <div className="min-w-0">
        <p className="truncate font-medium">{row.name}</p>
        <p className="truncate text-xs text-muted-foreground">{row.origin}</p>
      </div>
    ),
  },
  {
    key: 'ai_provider',
    label: 'Kind',
    priority: 'secondary',
    render: (row) =>
      row.ai_provider ? <Pill label={`AI · ${AI_PROVIDER_LABELS[row.ai_provider]}`} /> : 'HTTP',
  },
  {
    key: 'credential_configured',
    label: 'Credential',
    render: (row) => <CredentialPill integration={row} />,
  },
  {
    key: 'enabled',
    label: 'Status',
    priority: 'secondary',
    render: (row) => (
      <span className={row.enabled ? undefined : 'text-muted-foreground'}>
        {row.enabled ? 'Enabled' : 'Disabled'}
        {row.owner_kind === 'operator' && (
          <span className="block text-xs text-muted-foreground">Operator-provisioned</span>
        )}
      </span>
    ),
  },
  {
    key: 'today',
    label: 'Requests today',
    numeric: true,
    sortable: true,
    render: (row) => <UsageCell row={row} />,
  },
];

/**
 * Managed outbound integrations, and — when the account has it — the AI
 * gateway that rides on them. The list is the page; everything you can
 * change about one integration lives behind its row.
 */
export function IntegrationsBody({
  view,
  onView,
}: {
  view: IntegrationsView;
  onView: (view: IntegrationsView) => void;
}) {
  const accountId = useAuth().account?.id ?? '';
  const list = useOutboundIntegrations(accountId);
  const usages = useOutboundUsages(
    accountId,
    (list.data ?? []).map((i) => i.id)
  );
  const ai = useCapability('ai-gateway');
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<OutboundIntegration | null>(null);
  const [section, setSection] = useState<DetailSection>('overview');

  const rows: Row[] = (list.data ?? []).map((integration, index) => {
    const usage = usages[index];
    return {
      ...integration,
      usage: usage?.data,
      usageState: usage?.data ? 'ready' : usage?.isPending ? 'loading' : 'unavailable',
      today: usage?.data?.daily_request_count ?? -1,
    };
  });
  // Re-read from the list so a write that invalidates it updates the open
  // detail; the snapshot covers the moment before a refetch includes it.
  const open =
    list.data?.find((i) => i.id === openId) ?? (snapshot?.id === openId ? snapshot : null);
  const show = (integration: OutboundIntegration, next: DetailSection) => {
    setSection(next);
    setSnapshot(integration);
    setOpenId(integration.id);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Integrations"
        description="Fixed HTTPS destinations your apps call through the outbound gateway, with a sealed credential, a daily budget, and an admission policy."
        actions={
          view === 'integrations' && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus /> New integration
            </Button>
          )
        }
      />
      <Tabs
        label="Integrations sections"
        panelId="integrations-panel"
        value={view}
        onChange={onView}
        options={[
          { key: 'integrations', label: 'Integrations' },
          { key: 'ai', label: 'AI gateway' },
        ]}
      />
      <div id="integrations-panel" role="tabpanel">
        {view === 'integrations' ? (
          <Panel>
            <ResourceTable
              rows={rows}
              columns={COLUMNS}
              initialSort={{ key: 'name', dir: 'asc' }}
              onRowClick={(row) => show(row, 'overview')}
              searchKeys={['name', 'origin']}
              searchPlaceholder="Filter integrations…"
              loading={list.isPending}
              error={list.error}
              onRetry={() => void list.refetch()}
              emptyMessage="No integrations yet. Create one to let your apps call an external API through the gateway."
              emptyAction={
                <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
                  New integration
                </Button>
              }
              minWidth="min-w-[640px]"
            />
          </Panel>
        ) : (
          <AIGatewayView accountId={accountId} integrations={list.data} />
        )}
      </div>
      <CreateIntegrationDialog
        open={creating}
        accountId={accountId}
        aiAvailable={ai.state === 'available'}
        onClose={() => setCreating(false)}
        onCreated={(created) => {
          setCreating(false);
          // The credential is a separate write; go straight to it.
          show(created, 'credential');
        }}
      />
      <IntegrationDetail
        accountId={accountId}
        integration={open}
        section={section}
        onSection={setSection}
        onClose={() => setOpenId(null)}
      />
    </div>
  );
}
