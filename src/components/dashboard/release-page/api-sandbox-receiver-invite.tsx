import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { CopyIconButton } from '@/components/ui/copy-button';
import {
  confirmSandboxReceiver,
  readSandboxReceiverProof,
  verifySandboxReceiver,
  type APISandboxReceiverCredentials,
  type APISandboxReceiverProof,
} from '@/lib/api/api-sandboxes';
import { errorMessage } from '@/lib/api/errors';

export function SandboxReceiverInvitation({ run, token }: { run: string; token: string }) {
  const [proof, setProof] = useState<APISandboxReceiverProof>();
  const [credentials, setCredentials] = useState<APISandboxReceiverCredentials>();
  const [url, setURL] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    window.history.replaceState(
      window.history.state,
      '',
      window.location.pathname + window.location.search
    );
    const controller = new AbortController();
    void readSandboxReceiverProof(run, token, controller.signal).then(
      (result) => {
        if (!controller.signal.aborted) setProof(result);
      },
      () => {
        if (!controller.signal.aborted) {
          setError(
            'Ask the release owner for a new receiver invite if this link was used or expired.'
          );
        }
      }
    );
    return () => controller.abort();
  }, [run, token]);

  async function verify() {
    setBusy(true);
    setError(undefined);
    try {
      setCredentials(await verifySandboxReceiver(run, token, url.trim()));
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(outcomeToken: string) {
    setBusy(true);
    setError(undefined);
    try {
      await confirmSandboxReceiver(run, outcomeToken);
      setReady(true);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="console min-h-screen bg-background px-5 py-14 text-foreground">
      <div className="mx-auto grid max-w-xl gap-5 rounded-xl border border-border bg-card p-6 sm:p-8">
        <h1 className="text-2xl font-semibold">Verify your webhook receiver</h1>
        {credentials ? (
          <>
            <p className="text-sm text-muted-foreground">
              Install the signing secret in your test receiver and save the outcome token in CI.
              Save both before leaving this page.
            </p>
            <ReceiverValue label="Run signing secret" value={credentials.signing_secret} />
            <ReceiverValue label="Outcome token" value={credentials.outcome_token} />
            <p className="text-xs text-muted-foreground">
              Credentials expire{' '}
              <time dateTime={credentials.expires_at}>
                {new Date(credentials.expires_at).toLocaleString()}
              </time>
            </p>
            <p className="text-sm">
              Verify the <code>X-Faas-Webhook-Signature</code> header with HMAC-SHA256 over
              <code> timestamp.delivery_id.raw_body</code> using the run signing secret. The
              signature is a hex digest prefixed with <code>sha256=</code>.
            </p>
            <ReceiverOutcomeGuide run={run} />
            <div>
              {ready ? (
                <p role="status" className="text-sm">
                  Receiver ready. The release owner can start the run.
                </p>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  busy={busy}
                  disabled={busy}
                  onClick={() => void confirm(credentials.outcome_token)}
                >
                  Confirm receiver is ready
                </Button>
              )}
            </div>
          </>
        ) : proof ? (
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void verify();
            }}
          >
            <p className="text-sm text-muted-foreground">
              Return this proof as the plain-text body of an HTTP 200 GET from the exact HTTPS
              endpoint that will receive the test callback.
            </p>
            <ReceiverValue label="Endpoint ownership proof" value={proof.proof} />
            <label className="grid gap-1 text-sm font-medium">
              Test receiver URL
              <input
                className="rounded-md border border-input bg-background p-2 font-normal"
                type="url"
                inputMode="url"
                autoComplete="off"
                placeholder="https://test.example.com/webhooks/jobs"
                required
                value={url}
                onChange={(event) => setURL(event.target.value)}
              />
            </label>
            <div>
              <Button type="submit" size="sm" busy={busy} disabled={busy}>
                Verify endpoint
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Invite expires{' '}
              <time dateTime={proof.expires_at}>{new Date(proof.expires_at).toLocaleString()}</time>
            </p>
          </form>
        ) : !error ? (
          <p role="status" className="text-sm">
            Loading receiver invite…
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </main>
  );
}

function ReceiverValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-end gap-2">
      <label className="grid min-w-0 flex-1 gap-1 text-sm font-medium">
        {label}
        <input
          readOnly
          value={value}
          className="min-w-0 rounded-md border border-input bg-background p-2 font-mono text-xs"
          onFocus={(event) => event.currentTarget.select()}
        />
      </label>
      <CopyIconButton label={label} text={value} />
    </div>
  );
}

function ReceiverOutcomeGuide({ run }: { run: string }) {
  const baseURL = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
  const endpoint = new URL(
    `${baseURL}/v1/api-sandbox-runs/${encodeURIComponent(run)}/receiver-outcome`,
    window.location.origin
  );
  const command = [
    `curl --fail-with-body -X POST '${endpoint.href}'`,
    '  -H "Authorization: Bearer $SANDBOX_OUTCOME_TOKEN"',
    "  -H 'Content-Type: application/json'",
    '  --data "{\\"delivery_id\\":\\"$DELIVERY_ID\\",\\"applied_count\\":$APPLIED_COUNT}"',
  ].join(' \\\n');

  return (
    <section
      className="grid gap-2 border-t border-border pt-4"
      aria-label="Report the test outcome"
    >
      <p className="text-sm">
        After the second signed callback, use its <code>X-Faas-Delivery-Id</code> and count the
        business effects committed for that delivery. You have up to five minutes to submit the
        count. If Gregale is still recording the second attempt, retry shortly.
      </p>
      <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs">{command}</pre>
    </section>
  );
}
