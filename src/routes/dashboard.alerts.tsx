import { useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Plus, Refresh, Trash } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { FIELD } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { PageHeader, Panel } from '@/components/dashboard/primitives';
import { Pill, ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { AppScope, AppSelect, useSelectedApp } from '@/components/dashboard/app-select';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import {
  useAlerts,
  useCreateAlert,
  useDeleteAlert,
  useRotateAlertSecret,
  useUpdateAlert,
} from '@/lib/api/queries';
import { errorMessage } from '@/lib/api/errors';
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
  enabled: boolean;
  state: string;
}

const COMPARISON: Record<string, string> = { gt: '>', gte: '≥', lt: '<', lte: '≤' };

const METRICS = [
  ['error_rate_pct', 'Error rate (%)'],
  ['latency_p50_ms', 'Latency p50 (ms)'],
  ['latency_p95_ms', 'Latency p95 (ms)'],
  ['latency_p99_ms', 'Latency p99 (ms)'],
  ['cold_start_pct', 'Cold starts (%)'],
  ['request_count', 'Requests'],
  ['failed_invocations', 'Failed invocations'],
] as const;
type Metric = (typeof METRICS)[number][0];
type Comparison = 'gt' | 'gte' | 'lt' | 'lte';
const WINDOWS = ['5m', '15m', '1h', '6h', '24h', '7d', '15d'] as const;
type Window = (typeof WINDOWS)[number];

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
  const deleteAlert = useDeleteAlert(slug);
  const updateAlert = useUpdateAlert(slug);
  const rotateSecret = useRotateAlertSecret(slug);
  const createAlert = useCreateAlert(slug);

  const [name, setName] = useState('');
  const [metric, setMetric] = useState<Metric>('error_rate_pct');
  const [comparison, setComparison] = useState<Comparison>('gt');
  const [threshold, setThreshold] = useState('5');
  const [window, setWindow] = useState<Window>('15m');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [cooldown, setCooldown] = useState('30');

  const valid =
    name.trim().length > 0 &&
    Number.isFinite(Number(threshold)) &&
    /^https:\/\//.test(webhookUrl.trim()) &&
    secret.length >= 16;

  const rows = useMemo<AlertRow[]>(
    () =>
      (data ?? []).map((a) => ({
        id: a.id,
        name: a.name,
        condition: `${a.metric} ${COMPARISON[a.comparison] ?? a.comparison} ${a.threshold}`,
        window: a.window_spec,
        target: a.webhook_url,
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
      .catch((err: unknown) =>
        toast({ kind: 'error', title: 'Could not update', description: errorMessage(err) })
      );

  const columns: Column<AlertRow>[] = [
    {
      key: 'name',
      label: 'Rule',
      render: (a) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate">{a.name}</span>
          <span className="truncate font-mono text-xs text-muted-foreground" title={a.target}>
            {a.target.replace(/^https:\/\//, '')}
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
      width: 'w-20',
      render: (a) => (
        <span className="flex items-center gap-3">
          <button
            type="button"
            aria-label={`Rotate secret for ${a.name}`}
            onClick={async () => {
              if (
                !(await confirm({
                  title: `Rotate the secret for ${a.name}?`,
                  description:
                    'A new HMAC secret is minted server-side. Deliveries signed with the old one stop verifying immediately — update the receiver first.',
                  confirmLabel: 'Rotate secret',
                }))
              )
                return;
              void rotateSecret
                .mutateAsync(a.id)
                .then(() => toast({ kind: 'success', title: 'Secret rotated' }))
                .catch((err: unknown) =>
                  toast({
                    kind: 'error',
                    title: 'Could not rotate',
                    description: errorMessage(err),
                  })
                );
            }}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <Refresh className="h-3.5 w-3.5" />
          </button>
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
                    description: errorMessage(err),
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
        description="When the metric crosses the threshold for the window, a signed payload is POSTed to the webhook. The secret is sealed on save and never shown again."
      >
        <form
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid || createAlert.isPending) return;
            void createAlert
              .mutateAsync({
                name: name.trim(),
                metric,
                comparison,
                threshold: Number(threshold),
                window_spec: window,
                webhook_url: webhookUrl.trim(),
                webhook_secret: secret,
                cooldown_minutes: Number(cooldown) || 30,
                action: 'webhook',
              })
              .then((rule) => {
                setName('');
                setWebhookUrl('');
                setSecret('');
                toast({ kind: 'success', title: 'Rule added', description: rule.name });
              })
              .catch((err: unknown) =>
                toast({ kind: 'error', title: 'Could not add', description: errorMessage(err) })
              );
          }}
        >
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="label-mono text-muted-foreground">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Error rate over 5%"
              className={FIELD}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">Metric</span>
            <select
              value={metric}
              onChange={(e) => setMetric(e.target.value as Metric)}
              className={FIELD}
            >
              {METRICS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2">
            <label className="flex w-20 flex-col gap-1.5">
              <span className="label-mono text-muted-foreground">Is</span>
              <select
                value={comparison}
                onChange={(e) => setComparison(e.target.value as Comparison)}
                className={`${FIELD} font-mono`}
              >
                {(['gt', 'gte', 'lt', 'lte'] as const).map((c) => (
                  <option key={c} value={c}>
                    {COMPARISON[c]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-1 flex-col gap-1.5">
              <span className="label-mono text-muted-foreground">Threshold</span>
              <input
                type="number"
                step="any"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                className={`${FIELD} font-mono [font-variant-numeric:tabular-nums]`}
              />
            </label>
          </div>
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="label-mono text-muted-foreground">Webhook URL</span>
            <input
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://hooks.example.com/gregale"
              spellCheck={false}
              className={`${FIELD} font-mono`}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">Webhook secret</span>
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="16+ characters"
              autoComplete="new-password"
              className={`${FIELD} font-mono`}
            />
          </label>
          <div className="flex gap-2">
            <label className="flex flex-1 flex-col gap-1.5">
              <span className="label-mono text-muted-foreground">Window</span>
              <select
                value={window}
                onChange={(e) => setWindow(e.target.value as Window)}
                className={`${FIELD} font-mono`}
              >
                {WINDOWS.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex w-24 flex-col gap-1.5">
              <span className="label-mono text-muted-foreground">Cooldown</span>
              <input
                type="number"
                min={1}
                value={cooldown}
                onChange={(e) => setCooldown(e.target.value)}
                title="Minutes between firings"
                className={`${FIELD} font-mono [font-variant-numeric:tabular-nums]`}
              />
            </label>
          </div>
          <div className="flex items-end sm:col-span-2 lg:col-span-4">
            <Button
              type="submit"
              size="sm"
              className="gap-1.5"
              disabled={!valid}
              busy={createAlert.isPending}
            >
              <Plus className="h-3.5 w-3.5" />
              Add rule
            </Button>
          </div>
        </form>
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
        description="Threshold rules on your app metrics. A breach POSTs a signed payload to the rule's webhook."
        actions={<AppSelect slug={slug} onSelect={select} apps={apps} />}
      />
      <AppScope state={appState} resource="alert rules">
        <AlertsBody slug={slug} />
      </AppScope>
    </div>
  );
}
