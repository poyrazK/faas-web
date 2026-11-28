import { useEffect, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { useCopy } from '@/components/ui/copy-button';
import {
  isSandboxPartnerInvite,
  readSandboxInvite,
  readSharedSandboxRun,
  redeemSandboxPartnerInvite,
  type APISandbox,
  type APISandboxRunReport,
} from '@/lib/api/api-sandboxes';
import { errorMessage } from '@/lib/api/errors';
import { SandboxReceiverInvitation } from '@/components/dashboard/release-page/api-sandbox-receiver-invite';
import { pageHead } from '@/lib/seo';
import { sandboxExampleCommand } from '@/lib/api/sandbox-example';
import {
  SandboxRunReportDetails,
  sandboxRunStatus,
} from '@/components/dashboard/release-page/api-sandbox-run-report';

export const Route = createFileRoute('/api-sandbox/$sandboxId')({
  head: () => ({
    meta: [
      ...pageHead({ title: 'API sandbox' }).meta,
      { name: 'robots', content: 'noindex, nofollow' },
      { name: 'referrer', content: 'no-referrer' },
    ],
  }),
  component: SandboxRoute,
});

function SandboxRoute() {
  const { sandboxId } = Route.useParams();
  return <SandboxEntry key={sandboxId} sandboxId={sandboxId} />;
}

function SandboxEntry({ sandboxId }: { sandboxId: string }) {
  const [token] = useState(() =>
    typeof window === 'undefined' ? '' : window.location.hash.slice(1)
  );
  if (token.startsWith('sbx_winv_')) {
    return <SandboxReceiverInvitation run={sandboxId} token={token} />;
  }
  return token.startsWith('sbx_run_') ? (
    <SharedRunReport id={sandboxId} token={token} />
  ) : (
    <SandboxInvitation sandboxId={sandboxId} token={token} />
  );
}

function SandboxInvitation({ sandboxId, token }: { sandboxId: string; token: string }) {
  const partnerInvite = isSandboxPartnerInvite(token);
  const [accessKey, setAccessKey] = useState(partnerInvite ? '' : token);
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string>();
  const [sandbox, setSandbox] = useState<APISandbox>();
  const [unavailable, setUnavailable] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const clipboard = useCopy();

  useEffect(() => {
    if (!token) return;
    window.history.replaceState(
      window.history.state,
      '',
      window.location.pathname + window.location.search
    );
    if (partnerInvite) return;
    const controller = new AbortController();
    void readSandboxInvite(sandboxId, token, controller.signal).then(
      (receipt) => {
        if (!controller.signal.aborted) setSandbox(receipt);
      },
      () => {
        if (!controller.signal.aborted) setUnavailable(true);
      }
    );
    return () => controller.abort();
  }, [sandboxId, token, partnerInvite]);

  async function acceptInvite() {
    setAccepting(true);
    setAcceptError(undefined);
    try {
      const result = await redeemSandboxPartnerInvite(sandboxId, token);
      setAccessKey(result.token);
      setSandbox(result.sandbox);
    } catch (error) {
      setAcceptError(errorMessage(error));
    } finally {
      setAccepting(false);
    }
  }

  return (
    <main className="console min-h-screen bg-background px-5 py-14 text-foreground">
      <div className="mx-auto flex max-w-xl flex-col gap-5 rounded-xl border border-border bg-card p-6 sm:p-8">
        <h1 className="text-2xl font-semibold">API sandbox</h1>
        {sandbox ? (
          <>
            <p className="text-sm text-muted-foreground">
              Expires{' '}
              <time dateTime={sandbox.expires_at}>
                {new Date(sandbox.expires_at).toLocaleString()}
              </time>
            </p>
            <dl className="grid gap-3 text-sm">
              <div>
                <dt className="font-medium">Base URL</dt>
                <dd className="break-all font-mono text-muted-foreground">{sandbox.url}</dd>
              </div>
              <div>
                <dt className="font-medium">Source release</dt>
                <dd className="break-all font-mono text-muted-foreground">
                  {sandbox.source_deployment_id}
                </dd>
              </div>
            </dl>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                onClick={async () => {
                  if (!(await clipboard.copy(accessKey))) setShowKey(true);
                }}
              >
                {clipboard.copied ? 'Copied' : 'Copy sandbox key'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setShowKey(!showKey)}
              >
                {showKey ? 'Hide key' : 'Show key'}
              </Button>
            </div>
            {partnerInvite ? (
              <p className="text-sm text-muted-foreground">
                Save this key before closing the page. It expires with the sandbox.
              </p>
            ) : null}
            {showKey ? (
              <input
                className="rounded-md border border-input bg-background p-2 font-mono text-xs"
                aria-label="Sandbox bearer key"
                readOnly
                value={accessKey}
                onFocus={(event) => event.currentTarget.select()}
              />
            ) : null}
            {!sandbox.partner_step_count ? (
              <section className="grid gap-2" aria-label="First API request">
                <p className="text-sm">
                  Set the copied key as `SANDBOX_KEY` to download the OpenAPI spec.
                </p>
                <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs">
                  {`curl --fail-with-body \\\n  -H "Authorization: Bearer $SANDBOX_KEY" \\\n  '${sandbox.openapi_url}'`}
                </pre>
              </section>
            ) : null}
            {sandbox.scenario ? (
              <ScenarioGuide
                scenario={sandbox.scenario}
                baseURL={sandbox.url}
                partnerStepCount={sandbox.partner_step_count}
              />
            ) : null}
          </>
        ) : partnerInvite ? (
          <div className="grid gap-3">
            <p className="text-sm text-muted-foreground">
              Accept this one-time invitation to get your sandbox key and scenario guide.
            </p>
            <div>
              <Button type="button" size="sm" busy={accepting} onClick={acceptInvite}>
                Accept invite
              </Button>
            </div>
            {acceptError ? (
              <p role="alert" className="text-sm text-destructive">
                {acceptError}
              </p>
            ) : null}
          </div>
        ) : !token || unavailable ? (
          <p role="alert" className="text-sm text-muted-foreground">
            Open the original invitation link. If it has expired, ask the owner for a new sandbox.
          </p>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            Checking your invitation…
          </p>
        )}
      </div>
    </main>
  );
}

function ScenarioGuide({
  scenario,
  baseURL,
  partnerStepCount,
}: {
  scenario: NonNullable<APISandbox['scenario']>;
  baseURL: string;
  partnerStepCount?: number;
}) {
  const ids = Object.entries(scenario.seeded_ids ?? {});
  return (
    <section className="grid gap-3 border-t border-border pt-4">
      <h2 className="text-lg font-medium">{scenario.name}</h2>
      {partnerStepCount ? (
        <p className="text-sm text-muted-foreground">
          Send these requests in order from your client and wait for each response. Gregale will
          check the final state after the last request passes.
        </p>
      ) : null}
      {ids.length > 0 ? (
        <>
          <h3 className="text-sm font-medium">Seeded IDs</h3>
          <dl className="grid gap-2 text-sm">
            {ids.map(([label, id]) => (
              <div key={label} className="flex flex-wrap gap-x-2">
                <dt>{label}</dt>
                <dd className="break-all font-mono text-muted-foreground">{id}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : null}
      <ol className="grid list-decimal gap-4 pl-5">
        {scenario.requests
          .slice(0, partnerStepCount ?? scenario.requests.length)
          .map((request, index) => (
            <li key={index} className="min-w-0 space-y-1">
              <h3 className="text-sm font-medium">{request.title}</h3>
              <p className="text-xs text-muted-foreground">
                Expected HTTP {request.expected_status}
              </p>
              <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs">
                {sandboxExampleCommand(baseURL, request)}
              </pre>
            </li>
          ))}
      </ol>
    </section>
  );
}

function SharedRunReport({ id, token }: { id: string; token: string }) {
  const [run, setRun] = useState<APISandboxRunReport>();
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    window.history.replaceState(
      window.history.state,
      '',
      window.location.pathname + window.location.search
    );
    const controller = new AbortController();
    void readSharedSandboxRun(id, token, controller.signal).then(
      (report) => {
        if (!controller.signal.aborted) setRun(report);
      },
      () => {
        if (!controller.signal.aborted) setUnavailable(true);
      }
    );
    return () => controller.abort();
  }, [id, token]);

  return (
    <main className="console min-h-screen bg-background px-5 py-14 text-foreground">
      <div className="mx-auto grid max-w-xl gap-5 rounded-xl border border-border bg-card p-6 sm:p-8">
        <h1 className="text-2xl font-semibold">Scenario run report</h1>
        {run ? (
          <>
            <div>
              <h2 className="text-lg font-medium">{run.scenario_name}</h2>
              <p className="text-sm text-muted-foreground">{sandboxRunStatus[run.status]}</p>
              <p className="break-all text-xs text-muted-foreground">
                Source release <code>{run.source_deployment_id}</code>
              </p>
            </div>
            <SandboxRunReportDetails run={run} />
          </>
        ) : unavailable ? (
          <p role="alert">
            The report link is unavailable. Ask the release owner for an active link.
          </p>
        ) : (
          <p role="status">Loading scenario report…</p>
        )}
      </div>
    </main>
  );
}
