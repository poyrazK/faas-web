import { useMemo, useState } from 'react';
import { RotateSecretDialog } from '@/components/dashboard/rotate-secret-dialog';
import { createFileRoute } from '@tanstack/react-router';
import { InfoCircle, ListSelect, Refresh, Trash } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { PageHeader, Panel } from '@/components/dashboard/primitives';
import { Pill, ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { AlertDeliveries } from '@/components/dashboard/alert-deliveries';
import { AlertPresets } from '@/components/dashboard/alert-presets';
import { AlertRuleForm } from '@/components/dashboard/alert-rule-form';
import { AlertDetailDrawer } from '@/components/dashboard/alert-detail-drawer';
import { NotificationChannels } from '@/components/dashboard/notification-channels';
import { AppScope, AppSelect, useSelectedApp } from '@/components/dashboard/app-select';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { useAlerts, useDeleteAlert, useRotateAlertSecret, useUpdateAlert } from '@/lib/api/queries';
import { COMPARISON_LABEL as COMPARISON } from '@/lib/alert-rules';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/alerts')({
  component: AlertsPage,
  head: () => consoleHead('alerts'),
});

interface AlertRow {
  id: string;
  name: string;
  condition: string;
  window: string;
  target: string;
  channels: number;
  enabled: boolean;
  state: string;
}

/** Where a rule sends: its webhook host, else its channel count. */
function deliversTo(a: AlertRow): string {
  const channels = a.channels ? `${a.channels} channel${a.channels === 1 ? '' : 's'}` : '';
  const hook = a.target.replace(/^https?:\/\//, '');
  return hook ? hook : channels || 'nowhere';
}

/**
 * The alerts body, without the page chrome around it.
 *
 * Rendered both by this route and as a tab on the app detail page. Could
 * only delete before: rules had to be made with the CLI, the State column
 * showed a pill nothing could flip, and a leaked webhook secret had no way
 * to be rotated from here.
 */
export function AlertsBody({ slug }: { slug: string }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const { data, isPending, error, refetch } = useAlerts(slug);

  // Which rule's delivery history is open. The panel sits under the table so
  // the rule's condition and target stay readable next to what it actually did.
  const [deliveriesFor, setDeliveriesFor] = useState<AlertRow | null>(null);
  const deleteAlert = useDeleteAlert(slug);
  const updateAlert = useUpdateAlert(slug);
  const rotateSecret = useRotateAlertSecret(slug);
  const [rotating, setRotating] = useState<AlertRow | null>(null);
  // The rule whose detail drawer is open.
  const [detailId, setDetailId] = useState<string | undefined>();

  const rows = useMemo<AlertRow[]>(
    () =>
      (data ?? []).map((a) => ({
        id: a.id,
        name: a.name,
        condition: `${a.metric} ${COMPARISON[a.comparison] ?? a.comparison} ${a.threshold}`,
        window: a.window_spec,
        target: a.webhook_url,
        channels: a.channel_ids?.length ?? 0,
        enabled: a.enabled,
        state: a.state,
      })),
    [data]
  );

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
          <span className="truncate font-mono text-xs text-muted-foreground" title={a.target}>
            {deliversTo(a)}
            {a.target && a.channels > 0 && (
              <span>{` + ${a.channels} channel${a.channels === 1 ? '' : 's'}`}</span>
            )}
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
      render: (a) => <span className="font-mono text-xs text-muted-foreground">{a.window}</span>,
    },
    {
      key: 'state',
      label: 'State',
      width: 'w-24',
      render: (a) => (
        <Pill
          label={a.state}
          color={a.state === 'firing' ? 'var(--status-critical)' : 'var(--status-good)'}
        />
      ),
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
    {
      key: 'id',
      label: '',
      width: 'w-32',
      render: (a) => (
        <span className="flex items-center gap-3">
          <button
            type="button"
            aria-label={`Details for ${a.name}`}
            onClick={() => setDetailId(a.id)}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <InfoCircle className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label={`Deliveries for ${a.name}`}
            onClick={() => setDeliveriesFor((cur) => (cur?.id === a.id ? null : a))}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <ListSelect className="h-3.5 w-3.5" />
          </button>
          {a.target && (
            <button
              type="button"
              aria-label={`Rotate secret for ${a.name}`}
              onClick={() => setRotating(a)}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <Refresh className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            aria-label={`Delete rule ${a.name}`}
            onClick={async () => {
              if (
                !(await confirm({
                  title: `Delete ${a.name}?`,
                  description:
                    'The rule stops evaluating immediately and its webhook secret is discarded.',
                  confirmLabel: 'Delete rule',
                  destructive: true,
                }))
              )
                return;
              void deleteAlert
                .mutateAsync(a.id)
                .then(() => toast({ kind: 'success', title: 'Rule deleted' }))
                .catch((err: unknown) =>
                  toast({
                    kind: 'error',
                    title: 'Could not delete',
                    error: err,
                  })
                );
            }}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <Trash className="h-3.5 w-3.5" />
          </button>
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <Panel
        lit
        title="Add a rule"
        description="When the metric crosses the threshold for the window, the rule notifies its channels and POSTs a signed payload to its webhook. Secrets are sealed on save and never shown again."
      >
        <AlertRuleForm slug={slug} />
      </Panel>

      <ResourceTable
        rows={rows}
        columns={columns}
        initialSort={{ key: 'name', dir: 'asc' }}
        searchKeys={['name', 'condition', 'target']}
        searchPlaceholder="Filter by rule name…"
        emptyMessage={`No alert rules for ${slug}.`}
        minWidth="min-w-[920px]"
        loading={isPending}
        error={error}
        onRetry={() => void refetch()}
      />

      {rotating && (
        <RotateSecretDialog
          name={rotating.name}
          onClose={() => setRotating(null)}
          onRotate={(webhookSecret) =>
            rotateSecret
              .mutateAsync({ id: rotating.id, webhookSecret })
              .then(() => toast({ kind: 'success', title: 'Secret rotated' }))
          }
        />
      )}

      {deliveriesFor && (
        <Panel
          title={`Deliveries — ${deliveriesFor.name}`}
          description="Whether the webhook actually received this rule, newest first."
          actions={
            <Button size="sm" variant="secondary" onClick={() => setDeliveriesFor(null)}>
              Close
            </Button>
          }
        >
          <AlertDeliveries slug={slug} ruleId={deliveriesFor.id} />
        </Panel>
      )}
      <NotificationChannels
        rules={(data ?? []).map((a) => ({ id: a.id, name: a.name, channel_ids: a.channel_ids }))}
      />
      <AlertDetailDrawer slug={slug} ruleId={detailId} onClose={() => setDetailId(undefined)} />
      <Panel
        title="Presets"
        description="Rules worth having, already written. Enabling one creates a normal rule — the preset supplies the metric and threshold, you supply the webhook."
      >
        <AlertPresets slug={slug} />
      </Panel>
    </div>
  );
}

function AlertsPage() {
  const appState = useSelectedApp();
  const { slug, select, apps } = appState;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Alerts"
        description="Threshold rules on your app metrics. A breach notifies the rule's channels and POSTs a signed payload to its webhook."
        actions={<AppSelect slug={slug} onSelect={select} apps={apps} />}
      />
      <AppScope state={appState} resource="alert rules">
        <AlertsBody slug={slug} />
      </AppScope>
    </div>
  );
}
