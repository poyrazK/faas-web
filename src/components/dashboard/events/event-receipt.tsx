import { useState, type FormEvent } from 'react';
import { InlinePhase, Panel, queryPhase } from '@/components/dashboard/primitives';
import { Pill, ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { SegmentedControl } from '@/components/dashboard/tabs';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api/errors';
import {
  useAppEventPublishStatus,
  useEventReceipt,
  useRecipientBlockers,
  type EventReceipt,
  type EventReceiptRecipient,
} from '@/lib/api/events';
import { useApps } from '@/lib/api/queries';
import { formatNumber } from '@/lib/mock-data';
import {
  EXECUTION_UNAVAILABLE_LABELS,
  ROUTING_STATE_LABELS,
  ReasonPill,
  Timestamp,
  consumerName,
  type ReceiptLookup,
} from './event-format';
export type Lookup =
  ({ kind: 'event' } & ReceiptLookup) | { kind: 'producer'; slug: string; key: string };

const lookupKey = (l: Lookup | null) =>
  !l ? 'none' : l.kind === 'event' ? `e:${l.source}:${l.id}` : `p:${l.slug}:${l.key}`;

/**
 * Paste an event's identity, read back what the router did with it:
 * acceptance, the recipients captured at that moment, and each one's routing
 * and execution evidence. Read-only; recovery is not offered from here.
 */
export function EventReceiptPanel({
  accountId,
  lookup,
  onLookup,
}: {
  accountId: string;
  lookup: Lookup | null;
  onLookup: (lookup: Lookup) => void;
}) {
  return (
    <Panel
      title="Receipt lookup"
      description="Acceptance, routing, and execution evidence for one retained event."
    >
      <div className="flex flex-col gap-5">
        <LookupForm key={lookupKey(lookup)} initial={lookup} onLookup={onLookup} />
        {lookup?.kind === 'event' && <EventReceiptResult accountId={accountId} lookup={lookup} />}
        {lookup?.kind === 'producer' && <ProducerResult accountId={accountId} lookup={lookup} />}
      </div>
    </Panel>
  );
}

function LookupForm({
  initial,
  onLookup,
}: {
  initial: Lookup | null;
  onLookup: (lookup: Lookup) => void;
}) {
  const [mode, setMode] = useState<Lookup['kind']>(initial?.kind ?? 'event');
  const [source, setSource] = useState(initial?.kind === 'event' ? initial.source : '');
  const [id, setId] = useState(initial?.kind === 'event' ? initial.id : '');
  const [slug, setSlug] = useState(initial?.kind === 'producer' ? initial.slug : '');
  const [key, setKey] = useState(initial?.kind === 'producer' ? initial.key : '');
  const apps = useApps({ enabled: mode === 'producer' });
  const chosenSlug = slug || apps.data?.[0]?.slug || '';

  const ready =
    mode === 'event' ? Boolean(source.trim() && id.trim()) : Boolean(chosenSlug && key.trim());
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    onLookup(
      mode === 'event'
        ? { kind: 'event', source: source.trim(), id: id.trim() }
        : { kind: 'producer', slug: chosenSlug, key: key.trim() }
    );
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <SegmentedControl
        label="Look up by"
        value={mode}
        onChange={setMode}
        options={[
          { key: 'event', label: 'Source and event ID' },
          { key: 'producer', label: 'App producer key' },
        ]}
      />
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        {mode === 'event' ? (
          <>
            <FormField id="receipt-source" label="Source">
              {(props) => (
                <Input
                  {...props}
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder="billing"
                  spellCheck={false}
                  autoComplete="off"
                />
              )}
            </FormField>
            <FormField id="receipt-id" label="Event ID">
              {(props) => (
                <Input
                  {...props}
                  value={id}
                  onChange={(e) => setId(e.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                  className="font-mono"
                />
              )}
            </FormField>
          </>
        ) : (
          <>
            <FormField id="receipt-app" label="App">
              {(props) => (
                <Select
                  {...props}
                  value={chosenSlug}
                  onChange={(e) => setSlug(e.target.value)}
                  disabled={!apps.data?.length}
                >
                  {(apps.data ?? []).map((a) => (
                    <option key={a.slug} value={a.slug}>
                      {a.slug}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField id="receipt-key" label="Producer key">
              {(props) => (
                <Input
                  {...props}
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                  className="font-mono"
                />
              )}
            </FormField>
          </>
        )}
        <Button type="submit" disabled={!ready}>
          Look up
        </Button>
      </div>
    </form>
  );
}

function EventReceiptResult({ accountId, lookup }: { accountId: string; lookup: ReceiptLookup }) {
  const receipt = useEventReceipt(accountId, lookup);
  if (receipt.error instanceof ApiError && receipt.error.code === 'not_found') {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        No retained receipt for <span className="font-mono">{lookup.source}</span> /{' '}
        <span className="font-mono">{lookup.id}</span>. It was never accepted under this source, or
        it was pruned after its 30-day retention.
      </p>
    );
  }
  if (!receipt.data) {
    return (
      <InlinePhase
        phase={queryPhase({ error: receipt.error, loading: receipt.isPending })}
        error={receipt.error}
        loadingMessage="Reading receipt…"
        onRetry={() => void receipt.refetch()}
      />
    );
  }
  return <ReceiptEvidence accountId={accountId} receipt={receipt.data} />;
}

const PRODUCER_STATUS = {
  accepted: 'Accepted, and routing has settled. This does not prove any handler succeeded.',
  processing: 'Accepted; routing is still in progress.',
  unavailable:
    'No retained acceptance is visible. It may never have been accepted, may not be visible yet, or was pruned — this does not prove it was not published, so do not republish on this alone.',
} as const;

function ProducerResult({
  accountId,
  lookup,
}: {
  accountId: string;
  lookup: { slug: string; key: string };
}) {
  const status = useAppEventPublishStatus(accountId, lookup);
  if (!status.data) {
    return (
      <InlinePhase
        phase={queryPhase({ error: status.error, loading: status.isPending })}
        error={status.error}
        loadingMessage="Reading publish status…"
        onRetry={() => void status.refetch()}
      />
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <p role="status" className="text-sm">
        {PRODUCER_STATUS[status.data.status]}
      </p>
      {status.data.evidence && (
        <ReceiptEvidence accountId={accountId} receipt={status.data.evidence} />
      )}
    </div>
  );
}

type RecipientRow = EventReceiptRecipient & { id: string; name: string };

const titleCase = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, ' ');

function executionLabel(r: EventReceiptRecipient) {
  if (r.execution) return titleCase(r.execution.state);
  if (r.workflow_run_status) return `Workflow run ${r.workflow_run_status}`;
  if (r.cancellation) return 'Cancelled by work policy';
  if (r.execution_unavailable) return EXECUTION_UNAVAILABLE_LABELS[r.execution_unavailable];
  return '—';
}

const RECOVERY_LABELS: Record<string, string> = {
  routing_replay: 'routing replay',
  handler_replay: 'handler replay',
  keyed_handler_replay: 'keyed handler replay',
  dead_letter_replay: 'dead-letter replay',
};

export function ReceiptEvidence({
  accountId,
  receipt,
}: {
  accountId: string;
  receipt: EventReceipt;
}) {
  const waiting = receipt.recipients.filter(
    (r) => r.routing.state === 'pending' || r.routing.state === 'processing'
  );
  const blockers = useRecipientBlockers(
    accountId,
    waiting.map((r) => ({
      source: receipt.event_source,
      id: receipt.event_id,
      subscription_id: r.subscription_id,
      expected_accepted_at: receipt.accepted_at,
    }))
  );
  const reasonFor = (subscription: string) =>
    blockers.data?.items.find((item) => item.query.subscription_id === subscription)?.result
      ?.recipient?.waiting_reason;

  const rows: RecipientRow[] = receipt.recipients.map((r) => ({
    ...r,
    id: `${r.subscription_id}:${r.origin ?? 'acceptance'}`,
    name: consumerName(r),
  }));
  const columns: Column<RecipientRow>[] = [
    {
      key: 'name',
      label: 'Consumer',
      render: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{r.name}</p>
          {r.origin === 'backfill' && (
            <p className="text-xs text-muted-foreground">Added by backfill</p>
          )}
        </div>
      ),
    },
    {
      key: 'routing',
      label: 'Routing',
      render: (r) => {
        const reason = reasonFor(r.subscription_id);
        return (
          <div className="flex flex-wrap items-center gap-1.5">
            <span>{ROUTING_STATE_LABELS[r.routing.state]}</span>
            {reason && <ReasonPill reason={reason} />}
            <span className="text-xs text-muted-foreground">
              {formatNumber(r.routing.attempts)} attempt{r.routing.attempts === 1 ? '' : 's'}
            </span>
          </div>
        );
      },
    },
    {
      key: 'execution',
      label: 'Execution',
      render: (r) => (
        <div>
          <p>{executionLabel(r)}</p>
          {r.recovery && (
            <p className="text-xs text-muted-foreground">
              Latest replay: {titleCase(r.recovery.latest_replay.state)}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'recovery_actions',
      label: 'Notes',
      priority: 'secondary',
      render: (r) => {
        const error = r.execution?.last_error ?? r.routing.last_error;
        return (
          <div className="max-w-xs text-xs text-muted-foreground">
            {error && (
              <p className="truncate" title={error}>
                {error}
              </p>
            )}
            {r.recovery_actions.length > 0 && (
              <p>
                Eligible:{' '}
                {r.recovery_actions.map((a) => RECOVERY_LABELS[a.kind] ?? a.kind).join(', ')}
              </p>
            )}
          </div>
        );
      },
    },
  ];

  const summary = Object.entries(receipt.routing_summary).filter(([, n]) => n > 0);
  return (
    <div className="flex flex-col gap-4" aria-label="Receipt evidence">
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
        {(
          [
            ['Type', receipt.event_type],
            ['Source', receipt.event_source],
            ['Event ID', receipt.client_event_id ?? receipt.event_id],
            ['Accepted', <Timestamp key="a" iso={receipt.accepted_at} />],
            [
              'Routing',
              receipt.routing_settled_at ? (
                <>
                  Settled <Timestamp iso={receipt.routing_settled_at} />
                </>
              ) : (
                'Still routing'
              ),
            ],
            ['Retained until', <Timestamp key="r" iso={receipt.retain_until} />],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="label-mono text-muted-foreground">{label}</dt>
            <dd className="mt-1 truncate">{value}</dd>
          </div>
        ))}
      </dl>
      {receipt.snapshot_captured ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>
            {formatNumber(receipt.recipient_count)} recipient
            {receipt.recipient_count === 1 ? '' : 's'} captured at acceptance
            {receipt.backfill_recipient_count
              ? `, ${formatNumber(receipt.backfill_recipient_count)} added by backfill`
              : ''}
            :
          </span>
          {summary.map(([state, count]) => (
            <Pill
              key={state}
              label={`${formatNumber(count)} ${(ROUTING_STATE_LABELS[state as keyof typeof ROUTING_STATE_LABELS] ?? state).toLowerCase()}`}
            />
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          This receipt predates recipient capture, so which consumers it reached is unknown.
        </p>
      )}
      <ResourceTable
        rows={rows}
        columns={columns}
        emptyMessage={
          receipt.snapshot_captured
            ? 'No subscription matched this event when it was accepted.'
            : 'Recipients were not captured for this receipt.'
        }
        minWidth="min-w-[640px]"
      />
      {receipt.next_after && (
        <p className="text-xs text-muted-foreground">
          Showing the first {formatNumber(rows.length)} recipients.
        </p>
      )}
      {waiting.length > 0 && (
        <InlinePhase
          phase={queryPhase({ error: blockers.error, loading: blockers.isPending })}
          error={blockers.error}
          loadingMessage="Reading routing blockers…"
          onRetry={() => void blockers.refetch()}
        />
      )}
    </div>
  );
}
