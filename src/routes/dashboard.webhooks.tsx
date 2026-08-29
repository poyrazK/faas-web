import { useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { List, Plus, Refresh, Trash } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { FIELD } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { Modal } from '@/components/ui/modal';
import { InlinePhase, PageHeader, Panel, queryPhase } from '@/components/dashboard/primitives';
import { Pill, ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { AppScope, AppSelect, useSelectedApp } from '@/components/dashboard/app-select';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import {
  useCreateWebhook,
  useDeleteWebhook,
  useRetryDelivery,
  useRotateWebhookSecret,
  useUpdateWebhook,
  useWebhookDeliveries,
  useWebhooks,
} from '@/lib/api/queries';
import { errorMessage } from '@/lib/api/errors';
import { formatRelative } from '@/lib/mock-data';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/webhooks')({
  component: WebhooksPage,
  head: () => consoleHead('webhooks'),
});

interface WebhookRow {
  id: string;
  target: string;
  events: string;
  retryPolicy: string;
  enabled: boolean;
}

const EVENTS = [
  'cron.fired',
  'app.created',
  'app.deleted',
  'build.succeeded',
  'build.failed',
] as const;
type Event = (typeof EVENTS)[number];
type RetryPolicy = 'default' | 'aggressive' | 'none';

const DELIVERY_COLOR: Record<string, string | undefined> = {
  succeeded: 'var(--status-good)',
  failed: 'var(--status-serious)',
  dead: 'var(--status-critical)',
  pending: 'var(--status-warning)',
  in_flight: 'var(--status-warning)',
};

function when(value: string | undefined): string {
  if (!value) return '—';
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? '—' : formatRelative(ms);
}

/**
 * Recent deliveries for one webhook, with a retry on the ones that died.
 * `useWebhookDeliveries` and `useRetryDelivery` both existed and had no
 * caller; this is what they were for.
 */
function Deliveries({
  slug,
  hook,
  onClose,
}: {
  slug: string;
  hook: WebhookRow | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const deliveries = useWebhookDeliveries(slug, hook?.id ?? '');
  const retry = useRetryDelivery(slug, hook?.id ?? '');
  const list = deliveries.data?.deliveries ?? [];
  const deliveriesPhase = queryPhase({
    error: deliveries.error,
    loading: deliveries.isPending,
    isEmpty: list.length === 0,
  });

  return (
    <Modal
      open={hook !== null}
      onClose={onClose}
      title="Deliveries"
      description={hook?.target}
      width="max-w-2xl"
    >
      {deliveriesPhase !== 'ready' ? (
        <InlinePhase
          phase={deliveriesPhase}
          error={deliveries.error}
          loadingMessage="Loading deliveries…"
          emptyMessage="Nothing has been delivered yet."
        />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {list.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-sm">
              <Pill label={d.status} color={DELIVERY_COLOR[d.status]} />
              <span className="font-mono text-xs">{d.event}</span>
              <span className="text-xs text-muted-foreground">{when(d.created_at)}</span>
              {d.attempt > 1 && (
                <span className="text-xs text-muted-foreground">attempt {d.attempt}</span>
              )}
              {d.last_error && (
                <span className="font-mono text-xs text-muted-foreground">{d.last_error}</span>
              )}
              {(d.status === 'dead' || d.status === 'failed') && (
                <button
                  type="button"
                  disabled={retry.isPending}
                  onClick={() =>
                    void retry
                      .mutateAsync(d.id)
                      .then(() => toast({ kind: 'success', title: 'Delivery re-armed' }))
                      .catch((err: unknown) =>
                        toast({
                          kind: 'error',
                          title: 'Could not retry',
                          description: errorMessage(err),
                        })
                      )
                  }
                  className="ml-auto text-xs text-brand transition-colors hover:text-brand-hover disabled:opacity-50"
                >
                  Retry
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

/**
 * The webhooks body, without the page chrome around it.
 *
 * Rendered both by this route and as a tab on the app detail page. This
 * was the one page in the console with no mutations at all — the API has
 * create, update, delete, rotate, deliveries, and retry, and the console
 * had a read-only table.
 */
export function WebhooksBody({ slug }: { slug: string }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const { data, isPending, error, refetch } = useWebhooks(slug);
  const create = useCreateWebhook(slug);
  const update = useUpdateWebhook(slug);
  const remove = useDeleteWebhook(slug);
  const rotate = useRotateWebhookSecret(slug);

  const [target, setTarget] = useState('');
  const [secret, setSecret] = useState('');
  const [events, setEvents] = useState<Event[]>([]);
  const [retryPolicy, setRetryPolicy] = useState<RetryPolicy>('default');
  const [viewing, setViewing] = useState<WebhookRow | null>(null);

  const valid = /^https:\/\//.test(target.trim()) && secret.length >= 16;

  const rows = useMemo<WebhookRow[]>(
    () =>
      (data ?? []).map((w) => ({
        id: w.id,
        target: w.target_url,
        events: w.event_filter?.length ? w.event_filter.join(', ') : 'all events',
        retryPolicy: w.retry_policy,
        enabled: w.enabled,
      })),
    [data]
  );

  const setEnabled = (w: WebhookRow, enabled: boolean) =>
    void update
      .mutateAsync({ id: w.id, enabled })
      .then(() => toast({ kind: 'success', title: enabled ? 'Webhook enabled' : 'Webhook paused' }))
      .catch((err: unknown) =>
        toast({ kind: 'error', title: 'Could not update', description: errorMessage(err) })
      );

  const columns: Column<WebhookRow>[] = [
    {
      key: 'target',
      label: 'Target URL',
      render: (w) => <span className="break-all font-mono text-xs">{w.target}</span>,
    },
    {
      key: 'events',
      label: 'Events',
      render: (w) => <span className="text-xs text-muted-foreground">{w.events}</span>,
    },
    {
      key: 'retryPolicy',
      label: 'Retries',
      width: 'w-28',
      render: (w) => <Pill label={w.retryPolicy} />,
    },
    {
      key: 'enabled',
      label: 'Enabled',
      width: 'w-24',
      render: (w) => (
        <Switch
          size="sm"
          checked={w.enabled}
          onCheckedChange={(on) => setEnabled(w, on)}
          aria-label={`${w.enabled ? 'Pause' : 'Enable'} webhook to ${w.target}`}
          className="data-[state=checked]:bg-brand"
        />
      ),
    },
    {
      key: 'id',
      label: '',
      width: 'w-28',
      render: (w) => (
        <span className="flex items-center gap-3">
          <button
            type="button"
            aria-label={`Deliveries for ${w.target}`}
            onClick={() => setViewing(w)}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <List className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label={`Rotate secret for ${w.target}`}
            onClick={async () => {
              if (
                !(await confirm({
                  title: 'Rotate this webhook secret?',
                  description:
                    'A new HMAC secret is minted server-side. Deliveries signed with the old one stop verifying immediately — update the receiver first.',
                  confirmLabel: 'Rotate secret',
                }))
              )
                return;
              void rotate
                .mutateAsync(w.id)
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
            aria-label={`Delete webhook to ${w.target}`}
            onClick={async () => {
              if (
                !(await confirm({
                  title: 'Delete this webhook?',
                  description: `${w.target} stops receiving events. Pending deliveries are dropped.`,
                  confirmLabel: 'Delete webhook',
                  destructive: true,
                }))
              )
                return;
              void remove
                .mutateAsync(w.id)
                .then(() => toast({ kind: 'success', title: 'Webhook deleted' }))
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
        title="Add a webhook"
        description="Every matching event is POSTed as JSON with an HMAC signature. The secret is sealed on save and never shown again."
      >
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid || create.isPending) return;
            void create
              .mutateAsync({
                target_url: target.trim(),
                webhook_secret: secret,
                event_filter: events,
                retry_policy: retryPolicy,
                enabled: true,
              })
              .then(() => {
                setTarget('');
                setSecret('');
                setEvents([]);
                toast({ kind: 'success', title: 'Webhook added' });
              })
              .catch((err: unknown) =>
                toast({ kind: 'error', title: 'Could not add', description: errorMessage(err) })
              );
          }}
        >
          <label className="flex flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">Target URL</span>
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="https://ops.example.com/hooks/gregale"
              spellCheck={false}
              className={`${FIELD} font-mono`}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">Secret</span>
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="16+ characters"
              autoComplete="new-password"
              className={`${FIELD} font-mono`}
            />
          </label>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="label-mono text-muted-foreground">Events</legend>
            <div className="flex flex-wrap gap-1.5 pt-1.5">
              {EVENTS.map((ev) => {
                const on = events.includes(ev);
                return (
                  <button
                    key={ev}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setEvents((prev) => (on ? prev.filter((x) => x !== ev) : [...prev, ev]))
                    }
                    className={`h-8 rounded-md border px-2.5 font-mono text-xs pressable ${
                      on
                        ? 'border-brand bg-brand/10 text-foreground'
                        : 'border-border text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {ev}
                  </button>
                );
              })}
            </div>
            <span className="text-xs text-muted-foreground">None selected means every event.</span>
          </fieldset>
          <div className="flex items-end gap-3">
            <label className="flex flex-1 flex-col gap-1.5">
              <span className="label-mono text-muted-foreground">Retries</span>
              <select
                value={retryPolicy}
                onChange={(e) => setRetryPolicy(e.target.value as RetryPolicy)}
                className={FIELD}
              >
                <option value="default">default — back off over 7 tries</option>
                <option value="aggressive">aggressive — tighter back-off</option>
                <option value="none">none — one attempt</option>
              </select>
            </label>
            <Button
              type="submit"
              size="sm"
              className="gap-1.5"
              disabled={!valid}
              busy={create.isPending}
            >
              <Plus className="h-3.5 w-3.5" />
              Add webhook
            </Button>
          </div>
        </form>
      </Panel>

      <ResourceTable
        rows={rows}
        columns={columns}
        initialSort={{ key: 'target', dir: 'asc' }}
        searchKeys={['target', 'events']}
        searchPlaceholder="Filter by target URL…"
        emptyMessage={`No webhooks for ${slug}.`}
        minWidth="min-w-[900px]"
        loading={isPending}
        error={error}
        onRetry={() => void refetch()}
      />

      <Deliveries slug={slug} hook={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}

function WebhooksPage() {
  const appState = useSelectedApp();
  const { slug, select, apps } = appState;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Webhooks"
        description="Signed outbound deliveries. Failed attempts back off and dead-letter after seven tries."
        actions={<AppSelect slug={slug} onSelect={select} apps={apps} />}
      />
      <AppScope state={appState} resource="webhooks">
        <WebhooksBody slug={slug} />
      </AppScope>
    </div>
  );
}
