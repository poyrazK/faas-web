import { useState } from 'react';
import {
  CheckCircle,
  Clock,
  NavArrowDown,
  Pause,
  Play,
  Prohibition,
  RefreshDouble,
  WarningTriangle,
} from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { CopyableId } from '@/components/ui/copyable-id';
import { Select } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Timestamp } from '@/components/ui/timestamp';
import { useToast } from '@/components/ui/toast';
import { AppScope, AppSelect, useSelectedApp } from '@/components/dashboard/app-select';
import { CapabilityGate } from '@/components/dashboard/capability-gate';
import { InlinePhase, Panel, StatTile, queryPhase } from '@/components/dashboard/primitives';
import { Pill } from '@/components/dashboard/resource-table';
import {
  DEFAULT_RESUME_RATE,
  MAX_RESUME_RATE,
  useAcknowledgment,
  useDeliveryControl,
  useEventDeliveries,
  useEventSubscriptions,
  usePauseSubscription,
  useResumeSubscription,
  type EventDelivery,
  type EventDeliveryFilter,
  type EventSubscription,
} from '@/lib/api/event-consumers';
import { cn } from '@/lib/utils';

type Tone = 'good' | 'warning' | 'critical' | 'idle';
const TONE: Record<Tone, string> = {
  good: 'var(--status-good)',
  warning: 'var(--status-warning)',
  critical: 'var(--status-critical)',
  idle: 'var(--chart-muted)',
};

/** Status is colour plus icon plus label, never hue alone. */
function Status({ tone, icon: Icon, label }: { tone: Tone; icon: typeof Clock; label: string }) {
  const color = TONE[tone];
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs"
      style={{ backgroundColor: `color-mix(in oklab, ${color} 14%, transparent)`, color }}
    >
      <Icon className="size-3" aria-hidden />
      {label}
    </span>
  );
}

const DELIVERY_STATUS: Record<EventDelivery['state'], [Tone, typeof Clock, string]> = {
  pending: ['idle', Clock, 'Pending'],
  dispatching: ['warning', RefreshDouble, 'Dispatching'],
  completed: ['good', CheckCircle, 'Completed'],
  failed: ['critical', WarningTriangle, 'Failed'],
  dead_letter: ['critical', WarningTriangle, 'Dead-lettered'],
  cancelled: ['idle', Prohibition, 'Cancelled'],
  superseded: ['idle', Prohibition, 'Superseded'],
  expired: ['idle', Prohibition, 'Expired'],
};

const FILTERS: Array<{ value: EventDeliveryFilter | ''; label: string }> = [
  { value: '', label: 'All states' },
  { value: 'pending', label: 'Pending' },
  { value: 'dispatching', label: 'Dispatching' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'dead_letter', label: 'Dead-lettered' },
];

function age(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

/**
 * The app half of the event router: what the app subscribes to, operator
 * pause and resume per subscription, the deliveries it received, and each
 * delivery's acknowledgment lease. Each part sits behind its own catalog
 * capability (event-subscriptions, event-delivery-controls,
 * event-acknowledgments), so a part that is off says so and reads nothing.
 */
export function EventConsumers() {
  const appState = useSelectedApp();
  const { slug, select, apps } = appState;
  return (
    <CapabilityGate capability="event-subscriptions" title="Subscriptions">
      <AppScope state={appState} resource="event subscriptions">
        <div className="flex flex-col gap-6">
          <Subscriptions
            key={slug}
            slug={slug}
            picker={<AppSelect slug={slug} onSelect={select} apps={apps} />}
          />
          <Deliveries key={`deliveries-${slug}`} slug={slug} />
        </div>
      </AppScope>
    </CapabilityGate>
  );
}

function Subscriptions({ slug, picker }: { slug: string; picker: React.ReactNode }) {
  const list = useEventSubscriptions(slug);
  const [openId, setOpenId] = useState<string | null>(null);
  const subscriptions = list.data?.subscriptions ?? [];
  const phase = queryPhase({
    error: list.error,
    loading: list.isPending,
    isEmpty: subscriptions.length === 0,
  });

  return (
    <Panel title="Subscriptions" actions={picker}>
      <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
        {
          "Declared by event_triggers in the app's gregale.yaml: a deploy adds, changes and disables them. Pause and resume are operator controls that survive deploys."
        }
      </p>

      {phase === 'ready' ? (
        <ul className="flex flex-col">
          {subscriptions.map((subscription) => (
            <SubscriptionRow
              key={subscription.id}
              slug={slug}
              subscription={subscription}
              open={openId === subscription.id}
              onToggle={() =>
                setOpenId((current) => (current === subscription.id ? null : subscription.id))
              }
            />
          ))}
        </ul>
      ) : (
        <InlinePhase
          phase={phase}
          error={list.error}
          loadingMessage="Reading subscriptions…"
          emptyMessage="This app subscribes to no events. Add event_triggers to its gregale.yaml and deploy."
          onRetry={() => void list.refetch()}
        />
      )}
    </Panel>
  );
}

function SubscriptionRow({
  slug,
  subscription,
  open,
  onToggle,
}: {
  slug: string;
  subscription: EventSubscription;
  open: boolean;
  onToggle: () => void;
}) {
  const filter = Object.keys(subscription.filter ?? {}).length
    ? JSON.stringify(subscription.filter)
    : '';
  return (
    <li className="flex min-w-0 flex-col gap-3 border-b border-border py-3 last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        aria-label={`Subscription ${subscription.source} ${subscription.type}`}
        className="pressable flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md text-left"
        onClick={onToggle}
      >
        <NavArrowDown
          className={cn('size-4 shrink-0 transition-transform', open && 'rotate-180')}
          aria-hidden
        />
        {subscription.enabled ? (
          <Status tone="good" icon={CheckCircle} label="Enabled" />
        ) : (
          <Status tone="idle" icon={Prohibition} label="Disabled" />
        )}
        <span className="min-w-0 truncate font-mono text-xs">
          {subscription.source} · {subscription.type}
        </span>
        {subscription.ordered && <Pill label="ordered" />}
        {subscription.work_policy && <Pill label={`policy ${subscription.work_policy}`} />}
        {subscription.schema_versions?.length ? (
          <Pill label={`schema ${subscription.schema_versions.join(', ')}`} />
        ) : null}
        {filter && (
          <span className="min-w-0 max-w-full truncate font-mono text-xs text-muted-foreground">
            {filter}
          </span>
        )}
      </button>
      {open && (
        <div className="flex min-w-0 flex-col gap-3 pl-6">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>Subscription ID</span>
            <CopyableId value={subscription.id} label="subscription ID" />
          </div>
          <CapabilityGate capability="event-delivery-controls" title="Delivery control">
            <DeliveryControl slug={slug} subscriptionId={subscription.id} />
          </CapabilityGate>
        </div>
      )}
    </li>
  );
}

function DeliveryControl({ slug, subscriptionId }: { slug: string; subscriptionId: string }) {
  const confirm = useConfirm();
  const { toast } = useToast();
  const control = useDeliveryControl(slug, subscriptionId);
  const pause = usePauseSubscription(slug, subscriptionId);
  const resume = useResumeSubscription(slug, subscriptionId);
  const [rate, setRate] = useState(String(DEFAULT_RESUME_RATE));

  const phase = queryPhase({ error: control.error, loading: control.isPending });
  if (phase !== 'ready' || !control.data) {
    return (
      <InlinePhase
        phase={phase}
        error={control.error}
        loadingMessage="Reading delivery control…"
        onRetry={() => void control.refetch()}
      />
    );
  }
  const state = control.data;
  const rateValue = Number(rate);
  const rateValid =
    rate.trim() !== '' &&
    Number.isInteger(rateValue) &&
    rateValue >= 0 &&
    rateValue <= MAX_RESUME_RATE;

  const onPause = async () => {
    const ok = await confirm({
      title: 'Pause this subscription?',
      description:
        'New routing admissions stop. Matching events are still captured and wait in the backlog, counting toward retained storage; invocations already admitted keep running.',
      confirmLabel: 'Pause',
    });
    if (!ok) return;
    try {
      await pause.mutateAsync();
      toast({ kind: 'success', title: 'Subscription paused' });
    } catch (error) {
      toast({ kind: 'error', title: 'Could not pause', error });
    }
  };

  const onResume = async () => {
    const ok = await confirm({
      title: 'Resume this subscription?',
      description:
        rateValue === 0
          ? `The ${state.pending_recipients} waiting recipients drain without pacing, and new publications route as fast as capacity allows.`
          : `The ${state.pending_recipients} waiting recipients drain at up to ${rateValue} admissions a second; the rate keeps applying to new publications.`,
      confirmLabel: 'Resume',
    });
    if (!ok) return;
    try {
      await resume.mutateAsync(rateValue);
      toast({ kind: 'success', title: 'Subscription resumed' });
    } catch (error) {
      toast({ kind: 'error', title: 'Could not resume', error });
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-4 rounded-lg border border-border bg-background p-4">
      <div className="flex flex-wrap items-center gap-3">
        {state.paused ? (
          <Status tone="warning" icon={Pause} label="Paused" />
        ) : (
          <Status tone="good" icon={Play} label="Routing" />
        )}
        <span className="text-xs text-muted-foreground">
          {state.rate_per_second === 0
            ? 'No pacing'
            : `Up to ${state.rate_per_second} admissions a second`}
        </span>
        {state.updated_at && (
          <span className="text-xs text-muted-foreground">
            Changed <Timestamp value={state.updated_at} />
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile label="Waiting" value={String(state.pending_recipients)} />
        <StatTile label="Processing" value={String(state.processing_recipients)} />
        <StatTile
          label="Oldest waiting"
          value={state.pending_recipients ? age(state.oldest_age_seconds) : '—'}
        />
        <StatTile
          label="Live deliveries"
          value={`${state.live_deliveries} / ${state.effective_max_pending_deliveries}`}
        />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        {state.paused ? (
          <>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">Drain rate (per second)</span>
              <Input
                type="number"
                min={0}
                max={MAX_RESUME_RATE}
                className="w-32"
                aria-label="Drain rate (per second)"
                aria-invalid={!rateValid || undefined}
                value={rate}
                onChange={(event) => setRate(event.target.value)}
              />
            </label>
            <Button size="sm" busy={resume.isPending} disabled={!rateValid} onClick={onResume}>
              <Play /> Resume
            </Button>
            <span className="text-xs text-muted-foreground">0 to 100; 0 removes pacing.</span>
          </>
        ) : (
          <Button size="sm" variant="secondary" busy={pause.isPending} onClick={onPause}>
            <Pause /> Pause
          </Button>
        )}
      </div>
    </div>
  );
}

function Deliveries({ slug }: { slug: string }) {
  const [state, setState] = useState<EventDeliveryFilter | ''>('');
  const [openId, setOpenId] = useState<string | null>(null);
  const deliveries = useEventDeliveries(slug, state);
  const rows = deliveries.data?.pages.flatMap((page) => page.deliveries) ?? [];
  const failures = deliveries.data?.pages[0]?.fanout_failures ?? [];
  const phase = queryPhase({
    error: deliveries.error,
    loading: deliveries.isPending,
    isEmpty: rows.length === 0,
  });

  return (
    <Panel
      title="Deliveries"
      actions={
        <Select
          aria-label="Delivery state"
          value={state}
          onChange={(event) => setState(event.target.value as EventDeliveryFilter | '')}
        >
          {FILTERS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      }
    >
      <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
        {
          "Invocations this app's subscriptions produced, and operator replays of them, newest first."
        }
      </p>

      <div className="flex flex-col gap-4">
        {phase === 'ready' ? (
          <ul className="flex flex-col">
            {rows.map((delivery) => (
              <DeliveryRow
                key={delivery.invocation_id}
                slug={slug}
                delivery={delivery}
                open={openId === delivery.invocation_id}
                onToggle={() =>
                  setOpenId((current) =>
                    current === delivery.invocation_id ? null : delivery.invocation_id
                  )
                }
              />
            ))}
          </ul>
        ) : (
          <InlinePhase
            phase={phase}
            error={deliveries.error}
            loadingMessage="Reading deliveries…"
            emptyMessage={
              state ? 'No deliveries in this state.' : 'No event has been delivered to this app.'
            }
            onRetry={() => void deliveries.refetch()}
          />
        )}
        {deliveries.hasNextPage && (
          <Button
            size="sm"
            variant="secondary"
            className="w-fit"
            busy={deliveries.isFetchingNextPage}
            onClick={() => void deliveries.fetchNextPage()}
          >
            Load older deliveries
          </Button>
        )}
        {failures.length > 0 && (
          <section className="flex flex-col gap-2 border-t border-border pt-4">
            <h3 className="label-mono text-muted-foreground">Routing failures</h3>
            <p className="text-xs text-muted-foreground">
              Recipients whose routing failed before any invocation existed.
            </p>
            <ul className="flex flex-col gap-2">
              {failures.map((failure) => (
                <li
                  key={`${failure.event_source}/${failure.event_id}/${failure.subscription_id}`}
                  className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs"
                >
                  <Status tone="critical" icon={WarningTriangle} label="Routing failed" />
                  <span className="min-w-0 truncate font-mono">
                    {failure.event_source} · {failure.event_type}
                  </span>
                  <span className="font-mono text-muted-foreground">
                    {failure.failure_code ?? failure.last_error}
                  </span>
                  <Timestamp value={failure.failed_at} className="text-muted-foreground" />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Panel>
  );
}

function DeliveryRow({
  slug,
  delivery,
  open,
  onToggle,
}: {
  slug: string;
  delivery: EventDelivery;
  open: boolean;
  onToggle: () => void;
}) {
  const [tone, icon, label] = DELIVERY_STATUS[delivery.state];
  return (
    <li className="flex min-w-0 flex-col gap-3 border-b border-border py-3 last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        aria-label={`Delivery ${delivery.event_type} ${delivery.invocation_id}`}
        className="pressable flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md text-left"
        onClick={onToggle}
      >
        <NavArrowDown
          className={cn('size-4 shrink-0 transition-transform', open && 'rotate-180')}
          aria-hidden
        />
        <Status tone={tone} icon={icon} label={label} />
        <span className="min-w-0 truncate font-mono text-xs">
          {delivery.event_source} · {delivery.event_type}
        </span>
        {delivery.invocation_source === 'replay' && <Pill label="replay" />}
        <span className="text-xs text-muted-foreground">
          {delivery.attempts} {delivery.attempts === 1 ? 'attempt' : 'attempts'}
        </span>
        <Timestamp value={delivery.created_at} className="text-xs text-muted-foreground" />
      </button>
      {open && (
        <div className="flex min-w-0 flex-col gap-3 pl-6 text-xs">
          <dl className="grid gap-3 sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="label-mono text-muted-foreground">Event ID</dt>
              <dd className="mt-1 truncate font-mono">{delivery.event_id}</dd>
            </div>
            <div className="min-w-0">
              <dt className="label-mono text-muted-foreground">Invocation</dt>
              <dd className="mt-1">
                <CopyableId value={delivery.invocation_id} label="invocation ID" />
              </dd>
            </div>
          </dl>
          {delivery.last_error && (
            <p className="font-mono text-muted-foreground">{delivery.last_error}</p>
          )}
          <CapabilityGate capability="event-acknowledgments" title="Acknowledgment">
            <Acknowledgment slug={slug} invocationId={delivery.invocation_id} />
          </CapabilityGate>
        </div>
      )}
    </li>
  );
}

const PROCESSING: Record<string, [Tone, typeof Clock, string]> = {
  waiting: ['idle', Clock, 'Waiting'],
  delivering: ['warning', RefreshDouble, 'Delivering'],
  processing: ['warning', RefreshDouble, 'Processing'],
  expired: ['critical', WarningTriangle, 'Lease expired'],
  completed: ['good', CheckCircle, 'Acknowledged'],
  failed: ['critical', WarningTriangle, 'Failed'],
  dead_letter: ['critical', WarningTriangle, 'Dead-lettered'],
  cancelled: ['idle', Prohibition, 'Cancelled'],
  superseded: ['idle', Prohibition, 'Superseded'],
};

function Acknowledgment({ slug, invocationId }: { slug: string; invocationId: string }) {
  const ack = useAcknowledgment(slug, invocationId);
  const phase = queryPhase({ error: ack.error, loading: ack.isPending });
  if (phase !== 'ready' || !ack.data) {
    return (
      <InlinePhase
        phase={phase}
        error={ack.error}
        loadingMessage="Reading the acknowledgment lease…"
        onRetry={() => void ack.refetch()}
      />
    );
  }
  const status = ack.data;
  const [tone, icon, label] = PROCESSING[status.processing_state] ?? [
    'idle',
    Clock,
    status.processing_state,
  ];
  const rows: Array<[string, React.ReactNode]> = [
    ['Attempt', `${status.attempt} · replay generation ${status.replay_generation}`],
    ...(status.lease_expires_at
      ? ([
          [
            'Lease expires',
            <Timestamp key="lease" value={status.lease_expires_at} mode="absolute" />,
          ],
        ] as Array<[string, React.ReactNode]>)
      : []),
    ...(status.deadline_at
      ? ([
          ['Deadline', <Timestamp key="deadline" value={status.deadline_at} mode="absolute" />],
        ] as Array<[string, React.ReactNode]>)
      : []),
    ...(status.disposition
      ? ([
          [
            'Disposition',
            `${status.disposition}${status.failure_reason ? ` · ${status.failure_reason}` : ''}`,
          ],
        ] as Array<[string, React.ReactNode]>)
      : []),
    ...(status.next_attempt_at
      ? ([
          ['Next attempt', <Timestamp key="next" value={status.next_attempt_at} mode="absolute" />],
        ] as Array<[string, React.ReactNode]>)
      : []),
  ];
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-background p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="label-mono text-muted-foreground">Acknowledgment</span>
        <Status tone={tone} icon={icon} label={label} />
      </div>
      <dl className="grid gap-3 sm:grid-cols-2">
        {rows.map(([name, value]) => (
          <div key={name} className="min-w-0">
            <dt className="label-mono text-muted-foreground">{name}</dt>
            <dd className="mt-1">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-muted-foreground">
        Your handler completes, renews, retries or dead-letters this delivery with its secret
        delivery token. The console never holds that token, so it shows the lease without acting on
        it.
      </p>
    </div>
  );
}
