import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/dashboard/primitives';
import { ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { useToast } from '@/components/ui/toast';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useDeadLetter, useReplayDeadLetter } from '@/lib/api/queries';
import { formatRelative } from '@/lib/mock-data';

/**
 * Dead-lettered messages, and the one verb that gets them out again.
 *
 * Replay resets the row in place — `attempts=0`, `due_at=now()` — rather than
 * enqueuing a copy, so the row keeps its id and simply moves back to Pending.
 * That is why success invalidates the whole queue family: watching the row
 * cross from one table to the other is the confirmation.
 *
 * A second replay 404s by design, because the row is already pending. That is
 * a double-click, not a fault, so it reads as "already replayed" — reporting it
 * as an error would teach the customer to distrust a button that worked.
 */

interface Row {
  id: string;
  attempts: number;
  failedAt: string;
}

function formatWhen(value: string): string {
  if (!value) return '—';
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? '—' : formatRelative(ms);
}

export function DeadLetterPanel({ slug }: { slug: string }) {
  const { toast } = useToast();
  const dlq = useDeadLetter(slug);
  const replay = useReplayDeadLetter(slug);

  const rows = useMemo<Row[]>(
    () =>
      (dlq.data?.messages ?? []).map((m) => ({
        id: m.id,
        attempts: m.attempts ?? 0,
        failedAt: m.failed_at ?? '',
      })),
    [dlq.data]
  );

  const onReplay = (id: string) => {
    void replay
      .mutateAsync(id)
      .then(() =>
        toast({ kind: 'success', title: 'Replayed', description: 'The message is pending again.' })
      )
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.isNotFound) {
          toast({
            kind: 'info',
            title: 'Already replayed',
            description: 'This message is no longer dead-lettered.',
          });
          return;
        }
        toast({ kind: 'error', title: 'Could not replay', description: errorMessage(err) });
      });
  };

  const columns: Column<Row>[] = [
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
    {
      key: 'id',
      label: '',
      width: 'w-28',
      render: (m) => (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="secondary"
            busy={replay.isPending && replay.variables === m.id}
            onClick={() => onReplay(m.id)}
          >
            Replay
          </Button>
        </div>
      ),
    },
  ];

  return (
    <Panel title="Dead letter">
      <ResourceTable
        rows={rows}
        columns={columns}
        emptyMessage="Nothing has been dead-lettered."
        minWidth="min-w-[600px]"
        loading={dlq.isPending}
        error={dlq.error}
        onRetry={() => void dlq.refetch()}
      />
    </Panel>
  );
}
