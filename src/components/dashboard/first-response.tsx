import { useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useInvokeApp } from '@/lib/api/queries';
import { useAuth } from '@/lib/auth';
import { isPaidPlan } from '@/lib/plan';

const BODY_LIMIT = 16_384;

type Outcome = { status: string; body: string; error?: string };

function validPath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//') && !/[\\\s#]/.test(path);
}

function publicUrl(endpoint: string, path: string): string | undefined {
  try {
    const base = new URL(endpoint);
    if (base.protocol !== 'https:' || base.username || base.password) return undefined;
    if (!validPath(path)) return undefined;
    const url = new URL(path, base);
    return url.origin === base.origin ? url.href : undefined;
  } catch {
    return undefined;
  }
}

// The platform stores a JSON body as-is and any other body as a JSON string.
function preview(result: unknown): string {
  if (result === undefined || result === null) return '';
  let text: string;
  try {
    text = typeof result === 'string' ? result : (JSON.stringify(result, null, 2) ?? '');
  } catch {
    text = String(result);
  }
  return text.length > BODY_LIMIT
    ? `${text.slice(0, BODY_LIMIT)}\n… Response preview limited to 16 KB.`
    : text;
}

function failureMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'long_poll_timeout')
      return 'Your app did not answer within the wait, and the request keeps running. It may still be waking. Try again shortly, or see it under Invocations.';
    if (error.code === 'plan_feature_gated')
      return 'Sending requests from the console needs a paid plan. Open the request URL instead, or run the request under Call it.';
  }
  return errorMessage(error);
}

/**
 * An explicit GET sent through the platform's invoke API, separate from the
 * deployment status. The console's content policy keeps the browser off the
 * app's own host, so the public URL is offered as a link instead.
 */
export function FirstResponse({ slug, endpoint }: { slug: string; endpoint: string }) {
  return <RequestCheck key={`${slug} ${endpoint}`} slug={slug} endpoint={endpoint} />;
}

function RequestCheck({ slug, endpoint }: { slug: string; endpoint: string }) {
  const pathId = useId();
  const { account } = useAuth();
  const invoke = useInvokeApp();
  const [path, setPath] = useState(() => {
    try {
      const url = new URL(endpoint);
      return `${url.pathname}${url.search}`;
    } catch {
      return '/';
    }
  });
  const attempt = useRef(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Free plans cannot invoke synchronously; an unresolved account still tries.
  const canSend = account === null || isPaidPlan(account.plan);
  const valid = validPath(path);
  const url = publicUrl(endpoint, path);
  const pending = invoke.isPending;
  const successful = outcome?.status === 'completed';

  function changePath(value: string) {
    // A reply to an earlier path must not land on this one.
    attempt.current += 1;
    setOutcome(null);
    setError(null);
    setPath(value);
  }

  async function send() {
    if (!valid || pending) return;
    const current = ++attempt.current;
    setOutcome(null);
    setError(null);
    try {
      const response = await invoke.mutateAsync({ slug, method: 'GET', path });
      if (attempt.current === current)
        setOutcome({
          status: response.status,
          body: preview(response.result),
          error: response.error,
        });
    } catch (cause) {
      if (attempt.current === current) setError(failureMessage(cause));
    }
  }

  return (
    <section aria-labelledby={`${pathId}-title`} className="flex flex-col gap-3">
      <h2 id={`${pathId}-title`} className="text-sm font-medium text-muted-foreground">
        {successful ? 'First response received' : 'Verify your API'}
      </h2>
      <div className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
          className="flex flex-col gap-3 px-4 py-4"
        >
          <p className="text-[13px] leading-5 text-muted-foreground">
            {canSend
              ? 'Send a GET request through the platform to a read-only route, such as a health check. It reaches your app the way an invocation does rather than over its public URL, and can wake it and use compute allowance.'
              : 'Sending a request from the console needs a paid plan. Open the request URL to see your app answer, or run the request under Call it.'}
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex min-w-0 flex-1 basis-48 flex-col gap-1.5">
              <label htmlFor={pathId} className="text-sm font-medium">
                Request path
              </label>
              <Input
                id={pathId}
                value={path}
                onChange={(event) => changePath(event.target.value)}
                maxLength={2048}
                spellCheck={false}
                className="font-mono"
                aria-invalid={!valid || undefined}
              />
            </div>
            {canSend && (
              <Button type="submit" variant="cta" busy={pending} disabled={!valid}>
                Send GET request
              </Button>
            )}
          </div>
          {!valid && (
            <p role="alert" className="text-[13px] text-destructive">
              Use a path starting with a single /.
            </p>
          )}
        </form>
        <div aria-live="polite" aria-atomic="true" className="empty:hidden">
          {pending && (
            <p className="px-4 py-3 text-[13px] text-muted-foreground">
              Waiting for your app to respond…
            </p>
          )}
          {error && (
            <p role="alert" className="px-4 py-3 text-[13px] text-muted-foreground">
              {error}
            </p>
          )}
          {outcome && (
            <div className="flex flex-col gap-2 px-4 py-3">
              <p
                className={successful ? 'text-sm text-status-good' : 'text-sm text-status-warning'}
              >
                {successful
                  ? 'Your app responded successfully.'
                  : `The request ${outcome.status === 'failed' ? 'failed' : `ended ${outcome.status}`}${outcome.error ? `: ${outcome.error}` : '.'} Check the path and app logs.`}
              </p>
              {(successful || outcome.body) && (
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 font-mono text-xs">
                  {outcome.body || '(Empty response body)'}
                </pre>
              )}
            </div>
          )}
        </div>
        {url && (
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="min-w-0 truncate font-mono text-[13px] text-muted-foreground">
              {url}
            </span>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 text-[13px] text-brand underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-brand"
            >
              Open request URL
            </a>
          </div>
        )}
      </div>
    </section>
  );
}
