import { useState } from 'react';
import {
  CheckCircle,
  NavArrowDown,
  Prohibition,
  Redo,
  Trash,
  WarningTriangle,
} from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { CopyableId } from '@/components/ui/copyable-id';
import { Timestamp } from '@/components/ui/timestamp';
import { useToast } from '@/components/ui/toast';
import { InlinePhase, Panel, queryPhase } from '@/components/dashboard/primitives';
import { Pill } from '@/components/dashboard/resource-table';
import { CapabilityGate } from '@/components/dashboard/capability-gate';
import { ApiError } from '@/lib/api/errors';
import {
  DEAD_LETTER_BULK_MAX,
  useDeadLetterEvent,
  useDeadLetterLedger,
  useDiscardDeadLetterEvent,
  usePurgeDeadLetters,
  useReplayAllDeadLetters,
  useReplayDeadLetterEvent,
  type DeadLetterEvent,
} from '@/lib/api/dead-letters';
import { cn } from '@/lib/utils';

/**
 * One ledger for everything that failed for good in this app — invocations,
 * trigger records, webhook deliveries, event routing — with inspect, replay
 * and discard (faas docs/dead-letters.md). Gated on `dead-letter-queues`,
 * the catalog capability that owns `/v1/apps/{slug}/dlq`.
 */
export function DeadLetterLedger({ slug }: { slug: string }) {
  return (
    <CapabilityGate capability="dead-letter-queues" title="Dead-letter ledger">
      <LedgerBody slug={slug} />
    </CapabilityGate>
  );
}

const SOURCE_LABEL: Record<DeadLetterEvent['source'], string> = {
  invocation: 'Invocation',
  trigger_record: 'Trigger record',
  webhook_delivery: 'Webhook delivery',
  job_run: 'Job run',
  workflow_run: 'Workflow run',
  event_route: 'Event routing',
};

/** A routing failure whose receipt was pruned has nothing to redrive (409 dead_letter_not_replayable). */
const replayable = (event: DeadLetterEvent) => event.source !== 'event_route';

function LedgerStatus({ event }: { event: DeadLetterEvent }) {
  const [label, color, Icon] = event.replayed_at
    ? (['Replayed', 'var(--status-good)', CheckCircle] as const)
    : !replayable(event)
      ? (['Not replayable', 'var(--chart-muted)', Prohibition] as const)
      : (['Dead-lettered', 'var(--status-critical)', WarningTriangle] as const);
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

/** What a failed replay means, by the stable code (handlers_dead_letter.go, appevents/delivery_capacity.go). */
function replayFailure(error: unknown): {
  kind: 'info' | 'error';
  title: string;
  description?: string;
} {
  const code = error instanceof ApiError ? error.code : '';
  switch (code) {
    case 'not_found':
      return {
        kind: 'info',
        title: 'Already replayed or removed',
        description: 'The entry is no longer waiting in the ledger.',
      };
    case 'dead_letter_not_replayable':
      return {
        kind: 'error',
        title: 'Nothing to replay',
        description:
          'This routing failure has no receipt left to redrive. Publish the event in its payload again to deliver it.',
      };
    case 'keyed_replay_expired':
      return {
        kind: 'error',
        title: 'Keyed delivery deadline passed',
        description: 'A replay would expire at once. Publish the event again to deliver it.',
      };
    case 'event_delivery_capacity_exhausted':
      return {
        kind: 'error',
        title: 'Event delivery capacity exhausted',
        description: 'Retry after pending deliveries drain.',
      };
    default:
      return { kind: 'error', title: 'Replay failed' };
  }
}

const json = (value: unknown) => JSON.stringify(value ?? {}, null, 2);

function Inspect({ slug, id }: { slug: string; id: string }) {
  const read = useDeadLetterEvent(slug, id);
  const phase = queryPhase({ error: read.error, loading: read.isPending });
  if (phase !== 'ready' || !read.data) {
    return (
      <InlinePhase
        phase={phase}
        error={read.error}
        loadingMessage="Reading the entry…"
        onRetry={() => void read.refetch()}
      />
    );
  }
  const event = read.data;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <dl className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <div className="min-w-0">
          <dt className="label-mono text-muted-foreground">Source record</dt>
          <dd className="mt-1">
            <CopyableId value={event.source_id} label="source record ID" />
          </dd>
        </div>
        {event.trigger_id && (
          <div className="min-w-0">
            <dt className="label-mono text-muted-foreground">Trigger</dt>
            <dd className="mt-1">
              <CopyableId value={event.trigger_id} label="trigger ID" />
            </dd>
          </div>
        )}
        <div>
          <dt className="label-mono text-muted-foreground">First failed</dt>
          <dd className="mt-1">
            <Timestamp value={event.first_failed_at} mode="absolute" />
          </dd>
        </div>
        <div>
          <dt className="label-mono text-muted-foreground">Replayed</dt>
          <dd className="mt-1">
            {event.replayed_at ? <Timestamp value={event.replayed_at} mode="absolute" /> : 'Never'}
          </dd>
        </div>
      </dl>
      {(
        [
          ['Last error', event.error_detail],
          ['Payload', event.payload],
          ['Headers', event.headers],
        ] as const
      ).map(([label, value]) => (
        <div key={label} className="min-w-0">
          <p className="label-mono mb-1 text-muted-foreground">{label}</p>
          <pre className="max-h-56 overflow-auto rounded-md bg-muted p-2 font-mono text-xs">
            {json(value)}
          </pre>
        </div>
      ))}
    </div>
  );
}

function LedgerRow({
  slug,
  event,
  open,
  onToggle,
}: {
  slug: string;
  event: DeadLetterEvent;
  open: boolean;
  onToggle: () => void;
}) {
  const confirm = useConfirm();
  const { toast } = useToast();
  const replay = useReplayDeadLetterEvent(slug);
  const discard = useDiscardDeadLetterEvent(slug);

  const onReplay = async () => {
    const ok = await confirm({
      title: 'Replay this entry?',
      description: `Puts the ${SOURCE_LABEL[event.source].toLowerCase()} back to pending with its original payload and identity, so your handler runs it again. Replay once the cause is fixed; an entry is replayed only once.`,
      confirmLabel: 'Replay',
    });
    if (!ok) return;
    try {
      await replay.mutateAsync({ id: event.id });
      toast({
        kind: 'success',
        title: 'Replay accepted',
        description: 'The work is pending again.',
      });
    } catch (error) {
      toast({ ...replayFailure(error), error });
    }
  };

  const onDiscard = async () => {
    const ok = await confirm({
      title: 'Discard this entry?',
      description:
        'Removes it from this ledger for good. It cannot be undone, and the entry can no longer be inspected or replayed here. The source record stays dead-lettered where it came from.',
      confirmLabel: 'Discard',
      destructive: true,
    });
    if (!ok) return;
    try {
      await discard.mutateAsync({ id: event.id });
      toast({ kind: 'success', title: 'Entry discarded' });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'not_found') {
        toast({ kind: 'info', title: 'Already removed' });
        return;
      }
      toast({ kind: 'error', title: 'Discard failed', error });
    }
  };

  return (
    <li className="flex min-w-0 flex-col gap-3 border-b border-border py-3 last:border-b-0">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          aria-expanded={open}
          aria-label={`Inspect ${SOURCE_LABEL[event.source]} ${event.id}`}
          className="pressable inline-flex min-w-0 items-center gap-2 rounded-md text-left"
          onClick={onToggle}
        >
          <NavArrowDown
            className={cn('size-4 shrink-0 transition-transform', open && 'rotate-180')}
            aria-hidden
          />
          <LedgerStatus event={event} />
          <Pill label={SOURCE_LABEL[event.source]} />
          {event.origin && (
            <span className="truncate font-mono text-xs text-muted-foreground">{event.origin}</span>
          )}
        </button>
        <span className="min-w-0 truncate font-mono text-xs">{event.error_kind}</span>
        <span className="text-xs text-muted-foreground">
          {event.retry_count} {event.retry_count === 1 ? 'retry' : 'retries'}
        </span>
        <Timestamp value={event.last_failed_at} className="text-xs text-muted-foreground" />
        <span className="ml-auto flex gap-2">
          {replayable(event) && !event.replayed_at && (
            <Button size="sm" variant="secondary" busy={replay.isPending} onClick={onReplay}>
              <Redo /> Replay
            </Button>
          )}
          <Button size="sm" variant="ghost" busy={discard.isPending} onClick={onDiscard}>
            <Trash /> Discard
          </Button>
        </span>
      </div>
      {open && <Inspect slug={slug} id={event.id} />}
    </li>
  );
}

function LedgerBody({ slug }: { slug: string }) {
  const confirm = useConfirm();
  const { toast } = useToast();
  const ledger = useDeadLetterLedger(slug);
  const replayAll = useReplayAllDeadLetters(slug);
  const purge = usePurgeDeadLetters(slug);
  const [openId, setOpenId] = useState<string | null>(null);

  const events = ledger.data?.pages.flatMap((page) => page.events) ?? [];
  const phase = queryPhase({
    error: ledger.error,
    loading: ledger.isPending,
    isEmpty: events.length === 0,
  });
  const waiting = events.some((event) => replayable(event) && !event.replayed_at);

  const onReplayAll = async () => {
    const ok = await confirm({
      title: 'Replay every waiting entry?',
      description: `Puts up to ${DEAD_LETTER_BULK_MAX} entries that have not been replayed back to pending, each with its original payload, so your handlers run them again. Routing failures are not replayed. Fix the cause first.`,
      confirmLabel: 'Replay all',
    });
    if (!ok) return;
    try {
      const result = await replayAll.mutateAsync(undefined);
      toast({
        kind: 'success',
        title: `${result.replayed} ${result.replayed === 1 ? 'entry' : 'entries'} replayed`,
      });
    } catch (error) {
      toast({ ...replayFailure(error), error });
    }
  };

  const onPurge = async () => {
    const ok = await confirm({
      title: 'Discard the whole ledger?',
      description: `Removes up to ${DEAD_LETTER_BULK_MAX} entries from this app's ledger for good. It cannot be undone; they can no longer be inspected or replayed here. Their source records stay dead-lettered.`,
      confirmLabel: 'Discard all',
      destructive: true,
      typeToConfirm: slug,
    });
    if (!ok) return;
    try {
      const result = await purge.mutateAsync(undefined);
      toast({
        kind: 'success',
        title: `${result.purged} ${result.purged === 1 ? 'entry' : 'entries'} discarded`,
      });
    } catch (error) {
      toast({ kind: 'error', title: 'Discard failed', error });
    }
  };

  return (
    <Panel
      title="Dead-letter ledger"
      actions={
        phase === 'ready' ? (
          <div className="flex flex-wrap gap-2">
            {waiting && (
              <Button
                size="sm"
                variant="secondary"
                busy={replayAll.isPending}
                onClick={onReplayAll}
              >
                <Redo /> Replay all
              </Button>
            )}
            <Button size="sm" variant="ghost" busy={purge.isPending} onClick={onPurge}>
              <Trash /> Discard all
            </Button>
          </div>
        ) : undefined
      }
    >
      <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
        {
          'Everything that failed on every attempt in this app — invocations, trigger records, webhook deliveries and event routing — kept for 30 days.'
        }
      </p>

      {phase === 'ready' ? (
        <div className="flex flex-col gap-3">
          <ul className="flex flex-col">
            {events.map((event) => (
              <LedgerRow
                key={event.id}
                slug={slug}
                event={event}
                open={openId === event.id}
                onToggle={() => setOpenId((current) => (current === event.id ? null : event.id))}
              />
            ))}
          </ul>
          {ledger.hasNextPage && (
            <Button
              size="sm"
              variant="secondary"
              className="w-fit"
              busy={ledger.isFetchingNextPage}
              onClick={() => void ledger.fetchNextPage()}
            >
              Load older entries
            </Button>
          )}
        </div>
      ) : (
        <InlinePhase
          phase={phase}
          error={ledger.error}
          loadingMessage="Reading the dead-letter ledger…"
          emptyMessage="Nothing has been dead-lettered in this app."
          onRetry={() => void ledger.refetch()}
        />
      )}
    </Panel>
  );
}
