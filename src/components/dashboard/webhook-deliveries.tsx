import { useState, type ReactNode } from 'react';
import {
  CheckCircle,
  Clock,
  NavArrowDown,
  NavArrowRight,
  RefreshDouble,
  WarningCircle,
  WarningTriangle,
} from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { Timestamp } from '@/components/ui/timestamp';
import { useToast } from '@/components/ui/toast';
import { useApps } from '@/lib/api/queries';
import {
  useRetryWebhookDelivery,
  useWebhookAttempts,
  useWebhookDeliveryPage,
  useWebhookHealth,
  type WebhookDelivery,
  type WebhookHealth,
  type WebhookScope,
} from '@/lib/api/release-webhooks';
import { InlinePhase, queryPhase } from './primitives';

type Tone = { label: string; color: string; icon: typeof CheckCircle };
const GOOD = 'var(--status-good)';
const WARN = 'var(--status-warning)';
const SERIOUS = 'var(--status-serious)';
const CRITICAL = 'var(--status-critical)';

const DELIVERY: Record<string, Tone> = {
  succeeded: { label: 'Succeeded', color: GOOD, icon: CheckCircle },
  pending: { label: 'Pending', color: WARN, icon: Clock },
  in_flight: { label: 'In flight', color: WARN, icon: RefreshDouble },
  failed: { label: 'Retrying', color: SERIOUS, icon: WarningCircle },
  dead: { label: 'Dead', color: CRITICAL, icon: WarningTriangle },
};
const OUTCOME: Record<string, Tone> = {
  succeeded: { label: 'Succeeded', color: GOOD, icon: CheckCircle },
  retrying: { label: 'Retrying', color: SERIOUS, icon: WarningCircle },
  dead: { label: 'Dead', color: CRITICAL, icon: WarningTriangle },
};
const RECEIVER: Record<string, Tone> = {
  ready: { label: 'Ready', color: GOOD, icon: CheckCircle },
  cooling_down: { label: 'Cooling down', color: WARN, icon: Clock },
  awaiting_probe: { label: 'Waiting to probe', color: WARN, icon: Clock },
  probing: { label: 'Probing', color: WARN, icon: RefreshDouble },
};

/** Status as colour, icon and word together. */
export function ToneLabel({ tone, fallback }: { tone: Tone | undefined; fallback: string }) {
  const Icon = tone?.icon ?? Clock;
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs"
      style={{ color: tone?.color ?? 'var(--muted-foreground)' }}
    >
      <Icon aria-hidden className="h-3.5 w-3.5 shrink-0" />
      {tone?.label ?? fallback}
    </span>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="label-mono text-muted-foreground">{label}</dt>
      <dd className="text-sm tabular-nums">{children}</dd>
    </div>
  );
}

function seconds(n: number): string {
  if (n < 60) return `${n}s`;
  if (n < 3600) return `${Math.round(n / 60)}m`;
  return `${(n / 3600).toFixed(1)}h`;
}

/** apid's read of the queue at `snapshot_at` (AppWebhookDeliveryHealthResponse). */
export function HealthSummary({ health }: { health: WebhookHealth }) {
  const rate = health.recent_success_rate;
  return (
    <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
      <Fact label="Receiver">
        <ToneLabel tone={RECEIVER[health.receiver_state]} fallback={health.receiver_state} />
        {health.receiver_cooldown_until && (
          <span className="block text-xs text-muted-foreground">
            until <Timestamp value={health.receiver_cooldown_until} />
          </span>
        )}
      </Fact>
      <Fact label="Pending">{health.pending_count}</Fact>
      <Fact label="In flight">{health.in_flight_count}</Fact>
      <Fact label="Dead">
        <span style={health.dead_count ? { color: CRITICAL } : undefined}>{health.dead_count}</span>
      </Fact>
      <Fact label="Oldest overdue">
        {health.oldest_overdue_seconds !== undefined ? seconds(health.oldest_overdue_seconds) : '—'}
      </Fact>
      <Fact label="Last 24 h">
        {rate === undefined ? (
          <span className="text-muted-foreground">No finished deliveries</span>
        ) : (
          <span
            title={`${health.recent_succeeded_count} succeeded, ${health.recent_dead_count} dead`}
          >
            {(rate * 100).toFixed(rate === 1 ? 0 : 1)}% delivered
          </span>
        )}
      </Fact>
    </dl>
  );
}

function Attempts({ scope, deliveryId }: { scope: WebhookScope; deliveryId: string }) {
  const attempts = useWebhookAttempts(scope, deliveryId);
  const list = attempts.data?.attempts ?? [];
  const phase = queryPhase({
    error: attempts.error,
    loading: attempts.isPending,
    isEmpty: list.length === 0,
  });
  if (phase !== 'ready')
    return (
      <InlinePhase
        phase={phase}
        error={attempts.error}
        loadingMessage="Reading attempts…"
        emptyMessage="No attempt has finished yet."
      />
    );
  return (
    <ol aria-label="Attempts" className="flex flex-col gap-1.5 border-l border-border pl-3">
      {list.map((a) => (
        <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="font-mono text-muted-foreground">
            #{a.attempt_number}
            {a.replay_generation > 0 && ` · replay ${a.replay_generation}`}
          </span>
          <ToneLabel tone={OUTCOME[a.outcome]} fallback={a.outcome} />
          <span className="font-mono">
            {a.response_code ? `HTTP ${a.response_code}` : 'no response'}
          </span>
          <span className="text-muted-foreground">{a.duration_ms} ms</span>
          <Timestamp value={a.started_at} className="text-muted-foreground" />
          {a.error && <span className="break-all font-mono text-muted-foreground">{a.error}</span>}
          {a.next_attempt_at && (
            <span className="text-muted-foreground">
              next try <Timestamp value={a.next_attempt_at} />
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

function DeliveryRow({
  scope,
  delivery,
  appName,
}: {
  scope: WebhookScope;
  delivery: WebhookDelivery;
  appName?: string;
}) {
  const { toast } = useToast();
  const retry = useRetryWebhookDelivery(scope);
  const [open, setOpen] = useState(false);
  const Arrow = open ? NavArrowDown : NavArrowRight;
  return (
    <li className="flex flex-col gap-2 py-2.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <button
          type="button"
          aria-expanded={open}
          aria-label={`Attempts for ${delivery.event} delivery ${delivery.id}`}
          onClick={() => setOpen((v) => !v)}
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          <Arrow className="h-3.5 w-3.5" />
        </button>
        <ToneLabel tone={DELIVERY[delivery.status]} fallback={delivery.status} />
        <span className="font-mono text-xs">{delivery.event}</span>
        {appName && <span className="font-mono text-xs text-muted-foreground">{appName}</span>}
        <Timestamp value={delivery.created_at} className="text-xs text-muted-foreground" />
        {delivery.attempt > 1 && (
          <span className="text-xs text-muted-foreground">attempt {delivery.attempt}</span>
        )}
        {delivery.last_response_code ? (
          <span className="font-mono text-xs text-muted-foreground">
            HTTP {delivery.last_response_code}
          </span>
        ) : null}
        {delivery.last_error && (
          <span className="break-all font-mono text-xs text-muted-foreground">
            {delivery.last_error}
          </span>
        )}
        {/* Only a dead delivery can be re-armed (retryAppWebhookDelivery). */}
        {delivery.status === 'dead' && (
          <Button
            size="xs"
            variant="outline"
            className="ml-auto"
            busy={retry.isPending}
            onClick={() =>
              void retry
                .mutateAsync(delivery.id)
                .then(() => toast({ kind: 'success', title: 'Delivery re-armed' }))
                .catch((err: unknown) =>
                  toast({ kind: 'error', title: 'Could not retry', error: err })
                )
            }
          >
            Retry
          </Button>
        )}
      </div>
      {open && <Attempts scope={scope} deliveryId={delivery.id} />}
    </li>
  );
}

const normalize = (id: string) => id.replace(/-/g, '').toLowerCase();

/**
 * One receiver's delivery health and its deliveries, each with its attempt
 * history. An account receiver's deliveries span every app, so each row names
 * its source app.
 */
export function WebhookDeliveries({ scope }: { scope: WebhookScope }) {
  const health = useWebhookHealth(scope);
  const [pages, setPages] = useState<string[]>(['']);
  const token = pages[pages.length - 1];
  const page = useWebhookDeliveryPage(scope, token);
  const account = !('slug' in scope);
  const apps = useApps({ enabled: account });
  const appNames = new Map((apps.data ?? []).map((a) => [normalize(a.id), a.slug]));
  const list = page.data?.deliveries ?? [];
  const healthPhase = queryPhase({ error: health.error, loading: health.isPending });
  const listPhase = queryPhase({
    error: page.error,
    loading: page.isPending,
    isEmpty: list.length === 0,
  });

  return (
    <div className="flex flex-col gap-5">
      <section aria-label="Delivery health" className="flex flex-col gap-2">
        <h3 className="label-mono text-muted-foreground">Delivery health</h3>
        {healthPhase !== 'ready' || !health.data ? (
          <InlinePhase
            phase={healthPhase}
            error={health.error}
            loadingMessage="Reading health…"
            onRetry={() => void health.refetch()}
          />
        ) : (
          <HealthSummary health={health.data} />
        )}
      </section>
      <section aria-label="Deliveries" className="flex flex-col gap-1">
        <h3 className="label-mono text-muted-foreground">Deliveries</h3>
        {listPhase !== 'ready' ? (
          <InlinePhase
            phase={listPhase}
            error={page.error}
            loadingMessage="Reading deliveries…"
            emptyMessage={
              pages.length > 1 ? 'No older deliveries.' : 'Nothing has been delivered yet.'
            }
            onRetry={() => void page.refetch()}
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {list.map((d) => (
              <DeliveryRow
                key={d.id}
                scope={scope}
                delivery={d}
                appName={
                  account && d.app_id ? (appNames.get(normalize(d.app_id)) ?? d.app_id) : undefined
                }
              />
            ))}
          </ul>
        )}
        <div className="flex gap-2 pt-1">
          {pages.length > 1 && (
            <Button size="xs" variant="ghost" onClick={() => setPages((p) => p.slice(0, -1))}>
              Newer
            </Button>
          )}
          {page.data?.next_token && (
            <Button
              size="xs"
              variant="outline"
              onClick={() => setPages((p) => [...p, page.data?.next_token ?? ''])}
            >
              Older
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}
