import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CopyIconButton } from '@/components/ui/copy-button';
import { errorMessage } from '@/lib/api/errors';
import type { App } from '@/lib/api/queries';
import {
  appAccess,
  canVerifyHTTP,
  checkDeploymentResponse,
  validResponsePath,
  type ResponseCheck,
  type ResponseDeployment,
} from '@/lib/api/deployment-response';
import { publicAppUrl } from '@/lib/app-url';

type Props = {
  slug: string;
  endpoint?: string | null;
  app?: App;
  deployment: ResponseDeployment;
  onPublicOpen?: () => void;
};

export function FirstResponse(props: Props) {
  if (!canVerifyHTTP(props.app))
    return (
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Check workload activity</h2>
        <p className="text-sm text-muted-foreground">
          This workload does not serve HTTP. Inspect its runtime logs to check its activity.
        </p>
        <code className="break-all text-xs">gregale logs {props.slug} --follow</code>
      </section>
    );
  return (
    <RequestCheck
      key={`${props.slug} ${props.deployment.id} ${props.deployment.scope || 'default'}`}
      {...props}
    />
  );
}

function RequestCheck({ slug, endpoint, app, deployment, onPublicOpen }: Props) {
  const pathId = useId();
  const [path, setPath] = useState('/');
  const [outcome, setOutcome] = useState<ResponseCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const valid = validResponsePath(path);
  const access = appAccess(app);
  const successful = Boolean(outcome && outcome.http_status >= 200 && outcome.http_status < 300);
  const base =
    access === 'public' && (!deployment.scope || deployment.scope === 'default')
      ? publicAppUrl(endpoint)
      : undefined;
  const url = valid && base ? new URL(path, base).href : undefined;
  const named = Boolean(deployment.scope && deployment.scope !== 'default');
  const command =
    `gregale release verify ${deployment.id} --app ${slug} --path '${path.replaceAll("'", "'\\''")}'` +
    (named && outcome
      ? ` --project-id ${outcome.project_id} --environment-id ${outcome.environment_id}`
      : '');

  function changePath(value: string) {
    controller.current?.abort();
    controller.current = null;
    setPending(false);
    setOutcome(null);
    setError(null);
    setPath(value);
  }

  async function send() {
    if (!valid || controller.current) return;
    const current = new AbortController();
    controller.current = current;
    setPending(true);
    setOutcome(null);
    setError(null);
    try {
      const result = await checkDeploymentResponse(slug, deployment, path, current.signal);
      if (!current.signal.aborted) setOutcome(result);
    } catch (cause) {
      if (!current.signal.aborted) setError(errorMessage(cause));
    } finally {
      if (controller.current === current) {
        controller.current = null;
        setPending(false);
      }
    }
  }

  return (
    <section aria-labelledby={`${pathId}-title`} className="flex flex-col gap-3">
      <h2 id={`${pathId}-title`} className="text-sm font-medium text-muted-foreground">
        {successful ? 'Application response verified' : 'Verify application response'}
      </h2>
      <div className="flex flex-col divide-y divide-border surface rounded-[1.25rem] bg-card">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
          className="flex flex-col gap-3 px-4 py-4"
        >
          <p className="text-[13px] leading-5 text-muted-foreground">
            Deployment ready. Send an authenticated GET to this exact deployment using your Gregale
            account. Available on every plan; the check can wake the app and use compute allowance.
            Choose an application route such as /. A public /healthz can answer from Gregale’s edge.
          </p>
          <p className="text-[13px] leading-5 text-muted-foreground">
            {access === 'private'
              ? 'Private endpoint: opening its URL may return 401 or 403 unless its access requirements are met. Verify it here without making it public.'
              : access === 'internal'
                ? 'Internal app: test it here using your account. It has no public endpoint.'
                : access === 'public'
                  ? 'Public access is configured. Opening its URL is a separate public access test.'
                  : 'App access has not been confirmed. A browser URL alone does not establish public access.'}{' '}
            Account credentials stay with Gregale. Application-owned authentication still applies.
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
            <Button type="submit" variant="cta" busy={pending} disabled={!valid}>
              Verify response
            </Button>
          </div>
          {!valid && (
            <p role="alert" className="text-[13px] text-destructive">
              Use an app-relative path starting with a single /, without spaces or a fragment.
            </p>
          )}
        </form>
        <div aria-live="polite" aria-atomic="true" className="empty:hidden">
          {pending && (
            <p className="px-4 py-3 text-[13px] text-muted-foreground">
              Waiting for this deployment to respond…
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
                GET {path} → HTTP {outcome.http_status} ·{' '}
                {successful ? 'Application response verified' : 'Application response not verified'}
              </p>
              <p className="text-xs text-muted-foreground">
                Deployment {outcome.deployment_id} · {outcome.scope} · owner-authorized check.
                Public access has not been verified.
              </p>
              {!successful && (
                <p className="text-sm text-muted-foreground">
                  {outcome.http_status === 401 || outcome.http_status === 403
                    ? 'The application denied this request. Check its own authentication or choose a route it permits.'
                    : 'Check this route and the deployment logs, then retry the check.'}
                </p>
              )}
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 font-mono text-xs">
                {outcome.body || '(Empty response body)'}
              </pre>
              {outcome.body_truncated && (
                <p className="text-xs text-muted-foreground">Response preview shortened to 4 KB.</p>
              )}
            </div>
          )}
        </div>
        {valid && (!named || outcome) && (
          <div className="flex items-center gap-2 px-4 py-3">
            <code className="min-w-0 flex-1 break-all text-xs">{command}</code>
            <CopyIconButton text={command} label="Verification command" />
          </div>
        )}
        {url && (
          <div className="flex flex-col gap-2 px-4 py-3">
            <a
              href={url}
              onClick={onPublicOpen}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[13px] text-brand underline"
            >
              Open public request URL
            </a>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all text-xs">
                curl '{url.replaceAll("'", '%27')}'
              </code>
              <CopyIconButton
                text={`curl '${url.replaceAll("'", '%27')}'`}
                label="Public curl command"
              />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
