import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const BODY_LIMIT = 16_384;

function requestUrl(endpoint: string, path: string): string | undefined {
  try {
    const base = new URL(endpoint);
    if (base.protocol !== 'https:' || base.username || base.password) return undefined;
    if (!path.startsWith('/') || path.startsWith('//') || /[\\\s#]/.test(path)) return undefined;
    const url = new URL(path, base);
    return url.origin === base.origin ? url.href : undefined;
  } catch {
    return undefined;
  }
}

async function responsePreview(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let length = 0;
  let text = '';
  try {
    while (length < BODY_LIMIT) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      const part = value.subarray(0, BODY_LIMIT - length);
      length += part.length;
      text += decoder.decode(part, { stream: true });
    }
    return `${text}${decoder.decode()}\n… Response preview limited to 16 KB.`;
  } finally {
    void reader.cancel().catch(() => {});
  }
}

/** An explicit public-host request, separate from the platform's deployment status. */
export function FirstResponse({ endpoint }: { endpoint: string }) {
  return <RequestCheck key={endpoint} endpoint={endpoint} />;
}

function RequestCheck({ endpoint }: { endpoint: string }) {
  const pathId = useId();
  const [path, setPath] = useState(() => {
    try {
      const url = new URL(endpoint);
      return `${url.pathname}${url.search}`;
    } catch {
      return '/';
    }
  });
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ status: number; body: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  const url = requestUrl(endpoint, path);
  const successful = result !== null && result.status >= 200 && result.status < 300;

  useEffect(
    () => () => {
      active.current?.abort();
      active.current = null;
    },
    []
  );

  function changePath(value: string) {
    active.current?.abort();
    active.current = null;
    setPending(false);
    setResult(null);
    setError(null);
    setPath(value);
  }

  async function send() {
    if (!url || active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    setResult(null);
    setError(null);
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      // Do not send account cookies or follow the app to another host. Never
      // use no-cors: an opaque response cannot verify an HTTP result.
      const response = await fetch(url, {
        method: 'GET',
        credentials: 'omit',
        mode: 'cors',
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
      });
      if (response.type === 'opaque' || response.status === 0)
        throw new Error('Unreadable response');
      const body = await responsePreview(response);
      if (active.current === controller) setResult({ status: response.status, body });
    } catch {
      if (active.current === controller)
        setError(
          controller.signal.aborted
            ? 'The request timed out after 20 seconds. Your app may still be waking. Try again, open the URL, or run the request under Call it.'
            : 'The browser could not read a response. The app may restrict cross-origin access (CORS), redirect, or be unreachable. Open the URL, or run the request under Call it.'
        );
    } finally {
      window.clearTimeout(timeout);
      if (active.current === controller) {
        active.current = null;
        setPending(false);
      }
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
            Send a GET request to your public endpoint, to a read-only route such as a health check.
            It can wake your app and use compute allowance; no account cookies are sent.
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
                aria-invalid={!url || undefined}
              />
            </div>
            <Button type="submit" variant="cta" busy={pending} disabled={!url}>
              Send GET request
            </Button>
          </div>
          {!url && (
            <p role="alert" className="text-[13px] text-destructive">
              Use an HTTPS app endpoint and a path starting with a single /.
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
          {result && (
            <div className="flex flex-col gap-2 px-4 py-3">
              <p
                className={successful ? 'text-sm text-status-good' : 'text-sm text-status-warning'}
              >
                HTTP {result.status}
                {successful
                  ? ' · Public endpoint responded successfully.'
                  : ' · The endpoint responded, but this route did not return a successful status. Check the path and app logs.'}
              </p>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 font-mono text-xs">
                {result.body || '(Empty response body)'}
              </pre>
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
