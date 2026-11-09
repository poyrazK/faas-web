import { useId, useState, type ReactNode } from 'react';
import { CheckCircle, HelpCircle, Prohibition, Trash, WarningTriangle } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { FIELD, Select } from '@/components/ui/field';
import { Timestamp } from '@/components/ui/timestamp';
import { useToast } from '@/components/ui/toast';
import { CapabilityGate } from './capability-gate';
import {
  EmptyState,
  ErrorState,
  InlinePhase,
  LoadingState,
  Panel,
  UnreachableState,
  queryPhase,
} from './primitives';
import { ApiError } from '@/lib/api/errors';
import { useApp, useDomains } from '@/lib/api/queries';
import {
  PUBLIC_PORT_MAX,
  PUBLIC_PORT_MIN,
  declaredListeners,
  useCreateTcpListener,
  useCreateUdpListener,
  useDeleteTcpListener,
  useDeleteUdpListener,
  useTcpListenerTlsStatus,
  useTcpListeners,
  useUdpListeners,
  useUpdateTcpListener,
  useUpdateUdpListener,
  type ListenerProtocol,
  type TcpListener,
  type TcpListenerTlsStatus,
  type UdpListener,
} from '@/lib/api/listeners';
import { cn } from '@/lib/utils';

/**
 * The app's public raw TCP and UDP listeners (faas handlers_tcp_listeners.go,
 * handlers_udp_listeners.go), each behind its own preview capability.
 *
 * A listener puts an app port on the internet, so creating or enabling one is
 * confirmed with that said plainly, and so is anything that drops serving
 * (disable, a TLS change, delete). Only ports the app declares are offered:
 * the API refuses any other name or guest port.
 */
export function TcpListeners({ slug }: { slug: string }) {
  return (
    <CapabilityGate capability="tcp-listeners" title="TCP listeners">
      <TcpListenersBody slug={slug} />
    </CapabilityGate>
  );
}

export function UdpListeners({ slug }: { slug: string }) {
  return (
    <CapabilityGate capability="udp-listeners" title="UDP listeners">
      <UdpListenersBody slug={slug} />
    </CapabilityGate>
  );
}

type Toast = { kind: 'info' | 'error'; title: string; description?: string; error?: unknown };

/** What a refused write means, by the stable code (writeTCPListenerStoreError, writeUDPListenerStoreError). */
export function listenerFailure(error: unknown, fallback: string): Toast {
  const code = error instanceof ApiError ? error.code : '';
  switch (code) {
    case 'conflict':
      return {
        kind: 'error',
        title: 'Name or public port in use',
        description:
          'Another listener already has this name or public port. Choose another public port, or leave it empty for Gregale to pick one.',
      };
    case 'udp_listener_limit':
      return {
        kind: 'info',
        title: 'UDP listener limit reached',
        description:
          'Delete a UDP listener before reserving another. Disabled listeners still hold their ports.',
        error,
      };
    case 'not_found':
      return {
        kind: 'info',
        title: 'Listener not found',
        description: 'It was removed elsewhere. The list is refreshed.',
      };
    default:
      return { kind: 'error', title: fallback, error };
  }
}

function ServingBadge({ enabled }: { enabled: boolean }) {
  const [label, color, Icon] = enabled
    ? (['Accepting', 'var(--status-good)', CheckCircle] as const)
    : (['Disabled', 'var(--chart-muted)', Prohibition] as const);
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

const CERT_STATUS = {
  ready: ['Ready', 'var(--status-good)', CheckCircle],
  not_ready: ['Not ready', 'var(--status-warning)', WarningTriangle],
  unknown: ['Unknown', 'var(--chart-muted)', HelpCircle],
} as const;

function CertBadge({ status }: { status: keyof typeof CERT_STATUS }) {
  const [label, color, Icon] = CERT_STATUS[status];
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

/** Shared list scaffolding: the four read states in `queryPhase` order. */
function ListenerList<T>({
  query,
  noun,
  render,
}: {
  query: { data?: T[]; error: unknown; isPending: boolean; refetch: () => unknown };
  noun: string;
  render: (rows: T[]) => ReactNode;
}) {
  const phase = queryPhase({
    error: query.error,
    loading: query.isPending,
    isEmpty: (query.data?.length ?? 0) === 0,
  });
  if (phase === 'unreachable') return <UnreachableState onRetry={() => void query.refetch()} />;
  if (phase === 'error')
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (phase === 'loading') return <LoadingState message={`Loading ${noun}…`} />;
  if (phase === 'empty')
    return <EmptyState message={`No ${noun} yet. Expose a declared port below.`} />;
  return <ul className="flex flex-col gap-3">{render(query.data ?? [])}</ul>;
}

/* ------------------------------------------------------------------ *
 * TCP
 * ------------------------------------------------------------------ */

function TcpListenersBody({ slug }: { slug: string }) {
  const list = useTcpListeners(slug);
  return (
    <div className="flex flex-col gap-5">
      <Panel title="TCP listeners">
        <p className="mb-4 text-sm leading-relaxed text-muted-foreground">{`Raw TCP on a stable public port (${PUBLIC_PORT_MIN}–${PUBLIC_PORT_MAX}), forwarded to a TCP port the app declares. The port stays the same across wakes, moves and deploys.`}</p>

        <ListenerList
          query={list}
          noun="TCP listeners"
          render={(rows) =>
            rows.map((listener) => <TcpRow key={listener.id} slug={slug} listener={listener} />)
          }
        />
      </Panel>
      <ExposePort slug={slug} protocol="tcp" taken={(list.data ?? []).map((l) => l.name)} />
    </div>
  );
}

function tlsLine(listener: TcpListener) {
  return listener.tls.mode === 'terminate'
    ? `TLS terminated at the edge for ${listener.tls.hostname ?? 'an unset hostname'}`
    : 'TLS passthrough: bytes reach the app unchanged';
}

function TcpRow({ slug, listener }: { slug: string; listener: TcpListener }) {
  const confirm = useConfirm();
  const { toast } = useToast();
  const update = useUpdateTcpListener(slug);
  const remove = useDeleteTcpListener(slug);
  const [panel, setPanel] = useState<'tls' | 'cert' | null>(null);
  const busy = update.isPending || remove.isPending;

  const toggle = async () => {
    const enable = !listener.enabled;
    const ok = await confirm(
      enable
        ? {
            title: `Accept connections on public port ${listener.public_port}?`,
            description: `Anyone on the internet can open TCP connections to public port ${listener.public_port}, and they reach port ${listener.guest_port} in ${slug}. Gregale does not authenticate raw TCP: the app must.`,
            confirmLabel: 'Enable',
          }
        : {
            title: `Disable ${listener.name}?`,
            description: `The edge refuses new connections on public port ${listener.public_port}. The port stays reserved for this app, so enabling it again restores the same endpoint.`,
            confirmLabel: 'Disable',
          }
    );
    if (!ok) return;
    try {
      await update.mutateAsync({ name: listener.name, change: { enabled: enable } });
      toast({ kind: 'success', title: enable ? 'Listener enabled' : 'Listener disabled' });
    } catch (err) {
      toast(listenerFailure(err, enable ? 'Could not enable' : 'Could not disable'));
    }
  };

  const onDelete = async () => {
    if (
      !(await confirm({
        title: `Delete ${listener.name}?`,
        description: `Public port ${listener.public_port} is released: connections to it are refused, and a new listener may be given a different port.`,
        confirmLabel: 'Delete',
        destructive: true,
      }))
    )
      return;
    try {
      await remove.mutateAsync(listener.name);
      toast({ kind: 'success', title: 'Listener deleted' });
    } catch (err) {
      toast(listenerFailure(err, 'Could not delete'));
    }
  };

  return (
    <li className="flex flex-col gap-3 well rounded-xl bg-muted/40 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm">{listener.name}</span>
            <ServingBadge enabled={listener.enabled} />
          </div>
          <p className="text-xs text-muted-foreground">
            Public port <span className="font-mono">{listener.public_port}</span> → app port{' '}
            <span className="font-mono">{listener.guest_port}</span>
          </p>
          <p className="break-words text-xs text-muted-foreground">{tlsLine(listener)}</p>
          <p className="text-xs text-muted-foreground">
            Created <Timestamp value={listener.created_at} />
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void toggle()}>
            {listener.enabled ? 'Disable' : 'Enable'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            aria-expanded={panel === 'tls'}
            onClick={() => setPanel(panel === 'tls' ? null : 'tls')}
          >
            Change TLS
          </Button>
          {listener.tls.mode === 'terminate' && (
            <Button
              size="sm"
              variant="outline"
              aria-expanded={panel === 'cert'}
              onClick={() => setPanel(panel === 'cert' ? null : 'cert')}
            >
              Certificate status
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void onDelete()}
            aria-label={`Delete ${listener.name}`}
          >
            <Trash aria-hidden />
            Delete
          </Button>
        </div>
      </div>
      {panel === 'tls' && (
        <TlsEditor slug={slug} listener={listener} onDone={() => setPanel(null)} />
      )}
      {panel === 'cert' && <CertificateStatus slug={slug} name={listener.name} />}
    </li>
  );
}

/** Verified, app-wide domains of this app: the only hostnames termination accepts. */
function useTerminationHostnames(slug: string) {
  const app = useApp(slug);
  const domains = useDomains();
  const appId = app.data?.id;
  return (domains.data ?? [])
    .filter(
      (d) => appId && d.app_id === appId && d.verified && !d.environment && !d.domain.includes('*')
    )
    .map((d) => d.domain);
}

function TlsFields({
  slug,
  mode,
  hostname,
  onMode,
  onHostname,
}: {
  slug: string;
  mode: 'passthrough' | 'terminate';
  hostname: string;
  onMode: (mode: 'passthrough' | 'terminate') => void;
  onHostname: (hostname: string) => void;
}) {
  const id = useId();
  const suggestions = useTerminationHostnames(slug);
  return (
    <>
      <label className="flex flex-col gap-1.5 text-sm">
        TLS
        <Select
          value={mode}
          onChange={(e) => onMode(e.target.value as 'passthrough' | 'terminate')}
        >
          <option value="passthrough">Passthrough: the app handles TLS, or speaks plain TCP</option>
          <option value="terminate">Terminate at the edge with a certificate</option>
        </Select>
      </label>
      {mode === 'terminate' && (
        <label className="flex flex-col gap-1.5 text-sm">
          Hostname
          <input
            className={FIELD}
            list={`${id}-hosts`}
            value={hostname}
            onChange={(e) => onHostname(e.target.value)}
            placeholder="tcp.example.com"
            spellCheck={false}
            autoComplete="off"
          />
          <datalist id={`${id}-hosts`}>
            {suggestions.map((host) => (
              <option key={host} value={host} />
            ))}
          </datalist>
          <span className="text-xs text-muted-foreground">
            A verified domain of this app. Wildcards and IP addresses are refused.
          </span>
        </label>
      )}
    </>
  );
}

function TlsEditor({
  slug,
  listener,
  onDone,
}: {
  slug: string;
  listener: TcpListener;
  onDone: () => void;
}) {
  const confirm = useConfirm();
  const { toast } = useToast();
  const update = useUpdateTcpListener(slug);
  const [mode, setMode] = useState(listener.tls.mode);
  const [hostname, setHostname] = useState(listener.tls.hostname ?? '');
  const host = hostname.trim().toLowerCase();
  const unchanged =
    mode === listener.tls.mode && (mode === 'passthrough' || host === listener.tls.hostname);
  const incomplete = mode === 'terminate' && !host;

  const save = async () => {
    if (
      !(await confirm({
        title: `Change TLS on ${listener.name}?`,
        description:
          'The listener is disabled and its open connections are cancelled. Provision the certificate the new policy needs, then enable it again.',
        confirmLabel: 'Change TLS',
        destructive: true,
      }))
    )
      return;
    try {
      await update.mutateAsync({
        name: listener.name,
        change: { tls: mode === 'terminate' ? { mode, hostname: host } : { mode } },
      });
      toast({ kind: 'success', title: 'TLS changed; the listener is disabled' });
      onDone();
    } catch (err) {
      toast(listenerFailure(err, 'Could not change TLS'));
    }
  };

  return (
    <form
      className="flex flex-col gap-3 border-t border-border pt-3 sm:max-w-md"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <TlsFields
        slug={slug}
        mode={mode}
        hostname={hostname}
        onMode={setMode}
        onHostname={setHostname}
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={unchanged || incomplete || update.isPending}>
          Save TLS
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function CertificateStatus({ slug, name }: { slug: string; name: string }) {
  const read = useTcpListenerTlsStatus(slug, name);
  const data: TcpListenerTlsStatus | undefined = read.data;
  const phase = queryPhase({
    error: read.error,
    loading: read.isPending,
    isEmpty: (data?.observations.length ?? 0) === 0,
  });
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3 text-sm">
      <InlinePhase
        phase={phase}
        error={read.error}
        loadingMessage="Reading certificate reports…"
        emptyMessage="No edge has reported a certificate for this listener. That is unknown, not ready."
        onRetry={() => void read.refetch()}
      />
      {phase === 'ready' && data && (
        <ul className="flex flex-col gap-2" aria-label="Certificate reports by edge">
          {data.observations.map((o) => (
            <li key={o.edge_id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-mono text-xs">{o.edge_id}</span>
              <CertBadge status={o.status} />
              <span className="text-xs text-muted-foreground">
                Observed <Timestamp value={o.observed_at} />
                {o.not_after && (
                  <>
                    {' '}
                    · valid until <Timestamp value={o.not_after} mode="absolute" />
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        Certificate status from the edges that reported it. A minute without a report, or a changed
        TLS policy, reads as unknown; this does not prove every edge, client trust or that the app
        is listening.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * UDP
 * ------------------------------------------------------------------ */

function UdpListenersBody({ slug }: { slug: string }) {
  const list = useUdpListeners(slug);
  return (
    <div className="flex flex-col gap-5">
      <Panel title="UDP listeners">
        <p className="mb-4 text-sm leading-relaxed text-muted-foreground">{`Datagrams on a stable public port (${PUBLIC_PORT_MIN}–${PUBLIC_PORT_MAX}), forwarded to a UDP port the app declares. New listeners start disabled.`}</p>

        <ListenerList
          query={list}
          noun="UDP listeners"
          render={(rows) =>
            rows.map((listener) => <UdpRow key={listener.id} slug={slug} listener={listener} />)
          }
        />
      </Panel>
      <ExposePort slug={slug} protocol="udp" taken={(list.data ?? []).map((l) => l.name)} />
    </div>
  );
}

function UdpRow({ slug, listener }: { slug: string; listener: UdpListener }) {
  const confirm = useConfirm();
  const { toast } = useToast();
  const update = useUpdateUdpListener(slug);
  const remove = useDeleteUdpListener(slug);
  const busy = update.isPending || remove.isPending;

  const toggle = async () => {
    const enable = !listener.enabled;
    const ok = await confirm(
      enable
        ? {
            title: `Accept datagrams on public port ${listener.public_port}?`,
            description: `Anyone on the internet can send UDP datagrams to public port ${listener.public_port}, and they reach port ${listener.guest_port} in ${slug}. The app must check who is sending.`,
            confirmLabel: 'Enable',
          }
        : {
            title: `Disable ${listener.name}?`,
            description: `The edge stops accepting datagrams on public port ${listener.public_port}. The port stays reserved for this app.`,
            confirmLabel: 'Disable',
          }
    );
    if (!ok) return;
    try {
      await update.mutateAsync({ name: listener.name, enabled: enable });
      toast({ kind: 'success', title: enable ? 'Listener enabled' : 'Listener disabled' });
    } catch (err) {
      toast(listenerFailure(err, enable ? 'Could not enable' : 'Could not disable'));
    }
  };

  const onDelete = async () => {
    if (
      !(await confirm({
        title: `Delete ${listener.name}?`,
        description: `Public port ${listener.public_port} is released, and a new listener may be given a different port.`,
        confirmLabel: 'Delete',
        destructive: true,
      }))
    )
      return;
    try {
      await remove.mutateAsync(listener.name);
      toast({ kind: 'success', title: 'Listener deleted' });
    } catch (err) {
      toast(listenerFailure(err, 'Could not delete'));
    }
  };

  return (
    <li className="flex flex-col gap-3 well rounded-xl bg-muted/40 p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm">{listener.name}</span>
          <ServingBadge enabled={listener.enabled} />
        </div>
        <p className="text-xs text-muted-foreground">
          Public port <span className="font-mono">{listener.public_port}</span> → app port{' '}
          <span className="font-mono">{listener.guest_port}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          Created <Timestamp value={listener.created_at} />
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void toggle()}>
          {listener.enabled ? 'Disable' : 'Enable'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => void onDelete()}
          aria-label={`Delete ${listener.name}`}
        >
          <Trash aria-hidden />
          Delete
        </Button>
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ *
 * Create
 * ------------------------------------------------------------------ */

function ExposePort({
  slug,
  protocol,
  taken,
}: {
  slug: string;
  protocol: ListenerProtocol;
  taken: string[];
}) {
  const app = useApp(slug);
  const label = protocol.toUpperCase();
  const phase = queryPhase({ error: app.error, loading: app.isPending });
  const declared = declaredListeners(app.data?.manifest?.ports, protocol);
  const free = declared.filter((d) => !taken.includes(d.name));
  return (
    <Panel title={`Expose a ${label} port`}>
      <p className="mb-4 text-sm leading-relaxed text-muted-foreground">{`Only ports the app declares can be exposed. Declare one in the app's ports (a Compose ports entry, named ${protocol}-<port> when unnamed), then choose it here.`}</p>

      {phase !== 'ready' ? (
        <InlinePhase
          phase={phase}
          error={app.error}
          loadingMessage="Reading the app's declared ports…"
          onRetry={() => void app.refetch()}
        />
      ) : declared.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          This app declares no public {label} ports. Internal listeners never get a public port.
        </p>
      ) : free.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Every declared {label} port already has a listener.
        </p>
      ) : (
        <ExposeForm
          key={free.map((d) => d.name).join()}
          slug={slug}
          protocol={protocol}
          free={free}
        />
      )}
    </Panel>
  );
}

function ExposeForm({
  slug,
  protocol,
  free,
}: {
  slug: string;
  protocol: ListenerProtocol;
  free: { name: string; port: number }[];
}) {
  const confirm = useConfirm();
  const { toast } = useToast();
  const createTcp = useCreateTcpListener(slug);
  const createUdp = useCreateUdpListener(slug);
  const pending = createTcp.isPending || createUdp.isPending;
  const [name, setName] = useState(free[0].name);
  const [publicPort, setPublicPort] = useState('');
  const [mode, setMode] = useState<'passthrough' | 'terminate'>('passthrough');
  const [hostname, setHostname] = useState('');
  const portErrorId = useId();
  const chosen = free.find((d) => d.name === name) ?? free[0];
  const port = publicPort.trim() === '' ? undefined : Number(publicPort);
  const portError =
    port !== undefined &&
    !(Number.isInteger(port) && port >= PUBLIC_PORT_MIN && port <= PUBLIC_PORT_MAX)
      ? `A public port is a whole number from ${PUBLIC_PORT_MIN} to ${PUBLIC_PORT_MAX}.`
      : undefined;
  const host = hostname.trim().toLowerCase();
  const terminate = protocol === 'tcp' && mode === 'terminate';
  const where = port
    ? `public port ${port}`
    : `a public port Gregale picks (${PUBLIC_PORT_MIN}–${PUBLIC_PORT_MAX})`;

  const submit = async () => {
    const description =
      protocol === 'tcp'
        ? terminate
          ? `Once enabled, anyone on the internet can open TLS connections to ${where} for ${host}, and they reach port ${chosen.port} in ${slug}. It starts disabled: provision the edge certificate, then enable it.`
          : `Anyone on the internet can open TCP connections to ${where} as soon as it is created, and they reach port ${chosen.port} in ${slug}. Gregale does not authenticate raw TCP: the app must.`
        : `This reserves ${where} for port ${chosen.port} in ${slug}. It starts disabled; once enabled, anyone on the internet can send datagrams to it.`;
    if (
      !(await confirm({
        title:
          protocol === 'tcp'
            ? `Expose ${chosen.name} to the internet?`
            : `Reserve a public UDP port for ${chosen.name}?`,
        description,
        confirmLabel: protocol === 'tcp' && !terminate ? 'Expose port' : 'Create listener',
      }))
    )
      return;
    try {
      const created =
        protocol === 'tcp'
          ? await createTcp.mutateAsync({
              body: {
                name: chosen.name,
                guest_port: chosen.port,
                ...(port ? { public_port: port } : {}),
                ...(terminate ? { tls: { mode: 'terminate' as const, hostname: host } } : {}),
              },
            })
          : await createUdp.mutateAsync({
              body: {
                name: chosen.name,
                guest_port: chosen.port,
                ...(port ? { public_port: port } : {}),
              },
            });
      toast({
        kind: 'success',
        title: `${chosen.name} is on public port ${created.public_port}`,
        description: created.enabled ? undefined : 'It is disabled until you enable it.',
      });
      setPublicPort('');
    } catch (err) {
      toast(listenerFailure(err, 'Could not create the listener'));
    }
  };

  return (
    <form
      className="flex flex-col gap-4 sm:max-w-md"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label className="flex flex-col gap-1.5 text-sm">
        Declared port
        <Select value={chosen.name} onChange={(e) => setName(e.target.value)}>
          {free.map((d) => (
            <option key={d.name} value={d.name}>
              {d.name} (port {d.port})
            </option>
          ))}
        </Select>
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        Public port (optional)
        <input
          className={cn(FIELD, 'tabular-nums')}
          inputMode="numeric"
          value={publicPort}
          onChange={(e) => setPublicPort(e.target.value)}
          placeholder={`${PUBLIC_PORT_MIN}–${PUBLIC_PORT_MAX}, or empty to have one picked`}
          aria-invalid={portError ? true : undefined}
          aria-describedby={portError ? portErrorId : undefined}
        />
        {portError && (
          <span id={portErrorId} className="text-xs" style={{ color: 'var(--status-critical)' }}>
            {portError}
          </span>
        )}
      </label>
      {protocol === 'tcp' && (
        <TlsFields
          slug={slug}
          mode={mode}
          hostname={hostname}
          onMode={setMode}
          onHostname={setHostname}
        />
      )}
      <div>
        <Button type="submit" disabled={Boolean(portError) || (terminate && !host) || pending}>
          {protocol === 'tcp' ? 'Expose port' : 'Reserve port'}
        </Button>
      </div>
    </form>
  );
}
