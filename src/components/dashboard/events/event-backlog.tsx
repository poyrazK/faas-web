import { useState } from 'react';
import { InlinePhase, Panel, StatTile, queryPhase } from '@/components/dashboard/primitives';
import { ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import {
  BACKLOG_PAGE,
  useEventBacklog,
  useEventRetention,
  useEventStorage,
  useRecipientBlocker,
  type EventBacklogConsumer,
  type EventBacklogRecipient,
} from '@/lib/api/events';
import { formatNumber } from '@/lib/mock-data';
import { formatUsageBytes } from '@/lib/usage-format';
import {
  ReasonPill,
  Timestamp,
  ageSince,
  consumerName,
  formatAge,
  waitingLabel,
  type ReceiptLookup,
} from './event-format';

/** The reason holding most of a consumer's recipients, from its exact counts. */
function dominantReason(consumer: EventBacklogConsumer) {
  const entries = Object.entries(consumer.pending_waiting_reasons ?? {}).filter(([, n]) => n > 0);
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0]?.[0];
}

/** Headline figures: what is waiting, and how much retained storage it costs. */
export function EventOverview({ accountId }: { accountId: string }) {
  const backlog = useEventBacklog(accountId);
  const storage = useEventStorage(accountId);
  const retention = useEventRetention(accountId);
  const consumers = backlog.data?.consumers ?? [];
  const waiting = consumers.reduce((sum, c) => sum + c.waiting_recipients, 0);
  const partial = Boolean(backlog.data?.next_consumers_after);
  const tileState = (q: { isPending: boolean; error: unknown }) =>
    q.error ? 'unavailable' : q.isPending ? 'loading' : 'ready';
  const usage = storage.data;
  const r = retention.data;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Waiting recipients"
          state={tileState(backlog)}
          value={waiting}
          format={formatNumber}
          note={
            partial
              ? `Across the first ${BACKLOG_PAGE} consumers`
              : `${consumers.length} consumer${consumers.length === 1 ? '' : 's'}`
          }
        />
        <StatTile
          label="Retained events"
          state={tileState(storage)}
          value={usage?.retained_events}
          format={formatNumber}
          note={usage ? `of ${formatNumber(usage.limits.retained_events)} allowed` : undefined}
        />
        <StatTile
          label="Retained storage"
          state={tileState(storage)}
          value={usage ? formatUsageBytes(usage.retained_bytes) : undefined}
          note={usage ? `of ${formatUsageBytes(usage.limits.retained_bytes)} allowed` : undefined}
        />
        <StatTile
          label="Oldest unrouted event"
          state={tileState(storage)}
          value={
            usage
              ? usage.oldest_pending_at
                ? ageSince(usage.oldest_pending_at)
                : 'None'
              : undefined
          }
          note={usage ? `${formatNumber(usage.pending_events)} event(s) still routing` : undefined}
        />
      </div>
      {r ? (
        <p className="text-xs text-muted-foreground">
          Receipts are kept for 30 days after routing settles. {formatNumber(r.held_receipts)} held
          by backfill or recovery · {formatNumber(r.eligible_for_pruning)} eligible for pruning ·{' '}
          {formatNumber(r.expiring_receipts)} expiring in the next 24 hours.
        </p>
      ) : (
        <InlinePhase
          phase={queryPhase({ error: retention.error, loading: retention.isPending })}
          error={retention.error}
          loadingMessage="Reading retention…"
          onRetry={() => void retention.refetch()}
        />
      )}
    </div>
  );
}

type ConsumerRow = EventBacklogConsumer & { id: string; name: string; reason?: string };

export function EventBacklogPanel({
  accountId,
  onOpenReceipt,
}: {
  accountId: string;
  onOpenReceipt: (lookup: ReceiptLookup) => void;
}) {
  const backlog = useEventBacklog(accountId);
  const [selected, setSelected] = useState<ConsumerRow | null>(null);
  const rows: ConsumerRow[] = (backlog.data?.consumers ?? []).map((c) => ({
    ...c,
    id: `${c.subscription_id}:${c.consumer_kind}`,
    name: consumerName(c),
    reason: dominantReason(c),
  }));

  const columns: Column<ConsumerRow>[] = [
    {
      key: 'name',
      label: 'Consumer',
      sortable: true,
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.name}</p>
          <p className="text-xs text-muted-foreground">
            {row.consumer_kind === 'workflow' ? 'Workflow' : 'App subscription'}
            {row.target_available ? '' : ' · target unavailable'}
          </p>
        </div>
      ),
    },
    {
      key: 'waiting_recipients',
      label: 'Waiting',
      numeric: true,
      sortable: true,
      render: (row) => formatNumber(row.waiting_recipients),
    },
    {
      key: 'reason',
      label: 'Mostly',
      render: (row) => <ReasonPill reason={row.reason} />,
      priority: 'secondary',
    },
    {
      key: 'oldest_age_seconds',
      label: 'Oldest',
      numeric: true,
      sortable: true,
      render: (row) => formatAge(row.oldest_age_seconds),
    },
  ];

  const unattributed = backlog.data?.unattributed_receipts ?? 0;
  return (
    <Panel
      title="Waiting consumers"
      description="Consumers with event recipients still pending or routing. Handler execution queues are separate and not counted here."
    >
      <ResourceTable
        rows={rows}
        columns={columns}
        initialSort={{ key: 'waiting_recipients', dir: 'desc' }}
        onRowClick={setSelected}
        loading={backlog.isPending}
        error={backlog.error}
        onRetry={() => void backlog.refetch()}
        emptyMessage="Nothing is waiting. Every captured recipient has finished routing."
        minWidth="min-w-[560px]"
      />
      {(backlog.data?.next_consumers_after || unattributed > 0) && (
        <p className="mt-3 text-xs text-muted-foreground">
          {backlog.data?.next_consumers_after &&
            `Only the first ${BACKLOG_PAGE} consumers are listed. `}
          {unattributed > 0 &&
            `${formatNumber(unattributed)} older receipt(s) were accepted before recipients were captured, so their consumers cannot be named.`}
        </p>
      )}
      <ConsumerDetail
        accountId={accountId}
        consumer={selected}
        onClose={() => setSelected(null)}
        onOpenReceipt={(lookup) => {
          setSelected(null);
          onOpenReceipt(lookup);
        }}
      />
    </Panel>
  );
}

function ConsumerDetail({
  accountId,
  consumer,
  onClose,
  onOpenReceipt,
}: {
  accountId: string;
  consumer: ConsumerRow | null;
  onClose: () => void;
  onOpenReceipt: (lookup: ReceiptLookup) => void;
}) {
  return (
    <Modal
      open={consumer !== null}
      onClose={onClose}
      title={consumer?.name ?? 'Consumer'}
      description="Waiting recipients for this consumer, oldest first. Select one to read its current routing blocker."
      width="max-w-2xl"
    >
      {consumer && (
        <ConsumerDetailBody
          accountId={accountId}
          consumer={consumer}
          onOpenReceipt={onOpenReceipt}
        />
      )}
    </Modal>
  );
}

function ConsumerDetailBody({
  accountId,
  consumer,
  onOpenReceipt,
}: {
  accountId: string;
  consumer: ConsumerRow;
  onOpenReceipt: (lookup: ReceiptLookup) => void;
}) {
  const recipients = useEventBacklog(accountId, consumer.subscription_id);
  const [open, setOpen] = useState<EventBacklogRecipient | null>(null);
  const reasons = Object.entries(consumer.pending_waiting_reasons ?? {}).filter(([, n]) => n > 0);
  const list = recipients.data?.recipients ?? [];
  const phase = queryPhase({
    error: recipients.error,
    loading: recipients.isPending,
    isEmpty: list.length === 0,
  });

  return (
    <div className="flex flex-col gap-4 text-sm">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(
          [
            ['Pending', consumer.pending_recipients],
            ['Routing', consumer.processing_recipients],
            ['At capacity', consumer.capacity_waiting_recipients],
            ['Ordering', consumer.ordering_waiting_recipients],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <dt className="label-mono text-muted-foreground">{label}</dt>
            <dd className="mt-1 [font-variant-numeric:tabular-nums]">{formatNumber(value)}</dd>
          </div>
        ))}
      </dl>
      {reasons.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Waiting reasons">
          {reasons.map(([reason, count]) => (
            <span key={reason} className="flex items-center gap-1.5">
              <ReasonPill reason={reason} />
              <span className="text-xs text-muted-foreground">{formatNumber(count)}</span>
            </span>
          ))}
        </div>
      )}
      <InlinePhase
        phase={phase}
        error={recipients.error}
        loadingMessage="Reading waiting recipients…"
        emptyMessage="No recipient is waiting for this consumer any more."
        onRetry={() => void recipients.refetch()}
      />
      {list.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {list.map((r) => {
            const key = `${r.event_source}\u0000${r.event_id}`;
            const expanded = open?.event_source === r.event_source && open.event_id === r.event_id;
            return (
              <li key={key} className="px-3 py-2.5">
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setOpen(expanded ? null : r)}
                  className="pressable flex w-full flex-wrap items-center justify-between gap-2 text-left"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-xs">
                      {r.event_source} / {r.event_id}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {r.event_type} · waiting {formatAge(r.pending_age_seconds)}
                    </span>
                  </span>
                  <ReasonPill reason={r.waiting_reason} />
                </button>
                {expanded && (
                  <RecipientBlockerView
                    accountId={accountId}
                    recipient={r}
                    onOpenReceipt={() => onOpenReceipt({ source: r.event_source, id: r.event_id })}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
      {recipients.data?.next_after && (
        <p className="text-xs text-muted-foreground">
          The oldest {BACKLOG_PAGE} waiting recipients are shown.
        </p>
      )}
    </div>
  );
}

const BLOCKER_STATUS: Record<string, string> = {
  not_waiting:
    'No longer waiting — it has left pending routing. That does not mean the handler succeeded.',
  unavailable: 'The retained evidence for this recipient is unavailable.',
  acceptance_replaced:
    'This event was accepted again since; the waiting entry belongs to an earlier acceptance.',
};

/** A fresh, exact read of what holds one recipient, rather than the backlog snapshot. */
function RecipientBlockerView({
  accountId,
  recipient,
  onOpenReceipt,
}: {
  accountId: string;
  recipient: EventBacklogRecipient;
  onOpenReceipt: () => void;
}) {
  const blocker = useRecipientBlocker(accountId, {
    source: recipient.event_source,
    id: recipient.event_id,
    subscription_id: recipient.subscription_id,
    expected_accepted_at: recipient.accepted_at,
  });
  const live = blocker.data?.recipient;
  return (
    <div className="mt-3 flex flex-col gap-2 rounded-md bg-muted/40 p-3 text-xs">
      <InlinePhase
        phase={queryPhase({ error: blocker.error, loading: blocker.isPending })}
        error={blocker.error}
        loadingMessage="Reading routing blocker…"
        onRetry={() => void blocker.refetch()}
      />
      {blocker.data && blocker.data.status !== 'available' && (
        <p role="status">{BLOCKER_STATUS[blocker.data.status]}</p>
      )}
      {live && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-muted-foreground">Blocked by</dt>
          <dd>{waitingLabel(live.waiting_reason)}</dd>
          <dt className="text-muted-foreground">Routing attempts</dt>
          <dd>
            {formatNumber(live.attempts)}
            {live.capacity_deferrals > 0 &&
              ` (+${formatNumber(live.capacity_deferrals)} capacity waits)`}
          </dd>
          {live.next_attempt_at && (
            <>
              <dt className="text-muted-foreground">Next attempt</dt>
              <dd>
                <time dateTime={live.next_attempt_at} title={live.next_attempt_at}>
                  {new Date(live.next_attempt_at).toISOString().replace('.000Z', 'Z')}
                </time>
              </dd>
            </>
          )}
          {live.ordering_blocker && (
            <>
              <dt className="text-muted-foreground">Waiting behind</dt>
              <dd className="font-mono">
                {live.ordering_blocker.event_source} / {live.ordering_blocker.event_id} (
                {live.ordering_blocker.state}, {formatAge(live.ordering_blocker.age_seconds)})
              </dd>
            </>
          )}
          <dt className="text-muted-foreground">Accepted</dt>
          <dd>
            <Timestamp iso={live.accepted_at} />
          </dd>
        </dl>
      )}
      <div>
        <Button size="xs" variant="outline" onClick={onOpenReceipt}>
          Open receipt
        </Button>
      </div>
    </div>
  );
}
