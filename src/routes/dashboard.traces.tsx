import { useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Refresh } from 'iconoir-react';
import { InlinePhase, PageHeader, queryPhase } from '@/components/dashboard/primitives';
import { Pill, ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { useApps, useInvocation, useInvocations, useReplayInvocation } from '@/lib/api/queries';
import { Modal } from '@/components/ui/modal';
import { slugIndex } from '@/lib/api/adapters';
import { errorMessage } from '@/lib/api/errors';
import { formatRelative } from '@/lib/mock-data';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/traces')({
  component: InvocationsPage,
  head: () => consoleHead('traces'),
});

/**
 * Invocations, from `/v1/invocations`.
 *
 * This page was a fabricated span-waterfall "traces" view. The API has no span
 * tree to draw — `/v1/traces/{trace_id}` returns a single trace by id, and there
 * is no endpoint that lists traces to populate a browser. What it does have is
 * a record per invocation, which is the thing you actually want when a request
 * misbehaved, so that is what this shows.
 *
 * Replay re-runs an invocation with its original payload; it is the reason to
 * come here rather than to the logs.
 */
interface InvocationRow {
  id: string;
  app: string;
  state: string;
  source: string;
  route: string;
  attempts: number;
  createdAt: string;
}

const STATE_COLOR: Record<string, string> = {
  completed: 'var(--status-good)',
  dispatching: 'var(--status-warning)',
  pending: 'var(--chart-muted)',
  failed: 'var(--status-critical)',
  dead_letter: 'var(--status-critical)',
  cancelled: 'var(--chart-muted)',
};

function formatWhen(value: string | undefined): string {
  if (!value) return '—';
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? '—' : formatRelative(ms);
}

function Json({ value }: { value: unknown }) {
  return (
    <pre className="max-h-56 overflow-auto rounded-md border border-border bg-background p-3 font-mono text-xs leading-relaxed">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

/**
 * One invocation in full. The list shows state and route; what was sent,
 * what came back, and why it failed were unreachable from the console —
 * `useInvocation` had no caller.
 */
function InvocationDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useInvocation(id ?? '');
  const inv = q.data;
  const invPhase = queryPhase({ error: q.error, loading: q.isPending, isEmpty: !inv });
  return (
    <Modal
      open={id !== null}
      onClose={onClose}
      title={inv ? `${inv.method ?? ''} ${inv.path ?? ''}`.trim() || 'Invocation' : 'Invocation'}
      description={id ?? undefined}
      width="max-w-2xl"
    >
      {invPhase !== 'ready' || !inv ? (
        <InlinePhase
          phase={invPhase}
          error={q.error}
          emptyMessage="This invocation has no recorded detail."
        />
      ) : (
        <div className="flex flex-col gap-4">
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
            {[
              ['State', inv.state],
              ['Source', inv.source],
              ['Attempts', String(inv.attempts ?? 1)],
              ['Created', formatRelative(Date.parse(inv.created_at))],
              ['Completed', inv.completed_at ? formatRelative(Date.parse(inv.completed_at)) : '—'],
              ['Instance', inv.instance_id ?? '—'],
            ].map(([k, v]) => (
              <div key={k} className="flex min-w-0 flex-col gap-0.5">
                <dt className="label-mono text-muted-foreground">{k}</dt>
                <dd className="truncate font-mono text-xs">{v}</dd>
              </div>
            ))}
          </dl>
          {inv.last_error && (
            <p
              className="rounded-md border px-3 py-2 font-mono text-xs"
              style={{
                borderColor: 'color-mix(in oklab, var(--status-critical) 35%, transparent)',
              }}
            >
              {inv.last_error}
            </p>
          )}
          {inv.payload && (
            <div>
              <p className="label-mono mb-1.5 text-muted-foreground">Payload</p>
              <Json value={inv.payload} />
            </div>
          )}
          {inv.result && (
            <div>
              <p className="label-mono mb-1.5 text-muted-foreground">Result</p>
              <Json value={inv.result} />
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function InvocationsPage() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const { data, isPending, error, refetch } = useInvocations();
  const { data: apps } = useApps();
  const replay = useReplayInvocation();
  const [selected, setSelected] = useState<string | null>(null);

  const rows = useMemo<InvocationRow[]>(() => {
    const bySlug = slugIndex(apps ?? []);
    return (data?.invocations ?? []).map((i) => ({
      id: i.id,
      app: bySlug.get(i.app_id) ?? i.app_id,
      state: i.state,
      source: i.source,
      route: [i.method, i.path].filter(Boolean).join(' ') || '—',
      attempts: i.attempts ?? 0,
      createdAt: i.created_at,
    }));
  }, [data, apps]);

  const columns: Column<InvocationRow>[] = [
    {
      key: 'createdAt',
      label: 'When',
      numeric: true,
      render: (i) => (
        <span className="text-xs text-muted-foreground">{formatWhen(i.createdAt)}</span>
      ),
    },
    {
      key: 'app',
      label: 'App',
      render: (i) => <span className="font-mono text-xs">{i.app}</span>,
    },
    {
      key: 'state',
      label: 'State',
      width: 'w-32',
      render: (i) => <Pill label={i.state} color={STATE_COLOR[i.state]} />,
    },
    {
      key: 'source',
      label: 'Source',
      width: 'w-32',
      render: (i) => <Pill label={i.source} />,
    },
    {
      key: 'route',
      label: 'Route',
      render: (i) => <span className="font-mono text-xs text-muted-foreground">{i.route}</span>,
    },
    {
      key: 'attempts',
      label: 'Tries',
      numeric: true,
      width: 'w-20',
      render: (i) => (
        <span className="[font-variant-numeric:tabular-nums]">{i.attempts || '—'}</span>
      ),
    },
    {
      key: 'id',
      label: 'Invocation',
      render: (i) => <span className="font-mono text-xs text-muted-foreground">{i.id}</span>,
    },
    {
      key: 'app',
      label: '',
      width: 'w-12',
      render: (i) => (
        <button
          type="button"
          aria-label={`Replay invocation ${i.id}`}
          onClick={async () => {
            if (
              !(await confirm({
                title: 'Replay this invocation?',
                description:
                  'It is re-issued to the app with the same payload. If the handler is not idempotent, that work happens twice.',
                confirmLabel: 'Replay',
              }))
            )
              return;
            void replay
              .mutateAsync(i.id)
              .then(() => toast({ kind: 'success', title: 'Replayed' }))
              .catch((err: unknown) =>
                toast({ kind: 'error', title: 'Could not replay', description: errorMessage(err) })
              );
          }}
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          <Refresh className="h-3.5 w-3.5" />
        </button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Invocations"
        description="Every request into your apps, and the ones you can replay with their original payload."
      />
      <ResourceTable
        rows={rows}
        columns={columns}
        initialSort={{ key: 'createdAt', dir: 'desc' }}
        searchKeys={['app', 'state', 'source', 'id']}
        searchPlaceholder="Filter by app, state, or source…"
        emptyMessage="No invocations recorded yet."
        minWidth="min-w-[900px]"
        loading={isPending}
        error={error}
        onRetry={() => void refetch()}
        onRowClick={(i) => setSelected(i.id)}
      />

      <InvocationDrawer id={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
