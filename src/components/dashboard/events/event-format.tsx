import type { EventBacklogRecipient, EventReceiptRecipient } from '@/lib/api/events';
import { Pill } from '@/components/dashboard/resource-table';
import { formatRelative } from '@/lib/mock-data';

export type WaitingReason = EventBacklogRecipient['waiting_reason'];

export const WAITING_REASON_LABELS: Record<WaitingReason, string> = {
  circuit_open: 'Circuit open',
  circuit_probe_wait: 'Waiting for a circuit probe',
  circuit_recovery_rate_limited: 'Circuit recovery rate-limited',
  subscription_paused: 'Subscription paused',
  subscription_rate_limited: 'Subscription rate-limited',
  ordering_blocked: 'Blocked behind an earlier event',
  capacity_consumer: 'Consumer at capacity',
  capacity_app: 'App at capacity',
  capacity_account: 'Account at capacity',
  routing_in_progress: 'Routing in progress',
  receipt_processing: 'Receipt processing',
  retry_backoff: 'Waiting to retry',
  workflow_routing: 'Workflow routing',
  ready: 'Ready to route',
};

/**
 * Reasons that mean something is holding a recipient back, as opposed to the
 * normal moments of routing (in progress, ready). Only these are styled as a
 * blocker; the rest is ordinary flow and reads as neutral.
 */
const BLOCKING: ReadonlySet<string> = new Set<WaitingReason>([
  'circuit_open',
  'circuit_probe_wait',
  'circuit_recovery_rate_limited',
  'subscription_paused',
  'subscription_rate_limited',
  'ordering_blocked',
  'capacity_consumer',
  'capacity_app',
  'capacity_account',
  'retry_backoff',
]);

export const isBlocking = (reason: string | undefined) => Boolean(reason && BLOCKING.has(reason));

export function waitingLabel(reason: string | undefined) {
  return (reason && WAITING_REASON_LABELS[reason as WaitingReason]) || reason || 'Unknown';
}

export const ROUTING_STATE_LABELS: Record<EventReceiptRecipient['routing']['state'], string> = {
  pending: 'Pending',
  processing: 'Routing',
  filtered: 'Filtered out',
  enqueued: 'Handed to handler',
  failed: 'Routing failed',
};

export const EXECUTION_UNAVAILABLE_LABELS: Record<
  NonNullable<EventReceiptRecipient['execution_unavailable']>,
  string
> = {
  not_enqueued: 'Not started',
  record_unavailable: 'Record no longer retained',
  cancel_pending: 'Cancelled by work policy',
};

/** Whole-unit age from seconds: 45s, 18m, 3h 4m, 2d 5h. */
export function formatAge(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  // Under an hour, round like formatRelative so "waiting 12m" and "12m ago" agree.
  if (Math.round(s / 60) < 60) return `${Math.max(1, Math.round(s / 60))}m`;
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

/** Age of an instant at read time, in the same whole units. */
export function ageSince(iso: string) {
  return formatAge((Date.now() - Date.parse(iso)) / 1000);
}

/** Who a recipient is: the app, plus the workflow when the consumer is one. */
export function consumerName(row: { app_slug?: string; workflow_name?: string }) {
  const app = row.app_slug || 'App no longer in this account';
  return row.workflow_name ? `${app} · ${row.workflow_name}` : app;
}

/** A timestamp as relative text, with the exact instant one hover away. */
export function Timestamp({ iso }: { iso: string | null | undefined }) {
  if (!iso) return <span className="text-muted-foreground">—</span>;
  return (
    <time dateTime={iso} title={iso}>
      {formatRelative(Date.parse(iso))}
    </time>
  );
}

/** Parses the JSON payload field; the error text says what the rule is. */
export function parsePayload(
  text: string
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (!text.trim()) return { ok: false, error: 'Enter a JSON payload, such as {}.' };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, error: 'The payload must be valid JSON.' };
  }
}

export interface ReceiptLookup {
  source: string;
  id: string;
}

export function ReasonPill({ reason }: { reason: string | undefined }) {
  return (
    <Pill
      label={waitingLabel(reason)}
      color={isBlocking(reason) ? 'var(--status-warning)' : undefined}
    />
  );
}
