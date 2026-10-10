import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { FIELD } from '@/components/ui/field';
import { Panel } from '@/components/dashboard/primitives';
import { ApiError } from '@/lib/api/client';
import { errorMessage } from '@/lib/api/errors';
import { useWebhookReceipt } from '@/lib/api/inbound-webhooks';

export function WebhookReceipt({
  accountId,
  slug,
  endpointId,
}: {
  accountId: string;
  slug: string;
  endpointId: string;
}) {
  return (
    <WebhookReceiptContext
      key={`${accountId}/${slug}/${endpointId}`}
      accountId={accountId}
      slug={slug}
      endpointId={endpointId}
    />
  );
}

function WebhookReceiptContext({
  accountId,
  slug,
  endpointId,
}: {
  accountId: string;
  slug: string;
  endpointId: string;
}) {
  const [draft, setDraft] = useState('');
  const [eventId, setEventId] = useState('');
  const receipt = useWebhookReceipt(accountId, slug, endpointId, eventId);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = draft.trim();
    if (next === eventId && next) void receipt.refetch();
    else setEventId(next);
  }

  const result = eventId ? receipt.data : undefined;
  const params = new URLSearchParams({
    tab: 'Automations',
    automation: result?.workflow_name ?? '',
    automationView: 'runs',
    automationRun: result?.run_id ?? '',
  });

  return (
    <Panel
      title="Known event receipt"
      description="Look up a Stripe event ID you already know. This is a single retained routing receipt, not an event inbox."
    >
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="label-mono text-muted-foreground">Stripe event ID</span>
          <input
            className={`${FIELD} font-mono`}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setEventId('');
            }}
            autoComplete="off"
            spellCheck={false}
            placeholder="evt_…"
          />
        </label>
        <Button type="submit" size="sm" disabled={!draft.trim()}>
          Look up receipt
        </Button>
      </form>
      {eventId && receipt.isPending && <p className="mt-3 text-sm">Looking up receipt…</p>}
      {eventId && Boolean(receipt.error) && (
        <p role="alert" className="mt-3 text-sm text-muted-foreground">
          {receipt.error instanceof ApiError && receipt.error.status === 404
            ? 'No retained receipt was found for this endpoint and event ID. Check the ID and retention window.'
            : `Receipt lookup failed: ${errorMessage(receipt.error)}`}
        </p>
      )}
      {eventId && receipt.data === null && (
        <p role="alert" className="mt-3 text-sm text-muted-foreground">
          No retained receipt was found for this endpoint and event ID. Check the ID and retention
          window.
        </p>
      )}
      {result && (
        <div className="mt-4 space-y-2 text-sm">
          <p>
            <span className="font-mono">{result.provider_event_id}</span> ·{' '}
            {result.duplicate ? 'Duplicate event already accepted' : `Receipt ${result.status}`}
          </p>
          <p>
            Automation <strong>{result.workflow_name}</strong> · Routing {result.routing_status}
            {result.ignored_reason ? ` (${result.ignored_reason.replaceAll('_', ' ')})` : ''}
          </p>
          <p className="text-muted-foreground">
            Acceptance and routing do not prove the automation run succeeded. Inspect run status
            separately.
          </p>
          {result.run_id && (
            <a
              className="text-brand underline"
              href={`/dashboard/workflows/${encodeURIComponent(slug)}?${params.toString()}`}
            >
              Inspect automation run
            </a>
          )}
        </div>
      )}
    </Panel>
  );
}
