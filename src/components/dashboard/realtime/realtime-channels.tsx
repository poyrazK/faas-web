import { useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { Select, Textarea } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { Timestamp } from '@/components/ui/timestamp';
import { InlinePhase, queryPhase } from '@/components/dashboard/primitives';
import { Pill } from '@/components/dashboard/resource-table';
import { ApiError } from '@/lib/api/errors';
import {
  base64ToText,
  useConsumerGroups,
  useRealtimePublish,
  useRetainedHistory,
  utf8Bytes,
  type RealtimeConsumerGroup,
  type RealtimeDelivery,
  type RealtimePublishResult,
} from '@/lib/api/realtime';
import { channelError, explainToast, Section, StatusTag } from './realtime-shared';

/**
 * One channel of an endpoint: publish to it, read its retained history, and
 * see the consumer groups reading it.
 *
 * A publish is real traffic: every subscriber gets it, and a retained one is
 * replayed to resumable clients for 24 hours (faas handlers_connections.go:1164,
 * docs/realtime.md § Resumable protocol). So it is always confirmed, and each
 * composed message carries one Idempotency-Key: a retry after an unknown
 * outcome replays the first answer instead of sending twice (the key binds
 * mode and payload for 24 hours; reuse with a different payload is 409).
 */

const LIVE_MAX = 1_048_576;
const RETAINED_MAX = 4_096;

export function ChannelSection({ slug, endpointId }: { slug: string; endpointId: string }) {
  const id = useId();
  const [draft, setDraft] = useState('');
  const [channel, setChannel] = useState('');
  const [attempted, setAttempted] = useState(false);
  const error = channelError(draft);

  const open = (e: FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    if (!error) setChannel(draft);
  };

  return (
    <Section
      title="Channels"
      description="Channels exist while something uses them; name one to publish to it, read its retained history and see its consumer groups."
    >
      <form onSubmit={open} className="flex flex-wrap items-end gap-2" aria-label="Open a channel">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted-foreground">
          Channel
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value.trim())}
            placeholder="orders"
            aria-invalid={attempted && error ? true : undefined}
            aria-describedby={attempted && error ? `${id}-error` : undefined}
          />
        </label>
        <Button type="submit" size="sm" variant="outline">
          Open channel
        </Button>
        {attempted && error && (
          <p id={`${id}-error`} role="alert" className="w-full text-xs text-destructive">
            {error}
          </p>
        )}
      </form>
      {channel && (
        <div key={channel} className="flex flex-col gap-6 rounded-lg border border-border p-4">
          <PublishForm slug={slug} endpointId={endpointId} channel={channel} />
          <RetainedHistory slug={slug} endpointId={endpointId} channel={channel} />
          <ConsumerGroups slug={slug} endpointId={endpointId} channel={channel} />
        </div>
      )}
    </Section>
  );
}

function PublishForm({
  slug,
  endpointId,
  channel,
}: {
  slug: string;
  endpointId: string;
  channel: string;
}) {
  const publish = useRealtimePublish(slug, endpointId);
  const confirm = useConfirm();
  const { toast } = useToast();
  const [text, setText] = useState('');
  const [delivery, setDelivery] = useState<RealtimeDelivery>('live');
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [result, setResult] = useState<RealtimePublishResult | null>(null);
  const bytes = utf8Bytes(text);
  const max = delivery === 'retained' ? RETAINED_MAX : LIVE_MAX;
  const tooBig = bytes > max;

  // A new message is a new operation; the key follows the content.
  const edit = (next: { text?: string; delivery?: RealtimeDelivery }) => {
    if (next.text !== undefined) setText(next.text);
    if (next.delivery !== undefined) setDelivery(next.delivery);
    setKey(crypto.randomUUID());
    setResult(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text || tooBig || publish.isPending) return;
    if (
      !(await confirm({
        title: `Publish to ${channel}?`,
        description:
          delivery === 'retained'
            ? `Every client subscribed to ${channel} on this endpoint receives this message, and it stays in the channel's history for 24 hours, so resumable clients that reconnect get it too. This is real traffic and cannot be recalled.`
            : `Every client subscribed to ${channel} on this endpoint receives this message now. This is real traffic, not a sandbox, and cannot be recalled.`,
        confirmLabel: 'Publish',
      }))
    )
      return;
    try {
      const sent = await publish.mutateAsync({ channel, text, delivery, idempotencyKey: key });
      setResult(sent);
      setText('');
      setKey(crypto.randomUUID());
    } catch (err) {
      // An idempotency conflict means this key already carried another
      // message; anything else may be a lost answer, so the key is kept and a
      // retry replays apid's first response.
      if (err instanceof ApiError && err.code === 'conflict') setKey(crypto.randomUUID());
      toast({ kind: 'error', title: 'Could not publish', ...explainToast(err) });
    }
  };

  return (
    <Section
      title="Publish a message"
      description="Sent as UTF-8 text. Queued is not received: a client's socket accepting the message does not mean it was read."
    >
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-2">
        <Textarea
          aria-label={`Message for ${channel}`}
          value={text}
          onChange={(e) => edit({ text: e.target.value })}
          rows={3}
          className="font-mono text-xs"
          placeholder='{"id":42,"status":"shipped"}'
        />
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Delivery
            <Select
              value={delivery}
              onChange={(e) => edit({ delivery: e.target.value as RealtimeDelivery })}
              aria-label="Delivery"
            >
              <option value="live">Live — connected subscribers only</option>
              <option value="retained">Retained — also kept 24 h for resume</option>
            </Select>
          </label>
          <span className={tooBig ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
            {bytes.toLocaleString()} / {max.toLocaleString()} bytes
          </span>
          <Button
            type="submit"
            size="sm"
            className="ml-auto"
            disabled={!text || tooBig}
            busy={publish.isPending}
          >
            Publish…
          </Button>
        </div>
      </form>
      {result && <PublishOutcome result={result} />}
    </Section>
  );
}

function PublishOutcome({ result }: { result: RealtimePublishResult }) {
  const targeted = result.subscribers;
  const problems = (result.queue_full ?? 0) + (result.failed ?? 0);
  return (
    <div role="status" className="flex flex-col gap-1 rounded-md border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <StatusTag
          tone={result.partial || problems > 0 ? 'warning' : 'good'}
          label={result.partial || problems > 0 ? 'Partly queued' : 'Queued'}
        />
        <span>
          {targeted === undefined
            ? `Queued for ${result.queued} ${result.queued === 1 ? 'subscriber' : 'subscribers'}.`
            : `Queued for ${result.queued} of ${targeted} ${targeted === 1 ? 'subscriber' : 'subscribers'}.`}
        </span>
        {result.durable && result.sequence !== undefined && (
          <span className="text-xs text-muted-foreground">
            Retained as sequence {result.sequence}.
          </span>
        )}
      </div>
      {(result.queue_full ?? 0) > 0 && (
        <p className="text-xs text-muted-foreground">
          {result.queue_full} had a full output queue and did not get it.
        </p>
      )}
      {(result.failed ?? 0) > 0 && (
        <p className="text-xs text-muted-foreground">{result.failed} could not be queued.</p>
      )}
      {(result.nodes_unavailable ?? 0) > 0 && (
        <p className="text-xs text-muted-foreground">
          {result.nodes_unavailable} realtime {result.nodes_unavailable === 1 ? 'node' : 'nodes'}{' '}
          did not accept the publish; subscribers there did not get it
          {result.durable ? ' live, but can resume it from history' : ''}.
        </p>
      )}
    </div>
  );
}

function RetainedHistory({
  slug,
  endpointId,
  channel,
}: {
  slug: string;
  endpointId: string;
  channel: string;
}) {
  const history = useRetainedHistory(slug, endpointId, channel);
  const pages = history.data?.pages ?? [];
  const messages = pages.flatMap((p) => p.messages);
  const first = pages[0];
  const phase = queryPhase({
    error: history.error,
    loading: history.isPending,
    isEmpty: messages.length === 0,
  });
  return (
    <Section
      title="Retained history"
      description="Messages published with retained delivery, kept 24 hours and at most 1,024 per channel, oldest first."
      actions={
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void history.refetch()}
          busy={history.isFetching && !history.isFetchingNextPage}
        >
          Refresh
        </Button>
      }
    >
      <InlinePhase
        phase={phase}
        error={history.error}
        loadingMessage="Reading history…"
        emptyMessage="Nothing retained on this channel. Live messages are never kept."
        onRetry={() => void history.refetch()}
      />
      {phase === 'ready' && first && (
        <p className="text-xs text-muted-foreground">
          Sequences {first.oldest_sequence} to {first.latest_sequence} are retained.
        </p>
      )}
      {phase === 'ready' && (
        <ol className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {messages.map((m) => {
            const body = m.expired ? undefined : base64ToText(m.data_base64, m.binary);
            return (
              <li key={m.sequence} className="flex flex-col gap-1 px-3 py-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <span className="font-mono">#{m.sequence}</span>
                  <Timestamp value={m.created_at} className="text-muted-foreground" />
                  {m.event && <Pill label={m.event} />}
                  {m.deleted && <StatusTag tone="muted" label="Deleted" />}
                  {m.expired && <StatusTag tone="muted" label="Expired" />}
                </div>
                {m.expired ? null : body !== undefined ? (
                  <code className="whitespace-pre-wrap break-all font-mono text-xs">{body}</code>
                ) : (
                  <span className="text-xs text-muted-foreground">Binary payload</span>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {history.hasNextPage && (
        <Button
          size="sm"
          variant="outline"
          className="self-start"
          busy={history.isFetchingNextPage}
          onClick={() => void history.fetchNextPage()}
        >
          Load newer messages
        </Button>
      )}
    </Section>
  );
}

function groupState(g: RealtimeConsumerGroup) {
  if (g.drained) return { tone: 'muted' as const, label: 'Drained' };
  if (g.draining) return { tone: 'warning' as const, label: 'Draining' };
  if (g.paused) return { tone: 'warning' as const, label: 'Paused' };
  if (g.history_unavailable || g.capacity_blocked)
    return { tone: 'critical' as const, label: 'Blocked' };
  return { tone: 'good' as const, label: 'Consuming' };
}

function ConsumerGroups({
  slug,
  endpointId,
  channel,
}: {
  slug: string;
  endpointId: string;
  channel: string;
}) {
  const groups = useConsumerGroups(slug, endpointId, channel);
  const list = groups.data ?? [];
  const phase = queryPhase({
    error: groups.error,
    loading: groups.isPending,
    isEmpty: list.length === 0,
  });
  return (
    <Section
      title="Consumer groups"
      description="Backend workers sharing this channel's retained messages with leased claims. Create and operate groups from gregale.yaml or the API."
    >
      <InlinePhase
        phase={phase}
        error={groups.error}
        loadingMessage="Reading consumer groups…"
        emptyMessage="No consumer group reads this channel."
        onRetry={() => void groups.refetch()}
      />
      {phase === 'ready' && (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {list.map((g) => {
            const state = groupState(g);
            return (
              <li key={g.group_id} className="flex flex-col gap-1.5 px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{g.name}</span>
                  <StatusTag tone={state.tone} label={state.label} />
                  {g.trigger_id && <Pill label="Consumed by a trigger" />}
                </div>
                <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs min-[420px]:grid-cols-2 sm:grid-cols-4">
                  {(
                    [
                      ['Not yet assigned', g.unassigned],
                      ['Ready', g.ready],
                      ['Leased', g.leased],
                      ['Dead letters', g.dead],
                      ['Active workers', g.active_workers],
                      ['Expired leases', g.expired_leases],
                      ['Held for ordering', g.ordering_blocked],
                      ['Lease', `${g.lease_seconds} s`],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label} className="flex justify-between gap-2 sm:flex-col">
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="tabular-nums">{value}</dd>
                    </div>
                  ))}
                </dl>
                {g.history_unavailable && (
                  <p className="text-xs text-muted-foreground">
                    The group&apos;s position is older than retained history; it must be resynced.
                  </p>
                )}
                {g.capacity_blocked && (
                  <p className="text-xs text-muted-foreground">
                    Assignment is waiting for retained-history capacity.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
