import { useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { Textarea } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { CopyableId } from '@/components/ui/copyable-id';
import { Timestamp } from '@/components/ui/timestamp';
import { InlinePhase, queryPhase } from '@/components/dashboard/primitives';
import { Pill } from '@/components/dashboard/resource-table';
import { ApiError } from '@/lib/api/errors';
import {
  OCCUPANCY_MAX_CHANNELS,
  OCCUPANCY_POLL_MS,
  useCloseRealtimeConnection,
  useRealtimeConnections,
  useRealtimeOccupancy,
  useSendRealtimeConnection,
  utf8Bytes,
  type ConnectionFilters,
  type RealtimeConnection,
} from '@/lib/api/realtime';
import {
  channelError,
  explainToast,
  parseChannels,
  PartialNotice,
  Section,
} from './realtime-shared';

/**
 * Who is connected now, and how many are on a channel.
 *
 * Both are point-in-time fleet reads (faas handlers_connections.go:422,
 * handlers_occupancy.go:17). A connection list is ordered by ID and paged by
 * an opaque cursor; occupancy counts every open subscription on every
 * transport. Neither is pushed to the console: the live counts travel over
 * the resumable WebSocket protocol from the app's own host, which the
 * console's content policy does not connect to, so occupancy re-reads the
 * REST snapshot instead.
 */

/** Live sends are capped at 1 MiB decoded (ManagedRealtimeMessageRequest). */
const SEND_MAX_BYTES = 1_048_576;

export function ConnectionsSection({ slug, endpointId }: { slug: string; endpointId: string }) {
  const id = useId();
  const [draft, setDraft] = useState<ConnectionFilters>({});
  const [filters, setFilters] = useState<ConnectionFilters>({});
  const connections = useRealtimeConnections(slug, endpointId, filters);
  const pages = connections.data?.pages ?? [];
  const rows = pages.flatMap((p) => p.connections);
  const last = pages[pages.length - 1];
  const phase = queryPhase({
    error: connections.error,
    loading: connections.isPending,
    isEmpty: rows.length === 0,
  });
  const filterError = draft.channel ? channelError(draft.channel) : undefined;
  const filtered = Boolean(filters.principal || filters.channel);

  const apply = (e: FormEvent) => {
    e.preventDefault();
    if (filterError) return;
    setFilters({ principal: draft.principal?.trim(), channel: draft.channel?.trim() });
  };

  return (
    <Section
      title="Connections"
      description="Open WebSocket and SSE connections on this endpoint, read from every realtime node now."
      actions={
        <Button
          size="sm"
          variant="outline"
          onClick={() => void connections.refetch()}
          busy={connections.isFetching && !connections.isFetchingNextPage}
        >
          Refresh
        </Button>
      }
    >
      <form
        onSubmit={apply}
        className="flex flex-wrap items-end gap-2"
        aria-label="Filter connections"
      >
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted-foreground">
          Principal
          <Input
            value={draft.principal ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, principal: e.target.value }))}
            placeholder="user-123"
            className="min-w-36"
          />
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted-foreground">
          Channel
          <Input
            value={draft.channel ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, channel: e.target.value.trim() }))}
            placeholder="orders"
            aria-invalid={filterError ? true : undefined}
            aria-describedby={filterError ? `${id}-channel-error` : undefined}
            className="min-w-36"
          />
        </label>
        <Button type="submit" size="sm" variant="outline">
          Apply
        </Button>
        {filterError && (
          <p id={`${id}-channel-error`} role="alert" className="w-full text-xs text-destructive">
            {filterError}
          </p>
        )}
      </form>
      {last?.partial && (
        <PartialNotice
          queried={last.nodes_queried}
          unavailable={last.nodes_unavailable}
          what="this list"
        />
      )}
      <InlinePhase
        phase={phase}
        error={connections.error}
        loadingMessage="Asking the realtime nodes…"
        emptyMessage={
          filtered ? 'No open connection matches these filters.' : 'No clients are connected now.'
        }
        onRetry={() => void connections.refetch()}
      />
      {phase === 'ready' && (
        <ul className="flex flex-col divide-y divide-border well rounded-xl bg-muted/40">
          {rows.map((c) => (
            <ConnectionRow key={c.id} slug={slug} endpointId={endpointId} connection={c} />
          ))}
        </ul>
      )}
      {connections.hasNextPage && (
        <Button
          size="sm"
          variant="outline"
          className="self-start"
          busy={connections.isFetchingNextPage}
          onClick={() => void connections.fetchNextPage()}
        >
          Load more connections
        </Button>
      )}
    </Section>
  );
}

function ConnectionRow({
  slug,
  endpointId,
  connection: c,
}: {
  slug: string;
  endpointId: string;
  connection: RealtimeConnection;
}) {
  const close = useCloseRealtimeConnection(slug, endpointId);
  const send = useSendRealtimeConnection(slug, endpointId);
  const confirm = useConfirm();
  const { toast } = useToast();
  const [composing, setComposing] = useState(false);
  const [text, setText] = useState('');
  const who = c.principal ? `principal ${c.principal}` : 'this anonymous client';
  const gone = (err: unknown) => err instanceof ApiError && err.code === 'not_found';

  const onClose = async () => {
    if (
      !(await confirm({
        title: 'Close this connection?',
        description: `The socket for ${who} closes now. The client may reconnect unless your app or its credentials refuse it.`,
        confirmLabel: 'Close connection',
        destructive: true,
      }))
    )
      return;
    try {
      await close.mutateAsync({ connectionId: c.id });
      toast({ kind: 'success', title: 'Connection closed' });
    } catch (err) {
      toast(
        gone(err)
          ? { kind: 'info', title: 'That connection had already closed' }
          : { kind: 'error', title: 'Could not close the connection', ...explainToast(err) }
      );
    }
  };

  const tooBig = utf8Bytes(text) > SEND_MAX_BYTES;
  const onSend = async (e: FormEvent) => {
    e.preventDefault();
    if (!text || tooBig) return;
    if (
      !(await confirm({
        title: 'Send to this connection?',
        description: `${who.charAt(0).toUpperCase()}${who.slice(1)} receives this as a frame now. It is real traffic to a live client and cannot be recalled.`,
        confirmLabel: 'Send message',
      }))
    )
      return;
    try {
      await send.mutateAsync({ connectionId: c.id, text });
      // 202: the owning node queued it; that is not proof the client read it.
      toast({
        kind: 'success',
        title: 'Message accepted',
        description: "The connection's node queued it for delivery.",
      });
      setText('');
      setComposing(false);
    } catch (err) {
      toast(
        gone(err)
          ? { kind: 'info', title: 'That connection has closed', description: 'Nothing was sent.' }
          : { kind: 'error', title: 'Could not send the message', ...explainToast(err) }
      );
    }
  };

  return (
    <li className="flex flex-col gap-2 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <CopyableId value={c.id} label="connection ID" />
        <span className="min-w-0 truncate text-sm">
          {c.principal || <span className="text-muted-foreground">anonymous</span>}
        </span>
        <span className="text-xs text-muted-foreground">
          connected <Timestamp value={c.connected_at} />
        </span>
        <span className="text-xs text-muted-foreground">
          seen <Timestamp value={c.last_seen_at} />
        </span>
        <span className="text-xs text-muted-foreground">
          expires <Timestamp value={c.expires_at} />
        </span>
        <span className="ml-auto flex gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => setComposing((v) => !v)}>
            {composing ? 'Cancel' : 'Send…'}
          </Button>
          <Button size="sm" variant="outline" onClick={() => void onClose()} busy={close.isPending}>
            Close
          </Button>
        </span>
      </div>
      {c.channels && c.channels.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Subscribed channels">
          {c.channels.map((ch) => (
            <Pill key={ch} label={ch} />
          ))}
        </div>
      )}
      {composing && (
        <form onSubmit={(e) => void onSend(e)} className="flex flex-col gap-2">
          <Textarea
            aria-label="Message to this connection"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            className="font-mono text-xs"
            placeholder='{"type":"hello"}'
          />
          {tooBig && <p className="text-xs text-destructive">A message is at most 1 MiB.</p>}
          <Button
            type="submit"
            size="sm"
            className="self-start"
            disabled={!text || tooBig}
            busy={send.isPending}
          >
            Send
          </Button>
        </form>
      )}
    </li>
  );
}

export function OccupancySection({ slug, endpointId }: { slug: string; endpointId: string }) {
  const id = useId();
  const [draft, setDraft] = useState('');
  const [channels, setChannels] = useState<string[]>([]);
  const [attempted, setAttempted] = useState(false);
  const occupancy = useRealtimeOccupancy(slug, endpointId, channels);
  const parsed = parseChannels(draft);
  const error =
    parsed.length === 0
      ? 'Name at least one channel.'
      : parsed.length > OCCUPANCY_MAX_CHANNELS
        ? `At most ${OCCUPANCY_MAX_CHANNELS} channels at once.`
        : parsed.map(channelError).find(Boolean);
  const phase = queryPhase({ error: occupancy.error, loading: occupancy.isPending });

  const watch = (e: FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    if (error) return;
    setChannels(parsed);
  };

  return (
    <Section
      title="Occupancy"
      description={`Subscribers and presence members per channel, across every node. Re-read every ${OCCUPANCY_POLL_MS / 1000} seconds while this tab is visible.`}
    >
      <form onSubmit={watch} className="flex flex-wrap items-end gap-2" aria-label="Watch channels">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted-foreground">
          Channels (up to {OCCUPANCY_MAX_CHANNELS})
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="lobby, game-42"
            aria-invalid={attempted && error ? true : undefined}
            aria-describedby={attempted && error ? `${id}-error` : undefined}
          />
        </label>
        <Button type="submit" size="sm" variant="outline">
          Watch
        </Button>
        {channels.length > 0 && (
          <Button type="button" size="sm" variant="ghost" onClick={() => setChannels([])}>
            Stop
          </Button>
        )}
        {attempted && error && (
          <p id={`${id}-error`} role="alert" className="w-full text-xs text-destructive">
            {error}
          </p>
        )}
      </form>
      {channels.length > 0 && (
        <>
          <InlinePhase
            phase={phase}
            error={occupancy.error}
            loadingMessage="Counting…"
            onRetry={() => void occupancy.refetch()}
          />
          {occupancy.data?.partial && (
            <PartialNotice
              queried={occupancy.data.nodes_queried}
              unavailable={occupancy.data.nodes_unavailable}
              what="these counts"
            />
          )}
          {occupancy.data && (
            <div className="overflow-x-auto well rounded-xl bg-muted/40">
              <table className="w-full text-sm">
                <caption className="sr-only">Channel occupancy</caption>
                <thead>
                  <tr className="label-mono border-b border-border text-left text-muted-foreground">
                    <th scope="col" className="px-3 py-2 font-normal">
                      Channel
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-normal">
                      Subscribers
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-normal">
                      Presence
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {occupancy.data.channels.map((ch) => (
                    <tr key={ch.channel}>
                      <td className="max-w-0 truncate px-3 py-2 font-mono text-xs">{ch.channel}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{ch.subscribers}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{ch.presence_members}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {occupancy.dataUpdatedAt > 0 && (
            <p className="text-xs text-muted-foreground">
              Counted <Timestamp value={occupancy.dataUpdatedAt} />. A principal-scoped presence
              member counts once however many tabs it has open.
            </p>
          )}
        </>
      )}
    </Section>
  );
}
