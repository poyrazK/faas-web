import { InboundWebhooks } from '@/components/dashboard/inbound-webhooks';
import { Sheet } from '@/components/dashboard/kit/sheet';
import { Pill, ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { RotateSecretDialog } from '@/components/dashboard/rotate-secret-dialog';
import { SegmentedControl } from '@/components/dashboard/tabs';
import { WebhookDeliveries } from '@/components/dashboard/webhook-deliveries';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import {
  FIELD,
  FieldError,
  Select,
  fieldErrorProps,
  useFormValidation,
} from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import {
  useCreateWebhook,
  useDeleteWebhook,
  useRotateWebhookSecret,
  useUpdateWebhook,
  useWebhooks,
} from '@/lib/api/queries';
import {
  WEBHOOK_EVENTS,
  webhookEventLabel,
  type WebhookEvent,
} from '@/components/dashboard/webhook-events';
import { Plus, Refresh, Trash } from 'iconoir-react';
import { useMemo, useState } from 'react';

export function validateWebhookSearch(search: Record<string, unknown>): {
  direction?: 'inbound' | 'outbound';
  scope?: 'account';
} {
  return {
    direction: search.direction === 'inbound' ? 'inbound' : undefined,
    scope: search.scope === 'account' ? 'account' : undefined,
  };
}

export function WebhooksHub({
  accountId,
  slug,
  direction,
  onDirection,
}: {
  accountId: string;
  slug: string;
  direction: 'inbound' | 'outbound';
  onDirection: (direction: 'inbound' | 'outbound') => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <SegmentedControl
        label="Webhook direction"
        value={direction}
        options={[
          { key: 'outbound', label: 'Send events' },
          { key: 'inbound', label: 'Receive events' },
        ]}
        onChange={onDirection}
      />
      {direction === 'inbound' ? (
        <InboundWebhooks accountId={accountId} slug={slug} />
      ) : (
        <WebhooksBody slug={slug} />
      )}
    </div>
  );
}

interface WebhookRow {
  id: string;
  target: string;
  events: string;
  eventCodes: string;
  retryPolicy: string;
  enabled: boolean;
}

type RetryPolicy = 'default' | 'aggressive' | 'none';
const RETRY_LABELS: Record<string, string> = {
  default: 'Automatic retries',
  aggressive: 'Retry sooner',
  none: 'One attempt',
};

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname);
  } catch {
    return false;
  }
}

/**
 * One webhook's delivery health, its deliveries and each one's attempts, with
 * a retry on the dead ones (WebhookDeliveries, shared with account receivers).
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
  return (
    <Modal
      open={hook !== null}
      onClose={onClose}
      title="Deliveries"
      description={hook?.target}
      width="max-w-3xl"
    >
      {hook && <WebhookDeliveries scope={{ slug, id: hook.id }} />}
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

  const [creating, setCreating] = useState(false);
  const [target, setTarget] = useState('');
  const [secret, setSecret] = useState('');
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [eventMode, setEventMode] = useState<'all' | 'selected'>('all');
  const [retryPolicy, setRetryPolicy] = useState<RetryPolicy>('default');
  const [viewing, setViewing] = useState<WebhookRow | null>(null);
  const [rotating, setRotating] = useState<WebhookRow | null>(null);
  const validation = useFormValidation<'target' | 'secret' | 'eventMode'>();
  const targetError =
    target.trim().length > 2048
      ? 'Target URLs can be at most 2048 characters.'
      : isHttpsUrl(target.trim())
        ? undefined
        : 'Enter a complete HTTPS target URL.';
  const secretError =
    secret.length >= 1 && secret.length <= 256
      ? undefined
      : 'Enter a secret of no more than 256 characters.';
  const eventError =
    eventMode === 'selected' && events.length === 0
      ? 'Choose at least one event, or select All events.'
      : undefined;
  const shownEventError = validation.submitAttempted ? eventError : undefined;
  const shownTargetError = validation.submitAttempted ? targetError : undefined;
  const shownSecretError = validation.submitAttempted ? secretError : undefined;

  const rows = useMemo<WebhookRow[]>(
    () =>
      (data ?? []).map((w) => ({
        id: w.id,
        target: w.target_url,
        events: w.event_filter?.length
          ? w.event_filter.map(webhookEventLabel).join('; ')
          : 'All events',
        eventCodes: w.event_filter?.join(' ') ?? '',
        retryPolicy: w.retry_policy,
        enabled: w.enabled,
      })),
    [data]
  );

  const setEnabled = (w: WebhookRow, enabled: boolean) =>
    void update
      .mutateAsync({ id: w.id, enabled })
      .then(() => toast({ kind: 'success', title: enabled ? 'Webhook enabled' : 'Webhook paused' }))
      .catch((err: unknown) => toast({ kind: 'error', title: 'Could not update', error: err }));

  const columns: Column<WebhookRow>[] = [
    {
      key: 'target',
      label: 'Send to',
      render: (w) => (
        <button
          type="button"
          onClick={() => setViewing(w)}
          aria-label={`View deliveries to ${w.target}`}
          className="flex w-full flex-col gap-1.5 rounded-sm py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring [overflow-wrap:anywhere]"
        >
          <span className="text-sm">{w.target}</span>
          <span className="text-xs leading-relaxed text-muted-foreground md:hidden">
            {w.events}
          </span>
          <span className="text-xs text-muted-foreground">
            {w.enabled ? 'Active' : 'Paused'} · View deliveries
          </span>
        </button>
      ),
    },
    {
      key: 'events',
      label: 'When',
      priority: 'secondary',
      render: (w) => (
        <span className="block max-w-sm text-sm leading-relaxed [overflow-wrap:anywhere]">
          {w.events}
        </span>
      ),
    },
    {
      key: 'retryPolicy',
      label: 'If delivery fails',
      width: 'w-36',
      priority: 'secondary',
      render: (w) => <Pill label={RETRY_LABELS[w.retryPolicy] ?? w.retryPolicy} />,
    },
    {
      key: 'enabled',
      label: 'Enabled',
      width: 'w-20 md:w-24',
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
      width: 'w-20',
      render: (w) => (
        <span className="flex items-center gap-3">
          <button
            type="button"
            aria-label={`Rotate secret for ${w.target}`}
            onClick={() => setRotating(w)}
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
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-xl">
          <h2 className="text-base font-medium">Keep your other tools in the loop</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            When something happens in {slug}, send an event to a URL you choose. Open a webhook to
            check its deliveries.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="h-3.5 w-3.5" />
          Add webhook
        </Button>
      </div>
      <Sheet open={creating} onClose={() => setCreating(false)} title="Add webhook">
        <form
          noValidate
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (
              !validation.validate(
                { target: targetError, secret: secretError, eventMode: eventError },
                e.currentTarget
              ) ||
              create.isPending
            )
              return;
            void create
              .mutateAsync({
                target_url: target.trim(),
                webhook_secret: secret,
                event_filter: eventMode === 'all' ? [] : events,
                retry_policy: retryPolicy,
                enabled: true,
              })
              .then(() => {
                setTarget('');
                setSecret('');
                setEvents([]);
                setEventMode('all');
                setRetryPolicy('default');
                validation.resetValidation();
                setCreating(false);
                toast({ kind: 'success', title: 'Webhook added' });
              })
              .catch((err: unknown) =>
                toast({ kind: 'error', title: 'Could not add', error: err })
              );
          }}
        >
          <p className="text-sm leading-relaxed text-muted-foreground">
            Choose where to send events from {slug} and which changes you care about.
          </p>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Target URL</span>
            <input
              name="target"
              maxLength={2048}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              {...fieldErrorProps(shownTargetError, 'webhook-target-error')}
              placeholder="https://ops.example.com/hooks/gregale"
              type="url"
              spellCheck={false}
              className={`${FIELD} font-mono`}
            />
            {shownTargetError && (
              <FieldError id="webhook-target-error">{shownTargetError}</FieldError>
            )}
          </label>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="app-webhook-secret" className="text-sm font-medium">
              Signing secret
            </label>
            <input
              id="app-webhook-secret"
              name="secret"
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              {...fieldErrorProps(shownSecretError, 'webhook-secret-error')}
              placeholder="1–256 characters"
              autoComplete="new-password"
              aria-describedby={
                shownSecretError
                  ? 'webhook-secret-error app-webhook-secret-help'
                  : 'app-webhook-secret-help'
              }
              className={`${FIELD} font-mono`}
            />
            {shownSecretError && (
              <FieldError id="webhook-secret-error">{shownSecretError}</FieldError>
            )}
            <span
              id="app-webhook-secret-help"
              className="text-xs leading-relaxed text-muted-foreground"
            >
              Use the same secret in your receiver to verify messages came from Gregale. You cannot
              read it back after saving.
            </span>
          </div>
          <fieldset className="flex flex-col gap-3 border-t border-border pt-4">
            <legend className="text-sm font-medium">Which events should we send?</legend>
            <div className="grid gap-2">
              {(['all', 'selected'] as const).map((mode) => (
                <label
                  key={mode}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-3 text-sm ${eventMode === mode ? 'border-brand/50 bg-brand/5' : 'border-border'}`}
                >
                  <input
                    type="radio"
                    name="eventMode"
                    value={mode}
                    checked={eventMode === mode}
                    onChange={() => setEventMode(mode)}
                    className="size-4 accent-[color:var(--brand)]"
                    {...fieldErrorProps(shownEventError, 'webhook-events-error')}
                  />
                  {mode === 'all' ? 'All events' : 'Choose events'}
                </label>
              ))}
            </div>
            {eventMode === 'all' ? (
              <p className="text-xs leading-relaxed text-muted-foreground">
                Includes all supported app events, including new event types added in the future.
              </p>
            ) : (
              <div className="flex flex-col gap-4 rounded-lg border border-border p-3">
                {[...new Set(WEBHOOK_EVENTS.map((item) => item.group))].map((group) => (
                  <fieldset key={group}>
                    <legend className="mb-2 text-xs font-medium text-muted-foreground">
                      {group}
                    </legend>
                    <div className="grid gap-1 sm:grid-cols-2 sm:gap-x-4">
                      {WEBHOOK_EVENTS.filter((item) => item.group === group).map(
                        ({ event, label }) => (
                          <label
                            key={event}
                            className="flex cursor-pointer items-start gap-2.5 rounded px-1 py-2 text-sm hover:bg-muted/50"
                            title={event}
                          >
                            <input
                              type="checkbox"
                              checked={events.includes(event)}
                              onChange={(e) =>
                                setEvents((prev) =>
                                  e.target.checked
                                    ? [...prev, event]
                                    : prev.filter((item) => item !== event)
                                )
                              }
                              className="mt-0.5 size-4 shrink-0 accent-[color:var(--brand)]"
                            />
                            {label}
                          </label>
                        )
                      )}
                    </div>
                  </fieldset>
                ))}
                <p className="text-xs text-muted-foreground">{events.length} selected</p>
              </div>
            )}
            {shownEventError && (
              <FieldError id="webhook-events-error">{shownEventError}</FieldError>
            )}
          </fieldset>
          <details className="border-t border-border pt-4">
            <summary className="cursor-pointer text-sm font-medium">Advanced settings</summary>
            <div className="flex flex-col gap-3 pt-4">
              <p className="text-xs leading-relaxed text-muted-foreground">
                Events are sent as JSON in a signed HTTP POST request.
              </p>
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">If delivery fails</span>
                <Select
                  value={retryPolicy}
                  onChange={(e) => setRetryPolicy(e.target.value as RetryPolicy)}
                  className={FIELD}
                >
                  <option value="default">Retry automatically</option>
                  <option value="aggressive">Retry sooner</option>
                  <option value="none">Do not retry</option>
                </Select>
              </label>
              <p className="text-xs text-muted-foreground">
                Automatic retries wait longer between attempts. Retry sooner uses shorter waits.
              </p>
            </div>
          </details>
          <div className="flex justify-end">
            <Button type="submit" size="sm" busy={create.isPending}>
              Add webhook
            </Button>
          </div>
        </form>
      </Sheet>

      <ResourceTable
        rows={rows}
        columns={columns}
        initialSort={{ key: 'target', dir: 'asc' }}
        searchKeys={['target', 'events', 'eventCodes']}
        searchPlaceholder="Find a destination or event…"
        emptyMessage={`No webhooks for ${slug}.`}
        minWidth="min-w-0"
        desktopMinWidth="md:min-w-[740px]"
        loading={isPending}
        error={error}
        onRetry={() => void refetch()}
      />

      <p className="text-xs text-muted-foreground">
        Release events from every app can also go to one account receiver, with its own key:{' '}
        <a className="text-brand underline" href="/dashboard/webhooks?scope=account">
          account release webhooks
        </a>
        .
      </p>

      <Deliveries slug={slug} hook={viewing} onClose={() => setViewing(null)} />
      {rotating && (
        <RotateSecretDialog
          name={rotating.target}
          onClose={() => setRotating(null)}
          onRotate={(webhookSecret) =>
            rotate
              .mutateAsync({ id: rotating.id, webhookSecret })
              .then(() => toast({ kind: 'success', title: 'Secret rotated' }))
          }
        />
      )}
    </div>
  );
}
