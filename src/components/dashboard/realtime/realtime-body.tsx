import { useEffect, useState, type FormEvent } from 'react';
import { Plus } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { CopyIconButton } from '@/components/ui/copy-button';
import { CopyableId } from '@/components/ui/copyable-id';
import { Input } from '@/components/ui/input';
import { OneTimeSecret } from '@/components/ui/one-time-secret';
import { Timestamp } from '@/components/ui/timestamp';
import { useToast } from '@/components/ui/toast';
import { CapabilityGate } from '@/components/dashboard/capability-gate';
import { CliCommand } from '@/components/dashboard/cli-command';
import { MaturityLabel } from '@/components/dashboard/maturity-label';
import {
  EmptyState,
  ErrorState,
  InlinePhase,
  LoadingState,
  Panel,
  StatTile,
  UnreachableState,
  queryPhase,
} from '@/components/dashboard/primitives';
import { Pill } from '@/components/dashboard/resource-table';
import { useCapability } from '@/lib/api/capabilities';
import { ApiError } from '@/lib/api/errors';
import {
  realtimeClientUrl,
  rotateRealtimeAuth,
  useDeleteRealtimeEndpoint,
  useFinalizeRealtimeAuth,
  useRealtimeEndpoints,
  useRealtimeUsage,
  type RealtimeEndpoint,
  type RealtimeUsage,
} from '@/lib/api/realtime';
import { useAuth } from '@/lib/auth';
import { cliRealtimeDrainCommand } from '@/lib/cli-commands';
import { AUTH_SHORT, EndpointForm, SecretField, type GeneratedSecret } from './endpoint-form';
import { AccessSection, PushSection, TicketsSection } from './realtime-access';
import { ChannelSection } from './realtime-channels';
import { ConnectionsSection, OccupancySection } from './realtime-live';
import { explainRealtime, explainToast, StatusTag } from './realtime-shared';

/**
 * An app's managed realtime: its endpoints, and for one endpoint who is
 * connected, how full its channels are, publishing, tickets and access.
 *
 * The tab is gated on `realtime`; each part below sits behind the catalog
 * capability whose routes it calls (faas pkg/productcap/catalog.json), since
 * capgate answers 404 for a hidden child route (pkg/apid/capgate/gate.go) and
 * `hidden_capabilities` lists children of a hidden parent too.
 */
export function RealtimeBody({ slug, appUrl }: { slug: string; appUrl?: string }) {
  const { capability } = useCapability('realtime');
  const endpoints = useRealtimeEndpoints(slug);
  const remove = useDeleteRealtimeEndpoint(slug);
  const confirm = useConfirm();
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<string>();
  const [editing, setEditing] = useState<RealtimeEndpoint | 'new' | null>(null);
  const [secrets, setSecrets] = useState<GeneratedSecret[]>([]);
  const list = endpoints.data ?? [];
  const selected = list.find((e) => e.id === selectedId) ?? list[0];
  const phase = queryPhase({
    error: endpoints.error,
    loading: endpoints.isPending,
    isEmpty: list.length === 0,
  });

  const onDelete = async (endpoint: RealtimeEndpoint) => {
    if (
      !(await confirm({
        title: `Delete endpoint ${endpointName(endpoint)}?`,
        description:
          'New handshakes are refused and every open connection closes now. Its retained history and consumer groups go with it. To keep them, disable the endpoint instead.',
        confirmLabel: 'Delete endpoint',
        destructive: true,
      }))
    )
      return;
    try {
      await remove.mutateAsync(endpoint.id);
      if (selectedId === endpoint.id) setSelectedId(undefined);
      toast({ kind: 'success', title: 'Endpoint deleted' });
    } catch (err) {
      toast({ kind: 'error', title: 'Could not delete the endpoint', ...explainToast(err) });
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <MaturityLabel capability={capability} />
        <p className="text-sm text-muted-foreground">
          Clients connect over WebSocket or SSE; your backend publishes to channels. Realtime has no
          separate charge.
        </p>
      </div>

      <UsagePanel />

      <Panel
        title="Endpoints"
        actions={
          editing === null && (
            <Button size="sm" className="gap-1.5" onClick={() => setEditing('new')}>
              <Plus className="h-3.5 w-3.5" />
              New endpoint
            </Button>
          )
        }
      >
        <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
          {'Each endpoint has its own client URL, authentication and callbacks to this app.'}
        </p>

        <div className="flex flex-col gap-4">
          {secrets.map((s, i) => (
            <OneTimeSecret
              key={`${s.title}-${i}`}
              value={s.value}
              title={s.title}
              description="Generated in your browser and saved write-only; Gregale never shows it again."
              onDismiss={() => setSecrets((all) => all.filter((x) => x !== s))}
            />
          ))}
          {editing !== null && (
            <EndpointForm
              key={editing === 'new' ? 'new' : editing.id}
              slug={slug}
              appUrl={appUrl}
              endpoint={editing === 'new' ? undefined : editing}
              onCancel={() => setEditing(null)}
              onDone={(saved, generated) => {
                setEditing(null);
                setSelectedId(saved.id);
                setSecrets(generated);
              }}
            />
          )}
          {phase === 'loading' && <LoadingState message="Loading endpoints…" />}
          {phase === 'unreachable' && <UnreachableState onRetry={() => void endpoints.refetch()} />}
          {phase === 'error' && (
            <PlanAwareError error={endpoints.error} onRetry={() => void endpoints.refetch()} />
          )}
          {phase === 'empty' && editing === null && (
            <EmptyState
              message="No realtime endpoints on this app yet."
              action={
                <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
                  Create an endpoint
                </Button>
              }
            />
          )}
          {phase === 'ready' && (
            <ul
              aria-label="Realtime endpoints"
              className="flex flex-col divide-y divide-border rounded-lg border border-border"
            >
              {list.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5">
                  <button
                    type="button"
                    aria-pressed={selected?.id === e.id}
                    onClick={() => setSelectedId(e.id)}
                    className="pressable flex min-w-0 flex-col items-start rounded-md text-left"
                  >
                    <span className="text-sm font-medium">{endpointName(e)}</span>
                    <span className="text-xs text-muted-foreground">
                      {selected?.id === e.id ? 'Shown below' : 'Show details'}
                    </span>
                  </button>
                  <StatusTag
                    tone={e.enabled ? 'good' : 'muted'}
                    label={e.enabled ? 'Enabled' : 'Disabled'}
                  />
                  <Pill label={AUTH_SHORT[e.auth_mode]} />
                  <span className="text-xs text-muted-foreground">
                    {e.max_connections > 0
                      ? `${e.max_connections.toLocaleString()} connections max`
                      : 'node default connection cap'}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    created <Timestamp value={e.created_at} />
                  </span>
                  <span className="ml-auto flex gap-1.5">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(e)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void onDelete(e)}
                      busy={remove.isPending && remove.variables === e.id}
                    >
                      Delete
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>

      {selected && (
        <EndpointDetail key={selected.id} slug={slug} endpoint={selected} appUrl={appUrl} />
      )}
    </div>
  );
}

const endpointName = (e: RealtimeEndpoint) => e.slug || e.id.slice(0, 8);

function PlanAwareError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  if (error instanceof ApiError && error.code === 'plan_realtime_not_allowed')
    return (
      <EmptyState
        message={explainRealtime(error)}
        action={
          <a className="text-sm text-brand underline" href="/dashboard/plans">
            View plans
          </a>
        }
      />
    );
  return <ErrorState error={error} onRetry={onRetry} />;
}

/** Connections open now against the plan's account-wide limit (ADR-1323). */
function UsagePanel() {
  const { account } = useAuth();
  const usage = useRealtimeUsage(account?.id ?? '');
  const data = usage.data;
  const state = data ? 'ready' : usage.isPending && account ? 'loading' : 'unavailable';
  const recorded = data ? data.hours.length > 0 : false;
  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-4 sm:grid-cols-2">
        <StatTile
          label="Open connections"
          value={data?.open_connections}
          state={state}
          note={
            data && data.connection_limit > 0
              ? `of ${data.connection_limit.toLocaleString()} your plan allows at once`
              : 'Your plan includes no realtime connections'
          }
        />
        <StatTile
          label="Peak connections, last 24 h"
          // Hours appear only where the operator records realtime usage
          // (openapi getRealtimeUsage), so none recorded is not zero.
          value={data ? (recorded ? peak(data.hours) : '—') : undefined}
          state={state}
          note={
            recorded
              ? 'Across every endpoint of your account.'
              : 'No hourly usage has been recorded for this account.'
          }
        />
      </div>
      {usage.error instanceof ApiError && usage.error.code === 'not_found' ? (
        <p className="text-xs text-muted-foreground">
          Connection usage is not reported for this account yet.
        </p>
      ) : (
        usage.error != null && (
          <InlinePhase
            phase={queryPhase({ error: usage.error })}
            error={usage.error}
            onRetry={() => void usage.refetch()}
          />
        )
      )}
    </div>
  );
}

const peak = (hours: RealtimeUsage['hours']) =>
  Math.max(0, ...hours.map((h) => h.peak_connections));

function EndpointDetail({
  slug,
  endpoint,
  appUrl,
}: {
  slug: string;
  endpoint: RealtimeEndpoint;
  appUrl?: string;
}) {
  const url = realtimeClientUrl(appUrl, endpoint.id);
  const { account } = useAuth();
  const usage = useRealtimeUsage(account?.id ?? '');
  const own = usage.data?.endpoints.filter((h) => h.endpoint_id === endpoint.id) ?? [];
  return (
    <Panel title={`Endpoint ${endpointName(endpoint)}`}>
      <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
        {'Live reads ask every realtime node now; writes here reach real clients.'}
      </p>

      <div className="flex flex-col gap-8">
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1">
            <dt className="label-mono text-muted-foreground">Client URL</dt>
            <dd className="flex min-w-0 items-start gap-2">
              {url ? (
                <>
                  <code className="min-w-0 font-mono text-xs [overflow-wrap:anywhere]">{url}</code>
                  <CopyIconButton text={url} label={`client URL ${url}`} />
                </>
              ) : (
                <span className="text-xs text-muted-foreground">
                  wss://&lt;your app host&gt;/__gregale/realtime/{endpoint.id} — this app has no
                  public host.
                </span>
              )}
            </dd>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <dt className="label-mono text-muted-foreground">Endpoint ID</dt>
            <dd>
              <CopyableId value={endpoint.id} label="endpoint ID" full />
            </dd>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <dt className="label-mono text-muted-foreground">Callbacks</dt>
            <dd className="min-w-0 font-mono text-xs [overflow-wrap:anywhere]">
              {endpoint.callback_url} · {endpoint.connect_path}, {endpoint.message_path},{' '}
              {endpoint.disconnect_path}
            </dd>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <dt className="label-mono text-muted-foreground">Allowed origins</dt>
            <dd className="min-w-0 font-mono text-xs [overflow-wrap:anywhere]">
              {endpoint.allowed_origins.length > 0
                ? endpoint.allowed_origins.join(', ')
                : 'Any (no browser subprotocol tokens)'}
            </dd>
          </div>
          {own.length > 0 && (
            <div className="flex min-w-0 flex-col gap-1">
              <dt className="label-mono text-muted-foreground">Last 24 h</dt>
              <dd className="text-xs">
                Peak {peak(own).toLocaleString()} connections ·{' '}
                {own.reduce((n, h) => n + h.delivered_messages, 0).toLocaleString()} messages
                delivered
              </dd>
            </div>
          )}
          {(endpoint.channel_rules?.length ?? 0) > 0 && (
            <div className="flex min-w-0 flex-col gap-1">
              <dt className="label-mono text-muted-foreground">Channel rules</dt>
              <dd className="flex flex-wrap gap-1.5">
                {endpoint.channel_rules?.map((r) => (
                  <Pill
                    key={r.pattern}
                    label={`${r.pattern}${r.presence ? ' · read + presence' : ' · read'}`}
                  />
                ))}
              </dd>
            </div>
          )}
        </dl>

        {endpoint.auth_mode === 'static_bearer' && (
          <TokenRotation slug={slug} endpoint={endpoint} />
        )}

        <CapabilityGate capability="realtime-connections" title="Connections">
          <div className="flex flex-col gap-3">
            <ConnectionsSection slug={slug} endpointId={endpoint.id} />
            <CliCommand
              label="Closing many connections at once (a drain) is in the CLI; start with a dry run:"
              command={cliRealtimeDrainCommand(slug, endpoint.id)}
              copyLabel={`drain command for endpoint ${endpoint.id}`}
            />
          </div>
        </CapabilityGate>
        <CapabilityGate capability="realtime-occupancy" title="Occupancy">
          <OccupancySection slug={slug} endpointId={endpoint.id} />
        </CapabilityGate>
        <CapabilityGate capability="realtime-channels" title="Channels">
          <ChannelSection slug={slug} endpointId={endpoint.id} />
        </CapabilityGate>
        <CapabilityGate capability="realtime-tickets" title="Subscription tickets">
          <TicketsSection slug={slug} endpointId={endpoint.id} />
        </CapabilityGate>
        <CapabilityGate capability="realtime-access" title="Principal access">
          <AccessSection slug={slug} endpointId={endpoint.id} authMode={endpoint.auth_mode} />
        </CapabilityGate>
        <CapabilityGate capability="realtime-push" title="Push providers">
          <PushSection slug={slug} endpointId={endpoint.id} />
        </CapabilityGate>
      </div>
    </Panel>
  );
}

/** Whether a deadline is still ahead, re-rendering once when it passes. */
function useUntil(deadline: string | null | undefined) {
  const ends = deadline ? Date.parse(deadline) : Number.NaN;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!Number.isFinite(ends)) return;
    // setTimeout overflows past ~24.8 days; the overlap is at most a day.
    const left = Math.min(Math.max(ends - Date.now() + 250, 0), 2 ** 31 - 1);
    const timer = setTimeout(() => setNow(Date.now()), left);
    return () => clearTimeout(timer);
  }, [ends]);
  return Number.isFinite(ends) && ends > now;
}

/**
 * Static bearer rotation with an overlap (faas handlers.go:748-857): the new
 * token is current at once and the old one is accepted until its deadline,
 * or until finalize refuses it — closing clients still using it (1008).
 */
function TokenRotation({ slug, endpoint }: { slug: string; endpoint: RealtimeEndpoint }) {
  const finalize = useFinalizeRealtimeAuth(slug);
  const confirm = useConfirm();
  const { toast } = useToast();
  const [token, setToken] = useState('');
  const [generated, setGenerated] = useState(false);
  const [grace, setGrace] = useState('300');
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  const [overlapUntil, setOverlapUntil] = useState<string | null | undefined>(
    endpoint.auth_token_previous_expires_at
  );
  const graceN = Number(grace);
  const graceOk = Number.isInteger(graceN) && graceN >= 0 && graceN <= 86400;
  const inOverlap = useUntil(overlapUntil);

  const rotate = async (e: FormEvent) => {
    e.preventDefault();
    if (!token || token.length > 256 || !graceOk || busy) return;
    setBusy(true);
    try {
      const out = await rotateRealtimeAuth(slug, endpoint.id, {
        new_auth_token: token,
        grace_period_seconds: graceN,
      });
      setOverlapUntil(out.previous_token_expires_at);
      if (generated) setShown(token);
      setToken('');
      toast({ kind: 'success', title: 'Client token rotated' });
    } catch (err) {
      toast({ kind: 'error', title: 'Could not rotate the token', ...explainToast(err) });
    } finally {
      setBusy(false);
    }
  };

  const onFinalize = async () => {
    if (
      !(await confirm({
        title: 'Refuse the previous token now?',
        description:
          'Clients still connected with the previous token are closed (code 1008) and must reconnect with the new one.',
        confirmLabel: 'Refuse previous token',
        destructive: true,
      }))
    )
      return;
    try {
      const out = await finalize.mutateAsync(endpoint.id);
      setOverlapUntil(out.previous_token_expires_at ?? null);
      toast({ kind: 'success', title: 'Previous token refused' });
    } catch (err) {
      toast({ kind: 'error', title: 'Could not finalize the rotation', ...explainToast(err) });
    }
  };

  return (
    <section aria-label="Client token rotation" className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">Client token rotation</h3>
      {shown && (
        <OneTimeSecret
          value={shown}
          title="New client bearer token"
          description="Generated in your browser and saved write-only; Gregale never shows it again."
          onDismiss={() => setShown(null)}
        />
      )}
      {inOverlap && overlapUntil && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <StatusTag tone="warning" label="Overlap" />
          <span>
            The previous token is accepted until <Timestamp value={overlapUntil} mode="absolute" />.
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void onFinalize()}
            busy={finalize.isPending}
          >
            Refuse it now…
          </Button>
        </div>
      )}
      <form
        onSubmit={(e) => void rotate(e)}
        className="grid gap-3 sm:grid-cols-[1fr_8rem_auto] sm:items-end"
        aria-label="Rotate the client token"
      >
        <SecretField
          id={`rotate-${endpoint.id}`}
          name="new_auth_token"
          label="New client token"
          hint="Becomes current at once; the old one keeps working for the overlap."
          value={token}
          onChange={(value, gen) => {
            setToken(value);
            setGenerated(gen);
          }}
        />
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Overlap (s)
          <Input
            value={grace}
            inputMode="numeric"
            onChange={(e) => setGrace(e.target.value.trim())}
            aria-invalid={graceOk ? undefined : true}
            className="tabular-nums"
          />
        </label>
        <Button
          type="submit"
          size="sm"
          disabled={!token || !graceOk}
          busy={busy}
          className="sm:mb-6"
        >
          Rotate
        </Button>
      </form>
    </section>
  );
}
