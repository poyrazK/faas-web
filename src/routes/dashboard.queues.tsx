import { useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { PageHeader, Panel, StatTile } from '@/components/dashboard/primitives';
import { ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { AppScope, AppSelect, useSelectedApp } from '@/components/dashboard/app-select';
import { useDeadLetter, useQueuePeek, useQueueSend, useQueueState } from '@/lib/api/queries';
import { formatRelative } from '@/lib/mock-data';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/api/errors';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/queues')({
  component: QueuesPage,
  head: () => consoleHead('queues'),
});

/**
 * The per-app FIFO queue, from `/v1/apps/{slug}/queues/*`.
 *
 * There is one queue per app, not a list of named queues — which is why this
 * page is a depth readout plus two message lists rather than a table of queues.
 *
 * The head of the queue is read with `peek`, deliberately: `receive` would
 * claim the message and start its visibility timeout, so browsing a queue in
 * the dashboard would steal work from the app consuming it.
 */
interface MessageRow {
  id: string;
  createdAt: string;
  attempts: number;
  failedAt: string;
}

function formatWhen(value: string | undefined): string {
  if (!value) return '—';
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? '—' : formatRelative(ms);
}

function formatAge(seconds: number | null | undefined): string {
  if (seconds == null) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

function QueueSendPanel({ slug }: { slug: string }) {
  const { toast } = useToast();
  const send = useQueueSend(slug);
  const [payload, setPayload] = useState('{}');

  const submit = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch (error) {
      toast({ kind: 'error', title: 'Invalid JSON', description: errorMessage(error) });
      return;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      toast({ kind: 'error', title: 'Payload must be a JSON object' });
      return;
    }
    void send
      .mutateAsync({ payload: parsed as Record<string, unknown> })
      .then((result) => {
        setPayload('{}');
        toast({ kind: 'success', title: 'Message queued', description: result.id });
      })
      .catch((error: unknown) =>
        toast({ kind: 'error', title: 'Could not queue message', description: errorMessage(error) })
      );
  };

  return (
    <Panel
      lit
      title="Send a message"
      description="Publish a JSON object to this app's FIFO queue. The queue consumer remains responsible for receiving and acknowledging work."
      actions={
        <Button size="sm" onClick={submit} disabled={send.isPending}>
          {send.isPending ? 'Sending…' : 'Send message'}
        </Button>
      }
    >
      <textarea
        value={payload}
        onChange={(e) => setPayload(e.target.value)}
        rows={5}
        spellCheck={false}
        aria-label="Queue message payload"
        className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-brand/50"
      />
    </Panel>
  );
}

/**
 * The queues body, without the page chrome around it.
 *
 * Rendered both by this route and as a tab on the app detail page, so
 * the two can never drift into two different implementations of the
 * same resource.
 */
export function QueuesBody({ slug }: { slug: string }) {
  const state = useQueueState(slug);
  const peek = useQueuePeek(slug);
  const dlq = useDeadLetter(slug);

  const pending = useMemo<MessageRow[]>(
    () =>
      (peek.data?.messages ?? []).map((m) => ({
        id: m.id,
        createdAt: m.created_at,
        attempts: 0,
        failedAt: '',
      })),
    [peek.data]
  );

  const dead = useMemo<MessageRow[]>(
    () =>
      (dlq.data?.messages ?? []).map((m) => ({
        id: m.id,
        createdAt: m.created_at ?? '',
        attempts: m.attempts ?? 0,
        failedAt: m.failed_at ?? '',
      })),
    [dlq.data]
  );

  const pendingColumns: Column<MessageRow>[] = [
    {
      key: 'id',
      label: 'Message',
      render: (m) => <span className="font-mono text-xs">{m.id}</span>,
    },
    {
      key: 'createdAt',
      label: 'Enqueued',
      numeric: true,
      render: (m) => (
        <span className="text-xs text-muted-foreground">{formatWhen(m.createdAt)}</span>
      ),
    },
  ];

  const deadColumns: Column<MessageRow>[] = [
    {
      key: 'id',
      label: 'Message',
      render: (m) => <span className="font-mono text-xs">{m.id}</span>,
    },
    {
      key: 'attempts',
      label: 'Attempts',
      numeric: true,
      width: 'w-28',
      render: (m) => <span className="[font-variant-numeric:tabular-nums]">{m.attempts}</span>,
    },
    {
      key: 'failedAt',
      label: 'Failed',
      numeric: true,
      render: (m) => (
        <span className="text-xs text-muted-foreground">{formatWhen(m.failedAt)}</span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Depth" value={String(state.data?.depth ?? '—')} />
        <StatTile label="In flight" value={String(state.data?.in_flight ?? '—')} />
        <StatTile
          label="Oldest pending"
          value={formatAge(state.data?.oldest_pending_age_seconds)}
        />
        <StatTile label="Plan cap" value={String(state.data?.plan_cap ?? '—')} />
      </div>

      <QueueSendPanel slug={slug} />

      <Panel title="Pending">
        <ResourceTable
          rows={pending}
          columns={pendingColumns}
          emptyMessage={slug ? 'The queue is empty.' : 'Create an app first.'}
          minWidth="min-w-[600px]"
          loading={peek.isPending}
          error={peek.error}
          onRetry={() => void peek.refetch()}
        />
      </Panel>

      <Panel title="Dead letter">
        <ResourceTable
          rows={dead}
          columns={deadColumns}
          emptyMessage="Nothing has been dead-lettered."
          minWidth="min-w-[600px]"
          loading={dlq.isPending}
          error={dlq.error}
          onRetry={() => void dlq.refetch()}
        />
      </Panel>
    </div>
  );
}

function QueuesPage() {
  const appState = useSelectedApp();
  const { slug, select, apps } = appState;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Queue Jobs"
        description="One FIFO queue per app. Messages here are peeked, not received — browsing never claims work from your consumers."
        actions={<AppSelect slug={slug} onSelect={select} apps={apps} />}
      />

      <AppScope state={appState} resource="queue jobs">
        <QueuesBody slug={slug} />
      </AppScope>
    </div>
  );
}
