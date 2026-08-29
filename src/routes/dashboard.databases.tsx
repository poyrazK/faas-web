import { useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Plus, Trash } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { FIELD } from '@/components/ui/field';
import { PageHeader, Panel } from '@/components/dashboard/primitives';
import { Pill, ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { AppScope, AppSelect, useSelectedApp } from '@/components/dashboard/app-select';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { useAddUpstream, useDeleteUpstream, useUpstreams } from '@/lib/api/queries';
import { errorMessage } from '@/lib/api/errors';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/databases')({
  component: UpstreamsPage,
  head: () => consoleHead('databases'),
});

interface UpstreamRow {
  id: string;
  kind: string;
  fingerprint: string;
  port: number;
  source: string;
  scope: string;
}

const KINDS = [
  'postgres',
  'redis',
  'mongo',
  'cassandra',
  'clickhouse',
  'elasticsearch',
  'opensearch',
  'rabbitmq',
  'kafka',
  'nats',
  'minio',
  'memcached',
  'etcd',
  's3',
  'https_api',
] as const;

const DEFAULT_PORT: Partial<Record<(typeof KINDS)[number], number>> = {
  postgres: 5432,
  redis: 6379,
  mongo: 27017,
  cassandra: 9042,
  clickhouse: 9000,
  elasticsearch: 9200,
  opensearch: 9200,
  rabbitmq: 5672,
  kafka: 9092,
  nats: 4222,
  minio: 9000,
  memcached: 11211,
  etcd: 2379,
  s3: 443,
  https_api: 443,
};

/**
 * The upstreams body, without the page chrome around it.
 *
 * Rendered both by this route and as a tab on the app detail page. Mostly
 * discovered from egress, but the `explicit` pill implied a way to declare
 * one and there was none — the API takes a PUT, and declaring an upstream
 * is how its RTT gets probed before the first cold request needs it.
 */
export function UpstreamsBody({ slug }: { slug: string }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const { data, isPending, error, refetch } = useUpstreams(slug);
  const add = useAddUpstream(slug);
  const remove = useDeleteUpstream(slug);

  const [kind, setKind] = useState<(typeof KINDS)[number]>('postgres');
  const [host, setHost] = useState('');
  const [port, setPort] = useState(String(DEFAULT_PORT.postgres));
  const [scope, setScope] = useState('');

  const rows = useMemo<UpstreamRow[]>(
    () =>
      (data?.upstreams ?? []).map((u) => ({
        id: u.id,
        kind: u.kind,
        fingerprint: u.host_redacted_hash.slice(0, 12),
        port: u.port,
        source: u.source,
        scope: u.scope ?? '—',
      })),
    [data]
  );

  const columns: Column<UpstreamRow>[] = [
    { key: 'kind', label: 'Kind', width: 'w-40', render: (u) => <Pill label={u.kind} /> },
    {
      key: 'fingerprint',
      label: 'Host',
      render: (u) => (
        <span
          className="font-mono text-xs text-muted-foreground"
          title="Hostnames are never returned in the clear"
        >
          {u.fingerprint}…
        </span>
      ),
    },
    {
      key: 'port',
      label: 'Port',
      numeric: true,
      width: 'w-24',
      render: (u) => <span className="[font-variant-numeric:tabular-nums]">{u.port}</span>,
    },
    {
      key: 'source',
      label: 'Source',
      width: 'w-32',
      render: (u) => (
        <Pill label={u.source} color={u.source === 'explicit' ? 'var(--brand)' : undefined} />
      ),
    },
    {
      key: 'scope',
      label: 'Scope',
      render: (u) => <span className="text-xs text-muted-foreground">{u.scope}</span>,
    },
    {
      key: 'id',
      label: '',
      width: 'w-12',
      render: (u) => (
        <button
          type="button"
          aria-label={`Remove ${u.kind} upstream`}
          onClick={async () => {
            if (
              !(await confirm({
                title: `Remove this ${u.kind} upstream?`,
                description:
                  u.source === 'explicit'
                    ? 'It stops being probed. Traffic to it is unaffected; it will be rediscovered from egress if the app keeps talking to it.'
                    : 'It was discovered from egress, so it comes back the next time the app reaches it. Removing it only clears the record.',
                confirmLabel: 'Remove',
                destructive: true,
              }))
            )
              return;
            void remove
              .mutateAsync(u.id)
              .then(() => toast({ kind: 'success', title: 'Upstream removed' }))
              .catch((err: unknown) =>
                toast({ kind: 'error', title: 'Could not remove', description: errorMessage(err) })
              );
          }}
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          <Trash className="h-3.5 w-3.5" />
        </button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <Panel
        lit
        title="Declare an upstream"
        description="Declared upstreams are probed for reachability and latency before the app needs them. The hostname is hashed at rest."
      >
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!host.trim() || !Number(port) || add.isPending) return;
            void add
              .mutateAsync({
                kind,
                host: host.trim(),
                port: Number(port),
                scope: scope.trim() || undefined,
              })
              .then(() => {
                setHost('');
                setScope('');
                toast({ kind: 'success', title: `${kind} upstream declared` });
              })
              .catch((err: unknown) =>
                toast({ kind: 'error', title: 'Could not declare', description: errorMessage(err) })
              );
          }}
        >
          <label className="flex flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">Kind</span>
            <select
              value={kind}
              onChange={(e) => {
                const next = e.target.value as (typeof KINDS)[number];
                setKind(next);
                setPort(String(DEFAULT_PORT[next] ?? ''));
              }}
              className={`${FIELD} min-w-36`}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-56 flex-1 flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">Host</span>
            <input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="db.internal.example.com"
              spellCheck={false}
              className={`${FIELD} font-mono`}
            />
          </label>
          <label className="flex w-28 flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">Port</span>
            <input
              type="number"
              min={1}
              max={65535}
              value={port}
              onChange={(e) => setPort(e.target.value)}
              className={`${FIELD} font-mono [font-variant-numeric:tabular-nums]`}
            />
          </label>
          <label className="flex w-36 flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">Scope</span>
            <input
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              placeholder="optional"
              spellCheck={false}
              className={`${FIELD} font-mono`}
            />
          </label>
          <Button
            type="submit"
            size="sm"
            className="gap-1.5"
            disabled={!host.trim() || !Number(port)}
            busy={add.isPending}
          >
            <Plus className="h-3.5 w-3.5" />
            Declare
          </Button>
        </form>
      </Panel>

      <ResourceTable
        rows={rows}
        columns={columns}
        initialSort={{ key: 'kind', dir: 'asc' }}
        searchKeys={['kind', 'scope']}
        searchPlaceholder="Filter by kind…"
        emptyMessage={`No upstreams observed for ${slug}.`}
        minWidth="min-w-[820px]"
        loading={isPending}
        error={error}
        onRetry={() => void refetch()}
      />
    </div>
  );
}

function UpstreamsPage() {
  const appState = useSelectedApp();
  const { slug, select, apps } = appState;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Upstreams"
        description="External services this app reaches. Mostly discovered from egress; hostnames are hashed, never stored in the clear."
        actions={<AppSelect slug={slug} onSelect={select} apps={apps} />}
      />
      <AppScope state={appState} resource="upstreams">
        <UpstreamsBody slug={slug} />
      </AppScope>
    </div>
  );
}
