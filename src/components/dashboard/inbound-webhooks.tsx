import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { FIELD } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { useConfirm } from '@/components/ui/confirm';
import { Panel } from '@/components/dashboard/primitives';
import { CapabilityNotice } from '@/components/dashboard/capability-notice';
import { WebhookAutomationBinding } from '@/components/dashboard/webhook-automation-binding';
import { WebhookReceipt } from '@/components/dashboard/webhook-receipt';
import { useCapability } from '@/lib/api/capabilities';
import { ApiError } from '@/lib/api/client';
import { errorMessage } from '@/lib/api/errors';
import {
  createInboundEndpointOnce,
  deleteInboundEndpoint,
  inboundWebhookKey,
  rotateInboundEndpointSecret,
  setInboundEndpointDeliveryPath,
  setInboundEndpointEnabled,
  useInboundEndpoints,
} from '@/lib/api/inbound-webhooks';

type Disclosure = { context: string; url: string; name: string };
type Unresolved = { context: string; name: string; path: string };
const NAME = /^[a-z][a-z0-9-]{0,62}$/;

function validationError(name: string, secret: string, path: string): string | null {
  if (!NAME.test(name))
    return 'Use 1–63 lowercase letters, digits or hyphens; start with a letter.';
  if (!secret || new TextEncoder().encode(secret).length > 256)
    return 'Enter a Stripe signing secret of at most 256 bytes.';
  if (!path.startsWith('/') || path.length > 256 || /[?#]/.test(path))
    return 'Enter an app delivery path starting with / and without ? or #.';
  return null;
}

export function InboundWebhooks({ accountId, slug }: { accountId: string; slug: string }) {
  return <InboundWebhooksContext key={`${accountId}/${slug}`} accountId={accountId} slug={slug} />;
}

function InboundWebhooksContext({ accountId, slug }: { accountId: string; slug: string }) {
  const capability = useCapability('durable-inbound-webhooks');
  const endpoints = useInboundEndpoints(accountId, slug);
  const cache = useQueryClient();
  const confirm = useConfirm();
  const context = `${accountId}/${slug}`;
  const mountedRef = useRef(true);
  const [name, setName] = useState('');
  const [secret, setSecret] = useState('');
  const [path, setPath] = useState('/');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unresolved, setUnresolved] = useState<Unresolved | null>(null);
  const [disclosure, setDisclosure] = useState<Disclosure | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [replacementId, setReplacementId] = useState('');
  const [rotationSecret, setRotationSecret] = useState('');
  const [pathDraft, setPathDraft] = useState('/');
  const [managementBusy, setManagementBusy] = useState(false);
  const [managementMessage, setManagementMessage] = useState<string | null>(null);
  const available = capability.state === 'available' && capability.accountId === accountId;
  const availableRef = useRef(available);
  const activeDisclosure = disclosure?.context === context ? disclosure : null;
  const activeUnresolved = unresolved?.context === context ? unresolved : null;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  useEffect(() => {
    availableRef.current = available;
  }, [available]);
  const isCurrent = (submitted: string) => mountedRef.current && context === submitted;
  const canWrite = (submitted: string) => isCurrent(submitted) && availableRef.current;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!available || !slug || submitting || activeUnresolved || activeDisclosure) return;
    const attemptedName = name.trim();
    const attemptedPath = path.trim();
    const invalid = validationError(attemptedName, secret, attemptedPath);
    if (invalid) {
      setError(invalid);
      return;
    }
    const submitted = context;
    const signingSecret = secret;
    setSecret('');
    setError(null);
    setSubmitting(true);
    try {
      const created = await createInboundEndpointOnce(slug, {
        name: attemptedName,
        provider: 'stripe',
        signing_secret: signingSecret,
        delivery_path: attemptedPath,
      });
      if (!isCurrent(submitted)) return;
      if (!created.endpoint_url) {
        setUnresolved({ context: submitted, name: attemptedName, path: attemptedPath });
        void endpoints.refetch();
        return;
      }
      setDisclosure({ context: submitted, url: created.endpoint_url, name: attemptedName });
      setAcknowledged(false);
      setCopyFailed(false);
      setName('');
      setPath('/');
      void cache.invalidateQueries({ queryKey: inboundWebhookKey(accountId, slug) });
    } catch (caught) {
      if (!isCurrent(submitted)) return;
      const definitive =
        caught instanceof ApiError && [400, 401, 402, 403, 404, 422].includes(caught.status);
      if (definitive) setError(errorMessage(caught));
      else {
        setUnresolved({ context: submitted, name: attemptedName, path: attemptedPath });
        void endpoints.refetch();
      }
    } finally {
      if (isCurrent(submitted)) setSubmitting(false);
    }
  }

  async function copyUrl() {
    if (!activeDisclosure) return;
    try {
      await navigator.clipboard.writeText(activeDisclosure.url);
      setCopyFailed(false);
    } catch {
      setCopyFailed(true);
    }
  }
  function dismissDisclosure() {
    if (!acknowledged) return;
    setDisclosure(null);
    setAcknowledged(false);
    setCopyFailed(false);
  }
  async function changeEnabled(id: string, endpointName: string, enabled: boolean) {
    if (!available || managementBusy) return;
    const submitted = context;
    const approved = await confirm({
      title: enabled ? 'Enable Stripe ingress?' : 'Disable Stripe ingress?',
      description: `${endpointName} (${id}) will ${enabled ? 'accept' : 'stop accepting'} future provider events. Already accepted queued work remains deliverable.`,
      confirmLabel: enabled ? 'Enable ingress' : 'Disable ingress',
      destructive: !enabled,
    });
    if (!approved || !canWrite(submitted)) return;
    setManagementBusy(true);
    setManagementMessage(null);
    try {
      await setInboundEndpointEnabled(slug, id, enabled);
      if (isCurrent(submitted)) {
        setManagementMessage(
          enabled
            ? 'Future ingress enabled. Delivery health is unverified.'
            : 'Future ingress disabled. Accepted queued work may still run.'
        );
        void endpoints.refetch();
      }
    } catch (caught) {
      if (isCurrent(submitted)) {
        setManagementMessage(`Update outcome needs inspection: ${errorMessage(caught)}`);
        void endpoints.refetch();
      }
    } finally {
      if (isCurrent(submitted)) setManagementBusy(false);
    }
  }

  async function rotateSecret(id: string) {
    if (!available || managementBusy) return;
    const candidate = rotationSecret;
    if (!candidate || new TextEncoder().encode(candidate).length > 256) {
      setManagementMessage('Enter a new Stripe signing secret of at most 256 bytes.');
      return;
    }
    const submitted = context;
    const approved = await confirm({
      title: 'Rotate Stripe signing secret?',
      description: `Endpoint ${id} will verify future Stripe signatures with the new secret. Update Stripe consistently. Rotation does not recover the one-time endpoint URL.`,
      confirmLabel: 'Rotate secret',
    });
    if (!approved || !canWrite(submitted)) return;
    setRotationSecret('');
    setManagementBusy(true);
    setManagementMessage(null);
    try {
      await rotateInboundEndpointSecret(slug, id, candidate);
      if (isCurrent(submitted)) {
        setManagementMessage('Signing secret rotated. This does not recover the endpoint URL.');
        void endpoints.refetch();
      }
    } catch (caught) {
      if (isCurrent(submitted)) {
        setManagementMessage(
          `Rotation outcome is unknown; inspect this endpoint before trying again. ${errorMessage(caught)}`
        );
        void endpoints.refetch();
      }
    } finally {
      if (isCurrent(submitted)) setManagementBusy(false);
    }
  }

  async function changeDeliveryPath(id: string) {
    if (!available || managementBusy) return;
    const candidate = pathDraft.trim();
    if (!candidate.startsWith('/') || candidate.length > 256 || /[?#]/.test(candidate)) {
      setManagementMessage('Enter an app path starting with / and without ? or #.');
      return;
    }
    const submitted = context;
    const approved = await confirm({
      title: 'Change Stripe delivery path?',
      description: `Future accepted events for endpoint ${id} will deliver to ${candidate}. Already accepted queued work keeps its captured route.`,
      confirmLabel: 'Change path',
    });
    if (!approved || !canWrite(submitted)) return;
    setManagementBusy(true);
    setManagementMessage(null);
    try {
      await setInboundEndpointDeliveryPath(slug, id, candidate);
      if (isCurrent(submitted)) {
        setManagementMessage(
          'Delivery path saved for future ingress. Handler execution is unverified.'
        );
        void endpoints.refetch();
      }
    } catch (caught) {
      if (isCurrent(submitted)) {
        setManagementMessage(`Path update outcome needs inspection: ${errorMessage(caught)}`);
        void endpoints.refetch();
      }
    } finally {
      if (isCurrent(submitted)) setManagementBusy(false);
    }
  }

  async function deleteEndpoint(id: string, endpointName: string) {
    if (!available || managementBusy) return;
    const submitted = context;
    const approved = await confirm({
      title: 'Delete Stripe endpoint?',
      description: `Delete ${endpointName} (${id}). Future provider ingress stops, but accepted queued work may still run. The one-time URL cannot be recovered after deletion.`,
      confirmLabel: 'Delete endpoint',
      destructive: true,
    });
    if (!approved || !canWrite(submitted)) return;
    setManagementBusy(true);
    setManagementMessage(null);
    try {
      await deleteInboundEndpoint(slug, id);
      if (isCurrent(submitted)) {
        setSelectedId('');
        setManagementMessage('Endpoint deleted. Accepted queued work may still run.');
        void endpoints.refetch();
      }
    } catch (caught) {
      if (isCurrent(submitted)) {
        setManagementMessage(`Deletion outcome needs inspection: ${errorMessage(caught)}`);
        void endpoints.refetch();
      }
    } finally {
      if (isCurrent(submitted)) setManagementBusy(false);
    }
  }

  async function reviewReplacement() {
    if (!available || !activeUnresolved || !replacementId || managementBusy) return;
    const selected = sameName.find((endpoint) => endpoint.id === replacementId);
    if (!selected) return;
    const submitted = context;
    const approved = await confirm({
      title: 'Delete the selected inaccessible endpoint?',
      description: `You selected ${selected.name} (${selected.id}), delivering to ${selected.delivery_path}. Deletion stops future ingress but does not cancel accepted queued work. Its URL cannot be recovered. You must create and copy a replacement URL into Stripe manually.`,
      confirmLabel: 'Delete selected endpoint',
      destructive: true,
    });
    if (!approved || !canWrite(submitted)) return;
    setManagementBusy(true);
    setManagementMessage(null);
    try {
      const refreshed = await endpoints.refetch();
      if (!canWrite(submitted)) return;
      const stillSelected = refreshed.data?.some(
        (endpoint) =>
          endpoint.id === selected.id &&
          endpoint.name === selected.name &&
          endpoint.delivery_path === selected.delivery_path
      );
      if (!refreshed.isSuccess || refreshed.error || !stillSelected) {
        setManagementMessage(
          'The selected endpoint changed or could not be verified. Inspect the refreshed metadata before deleting.'
        );
        return;
      }
      await deleteInboundEndpoint(slug, selected.id);
      if (!isCurrent(submitted)) return;
      setName(activeUnresolved.name);
      setPath(activeUnresolved.path);
      setSecret('');
      setUnresolved(null);
      setReplacementId('');
      setManagementMessage(
        'Selected endpoint deleted. Enter the signing secret and create a replacement explicitly; then update Stripe with its new URL.'
      );
      void endpoints.refetch();
    } catch (caught) {
      if (isCurrent(submitted)) {
        setManagementMessage(
          `Deletion outcome needs inspection; no replacement was created. ${errorMessage(caught)}`
        );
        void endpoints.refetch();
      }
    } finally {
      if (isCurrent(submitted)) setManagementBusy(false);
    }
  }
  const sameName = (endpoints.data ?? []).filter(
    (endpoint) => endpoint.name === activeUnresolved?.name
  );
  const selectedEndpoint = (endpoints.data ?? []).find((endpoint) => endpoint.id === selectedId);

  return (
    <div className="flex flex-col gap-6">
      <Panel
        lit
        title="Stripe inbound webhooks"
        description="Stripe sends signed events to Gregale. After verification and durable acceptance, Gregale delivers to your app path or a bound automation."
      >
        <div className="mb-4">
          <CapabilityNotice
            capability={capability.capability}
            state={capability.state}
            onRetry={capability.refresh}
          />
        </div>
        <form
          noValidate
          onSubmit={(event) => void submit(event)}
          className="grid gap-4 sm:grid-cols-2"
        >
          <label className="flex flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">Endpoint name</span>
            <input
              className={FIELD}
              name="name"
              value={name}
              maxLength={63}
              onChange={(event) => setName(event.target.value)}
              autoComplete="off"
              placeholder="stripe-primary"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">Delivery path</span>
            <input
              className={`${FIELD} font-mono`}
              name="path"
              value={path}
              maxLength={256}
              onChange={(event) => setPath(event.target.value)}
              spellCheck={false}
            />
          </label>
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="label-mono text-muted-foreground">Stripe signing secret</span>
            <input
              aria-label="Stripe signing secret"
              className={`${FIELD} font-mono`}
              name="signing-secret"
              type="password"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              autoComplete="new-password"
              placeholder="whsec_…"
            />
            <span className="text-xs text-muted-foreground">
              Sealed on save and never returned.
            </span>
          </label>
          {error && (
            <p role="alert" className="text-sm text-destructive sm:col-span-2">
              {error}
            </p>
          )}
          <div className="sm:col-span-2">
            <Button
              type="submit"
              size="sm"
              busy={submitting}
              disabled={!available || Boolean(activeUnresolved) || Boolean(activeDisclosure)}
            >
              Create Stripe endpoint
            </Button>
          </div>
        </form>
      </Panel>

      {managementMessage && (
        <p role="status" className="text-sm text-muted-foreground">
          {managementMessage}
        </p>
      )}

      {activeUnresolved && (
        <Panel title="Inspect an uncertain creation">
          <div role="alert" className="space-y-3 text-sm">
            <p>
              The create outcome is unknown. The request may have committed, but its one-time URL
              cannot be recovered from endpoint metadata. No new endpoint was created automatically.
            </p>
            <p>
              Inspect the matching endpoint name <strong>{activeUnresolved.name}</strong> and path{' '}
              <code>{activeUnresolved.path}</code>. A matching name alone does not prove which
              request created it.
            </p>
            {sameName.length ? (
              <ul className="list-disc pl-5">
                {sameName.map((endpoint) => (
                  <li key={endpoint.id}>
                    {endpoint.name} · {endpoint.id} ·{' '}
                    {endpoint.enabled ? 'Ingress enabled' : 'Ingress disabled'}
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                No matching endpoint is visible yet. Refresh metadata before deciding what to do.
              </p>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void endpoints.refetch()}
            >
              Refresh endpoint metadata
            </Button>
            <p>
              To replace an inaccessible URL, identify and disable or delete the exact endpoint,
              then create a new one and update Stripe manually.
            </p>
            {sameName.length > 0 && (
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className="label-mono text-muted-foreground">Inaccessible endpoint</span>
                  <select
                    className={FIELD}
                    value={replacementId}
                    onChange={(event) => setReplacementId(event.target.value)}
                  >
                    <option value="">Select exact endpoint ID</option>
                    {sameName.map((endpoint) => (
                      <option key={endpoint.id} value={endpoint.id}>
                        {endpoint.name} · {endpoint.id}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={!available || !replacementId || managementBusy}
                  onClick={() => void reviewReplacement()}
                >
                  Review replacement
                </Button>
              </div>
            )}
          </div>
        </Panel>
      )}

      <Panel
        title="Inbound endpoints"
        description="Enabled means Gregale accepts future ingress. It does not prove an app delivery or automation run succeeded."
      >
        {endpoints.isPending ? (
          <p>Loading endpoints…</p>
        ) : endpoints.error ? (
          <div role="alert" className="space-y-2 text-sm">
            <p>Could not load endpoints: {errorMessage(endpoints.error)}</p>
            <Button size="sm" variant="outline" onClick={() => void endpoints.refetch()}>
              Retry
            </Button>
          </div>
        ) : endpoints.data?.length ? (
          <ul className="divide-y divide-border">
            {endpoints.data.map((endpoint) => (
              <li
                key={endpoint.id}
                className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
              >
                <span>
                  <strong>{endpoint.name}</strong>{' '}
                  <span className="font-mono text-xs text-muted-foreground">
                    {endpoint.delivery_path}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {endpoint.enabled ? 'Ingress enabled' : 'Ingress disabled'}
                </span>
                <span className="flex max-w-full flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    className="h-auto min-h-6 max-w-full break-all py-1 text-left whitespace-normal"
                    disabled={!available || managementBusy}
                    onClick={() =>
                      void changeEnabled(endpoint.id, endpoint.name, !endpoint.enabled)
                    }
                  >
                    {endpoint.enabled ? `Disable ${endpoint.name}` : `Enable ${endpoint.name}`}
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    className="h-auto min-h-6 max-w-full break-all py-1 text-left whitespace-normal"
                    onClick={() => {
                      setSelectedId(endpoint.id);
                      setPathDraft(endpoint.delivery_path);
                      setRotationSecret('');
                    }}
                  >
                    Manage {endpoint.name}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No inbound endpoints for this app.</p>
        )}
      </Panel>

      {selectedEndpoint && (
        <Panel
          title={`Manage ${selectedEndpoint.name}`}
          description="Signing-secret rotation changes verification only. It does not recover the endpoint URL."
        >
          <div className="space-y-3 text-sm">
            <p>
              Endpoint ID <code>{selectedEndpoint.id}</code> · Delivery path{' '}
              <code>{selectedEndpoint.delivery_path}</code>
            </p>
            <label className="flex flex-col gap-1.5">
              <span className="label-mono text-muted-foreground">New Stripe signing secret</span>
              <input
                className={`${FIELD} font-mono`}
                type="password"
                value={rotationSecret}
                onChange={(event) => setRotationSecret(event.target.value)}
                autoComplete="new-password"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!available || managementBusy}
                onClick={() => void rotateSecret(selectedEndpoint.id)}
              >
                Rotate signing secret
              </Button>
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="label-mono text-muted-foreground">App delivery path</span>
              <input
                className={`${FIELD} font-mono`}
                value={pathDraft}
                onChange={(event) => setPathDraft(event.target.value)}
                maxLength={256}
                spellCheck={false}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!available || managementBusy}
                onClick={() => void changeDeliveryPath(selectedEndpoint.id)}
              >
                Review path change
              </Button>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={!available || managementBusy}
                onClick={() => void deleteEndpoint(selectedEndpoint.id, selectedEndpoint.name)}
              >
                Delete endpoint
              </Button>
            </div>
          </div>
        </Panel>
      )}
      {selectedEndpoint && (
        <WebhookAutomationBinding
          accountId={accountId}
          slug={slug}
          endpointId={selectedEndpoint.id}
        />
      )}
      {selectedEndpoint && (
        <WebhookReceipt accountId={accountId} slug={slug} endpointId={selectedEndpoint.id} />
      )}

      <Modal
        open={Boolean(activeDisclosure)}
        title="Copy Stripe endpoint URL"
        description="This URL is shown once. Save it in Stripe before closing. The signing secret and URL cannot be retrieved later."
        onClose={dismissDisclosure}
        footer={
          <Button type="button" size="sm" disabled={!acknowledged} onClick={dismissDisclosure}>
            Done
          </Button>
        }
      >
        {activeDisclosure && (
          <div className="space-y-4 text-sm">
            <p>
              Endpoint <strong>{activeDisclosure.name}</strong> was created. Copy this URL into
              Stripe's webhook destination.
            </p>
            <input
              aria-label="One-time endpoint URL"
              className={`${FIELD} font-mono`}
              readOnly
              value={activeDisclosure.url}
              onFocus={(event) => event.target.select()}
            />
            <Button type="button" size="sm" variant="outline" onClick={() => void copyUrl()}>
              Copy URL
            </Button>
            {copyFailed && (
              <p role="status">Select and copy the URL manually from the field above.</p>
            )}
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              <span>I saved this URL in Stripe</span>
            </label>
          </div>
        )}
      </Modal>
    </div>
  );
}
