import { useId, useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { ListSelect, Trash } from 'iconoir-react';
import { Switch } from '@/components/ui/switch';
import { PageHeader, Panel } from '@/components/dashboard/primitives';
import { ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { AlertDetail, AlertState } from '@/components/dashboard/alert-detail';
import { describeCondition, metricSpec } from '@/components/dashboard/alert-metrics';
import { AlertPresets } from '@/components/dashboard/alert-presets';
import { AlertRuleForm } from '@/components/dashboard/alert-rule-form';
import { MaturityLabel } from '@/components/dashboard/maturity-label';
import { NotificationChannels } from '@/components/dashboard/notification-channels';
import { Tabs, tabId } from '@/components/dashboard/tabs';
import { AppScope, AppSelect, useSelectedApp } from '@/components/dashboard/app-select';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { useCapability } from '@/lib/api/capabilities';
import { useNotificationChannels } from '@/lib/api/notification-channels';
import { useAlerts, useDeleteAlert, useUpdateAlert } from '@/lib/api/queries';
import { consoleHead } from '@/lib/seo';

export type AlertsView = 'rules' | 'channels';

export function validateAlertsSearch(search: Record<string, unknown>): { view?: 'channels' } {
  return search.view === 'channels' ? { view: 'channels' } : {};
}

export const Route = createFileRoute('/dashboard/alerts')({
  component: AlertsPage,
  head: () => consoleHead('alerts'),
  validateSearch: validateAlertsSearch,
});

interface AlertRow {
  id: string;
  name: string;
  condition: string;
  window: string;
  destination: string;
  enabled: boolean;
  state: string;
}

/**
 * The alerts body, without the page chrome around it.
 *
 * Rendered both by this route and as a tab on the app detail page: the rules
 * an app sees (its own and the account-wide ones), a form for new ones, the
 * selected rule in full, and the preset catalog.
 */
export function AlertsBody({ slug }: { slug: string }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const { data, isPending, error, refetch } = useAlerts(slug);
  const channels = useNotificationChannels();
  const deleteAlert = useDeleteAlert(slug);
  const updateAlert = useUpdateAlert(slug);
  // The rule open in the detail panel. The panel sits under the table so the
  // list stays readable next to what one rule actually did.
  const [selected, setSelected] = useState<string | null>(null);

  const rows = useMemo<AlertRow[]>(() => {
    const names = new Map((channels.data ?? []).map((c) => [c.id, c.name]));
    return (data ?? []).map((a) => {
      const to = [
        ...(a.channel_ids ?? []).map((id) => names.get(id) ?? 'channel'),
        ...(a.webhook_url ? [a.webhook_url.replace(/^https:\/\//, '')] : []),
      ];
      return {
        id: a.id,
        name: a.name,
        condition: describeCondition(a),
        // apid ignores the window for SLO metrics and consecutive check failures.
        window: metricSpec(a.metric)?.ignoresWindow ? '—' : a.window_spec,
        destination: to.join(', '),
        enabled: a.enabled,
        state: a.state,
      };
    });
  }, [data, channels.data]);

  const setEnabled = (a: AlertRow, enabled: boolean) =>
    void updateAlert
      .mutateAsync({ id: a.id, enabled })
      .then(() =>
        toast({ kind: 'success', title: enabled ? `${a.name} resumed` : `${a.name} paused` })
      )
      .catch((err: unknown) => toast({ kind: 'error', title: 'Could not update', error: err }));

  const columns: Column<AlertRow>[] = [
    {
      key: 'name',
      label: 'Rule',
      render: (a) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate">{a.name}</span>
          <span className="truncate font-mono text-xs text-muted-foreground" title={a.destination}>
            {a.destination ? `→ ${a.destination}` : 'Delivers nowhere'}
          </span>
        </span>
      ),
    },
    {
      key: 'condition',
      label: 'Condition',
      render: (a) => <span className="font-mono text-xs">{a.condition}</span>,
    },
    {
      key: 'window',
      label: 'Window',
      width: 'w-20',
      priority: 'secondary',
      render: (a) => <span className="font-mono text-xs text-muted-foreground">{a.window}</span>,
    },
    {
      key: 'state',
      label: 'State',
      width: 'w-28',
      render: (a) => <AlertState state={a.state} />,
    },
    {
      key: 'enabled',
      label: 'Enabled',
      width: 'w-24',
      render: (a) => (
        <Switch
          size="sm"
          checked={a.enabled}
          onCheckedChange={(on) => setEnabled(a, on)}
          aria-label={`${a.enabled ? 'Pause' : 'Resume'} ${a.name}`}
          className="data-[state=checked]:bg-brand"
        />
      ),
    },
  ];

  const askDelete = async (a: AlertRow) => {
    if (
      !(await confirm({
        title: `Delete ${a.name}?`,
        description: 'The rule stops evaluating immediately and its webhook secret is discarded.',
        confirmLabel: 'Delete rule',
        destructive: true,
      }))
    )
      return;
    void deleteAlert
      .mutateAsync(a.id)
      .then(() => {
        if (selected === a.id) setSelected(null);
        toast({ kind: 'success', title: 'Rule deleted' });
      })
      .catch((err: unknown) => toast({ kind: 'error', title: 'Could not delete', error: err }));
  };

  return (
    <div className="flex flex-col gap-6">
      <Panel
        lit
        title="Add a rule"
        description="When the metric crosses the threshold over the window, the rule notifies its channels, its signed webhook, or both."
      >
        <AlertRuleForm slug={slug} onCreated={(rule) => setSelected(rule.id)} />
      </Panel>

      <ResourceTable
        rows={rows}
        columns={columns}
        initialSort={{ key: 'name', dir: 'asc' }}
        searchKeys={['name', 'condition', 'destination']}
        searchPlaceholder="Filter by rule name…"
        emptyMessage={`No alert rules for ${slug}.`}
        minWidth="min-w-[860px]"
        loading={isPending}
        error={error}
        onRetry={() => void refetch()}
        onRowClick={(a) => setSelected(a.id)}
        rowActions={(a) => (
          <span className="flex items-center gap-3">
            <button
              type="button"
              aria-label={`Details for ${a.name}`}
              aria-pressed={selected === a.id}
              onClick={() => setSelected((cur) => (cur === a.id ? null : a.id))}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <ListSelect className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label={`Delete rule ${a.name}`}
              onClick={() => void askDelete(a)}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <Trash className="h-3.5 w-3.5" />
            </button>
          </span>
        )}
      />

      {selected && <AlertDetail slug={slug} ruleId={selected} onClose={() => setSelected(null)} />}

      <Panel
        title="Presets"
        description="Rules worth having, already written. Enabling one creates a normal rule — the preset supplies the metric and threshold, you choose where it delivers."
      >
        <AlertPresets slug={slug} />
      </Panel>
    </div>
  );
}

function AlertsPage() {
  const appState = useSelectedApp();
  const { slug, select, apps } = appState;
  const { capability } = useCapability('alerts');
  const view: AlertsView = Route.useSearch().view ?? 'rules';
  const navigate = Route.useNavigate();
  const panelId = useId();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Alerts"
        description={
          view === 'channels'
            ? 'Slack, PagerDuty and email destinations for every alert rule on the account.'
            : 'Rules on your app metrics, SLOs and logs. A breach notifies the rule’s channels and its signed webhook.'
        }
        actions={
          <>
            <MaturityLabel capability={capability} />
            {view === 'rules' && <AppSelect slug={slug} onSelect={select} apps={apps} />}
          </>
        }
      />
      <Tabs
        label="Alerts"
        value={view}
        panelId={panelId}
        options={[
          { key: 'rules', label: 'Rules' },
          { key: 'channels', label: 'Channels' },
        ]}
        onChange={(next) =>
          void navigate({ search: next === 'channels' ? { view: 'channels' } : {}, replace: true })
        }
      />
      <div id={panelId} role="tabpanel" aria-labelledby={tabId(panelId, view)}>
        {view === 'channels' ? (
          <NotificationChannels />
        ) : (
          <AppScope state={appState} resource="alert rules">
            <AlertsBody slug={slug} />
          </AppScope>
        )}
      </div>
    </div>
  );
}
