import { Button } from '@/components/ui/button';
import { FIELD as BASE_FIELD, Select, Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { asyncInvokeExtras, NO_ASYNC_OPTIONS } from '@/lib/api/async-invocations';
import { errorMessage } from '@/lib/api/errors';
import { useInvocation, useInvokeApp, useInvokeAppAsync } from '@/lib/api/queries';
import { useAuth } from '@/lib/auth';
import { isPaidPlan } from '@/lib/plan';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { AsyncInvokeOptionsFields } from './async-invoke-options';
import { Panel } from './primitives';

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
      title="Invoke"
      help="Sync waits for the result and takes longer on a cold app. Async returns at once and is followed here."
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
          <Select value={method} onChange={(e) => setMethod(e.target.value)} className={FIELD}>
            {['POST', 'GET', 'PUT', 'PATCH', 'DELETE'].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </Select>
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
        <div className="flex items-center justify-end gap-3 sm:col-span-2">
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

// Moved beside the job registries, which share its editor; kept importable from here.
export { RegistryCredentialsPanel } from './registry-credentials';
