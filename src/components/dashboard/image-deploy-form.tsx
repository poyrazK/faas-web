import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/auth';
import { api, unwrap } from '@/lib/api/client';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { keys, retryPolicy } from '@/lib/api/queries';
import { createImageApp, deployImage } from '@/lib/api/image-deployments';
import { useCapability } from '@/lib/api/capabilities';
import { imageRequest } from '@/lib/oci-image';
import {
  clearImageOperation,
  creationReplayAllowed,
  newImageOperation,
  readImageOperation,
  saveImageOperation,
  type ImageOperation,
} from '@/lib/image-operation';
import { useUnsavedGuard } from '@/lib/use-unsaved-guard';
import { appNameError } from './new-app-validation';
import { CapabilityNotice } from './capability-notice';
import { DeploymentProgress } from './deployment-progress';
import type { components } from '@/lib/api/schema';

// A new request's settled admission/validation refusal did not accept a release.
// Conflict and transport/server failures remain ambiguous; never clear those implicitly.
function definitivelyRejected(error: unknown) {
  return (
    error instanceof ApiError && [400, 401, 402, 403, 404, 413, 422, 429].includes(error.status)
  );
}

export function ImageDeployForm({ slug }: { slug?: string }) {
  const { account } = useAuth();
  if (!account) return <p role="status">Verifying your account…</p>;
  return (
    <ImageJourney
      key={`${account.id}:${slug ?? 'new'}`}
      accountId={account.id}
      plan={account.plan}
      maxMemory={account.limits.ram_mb}
      slug={slug ?? ''}
    />
  );
}
export function ImageDeploymentPanel({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <Button variant="outline" aria-expanded={open} onClick={() => setOpen(!open)}>
        Deploy image
      </Button>
      {open && <ImageDeployForm slug={slug} />}
    </div>
  );
}
function ImageJourney({
  accountId,
  plan,
  maxMemory,
  slug,
}: {
  accountId: string;
  plan: string;
  maxMemory: number;
  slug: string;
}) {
  const [recovery] = useState(() => {
    try {
      return { operation: readImageOperation(accountId, slug), error: null };
    } catch (error) {
      return { operation: null, error: errorMessage(error) };
    }
  });
  const [operation, setOperation] = useState<ImageOperation | null>(recovery.operation);
  const [editingApp, setEditingApp] = useState<ImageOperation | null>(null);
  const [observedTerminal, setObservedTerminal] = useState<string>();
  const fixedApp = editingApp?.createRequest.slug || slug;
  const [name, setName] = useState(slug);
  const [image, setImage] = useState('');
  const [port, setPort] = useState('');
  const [health, setHealth] = useState('');
  const [memory, setMemory] = useState(128);
  const [allowAuto, setAllowAuto] = useState(false);
  const [privateRegistry, setPrivateRegistry] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(recovery.error);
  const [conflicted, setConflicted] = useState(false);
  const [inspected, setInspected] = useState(false);
  const [confirmAttempt, setConfirmAttempt] = useState(false);
  const [history, setHistory] = useState<components['schemas']['DeploymentResponse'][]>([]);
  const availability = useCapability('container-deployments');
  const cache = useQueryClient();
  const active = useRef(true);
  const lock = useRef(false);
  const currentAvailability = useRef(availability.state);
  useEffect(() => {
    currentAvailability.current = availability.state;
  }, [availability.state]);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const registrySlug = operation?.appId ? operation.createRequest.slug : fixedApp;
  const registry = useQuery({
    queryKey: ['account', accountId, 'image-registry', registrySlug],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/registry-credentials', {
          params: { path: { slug: registrySlug } },
          signal,
        })
      ),
    enabled: Boolean(registrySlug),
    retry: retryPolicy,
  });
  useUnsavedGuard(
    Boolean(operation && operation.stage !== 'accepted') || Boolean(image || password)
  );
  const permitted = availability.state === 'available' && !busy && !recovery.error;
  const frozen = Boolean(operation);
  const unknown = operation?.stage === 'deploy-unknown' || operation?.stage === 'deploy-submitting';
  const credentialsNeeded = operation?.stage === 'credentials';
  function persist(next: ImageOperation) {
    if (!active.current)
      throw new Error('Account or app selection changed. Resume from its saved recovery record.');
    saveImageOperation(next);
    setOperation(next);
    return next;
  }
  function ensureCanWrite() {
    if (!active.current || currentAvailability.current !== 'available')
      throw new Error('Availability or account changed. Resume after verifying access.');
  }
  async function verifyApp(current: ImageOperation) {
    const app = await unwrap(
      api.GET('/v1/apps/{slug}', { params: { path: { slug: current.createRequest.slug } } })
    );
    if (app.id !== current.appId || app.type !== 'app')
      throw new Error('The app identity or type has changed. Inspect the app before resuming.');
    ensureCanWrite();
  }
  async function submitDeployment(current: ImageOperation) {
    ensureCanWrite();
    await verifyApp(current);
    current = persist({ ...current, stage: 'deploy-submitting' });
    try {
      const deployment = await deployImage(
        current.createRequest.slug,
        current.deployRequest,
        current.deployKey
      );
      if (!deployment?.id) throw new Error('No accepted deployment identity was returned.');
      persist({ ...current, stage: 'accepted', deploymentId: deployment.id });
      void cache.invalidateQueries({ queryKey: keys.apps });
      void cache.invalidateQueries({ queryKey: keys.deployments });
      void cache.invalidateQueries({ queryKey: keys.appDeployments(current.createRequest.slug) });
    } catch (error) {
      if (active.current)
        persist({
          ...current,
          stage: definitivelyRejected(error) ? 'deploy-rejected' : 'deploy-unknown',
        });
      throw error;
    }
  }
  async function saveCredentialAndDeploy(current: ImageOperation) {
    if (!username || !password)
      throw new Error(
        'Re-enter the registry username and password. Credentials are never saved in recovery records.'
      );
    const registryHost = current.deployRequest.image!.split('/')[0];
    ensureCanWrite();
    await verifyApp(current);
    await unwrap(
      api.PUT('/v1/apps/{slug}/registry-credentials', {
        params: { path: { slug: current.createRequest.slug } },
        body: { registry: `https://${registryHost}`, username, password },
      })
    );
    if (!active.current) return;
    setPassword('');
    setUsername('');
    current = persist({ ...current, stage: 'app-created', needsCredentials: false });
    void registry.refetch();
    await submitDeployment(current);
  }
  async function run(task: () => Promise<void>) {
    if (!permitted || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (error) {
      if (active.current) {
        setError(errorMessage(error));
        if (error instanceof ApiError && error.status === 409 && !operation?.appId)
          setConflicted(true);
      }
    } finally {
      lock.current = false;
      if (active.current) setBusy(false);
    }
  }
  async function createOrRecover(current: ImageOperation, freshRequest = false) {
    ensureCanWrite();
    if (!creationReplayAllowed(current) || conflicted)
      throw new Error(
        'The creation outcome is unresolved. Inspect the app; do not create a renamed replacement.'
      );
    let app;
    try {
      app = await createImageApp(current.createRequest, current.createKey);
    } catch (error) {
      // An old ambiguous creation may already have created its app. A later
      // refusal after account changes is not proof about that earlier attempt.
      if (
        freshRequest &&
        active.current &&
        (definitivelyRejected(error) || (error instanceof ApiError && error.status === 409))
      )
        persist({ ...current, stage: 'create-rejected' });
      throw error;
    }
    if (!app?.id || app.slug !== current.createRequest.slug)
      throw new Error(
        'App creation returned an unexpected identity. Inspect your apps before resuming.'
      );
    current = persist({
      ...current,
      appId: app.id,
      endpoint: app.url,
      stage: current.needsCredentials ? 'credentials' : 'app-created',
    });
    void cache.invalidateQueries({ queryKey: keys.apps });
    if (current.needsCredentials) await saveCredentialAndDeploy(current);
    else await submitDeployment(current);
  }
  async function start() {
    const request = imageRequest(image, port, health, allowAuto);
    if (!fixedApp && appNameError(name)) throw new Error(appNameError(name)!);
    if (memory > maxMemory) throw new Error('Memory exceeds this plan’s per-app limit.');
    const current = persist({
      ...newImageOperation(
        accountId,
        editingApp?.createRequest ?? {
          slug: fixedApp || name,
          type: 'app',
          ram_mb: memory,
          idle_timeout_s: 0,
        },
        request,
        editingApp?.existingSlug ?? slug
      ),
      needsCredentials: privateRegistry,
      ...(editingApp
        ? {
            appId: editingApp.appId,
            endpoint: editingApp.endpoint,
            stage: privateRegistry ? ('credentials' as const) : ('app-created' as const),
          }
        : {}),
    });
    if (editingApp) {
      if (current.needsCredentials) await saveCredentialAndDeploy(current);
      else await submitDeployment(current);
    } else if (slug) await resumeExisting(current);
    else await createOrRecover(current, true);
  }
  function editRequest(current: ImageOperation) {
    if (!active.current || busy) return;
    try {
      clearImageOperation(current);
      setEditingApp(current.appId ? current : null);
      setOperation(null);
      setObservedTerminal(undefined);
      setConflicted(false);
      setReviewing(false);
      setName(current.createRequest.slug);
      setImage(current.deployRequest.image ?? '');
      setPort(
        current.deployRequest.overrides?.port ? String(current.deployRequest.overrides.port) : ''
      );
      setHealth(current.deployRequest.overrides?.healthcheck?.path ?? '');
      setMemory(current.createRequest.ram_mb ?? 128);
      setAllowAuto(current.deployRequest.full_rootfs_allow_auto === true);
      setPrivateRegistry(false);
      setUsername('');
      setPassword('');
      setError(null);
    } catch (error) {
      setError(errorMessage(error));
    }
  }
  async function resumeExisting(current: ImageOperation) {
    ensureCanWrite();
    const app = await unwrap(api.GET('/v1/apps/{slug}', { params: { path: { slug } } }));
    if (!app?.id || app.slug !== slug || app.type !== 'app')
      throw new Error('Deploy image requires an HTTP container app. No app was changed.');
    current = persist({
      ...current,
      appId: app.id,
      endpoint: app.url,
      stage: privateRegistry ? 'credentials' : 'app-created',
    });
    if (current.needsCredentials)
      await saveCredentialAndDeploy(persist({ ...current, stage: 'credentials' }));
    else await submitDeployment(current);
  }
  async function inspect() {
    if (!operation?.appId || busy || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const app = await unwrap(
        api.GET('/v1/apps/{slug}', { params: { path: { slug: operation.createRequest.slug } } })
      );
      if (app.id !== operation.appId)
        throw new Error('The app identity has changed. Do not resume this operation.');
      const result = await unwrap(
        api.GET('/v1/apps/{slug}/deployments', {
          params: { path: { slug: operation.createRequest.slug }, query: { limit: 20 } },
        })
      );
      if (!active.current) return;
      setHistory(result.items.filter((item) => item.app_id === operation.appId));
      setInspected(true);
    } catch (error) {
      if (active.current) setError(errorMessage(error));
    } finally {
      lock.current = false;
      if (active.current) setBusy(false);
    }
  }
  const title = slug ? 'Deploy image' : 'Container image';
  return (
    <section
      aria-label={title}
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5"
    >
      <h2 className="text-lg font-medium">{title}</h2>
      <p className="text-sm text-muted-foreground">
        Linux/amd64 HTTP images, stateless ephemeral disk. Listen on <code>0.0.0.0:$PORT</code>.
        Host mounts and privileged containers are not supported.
      </p>
      <CapabilityNotice
        capability={availability.capability}
        state={availability.state}
        onRetry={availability.refresh}
      />
      {error && (
        <p role="alert" className="text-sm text-[color:var(--status-critical)]">
          {error}
        </p>
      )}
      {operation ? (
        <>
          <p className="break-all text-sm">
            App: <strong>{operation.createRequest.slug}</strong> · Image:{' '}
            <code>{operation.deployRequest.image}</code>
          </p>
          <p className="text-xs text-muted-foreground">
            This request is frozen. Recovery keeps its app identity and never creates a renamed
            replacement.
          </p>
          {(operation.stage === 'create-rejected' || operation.stage === 'deploy-rejected') && (
            <>
              <p role="status">
                This attempt was rejected before acceptance.{' '}
                {operation.appId
                  ? 'Your existing app is kept.'
                  : 'No app was accepted for this attempt.'}{' '}
                Edit and review a new request.
              </p>
              <Button disabled={busy} onClick={() => editRequest(operation)}>
                Edit rejected request
              </Button>
            </>
          )}
          {operation.stage === 'create-pending' && (
            <>
              {(!creationReplayAllowed(operation) || conflicted) && (
                <p role="status">
                  The creation receipt window has expired or the slug conflicts. The outcome is
                  unresolved; inspect your apps before proceeding.
                </p>
              )}
              {slug ? (
                <Button
                  disabled={!permitted}
                  onClick={() => void run(() => resumeExisting(operation))}
                >
                  Resume existing app deployment
                </Button>
              ) : (
                <Button
                  disabled={!permitted || !creationReplayAllowed(operation) || conflicted}
                  onClick={() => void run(() => createOrRecover(operation))}
                >
                  Recover app creation
                </Button>
              )}
            </>
          )}
          {credentialsNeeded && (
            <>
              <p className="text-sm">
                Your app is saved. Re-enter credentials to finish this deployment.
              </p>
              <label className="text-sm">
                Registry username
                <Input
                  autoComplete="off"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </label>
              <label className="text-sm">
                Registry password
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <Button
                disabled={!permitted || !username || !password || plan === 'free'}
                onClick={() => void run(() => saveCredentialAndDeploy(operation))}
              >
                Save credentials and deploy
              </Button>
            </>
          )}
          {operation.stage === 'app-created' && (
            <Button
              disabled={!permitted}
              onClick={() => void run(() => submitDeployment(operation))}
            >
              Submit image deployment
            </Button>
          )}
          {unknown && (
            <>
              <p role="status">
                The deployment outcome is unconfirmed. Inspect recent releases before starting
                another attempt; an earlier request may still be running.
              </p>
              <Button variant="outline" disabled={busy} onClick={() => void inspect()}>
                Inspect recent releases
              </Button>
              {inspected && (
                <>
                  <p className="text-xs text-muted-foreground">
                    Recent releases are candidates, not a confirmed match to this request. Digest or
                    timing alone cannot establish identity.
                  </p>
                  <ul className="flex flex-col gap-2">
                    {history.map((item) => (
                      <li key={item.id} className="break-all text-sm">
                        <a
                          className="text-brand underline"
                          href={`/dashboard/deployments?deployment=${encodeURIComponent(item.id)}`}
                        >
                          {item.id}
                        </a>{' '}
                        · <span>{item.status}</span> · {item.image_digest}
                      </li>
                    ))}
                  </ul>
                  <label className="flex gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={confirmAttempt}
                      onChange={(e) => setConfirmAttempt(e.target.checked)}
                    />
                    I inspected the releases. Start a separate attempt, which may duplicate an
                    unconfirmed request.
                  </label>
                  <Button
                    disabled={!permitted || !confirmAttempt}
                    onClick={() => {
                      const next = persist({
                        ...operation,
                        stage: 'app-created',
                        deployKey: crypto.randomUUID(),
                        attemptAt: Date.now(),
                        deploymentId: undefined,
                      });
                      setInspected(false);
                      setConfirmAttempt(false);
                      void run(() => submitDeployment(next));
                    }}
                  >
                    Start new image attempt
                  </Button>
                </>
              )}
            </>
          )}
          {operation.stage === 'accepted' && (
            <DeploymentProgress
              appCreated
              appName={operation.createRequest.slug}
              deploymentId={operation.deploymentId ?? null}
              source={{ kind: 'image', reference: operation.deployRequest.image! }}
              endpoint={operation.endpoint}
              onLive={(deployment) => {
                if (
                  deployment.id === operation.deploymentId &&
                  deployment.app_id === operation.appId
                )
                  clearImageOperation(operation);
              }}
              onTerminal={(deployment) => {
                if (
                  deployment.id === operation.deploymentId &&
                  deployment.app_id === operation.appId
                )
                  setObservedTerminal(deployment.id);
              }}
            />
          )}
          {operation.stage === 'accepted' && observedTerminal === operation.deploymentId && (
            <>
              <p className="text-xs text-muted-foreground">
                This release has a confirmed terminal outcome. Your app is kept; another image
                requires a new review and request.
              </p>
              <Button disabled={busy} onClick={() => editRequest(operation)}>
                Choose another image
              </Button>
            </>
          )}
          <a
            className="w-fit text-sm text-brand underline"
            href={`/dashboard/workflows/${encodeURIComponent(operation.createRequest.slug)}?tab=Deployments`}
          >
            Inspect app and releases
          </a>
        </>
      ) : (
        <>
          {editingApp && (
            <p className="text-sm">
              Continuing with saved app <strong>{fixedApp}</strong>. No new app will be created.
            </p>
          )}
          {!fixedApp && (
            <label className="text-sm">
              App name
              <Input
                disabled={reviewing || frozen}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={40}
              />
            </label>
          )}
          <label className="text-sm">
            Image reference
            <Input
              disabled={reviewing}
              value={image}
              onChange={(e) => setImage(e.target.value)}
              placeholder="ghcr.io/team/api@sha256:…"
              autoComplete="off"
            />
          </label>
          {!fixedApp && (
            <label className="text-sm">
              Memory (MB)
              <Input
                type="number"
                min={128}
                max={maxMemory}
                step={128}
                disabled={reviewing}
                value={memory}
                onChange={(e) => setMemory(Number(e.target.value))}
              />
            </label>
          )}
          <details>
            <summary className="cursor-pointer text-sm">Advanced settings</summary>
            <div className="mt-3 flex flex-col gap-3">
              <p className="text-xs text-muted-foreground">
                Omit overrides to use the image defaults. A health path is readiness configuration,
                not proof that the app is healthy.
              </p>
              <label className="text-sm">
                Port override
                <Input
                  disabled={reviewing}
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  inputMode="numeric"
                />
              </label>
              <label className="text-sm">
                Health path override
                <Input
                  disabled={reviewing}
                  value={health}
                  onChange={(e) => setHealth(e.target.value)}
                />
              </label>
              <label className="flex gap-2 text-sm">
                <input
                  type="checkbox"
                  disabled={reviewing}
                  checked={allowAuto}
                  onChange={(e) => setAllowAuto(e.target.checked)}
                />
                Allow self-contained image fallback
              </label>
              {plan === 'free' && (
                <p className="text-xs text-muted-foreground">
                  Free self-contained images need this explicit full-rootfs fallback opt-in. It does
                  not make every image compatible.
                </p>
              )}
            </div>
          </details>
          {fixedApp && (
            <div className="text-xs text-muted-foreground">
              {registry.isError
                ? 'Registry metadata unavailable; no saved credential is assumed.'
                : registry.isPending
                  ? 'Loading this app’s registry metadata…'
                  : `This app’s saved registries: ${registry.data?.credentials.map((item) => item.registry).join(', ') || 'none'}.`}
            </div>
          )}
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={privateRegistry}
              disabled={reviewing || plan === 'free'}
              onChange={(e) => setPrivateRegistry(e.target.checked)}
            />
            Add registry credentials
          </label>
          {plan === 'free' && (
            <p className="text-xs text-muted-foreground">
              Free supports public images. Private registry credentials require Hobby or above.
            </p>
          )}
          {privateRegistry && (
            <>
              <label className="text-sm">
                Registry username
                <Input
                  autoComplete="off"
                  disabled={reviewing}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </label>
              <label className="text-sm">
                Registry password
                <Input
                  type="password"
                  autoComplete="new-password"
                  disabled={reviewing}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <p className="text-xs text-muted-foreground">
                Saved only for this app’s image registry. The password is sealed by the server and
                never stored in this browser.
              </p>
            </>
          )}
          {reviewing ? (
            <>
              <p className="text-sm">
                Review: {fixedApp || name} · {memory} MB ·{' '}
                {allowAuto ? 'Self-contained fallback allowed' : 'Image defaults'}
                {port && ` · Port ${port}`}
                {health && ` · Health path ${health}`}.{' '}
                {privateRegistry
                  ? 'Save this app’s registry credential first.'
                  : 'Use a public image or this app’s saved matching credential.'}
              </p>
              <div className="flex flex-wrap gap-3">
                <Button variant="outline" disabled={busy} onClick={() => setReviewing(false)}>
                  Edit configuration
                </Button>
                <Button disabled={!permitted} onClick={() => void run(start)}>
                  {fixedApp ? 'Deploy reviewed image' : 'Create app and deploy image'}
                </Button>
              </div>
            </>
          ) : (
            <Button
              disabled={!permitted}
              onClick={() => {
                try {
                  imageRequest(image, port, health, allowAuto);
                  if (!fixedApp && appNameError(name)) throw new Error(appNameError(name)!);
                  if (privateRegistry && (!username || !password))
                    throw new Error('Enter registry credentials before review.');
                  if (!Number.isInteger(memory) || memory < 128 || memory > maxMemory)
                    throw new Error('Select memory within your plan limit.');
                  setError(null);
                  setReviewing(true);
                } catch (error) {
                  setError(errorMessage(error));
                }
              }}
            >
              Review image deployment
            </Button>
          )}
        </>
      )}
    </section>
  );
}
