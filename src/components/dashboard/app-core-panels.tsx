import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { FIELD as BASE_FIELD, Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { ErrorState, LoadingState, Panel, StatTile } from './primitives';
import {
  useAppSlo,
  useInvokeApp,
  useInvokeAppAsync,
  useInvocation,
  type AppSLOWindow,
} from '@/lib/api/queries';
import { errorMessage } from '@/lib/api/errors';
import { useAuth } from '@/lib/auth';
import { isPaidPlan } from '@/lib/plan';
import { PlanGate } from './plan-gate';
import { AsyncInvokeOptionsFields } from './async-invoke-options';
import { asyncInvokeExtras, NO_ASYNC_OPTIONS } from '@/lib/api/async-invocations';

const FIELD = `${BASE_FIELD} w-full`;
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
  const [asyncOptions, setAsyncOptions] = useState(NO_ASYNC_OPTIONS);
  const [output, setOutput] = useState<unknown>(null);
  const [pendingId, setPendingId] = useState('');
  const invocation = useInvocation(pendingId, true);
  // apid refuses both invoke routes on Free: invokeApp and invokeAppAsync
  // each check AsyncInvokeAllowed (faas handlers_invocations.go; limits.go
  // sets it false for Free) and answer plan_feature_gated.
  const invokeAvailable = account !== null && isPaidPlan(account.plan);

  const submit = () => {
    let body: {
      method: string;
      path: string;
      payload: Record<string, unknown>;
      headers: Record<string, unknown>;
    } & ReturnType<typeof asyncInvokeExtras>;
    try {
      body = {
        method,
        path: path.trim() || '/',
        payload: parseObject(payload, 'Payload'),
        headers: parseObject(headers, 'Headers'),
        ...(mode === 'async' ? asyncInvokeExtras(asyncOptions) : {}),
      };
    } catch (error) {
      toast({ kind: 'error', title: 'Invalid request', error: error });
      return;
    }

    setOutput(null);
    setPendingId('');
    const request = mode === 'sync' ? sync.mutateAsync : asyncInvoke.mutateAsync;
    void request({ slug, ...body })
      .then((result) => {
        if (mode === 'async') {
          setPendingId(result.id);
          setOutput({ id: result.id, status: 'queued' });
          toast({ kind: 'success', title: 'Invocation queued' });
        } else {
          setOutput(result);
        }
      })
      .catch((error: unknown) =>
        toast({ kind: 'error', title: 'Invocation failed', error: error })
      );
  };

  const pending = mode === 'async' && Boolean(pendingId) && !invocation.data;
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
              aria-pressed={mode === value}
              aria-disabled={!invokeAvailable}
              disabled={!invokeAvailable}
              onClick={() => setMode(value)}
              className={`rounded px-2.5 py-1 text-xs pressable ${
                mode === value
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
          <Textarea
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
            rows={5}
            spellCheck={false}
            className="font-mono"
          />
        </label>
        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="label-mono text-muted-foreground">Headers (optional JSON)</span>
          <Textarea
            value={headers}
            onChange={(e) => setHeaders(e.target.value)}
            rows={3}
            spellCheck={false}
            className="font-mono"
          />
        </label>
        {mode === 'async' && (
          <AsyncInvokeOptionsFields slug={slug} value={asyncOptions} onChange={setAsyncOptions} />
        )}
        <div className="flex items-center justify-between gap-3 sm:col-span-2">
          <p className="text-xs text-muted-foreground">
            {mode === 'sync'
              ? 'The request waits for the platform result and may take longer on a cold app.'
              : 'The request returns immediately; its status is polled until it reaches a terminal state.'}
          </p>
          <Button size="sm" onClick={submit} disabled={authLoading || !invokeAvailable} busy={busy}>
            Send request
          </Button>
        </div>
        {authLoading ? (
          <p className="text-xs text-muted-foreground sm:col-span-2" role="status">
            Checking plan access…
          </p>
        ) : account && !invokeAvailable ? (
          <p className="text-xs text-muted-foreground sm:col-span-2" role="status">
            Invoking from the console is available on Hobby and above. On the free plan, call the
            app at its own URL.{' '}
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
              value={
                data.wake_queue_p95_ms == null ? '—' : `${data.wake_queue_p95_ms.toFixed(1)} ms`
              }
              note={
                data.wake_queue_p95_ms == null
                  ? data.wake_queue_sample_status === 'no_sample'
                    ? 'No wake-queue samples in this window.'
                    : 'Wake-queue telemetry unavailable.'
                  : undefined
              }
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

// Moved beside the job registries, which share its editor; kept importable from here.
export { RegistryCredentialsPanel } from './registry-credentials';
