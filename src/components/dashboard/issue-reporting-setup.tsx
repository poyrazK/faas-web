import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { ApiError } from '@/lib/api/client';
import { useCapability } from '@/lib/api/capabilities';
import {
  useEnvironmentState,
  useProject,
  useProjectEnvironments,
  useProjects,
} from '@/lib/api/projects';
import {
  createIssueTokenOnce,
  issueTokensKey,
  revokeIssueToken,
  useIssueDeployments,
  useIssueTokens,
  type IssueTokenMetadata,
} from '@/lib/api/issues';

type Props = { accountId: string; slug: string; onClose: () => void };
type Disclosure = { token: string; id: string; context: string };
type Unresolved = {
  name: string;
  deploymentId: string;
  environment: string;
  expiresAt: string;
  tokenId?: string;
};
function expiryAfterSubmission(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}
function readRecovery(key: string): Unresolved | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<Unresolved>;
    if (
      !value ||
      typeof value.name !== 'string' ||
      typeof value.deploymentId !== 'string' ||
      typeof value.environment !== 'string' ||
      typeof value.expiresAt !== 'string'
    )
      return null;
    return {
      name: value.name,
      deploymentId: value.deploymentId,
      environment: value.environment,
      expiresAt: value.expiresAt,
      ...(typeof value.tokenId === 'string' ? { tokenId: value.tokenId } : {}),
    };
  } catch {
    return null;
  }
}

export function IssueReportingSetup({ accountId, slug, onClose }: Props) {
  return (
    <SetupContext
      key={`${accountId}/${slug}`}
      accountId={accountId}
      slug={slug}
      onClose={onClose}
    />
  );
}

function SetupContext({ accountId, slug, onClose }: Props) {
  const context = `${accountId}/${slug}`;
  const recoveryKey = `gregale.issue-token-recovery.${accountId}.${slug}`;
  const availability = useCapability('issues');
  const available = availability.accountId === accountId && availability.state === 'available';
  const availableRef = useRef(available);
  const mounted = useRef(true);
  const tokens = useIssueTokens(accountId, slug);
  const deployments = useIssueDeployments(accountId, slug);
  const projects = useProjects(accountId);
  const cache = useQueryClient();
  const [deploymentId, setDeploymentId] = useState('');
  const [name, setName] = useState('');
  const [environment, setEnvironment] = useState('application');
  const [projectSlug, setProjectSlug] = useState('');
  const project = useProject(accountId, projectSlug);
  const projectEnvironments = useProjectEnvironments(accountId, projectSlug);
  const environmentState = useEnvironmentState(
    accountId,
    projectSlug,
    environment === 'application' ? '' : environment
  );
  const [hours, setHours] = useState(24);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [unresolved, setUnresolved] = useState<Unresolved | null>(() => readRecovery(recoveryKey));
  const [disclosure, setDisclosure] = useState<Disclosure | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<IssueTokenMetadata | null>(null);
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [observedNow, setObservedNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setObservedNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    availableRef.current = available;
  }, [available]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const current = (expected: string) => mounted.current && context === expected;
  function saveRecovery(value: Unresolved) {
    setUnresolved(value);
    try {
      sessionStorage.setItem(recoveryKey, JSON.stringify(value));
    } catch {
      /* Browser storage may be denied. */
    }
  }
  function clearRecovery() {
    setUnresolved(null);
    try {
      sessionStorage.removeItem(recoveryKey);
    } catch {
      /* Browser storage may be denied. */
    }
  }
  const rows = deployments.data?.pages.flatMap((page) => page.items) ?? [];
  const projectOwnsApp =
    project.data?.workloads.some((workload) => workload.slug === slug) ?? false;
  const activeRelease = environmentState.data?.active_release_set;
  const chosenAppId = environmentState.data?.workloads.find(
    (workload) => workload.workload_slug === slug
  )?.app_id;
  const projectDeploymentAllowed =
    projectOwnsApp &&
    Boolean(
      activeRelease?.members.some(
        (member) => member.app_id === chosenAppId && member.deployment_id === deploymentId
      )
    );
  const match =
    unresolved &&
    tokens.data?.filter(
      (token) =>
        token.name === unresolved.name &&
        token.deployment_id === unresolved.deploymentId &&
        token.environment === unresolved.environment &&
        token.expires_at === unresolved.expiresAt
    );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !available ||
      busy ||
      unresolved ||
      disclosure ||
      !deploymentId ||
      !rows.some((item) => item.id === deploymentId)
    )
      return;
    if (environment !== 'application' && !projectDeploymentAllowed) {
      setError('Choose a deployment in the active recorded release for this project environment.');
      return;
    }
    const requestedName = name.trim();
    const requestedEnvironment = environment.trim();
    if (
      !requestedName ||
      requestedName.length > 64 ||
      !/^[a-z0-9][a-z0-9-]{0,62}$/.test(requestedEnvironment) ||
      !Number.isInteger(hours) ||
      hours < 1 ||
      hours > 2160
    ) {
      setError(
        'Choose a listed deployment, a name up to 64 characters, a valid environment, and expiry within 90 days.'
      );
      return;
    }
    const expiresAt = expiryAfterSubmission(hours);
    const expected = context;
    setBusy(true);
    setError('');
    try {
      const result = await createIssueTokenOnce(slug, {
        deployment_id: deploymentId,
        name: requestedName,
        environment: requestedEnvironment,
        expires_at: expiresAt,
      });
      if (!current(expected) || !availableRef.current) return;
      if (!result.token) {
        saveRecovery({
          name: requestedName,
          deploymentId,
          environment: requestedEnvironment,
          expiresAt,
        });
        void tokens.refetch();
        return;
      }
      setDisclosure({ token: result.token, id: result.id, context: expected });
      saveRecovery({
        name: requestedName,
        deploymentId,
        environment: requestedEnvironment,
        expiresAt,
        tokenId: result.id,
      });
      setAcknowledged(false);
      setCopyFailed(false);
      setName('');
      void cache.invalidateQueries({ queryKey: issueTokensKey(accountId, slug) });
    } catch (caught) {
      if (!current(expected) || !availableRef.current) return;
      const definitive =
        caught instanceof ApiError &&
        ([400, 401, 402, 403, 404, 422].includes(caught.status) ||
          caught.code === 'issue_quota_exceeded');
      if (definitive) setError(caught.message);
      else {
        saveRecovery({
          name: requestedName,
          deploymentId,
          environment: requestedEnvironment,
          expiresAt,
        });
        void tokens.refetch();
      }
    } finally {
      if (current(expected)) setBusy(false);
    }
  }

  async function copy() {
    if (!disclosure || disclosure.context !== context) return;
    try {
      await navigator.clipboard.writeText(disclosure.token);
      setCopyFailed(false);
    } catch {
      setCopyFailed(true);
    }
  }

  async function revoke() {
    if (!revokeTarget || !available || revokeBusy) return;
    const expected = context;
    setRevokeBusy(true);
    setError('');
    try {
      await revokeIssueToken(slug, revokeTarget.id);
      if (!current(expected)) return;
      const refreshed = await tokens.refetch();
      if (!current(expected)) return;
      if (refreshed.isSuccess && !refreshed.data?.some((token) => token.id === revokeTarget.id)) {
        setRevokeTarget(null);
        if (
          unresolved &&
          (unresolved.tokenId === revokeTarget.id ||
            (match?.some((token) => token.id === revokeTarget.id) && match.length === 1))
        )
          clearRecovery();
      } else
        setError(
          'Revocation outcome is unverified. Inspect current token metadata before creating another.'
        );
    } catch {
      if (current(expected))
        setError(
          'Revocation outcome is unverified. Refresh token metadata and inspect this exact ID.'
        );
    } finally {
      if (current(expected)) setRevokeBusy(false);
    }
  }

  const secret = disclosure?.context === context ? disclosure : null;
  function dismissSecret() {
    if (!acknowledged) return;
    setDisclosure(null);
    clearRecovery();
    setAcknowledged(false);
    setCopyFailed(false);
  }
  return (
    <section className="min-w-0 space-y-5 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Issue reporting setup</h3>
        <Button variant="outline" disabled={Boolean(secret)} onClick={onClose}>
          Back to issues
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Create a short lived credential for the exact deployment that reports exceptions. The token
        is shown once; store it as an app secret. Rotate on deployment and revoke old credentials.
      </p>
      <Modal
        open={Boolean(secret)}
        onClose={dismissSecret}
        title="Save reporting token"
        description="This deployment-bound credential is shown once. Save it securely and acknowledge before closing."
        width="max-w-xl"
      >
        {secret && (
          <div className="space-y-3">
            <p className="text-sm font-medium">
              Save this token now. It cannot be recovered after closing this view.
            </p>
            <label className="block text-xs text-muted-foreground">
              One-time reporting token
              <input
                readOnly
                type="password"
                value={secret.token}
                className="mt-1 w-full rounded border border-border bg-background p-2 font-mono text-sm text-foreground"
              />
            </label>
            <Button variant="outline" onClick={() => void copy()}>
              Copy token
            </Button>
            {copyFailed && (
              <p role="alert" className="text-xs">
                Clipboard access failed. Select the token in the field and copy it manually.
              </p>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              I saved this token securely
            </label>
            <Button disabled={!acknowledged} onClick={dismissSecret}>
              Done
            </Button>
          </div>
        )}
      </Modal>
      {!secret && (
        <>
          {unresolved && (
            <div role="alert" className="space-y-2 rounded border border-border p-3 text-sm">
              <p>
                {unresolved.tokenId
                  ? `Token ${unresolved.tokenId} was created, but its bearer was not acknowledged. It cannot be recovered. Inspect this exact token and revoke it if unusable before creating another.`
                  : 'The creation outcome is uncertain. A credential may have consumed quota, but its bearer cannot be recovered. Do not create another until you inspect the exact metadata below.'}
              </p>
              <p>
                Attempted: {unresolved.name} · {unresolved.deploymentId} · {unresolved.environment}{' '}
                · expires {unresolved.expiresAt}
              </p>
              <Button variant="outline" onClick={() => void tokens.refetch()}>
                Refresh token metadata
              </Button>
              {tokens.isPending || tokens.error ? (
                <p>Token inventory is not confirmed yet.</p>
              ) : match?.length === 0 ? (
                <p>
                  No exact matching token is visible. Contact support if the result remains
                  uncertain.
                </p>
              ) : (
                <p>
                  {match?.length} exact metadata match{match?.length === 1 ? '' : 'es'}; inspect the
                  token ID before revoking an unusable credential.
                </p>
              )}
            </div>
          )}
          <form
            onSubmit={(event) => void submit(event)}
            className="flex flex-wrap items-end gap-3 text-sm"
          >
            <label className="flex flex-col gap-1">
              Deployment
              <select
                aria-label="Deployment"
                required
                value={deploymentId}
                onChange={(event) => setDeploymentId(event.target.value)}
                className="max-w-64 rounded border border-border bg-background px-2 py-1 font-mono text-foreground"
              >
                <option value="">Choose a deployment</option>
                {rows.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.id} · {row.status}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              Token name
              <input
                aria-label="Token name"
                maxLength={64}
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="rounded border border-border bg-background px-2 py-1 text-foreground"
              />
            </label>
            <label className="flex flex-col gap-1">
              Project
              <select
                aria-label="Project"
                value={projectSlug}
                onChange={(event) => {
                  setProjectSlug(event.target.value);
                  setEnvironment('application');
                }}
                className="rounded border border-border bg-background px-2 py-1 text-foreground"
              >
                <option value="">Standalone application</option>
                {projects.data?.map((item) => (
                  <option key={item.id} value={item.slug}>
                    {item.slug}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              Environment
              <select
                aria-label="Environment"
                value={environment}
                onChange={(event) => setEnvironment(event.target.value)}
                className="rounded border border-border bg-background px-2 py-1 text-foreground"
              >
                <option value="application">application</option>
                {projectOwnsApp &&
                  projectEnvironments.data?.map((item) => (
                    <option key={item.id} value={item.slug}>
                      {item.slug}
                    </option>
                  ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              Expires in hours
              <input
                aria-label="Expires in hours"
                type="number"
                min={1}
                max={2160}
                value={hours}
                onChange={(event) => setHours(Number(event.target.value))}
                className="w-24 rounded border border-border bg-background px-2 py-1 text-foreground"
              />
            </label>
            <Button
              type="submit"
              disabled={
                !available ||
                busy ||
                Boolean(unresolved) ||
                deployments.isPending ||
                Boolean(deployments.error) ||
                (environment !== 'application' && !projectDeploymentAllowed)
              }
            >
              {busy ? 'Creating…' : 'Create reporting token'}
            </Button>
          </form>
          <p className="text-xs text-muted-foreground">
            “application” is the standalone namespace. Named environments require a project
            containing this app and a deployment in its active recorded release. The server checks
            that relationship again.
          </p>
          {deployments.hasNextPage && (
            <Button variant="outline" onClick={() => void deployments.fetchNextPage()}>
              Load older deployments
            </Button>
          )}
          {deployments.error && <p role="alert">Could not load authoritative deployments.</p>}
          {error && <p role="alert">{error}</p>}
        </>
      )}
      <div className="space-y-2">
        <h4 className="text-sm font-medium">Existing token metadata</h4>
        {tokens.isPending ? (
          <p role="status">Loading token metadata…</p>
        ) : tokens.error ? (
          <p role="alert">
            Could not load token metadata.{' '}
            <Button variant="outline" onClick={() => void tokens.refetch()}>
              Retry
            </Button>
          </p>
        ) : tokens.data?.length ? (
          <ul className="divide-y divide-border rounded border border-border text-xs">
            {tokens.data.map((token) => (
              <li key={token.id} className="flex flex-wrap items-center justify-between gap-2 p-2">
                <span className="break-all">
                  {token.name} · {token.id} · {token.deployment_id} · {token.environment} · expires{' '}
                  {token.expires_at}{' '}
                  {token.revoked_at
                    ? '· revoked'
                    : Date.parse(token.expires_at) <= observedNow
                      ? '· expired'
                      : '· active'}
                </span>
                {!token.revoked_at && (
                  <Button
                    variant="outline"
                    disabled={!available}
                    onClick={() => setRevokeTarget(token)}
                  >
                    Review revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">No token metadata recorded for this app.</p>
        )}
      </div>
      {revokeTarget && (
        <div className="space-y-2 rounded border border-border p-3 text-sm">
          <p>
            Revoke only this identified token: {revokeTarget.name} ({revokeTarget.id}) for{' '}
            {revokeTarget.deployment_id} in {revokeTarget.environment}. Reporting with it will stop.
          </p>
          <div className="flex gap-2">
            <Button disabled={revokeBusy || !available} onClick={() => void revoke()}>
              Revoke this token
            </Button>
            <Button variant="outline" onClick={() => setRevokeTarget(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      <details className="text-sm">
        <summary className="cursor-pointer font-medium">Connect a reporter</summary>
        <div className="space-y-2 pt-2 text-muted-foreground">
          <p>
            Node: <code>@gregale/sdk-node</code> → <code>createIssueReporter</code>. Python:{' '}
            <code>faas_sdk.IssueReporter</code>. Go: <code>github.com/poyrazK/faas/sdk/go</code> →{' '}
            <code>NewIssueReporter</code>. Configure the deployment-bound token as a secret and
            capture exceptions explicitly.
          </p>
          <p>
            OTLP JSON exception exports: <code>POST /v1/apps/{slug}/issue-events/otlp/traces</code>{' '}
            or <code>/otlp/logs</code> with this bearer token. Binary protobuf is not accepted.
            Trace sampling and process crashes can omit failures; inspect reporter delivery/drop
            counts.
          </p>
        </div>
      </details>
    </section>
  );
}
