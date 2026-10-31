import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { FIELD } from '@/components/ui/field';
import { Panel } from '@/components/dashboard/primitives';
import { useCapability } from '@/lib/api/capabilities';
import { useAutomations } from '@/lib/api/automations';
import { ApiError } from '@/lib/api/client';
import { errorMessage } from '@/lib/api/errors';
import {
  deleteWebhookBinding,
  putWebhookBinding,
  useWebhookBinding,
  webhookBindingKey,
} from '@/lib/api/inbound-webhooks';

export function WebhookAutomationBinding(props: {
  accountId: string;
  slug: string;
  endpointId: string;
}) {
  return <BindingContext key={`${props.accountId}/${props.slug}/${props.endpointId}`} {...props} />;
}

function BindingContext({
  accountId,
  slug,
  endpointId,
}: {
  accountId: string;
  slug: string;
  endpointId: string;
}) {
  const capability = useCapability('workflows-and-jobs');
  const automations = useAutomations(accountId, slug);
  const binding = useWebhookBinding(accountId, slug, endpointId);
  const cache = useQueryClient();
  const confirm = useConfirm();
  const mounted = useRef(true);
  const [workflow, setWorkflow] = useState('');
  const [eventType, setEventType] = useState('');
  const [busy, setBusy] = useState(false);
  const [conflicted, setConflicted] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const available =
    capability.state === 'available' &&
    capability.accountId === accountId &&
    Boolean(automations.data?.runtime_enabled) &&
    !automations.error;
  const availableRef = useRef(available);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    availableRef.current = available;
  }, [available]);
  const bindingReady = !binding.isPending && !binding.error && binding.data !== undefined;
  const published = (automations.data?.automations ?? []).filter((automation) =>
    Boolean(automation.published)
  );
  const selected = published.find((automation) => automation.name === workflow);
  const maySave =
    available &&
    bindingReady &&
    Boolean(selected) &&
    eventType.trim().length > 0 &&
    eventType.trim().length <= 256 &&
    !busy &&
    !conflicted;

  async function save() {
    if (!maySave || !selected) return;
    const operation = crypto.randomUUID();
    const version = binding.data?.version ?? 0;
    const chosenEventType = eventType.trim();
    const approved = await confirm({
      title: 'Route Stripe events to this automation?',
      description: `Future verified ${chosenEventType} events for endpoint ${endpointId} will start published automation ${selected.name} instead of app delivery. Already accepted events keep their captured routing decision.`,
      confirmLabel: 'Take over delivery',
    });
    if (!approved || !mounted.current || !availableRef.current) return;
    setBusy(true);
    setMessage(null);
    try {
      await putWebhookBinding(
        slug,
        endpointId,
        {
          expected_version: version,
          workflow_name: selected.name,
          event_type: chosenEventType,
          ...(binding.data?.filter ? { filter: binding.data.filter } : {}),
          take_over_delivery: true,
        },
        operation
      );
      if (mounted.current) {
        setMessage('Binding saved for future events. No automation run has been verified.');
        void cache.invalidateQueries({ queryKey: webhookBindingKey(accountId, slug, endpointId) });
      }
    } catch (caught) {
      if (!mounted.current) return;
      if (caught instanceof ApiError && caught.status === 409) {
        setConflicted(true);
        setMessage('The binding changed. Review the refreshed version before saving again.');
        void binding.refetch();
      } else {
        setMessage(`Binding outcome needs inspection: ${errorMessage(caught)}`);
        void binding.refetch();
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function remove() {
    const version = binding.data?.version;
    if (!available || !bindingReady || !version || busy || conflicted) return;
    const approved = await confirm({
      title: 'Restore app delivery?',
      description: `Remove version ${version} of the binding for endpoint ${endpointId}. Future verified events return to app delivery; already accepted receipts keep their captured decision.`,
      confirmLabel: 'Remove binding',
      destructive: true,
    });
    if (!approved || !mounted.current || !availableRef.current) return;
    setBusy(true);
    setMessage(null);
    try {
      await deleteWebhookBinding(slug, endpointId, version);
      if (mounted.current) {
        setMessage('Binding removed for future events. Accepted work remains queued.');
        const refreshed = await binding.refetch();
        if (mounted.current && !refreshed.isSuccess) {
          setConflicted(true);
          setMessage(
            'Removal accepted, but current binding metadata could not be verified. Refresh before another change.'
          );
        }
      }
    } catch (caught) {
      if (mounted.current) {
        if (caught instanceof ApiError && caught.status === 409) setConflicted(true);
        setMessage(
          caught instanceof ApiError && caught.status === 409
            ? 'The binding changed. Review the refreshed version before removing it.'
            : `Removal outcome needs inspection: ${errorMessage(caught)}`
        );
        void binding.refetch();
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function reviewConflict() {
    const result = await binding.refetch();
    if (!mounted.current) return;
    if (result.isSuccess) {
      setConflicted(false);
      setMessage(
        'Current binding metadata refreshed. Review the version and delivery decision before submitting.'
      );
    }
  }

  return (
    <Panel
      title="Automation binding"
      description="A binding routes future verified Stripe events directly to a published automation instead of the app path."
    >
      <div className="space-y-4 text-sm">
        {!available && (
          <p role="status">
            Workflows unavailable for this account or runtime. Published same-app automations are
            required.
          </p>
        )}
        {automations.error && (
          <p role="alert">Could not read automations: {errorMessage(automations.error)}</p>
        )}
        {binding.error ? (
          <p role="alert">Could not read the current binding: {errorMessage(binding.error)}</p>
        ) : null}
        {binding.data && (
          <p>
            Current binding: <strong>{binding.data.workflow_name}</strong> ·{' '}
            {binding.data.event_type} · version {binding.data.version}. This is configured routing,
            not evidence of a successful run.
          </p>
        )}
        <label className="flex flex-col gap-1.5">
          <span className="label-mono text-muted-foreground">Published automation</span>
          <select
            className={FIELD}
            value={workflow}
            onChange={(event) => setWorkflow(event.target.value)}
          >
            <option value="">Choose a published automation</option>
            {published.map((automation) => (
              <option key={automation.name} value={automation.name}>
                {automation.name}
                {automation.enabled ? '' : ' (paused)'}
              </option>
            ))}
          </select>
        </label>
        {published.length === 0 && (
          <p>No published same-app automation is available. Publish one before binding.</p>
        )}
        <label className="flex flex-col gap-1.5">
          <span className="label-mono text-muted-foreground">Stripe event type</span>
          <input
            className={`${FIELD} font-mono`}
            value={eventType}
            onChange={(event) => setEventType(event.target.value)}
            maxLength={256}
            placeholder="payment_intent.succeeded"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            disabled={!maySave}
            busy={busy}
            onClick={() => void save()}
          >
            Review binding
          </Button>
          {binding.data && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!available || !bindingReady || busy || conflicted}
              onClick={() => void remove()}
            >
              Remove binding
            </Button>
          )}
          {conflicted && (
            <Button type="button" size="sm" variant="outline" onClick={() => void reviewConflict()}>
              Review refreshed binding
            </Button>
          )}
        </div>
        {message && <p role="status">{message}</p>}
      </div>
    </Panel>
  );
}
