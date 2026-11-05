import { AlertDetail, AlertState } from '@/components/dashboard/alert-detail';
import {
  alertActionLabel,
  alertConditionParts,
  explainAlertCondition,
} from '@/components/dashboard/alert-language';
import type { AlertRule } from '@/lib/api/alert-rules';
import { AlertPresets } from '@/components/dashboard/alert-presets';
import { AlertRuleForm } from '@/components/dashboard/alert-rule-form';
import { Sheet } from '@/components/dashboard/kit/sheet';
import { Panel } from '@/components/dashboard/primitives';
import { ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { useNotificationChannels } from '@/lib/api/notification-channels';
import { useAlerts, useDeleteAlert, useUpdateAlert } from '@/lib/api/queries';
import { Plus, Trash } from 'iconoir-react';
import { useMemo, useState } from 'react';

export type AlertsView = 'rules' | 'channels';

export function validateAlertsSearch(search: Record<string, unknown>): { view?: 'channels' } {
  return search.view === 'channels' ? { view: 'channels' } : {};
}

interface AlertRow {
  id: string;
  name: string;
  condition: string;
  rule: AlertRule;
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

  const [creating, setCreating] = useState(false);
  const rows = useMemo<AlertRow[]>(() => {
    const names = new Map((channels.data ?? []).map((c) => [c.id, c.name]));
    return (data ?? []).map((a) => {
      const to = [
        ...(a.channel_ids ?? []).map((id) => names.get(id) ?? `Channel ${id}`),
        ...(a.webhook_url ? [a.webhook_url.replace(/^https:\/\//, '')] : []),
      ];
      return {
        id: a.id,
        name: a.name,
        condition: explainAlertCondition(a),
        rule: a,
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
      label: 'When this happens',
      render: (a) => {
        const condition = alertConditionParts(a.rule);
        const selectors = [
          a.rule.custom_metric_name && `Metric: ${a.rule.custom_metric_name}`,
          a.rule.failure_source &&
            a.rule.failure_source !== 'any' &&
            `Source: ${a.rule.failure_source.replaceAll('_', ' ')}`,
          a.rule.slo_id && `SLO: ${a.rule.slo_id}`,
          a.rule.synthetic_check_id && `Check: ${a.rule.synthetic_check_id}`,
          a.rule.log_query && `Log query: ${a.rule.log_query}`,
          a.rule.edge_rule_id && `Edge rule: ${a.rule.edge_rule_id}`,
          a.rule.event_subscription_id && `Subscription: ${a.rule.event_subscription_id}`,
        ].filter(Boolean);
        return (
          <button
            type="button"
            aria-label={`Details for ${a.name}`}
            aria-expanded={selected === a.id}
            onClick={() => setSelected((cur) => (cur === a.id ? null : a.id))}
            className="flex w-full min-w-0 flex-col gap-1.5 rounded-sm py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring [overflow-wrap:anywhere]"
          >
            <span className="text-sm leading-relaxed">
              {condition.subject} is {condition.comparison}{' '}
              <span className={a.enabled ? 'font-medium text-brand' : 'font-medium'}>
                {condition.value}
              </span>
            </span>
            <span className="text-xs text-muted-foreground">
              {a.name}
              {condition.window && ` · ${condition.window} evaluation window`}
              {a.rule.app_id === '' && ' · Account-wide rule'}
            </span>
            {selectors.length > 0 && (
              <span className="text-xs text-muted-foreground">{selectors.join(' · ')}</span>
            )}
            <span className="md:hidden">
              {a.enabled ? (
                <AlertState state={a.state} />
              ) : (
                <span className="text-xs text-muted-foreground">Paused</span>
              )}
            </span>
            {condition.baseline && (
              <span className="text-xs text-muted-foreground">
                Usual value at this time of day over the last 7 days.
              </span>
            )}
          </button>
        );
      },
    },
    {
      key: 'destination',
      label: 'Then',
      priority: 'secondary',
      render: (a) => (
        <span className="flex max-w-sm flex-col gap-1.5 text-xs leading-relaxed [overflow-wrap:anywhere]">
          <span>{alertActionLabel(a.rule.action)}</span>
          <span className="text-muted-foreground">
            {a.destination || 'No notification destination configured'}
          </span>
        </span>
      ),
    },
    {
      key: 'state',
      label: 'State',
      priority: 'secondary',
      width: 'w-28',
      render: (a) =>
        a.enabled ? (
          <AlertState state={a.state} />
        ) : (
          <span className="text-xs text-muted-foreground">Paused</span>
        ),
    },
    {
      key: 'enabled',
      label: 'Enabled',
      width: 'w-20 md:w-24',
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
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-xl">
          <h2 className="text-base font-medium">Know when something needs you</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Choose what to watch and where to send a notification. Open a rule to see its settings
            and delivery history.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="h-3.5 w-3.5" />
          Add rule
        </Button>
      </div>
      <Sheet open={creating} onClose={() => setCreating(false)} title="Add rule">
        <AlertRuleForm
          slug={slug}
          onCreated={(rule) => {
            setSelected(rule.id);
            setCreating(false);
          }}
        />
      </Sheet>

      <ResourceTable
        rows={rows}
        columns={columns}
        initialSort={{ key: 'name', dir: 'asc' }}
        searchKeys={['name', 'condition', 'destination']}
        searchPlaceholder="Find a rule, condition or destination…"
        emptyMessage={`No alert rules for ${slug}.`}
        minWidth="min-w-0"
        desktopMinWidth="md:min-w-[700px]"
        loading={isPending}
        error={error}
        onRetry={() => void refetch()}
        rowActions={(a) => (
          <span className="flex items-center gap-3">
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
        title="Start with a common alert"
        help="Rules worth having, already written. Enabling one creates a normal rule — the preset supplies the metric and threshold, you choose where it delivers."
      >
        <AlertPresets slug={slug} />
      </Panel>
    </div>
  );
}
