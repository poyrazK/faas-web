import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { CopyableId } from '@/components/ui/copyable-id';
import { Timestamp } from '@/components/ui/timestamp';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api/errors';
import {
  useResendWebhookDelivery,
  useWebhookAttempts,
  useWebhookDeliveryPages,
  useWebhookHealth,
  type WebhookDelivery,
  type WebhookHealth,
  type WebhookSource,
} from '@/lib/api/webhook-deliveries';
import { InlinePhase, queryPhase } from './primitives';
import { Pill } from './resource-table';

const STATUS_COLOR: Record<string, string | undefined> = {
  succeeded: 'var(--status-good)',
  failed: 'var(--status-serious)',
  dead: 'var(--status-critical)',
  pending: 'var(--status-warning)',
  in_flight: 'var(--status-warning)',
  retrying: 'var(--status-warning)',
};

/**
 * The dispatcher's claim gate for this receiver (faas pkg/webhook
 * dispatcher.go:763-769, memstore_app_webhooks.go:780-800): a 429 or 503 with
 * Retry-After pauses it, capped at a day, then one delivery probes it before
 * the rest resume.
 */
const RECEIVER: Record<WebhookHealth['receiver_state'], { label: string; color?: string }> = {
  ready: { label: 'Ready', color: 'var(--status-good)' },
  cooling_down: { label: 'Cooling down', color: 'var(--status-warning)' },
  awaiting_probe: { label: 'Awaiting probe', color: 'var(--status-warning)' },
  probing: { label: 'Probing', color: 'var(--status-warning)' },
};

function seconds(total: number): string {
  if (total < 60) return `${total}s`;
  if (total < 3600) return `${Math.round(total / 60)}m`;
  if (total < 86400) return `${Math.round(total / 3600)}h`;
  return `${Math.round(total / 86400)}d`;
}

function duration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function HealthSummary({ health }: { health: WebhookHealth }) {
  const receiver = RECEIVER[health.receiver_state] ?? { label: health.receiver_state };
  return (
    <section
      aria-label="Delivery health"
      className="flex flex-col gap-2 rounded-lg border border-border px-3 py-2.5 text-xs"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Pill label={receiver.label} color={receiver.color} />
        <span className="text-muted-foreground">
          {health.pending_count} pending · {health.in_flight_count} in flight · {health.dead_count}{' '}
          dead
        </span>
        {health.oldest_overdue_seconds !== undefined && health.oldest_overdue_seconds > 0 && (
          <span className="text-muted-foreground">
            oldest due delivery waiting {seconds(health.oldest_overdue_seconds)}
          </span>
        )}
      </div>
      {health.receiver_state === 'cooling_down' && (
        <p className="text-muted-foreground">
          The receiver answered 429 or 503 with Retry-After. Nothing is sent until{' '}
          <Timestamp value={health.receiver_cooldown_until} mode="absolute" />, then one delivery
          probes it before the rest resume.
        </p>
      )}
      {health.receiver_state === 'awaiting_probe' && (
        <p className="text-muted-foreground">
          The receiver's pause is over. One delivery tests it before the rest resume.
        </p>
      )}
      {health.receiver_state === 'probing' && (
        <p className="text-muted-foreground">One recovery delivery is testing the receiver.</p>
      )}
      <p className="text-muted-foreground">
        {health.recent_success_rate === undefined ? (
          'No delivery finished in the last 24 hours.'
        ) : (
          <>
            Last 24 hours:{' '}
            <span className="font-medium text-foreground">
              {Math.round(health.recent_success_rate * 100)}%
            </span>{' '}
            delivered ({health.recent_succeeded_count} succeeded, {health.recent_dead_count} dead).
          </>
        )}
      </p>
    </section>
  );
}

function Attempts({ source, did }: { source: WebhookSource; did: string }) {
  const query = useWebhookAttempts(source, did, true);
  const list = query.data?.pages.flatMap((page) => page.attempts) ?? [];
  const phase = queryPhase({
    error: query.error,
    loading: query.isPending,
    isEmpty: list.length === 0,
  });
  if (phase !== 'ready')
    return (
      <InlinePhase
        phase={phase}
        error={query.error}
        loadingMessage="Loading attempts…"
        emptyMessage="No attempt has finished yet."
        onRetry={() => void query.refetch()}
      />
    );
  return (
    <div className="flex flex-col gap-2">
      <ul aria-label="Attempts" className="flex flex-col gap-1.5 border-l border-border pl-3">
        {list.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
            <span className="font-mono text-muted-foreground">#{a.attempt_number}</span>
            <Pill label={a.outcome} color={STATUS_COLOR[a.outcome]} />
            <span className="font-mono">{a.response_code ? a.response_code : 'no response'}</span>
            <span className="text-muted-foreground">{duration(a.duration_ms)}</span>
            <Timestamp value={a.started_at} className="text-muted-foreground" />
            {a.replay_generation > 0 && (
              <span className="text-muted-foreground">re-sent ×{a.replay_generation}</span>
            )}
            {a.error && <span className="font-mono text-muted-foreground">{a.error}</span>}
            {a.next_attempt_at && (
              <span className="text-muted-foreground">
                next try <Timestamp value={a.next_attempt_at} />
              </span>
            )}
          </li>
        ))}
      </ul>
      {query.hasNextPage && (
        <Button
          size="sm"
          variant="ghost"
          className="self-start"
          busy={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          Load older attempts
        </Button>
      )}
    </div>
  );
}

function DeliveryRow({
  source,
  delivery: d,
  appName,
  onResend,
  resending,
}: {
  source: WebhookSource;
  delivery: WebhookDelivery;
  appName?: (appId: string) => string | undefined;
  onResend: (d: WebhookDelivery) => void;
  resending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const app = d.app_id ? appName?.(d.app_id) : undefined;
  const outcome = d.last_error || (d.last_response_code ? `HTTP ${d.last_response_code}` : '');
  return (
    <li aria-label={`${d.event}, ${d.status}`} className="flex flex-col gap-2 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <Pill label={d.status} color={STATUS_COLOR[d.status]} />
        <span className="font-mono text-xs">{d.event}</span>
        {appName &&
          d.app_id &&
          (app ? (
            <span className="text-xs">{app}</span>
          ) : (
            <CopyableId value={d.app_id} label="app ID" displayLength={8} />
          ))}
        <Timestamp value={d.created_at} className="text-xs text-muted-foreground" />
        {d.attempt > 1 && (
          <span className="text-xs text-muted-foreground">{d.attempt} attempts</span>
        )}
        {d.status !== 'succeeded' && outcome && (
          <span className="font-mono text-xs text-muted-foreground">{outcome}</span>
        )}
        <span className="ml-auto flex items-center gap-3">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Attempts
          </button>
          {d.status === 'dead' && (
            <button
              type="button"
              disabled={resending}
              onClick={() => onResend(d)}
              className="text-xs text-brand transition-colors hover:text-brand-hover disabled:opacity-50"
            >
              Send again
            </button>
          )}
        </span>
      </div>
      {open && <Attempts source={source} did={d.id} />}
    </li>
  );
}

/**
 * One webhook's delivery health, recent deliveries, each delivery's attempts,
 * and re-sending a dead one. Used by app webhooks and account release
 * webhooks alike; `appName` names the source app, which only a release
 * receiver needs since it follows every app.
 */
export function WebhookDeliveries({
  source,
  target,
  appName,
}: {
  source: WebhookSource;
  /** The receiver URL, named in the re-send confirmation. */
  target: string;
  appName?: (appId: string) => string | undefined;
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const health = useWebhookHealth(source);
  const deliveries = useWebhookDeliveryPages(source);
  const resend = useResendWebhookDelivery(source);
  const list = deliveries.data?.pages.flatMap((page) => page.deliveries) ?? [];
  const phase = queryPhase({
    error: deliveries.error,
    loading: deliveries.isPending,
    isEmpty: list.length === 0,
  });

  const sendAgain = async (d: WebhookDelivery) => {
    if (
      !(await confirm({
        title: 'Send this delivery again?',
        description: `${d.event} goes back in the queue for ${target} with the same delivery ID, signed with the current secret, and gets a fresh set of retries.`,
        confirmLabel: 'Send again',
      }))
    )
      return;
    resend
      .mutateAsync(d.id)
      .then(() => toast({ kind: 'success', title: 'Delivery queued again' }))
      .catch((err: unknown) =>
        toast(
          err instanceof ApiError && err.code === 'app_webhook_invalid'
            ? {
                kind: 'error',
                title: 'Could not send again',
                description:
                  'This delivery is no longer dead: it was already sent again or has finished.',
              }
            : { kind: 'error', title: 'Could not send again', error: err }
        )
      );
  };

  return (
    <div className="flex flex-col gap-4">
      {health.data ? (
        <HealthSummary health={health.data} />
      ) : (
        <InlinePhase
          phase={queryPhase({ error: health.error, loading: health.isPending })}
          error={health.error}
          loadingMessage="Reading delivery health…"
          onRetry={() => void health.refetch()}
        />
      )}
      {phase !== 'ready' ? (
        <InlinePhase
          phase={phase}
          error={deliveries.error}
          loadingMessage="Loading deliveries…"
          emptyMessage="Nothing has been delivered yet."
          onRetry={() => void deliveries.refetch()}
        />
      ) : (
        <ul aria-label="Deliveries" className="flex flex-col divide-y divide-border">
          {list.map((d) => (
            <DeliveryRow
              key={d.id}
              source={source}
              delivery={d}
              appName={appName}
              resending={resend.isPending}
              onResend={(row) => void sendAgain(row)}
            />
          ))}
        </ul>
      )}
      {deliveries.hasNextPage && (
        <Button
          size="sm"
          variant="outline"
          className="self-start"
          busy={deliveries.isFetchingNextPage}
          onClick={() => void deliveries.fetchNextPage()}
        >
          Load older deliveries
        </Button>
      )}
    </div>
  );
}
