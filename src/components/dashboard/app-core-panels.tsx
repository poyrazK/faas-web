import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { ErrorState, LoadingState, Panel, StatTile } from './primitives';
import {
  useAppRegistryCredentials,
  useAppSlo,
  useDeleteAppRegistryCredential,
  useInvokeApp,
  useInvokeAppAsync,
  useInvocation,
  useSetAppRegistryCredential,
  type AppSLOWindow,
} from '@/lib/api/queries';
import { errorMessage } from '@/lib/api/errors';
import { useAuth } from '@/lib/auth';
import { isPaidPlan } from '@/lib/plan';
import { PlanGate } from './plan-gate';

const FIELD =
  'h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand/50';
const CODE_FIELD = `${FIELD} font-mono`;

function parseObject(value: string, label: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function pretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? 'null';
  } catch {
    return String(value);
  }
}

/** A small request console for the customer-facing invoke path. */
export function InvokePanel({ slug }: { slug: string }) {
  const { toast } = useToast();
  const { account, loading: authLoading } = useAuth();
  const sync = useInvokeApp();
  const asyncInvoke = useInvokeAppAsync();
  const [mode, setMode] = useState<'sync' | 'async'>('sync');
  const [method, setMethod] = useState('POST');
  const [path, setPath] = useState('/');
  const [payload, setPayload] = useState('{}');
  const [headers, setHeaders] = useState('{}');
  const [output, setOutput] = useState<unknown>(null);
  const [pendingId, setPendingId] = useState('');
  const invocation = useInvocation(pendingId, true);
  const syncAvailable = account !== null && isPaidPlan(account.plan);
  // Keep the in-memory choice harmless if the account resolves as Free after
  // the panel mounted: the displayed and submitted mode becomes async
  // without a state-setting effect or a paid-only request.
  const effectiveMode = syncAvailable ? mode : 'async';

  const submit = () => {
    let body: {
      method: string;
      path: string;
      payload: Record<string, unknown>;
      headers: Record<string, unknown>;
    };
    try {
      body = {
        method,
        path: path.trim() || '/',
        payload: parseObject(payload, 'Payload'),
        headers: parseObject(headers, 'Headers'),
      };
    } catch (error) {
      toast({ kind: 'error', title: 'Invalid request', description: errorMessage(error) });
      return;
    }

    setOutput(null);
    setPendingId('');
    const request = effectiveMode === 'sync' ? sync.mutateAsync : asyncInvoke.mutateAsync;
    void request({ slug, ...body })
      .then((result) => {
        if (effectiveMode === 'async') {
          setPendingId(result.id);
          setOutput({ id: result.id, status: 'queued' });
          toast({ kind: 'success', title: 'Invocation queued' });
        } else {
          setOutput(result);
        }
      })
      .catch((error: unknown) =>
        toast({ kind: 'error', title: 'Invocation failed', description: errorMessage(error) })
      );
  };

  const pending = effectiveMode === 'async' && Boolean(pendingId) && !invocation.data;
  const busy = sync.isPending || asyncInvoke.isPending;

  return (
    <Panel
      lit
      title="Invoke"
      description="Send a request to this app without leaving the dashboard. Async requests can be followed here after they are queued."
      actions={
        <div className="flex rounded-md border border-border p-0.5" role="group" aria-label="Mode">
          {(['sync', 'async'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={effectiveMode === value}
              aria-disabled={value === 'sync' && !syncAvailable}
              disabled={value === 'sync' && !syncAvailable}
              onClick={() => setMode(value)}
              className={`rounded px-2.5 py-1 text-xs transition-colors ${
                effectiveMode === value
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {value === 'sync' ? 'Wait for result' : 'Async'}
            </button>
          ))}
        </div>
      }
    >
      <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
        <label className="flex flex-col gap-1.5">
          <span className="label-mono text-muted-foreground">Method</span>
          <select value={method} onChange={(e) => setMethod(e.target.value)} className={FIELD}>
            {['POST', 'GET', 'PUT', 'PATCH', 'DELETE'].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label-mono text-muted-foreground">Path</span>
          <input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/"
            spellCheck={false}
            className={CODE_FIELD}
          />
        </label>
        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="label-mono text-muted-foreground">JSON payload</span>
          <textarea
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
            rows={5}
            spellCheck={false}
            className="rounded-md border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-brand/50"
          />
        </label>
        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="label-mono text-muted-foreground">Headers (optional JSON)</span>
          <textarea
            value={headers}
            onChange={(e) => setHeaders(e.target.value)}
            rows={3}
            spellCheck={false}
            className="rounded-md border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-brand/50"
          />
        </label>
        <div className="flex items-center justify-between gap-3 sm:col-span-2">
          <p className="text-xs text-muted-foreground">
            {effectiveMode === 'sync'
              ? 'The request waits for the platform result and may take longer on a cold app.'
              : 'The request returns immediately; its status is polled until it reaches a terminal state.'}
          </p>
          <Button size="sm" onClick={submit} disabled={busy || authLoading}>
            {busy ? 'Sending…' : 'Send request'}
          </Button>
        </div>
        {authLoading ? (
          <p className="text-xs text-muted-foreground sm:col-span-2" role="status">
            Checking plan access…
          </p>
        ) : account && !syncAvailable ? (
          <p className="text-xs text-muted-foreground sm:col-span-2" role="status">
            Synchronous invocation is available on Hobby and above. Async invocation remains
            available on the free plan.{' '}
            <Link to="/dashboard/plans" className="text-brand hover:underline">
              Compare plans
            </Link>
          </p>
        ) : null}
      </div>

      {(output !== null || pendingId) && (
        <div className="mt-5 border-t border-border pt-4">
          <p className="label-mono mb-2 text-muted-foreground">Response</p>
          {invocation.error ? (
            <p className="text-sm text-muted-foreground">{errorMessage(invocation.error)}</p>
          ) : pending ? (
            <p className="text-sm text-muted-foreground">Waiting for the invocation to finish…</p>
          ) : (
            <pre className="max-h-72 overflow-auto rounded-md border border-border bg-background p-3 font-mono text-xs leading-relaxed">
              {pretty(invocation.data ?? output)}
            </pre>
          )}
        </div>
      )}
    </Panel>
  );
}

const SLO_WINDOWS: AppSLOWindow[] = ['1h', '24h', '7d'];

export function SloPanel({ slug }: { slug: string }) {
  const { account, loading: authLoading } = useAuth();
  const [window, setWindow] = useState<AppSLOWindow>('24h');
  const paidAccess = account !== null && isPaidPlan(account.plan);
  const slo = useAppSlo(slug, window, { enabled: paidAccess });
  const data = slo.data;
  const degraded = Boolean(data && data.source !== 'prometheus');
  const tileState = degraded ? ('unavailable' as const) : ('ready' as const);

  return (
    <Panel
      title="Service level"
      description="Customer-facing SLO signals over a fixed window. The source label calls out degraded telemetry instead of hiding it."
      actions={
        <select
          value={window}
          onChange={(e) => setWindow(e.target.value as AppSLOWindow)}
          disabled={!paidAccess}
          className="h-8 rounded-md border border-border bg-background px-2 font-mono text-xs outline-none focus:border-brand/50"
          aria-label="SLO window"
        >
          {SLO_WINDOWS.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      }
    >
      {authLoading ? (
        <LoadingState message="Checking plan access…" />
      ) : account === null || !paidAccess ? (
        <PlanGate
          feature="Service-level metrics"
          description="Per-app SLOs include request, error, cold-boot, wake-queue, and latency signals for paid plans."
        />
      ) : slo.error ? (
        <ErrorState error={slo.error} onRetry={() => void slo.refetch()} />
      ) : slo.isPending || !data ? (
        <LoadingState message="Reading service level…" />
      ) : (
        <div className="flex flex-col gap-4">
          {degraded && (
            <p className="text-xs text-muted-foreground" role="status">
              Telemetry source: <span className="font-mono">{data.source}</span>
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="Requests"
              value={data.requests_total.toLocaleString()}
              state={tileState}
            />
            <StatTile
              label="Error rate"
              value={data.error_rate_pct.toFixed(2)}
              unit="%"
              deltaGood={false}
              state={tileState}
            />
            <StatTile
              label="Cold boots"
              value={data.cold_boot_rate_pct.toFixed(2)}
              unit="%"
              state={tileState}
            />
            <StatTile
              label="Wake queue p95"
              value={`${data.wake_queue_p95_ms.toFixed(1)} ms`}
              state={tileState}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatTile
              label="Latency p50"
              value={`${data.request_duration.p50_ms.toFixed(1)} ms`}
              state={tileState}
            />
            <StatTile
              label="Latency p95"
              value={`${data.request_duration.p95_ms.toFixed(1)} ms`}
              state={tileState}
            />
            <StatTile
              label="Latency p99"
              value={`${data.request_duration.p99_ms.toFixed(1)} ms`}
              state={tileState}
            />
          </div>
        </div>
      )}
    </Panel>
  );
}

function date(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleDateString();
}

export function RegistryCredentialsPanel({ slug }: { slug: string }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const credentials = useAppRegistryCredentials(slug);
  const setCredential = useSetAppRegistryCredential(slug);
  const deleteCredential = useDeleteAppRegistryCredential(slug);
  const [registry, setRegistry] = useState('https://');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const save = () => {
    void setCredential
      .mutateAsync({ registry: registry.trim(), username: username.trim(), password })
      .then(() => {
        setPassword('');
        toast({ kind: 'success', title: 'Registry credential saved' });
      })
      .catch((error: unknown) =>
        toast({
          kind: 'error',
          title: 'Could not save credential',
          description: errorMessage(error),
        })
      );
  };

  return (
    <Panel
      title="Private registries"
      description="Credentials are sealed by the control plane and never returned to the browser after saving."
    >
      <div className="flex flex-col gap-5">
        <form
          className="grid gap-3 sm:grid-cols-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (registry.trim() && username.trim() && password && !setCredential.isPending) save();
          }}
        >
          <label className="flex flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">Registry URL</span>
            <input
              value={registry}
              onChange={(e) => setRegistry(e.target.value)}
              placeholder="https://registry.example.com"
              spellCheck={false}
              className={CODE_FIELD}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">Username</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              className={FIELD}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              className={FIELD}
            />
          </label>
          <div className="flex items-center justify-between gap-3 sm:col-span-3">
            <p className="text-xs text-muted-foreground">Use an explicit https:// registry URL.</p>
            <Button
              size="sm"
              type="submit"
              disabled={
                !registry.trim() || !username.trim() || !password || setCredential.isPending
              }
            >
              {setCredential.isPending ? 'Saving…' : 'Save credential'}
            </Button>
          </div>
        </form>

        {credentials.error ? (
          <p className="text-sm text-muted-foreground">{errorMessage(credentials.error)}</p>
        ) : credentials.isPending ? (
          <p className="text-sm text-muted-foreground">Reading credentials…</p>
        ) : (credentials.data?.credentials.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">
            No private registry credentials configured.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border border-t border-border">
            {credentials.data?.credentials.map((credential) => (
              <li key={credential.registry} className="flex flex-wrap items-center gap-3 py-3">
                <span className="min-w-0 flex-1 font-mono text-xs">{credential.registry}</span>
                <span className="text-xs text-muted-foreground">
                  {credential.username} · saved {date(credential.updated_at)}
                </span>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={deleteCredential.isPending}
                  onClick={async () => {
                    if (
                      !(await confirm({
                        title: `Remove ${credential.registry}?`,
                        description:
                          'Future private-image pulls will no longer have these credentials.',
                        confirmLabel: 'Remove credential',
                        destructive: true,
                      }))
                    )
                      return;
                    void deleteCredential
                      .mutateAsync(credential.registry)
                      .then(() => toast({ kind: 'success', title: 'Registry credential removed' }))
                      .catch((error: unknown) =>
                        toast({
                          kind: 'error',
                          title: 'Could not remove credential',
                          description: errorMessage(error),
                        })
                      );
                  }}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
