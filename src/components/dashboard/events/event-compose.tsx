import { useState, type FormEvent, type ReactNode } from 'react';
import { InlinePhase } from '@/components/dashboard/primitives';
import { SegmentedControl } from '@/components/dashboard/tabs';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { Select, Textarea } from '@/components/ui/field';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { ApiError, errorMessage } from '@/lib/api/errors';
import {
  usePreviewEvent,
  usePublishAppEvent,
  usePublishEvent,
  type PreviewSubscription,
} from '@/lib/api/events';
import { useApps } from '@/lib/api/queries';
import { formatNumber } from '@/lib/mock-data';
import { consumerName, parsePayload, type ReceiptLookup } from './event-format';

/* --- Shared envelope fields --------------------------------------------- */

interface Envelope {
  source: string;
  type: string;
  schemaversion: string;
  data: string;
}
const EMPTY_ENVELOPE: Envelope = { source: '', type: '', schemaversion: '', data: '{}' };
type Errors = Partial<Record<'source' | 'type' | 'id' | 'key' | 'data', string>>;

function validateEnvelope(env: Envelope, withSource: boolean): Errors {
  const payload = parsePayload(env.data);
  return {
    ...(withSource && !env.source.trim() ? { source: 'Enter the event source.' } : {}),
    ...(!env.type.trim() ? { type: 'Enter the event type, such as invoice.paid.' } : {}),
    ...(payload.ok ? {} : { data: payload.error }),
  };
}

function EnvelopeFields({
  prefix,
  value,
  onChange,
  errors,
  showErrors,
  withSource = true,
  children,
}: {
  prefix: string;
  value: Envelope;
  onChange: (next: Envelope) => void;
  errors: Errors;
  showErrors: boolean;
  withSource?: boolean;
  /** Identity fields that sit between source/type and the payload. */
  children?: ReactNode;
}) {
  const set = (field: keyof Envelope) => (e: { target: { value: string } }) =>
    onChange({ ...value, [field]: e.target.value });
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {withSource && (
          <FormField
            id={`${prefix}-source`}
            label="Source"
            error={errors.source}
            showError={showErrors}
          >
            {(props) => (
              <Input
                {...props}
                value={value.source}
                onChange={set('source')}
                spellCheck={false}
                autoComplete="off"
              />
            )}
          </FormField>
        )}
        <FormField id={`${prefix}-type`} label="Type" error={errors.type} showError={showErrors}>
          {(props) => (
            <Input
              {...props}
              value={value.type}
              onChange={set('type')}
              spellCheck={false}
              autoComplete="off"
            />
          )}
        </FormField>
      </div>
      {children}
      <FormField
        id={`${prefix}-schema`}
        label="Schema version (optional)"
        hint="Required once a JSON Schema is registered for this source and type."
      >
        {(props) => (
          <Input
            {...props}
            value={value.schemaversion}
            onChange={set('schemaversion')}
            spellCheck={false}
            autoComplete="off"
          />
        )}
      </FormField>
      <FormField
        id={`${prefix}-data`}
        label="Payload (JSON)"
        error={errors.data}
        showError={showErrors}
      >
        {(props) => (
          <Textarea
            {...props}
            value={value.data}
            onChange={set('data')}
            spellCheck={false}
            rows={6}
            className="font-mono text-xs"
          />
        )}
      </FormField>
    </div>
  );
}

const hasErrors = (errors: Errors) => Object.values(errors).some(Boolean);
const schemaField = (env: Envelope) =>
  env.schemaversion.trim() ? { schemaversion: env.schemaversion.trim() } : {};

function DialogActions({ children }: { children: ReactNode }) {
  return <div className="flex justify-end gap-2 border-t border-border pt-4">{children}</div>;
}

/* --- Preview ------------------------------------------------------------- */

const PREVIEW_REASONS: Record<string, string> = {
  would_deliver: 'Would receive it',
  content_filter_mismatch: 'Content filter does not match',
  pattern_mismatch: 'Type pattern does not match',
  tenant_mismatch: 'Different tenant',
};

export function PreviewEventDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Preview routing"
      description="Evaluates an event against your enabled subscriptions without publishing it. Nothing is stored and nothing is delivered."
      width="max-w-2xl"
    >
      {open && <PreviewBody onClose={onClose} />}
    </Modal>
  );
}

function PreviewBody({ onClose }: { onClose: () => void }) {
  const [env, setEnv] = useState<Envelope>(EMPTY_ENVELOPE);
  const [id, setId] = useState('');
  const [attempted, setAttempted] = useState(false);
  const preview = usePreviewEvent();
  const errors = validateEnvelope(env, true);

  const change = (next: Envelope) => {
    setEnv(next);
    // A result describes the inputs that produced it; edits make it stale.
    if (preview.data || preview.error) preview.reset();
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    const payload = parsePayload(env.data);
    if (hasErrors(errors) || !payload.ok) return;
    preview.mutate({
      source: env.source.trim(),
      type: env.type.trim(),
      data: payload.value,
      ...(id.trim() ? { id: id.trim() } : {}),
      ...schemaField(env),
    });
  };

  const result = preview.data;
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <EnvelopeFields
        prefix="preview"
        value={env}
        onChange={change}
        errors={errors}
        showErrors={attempted}
      >
        <FormField
          id="preview-id"
          label="Event ID (optional)"
          hint="Only needed when a subscription filters on the event ID."
        >
          {(props) => (
            <Input
              {...props}
              value={id}
              onChange={(e) => setId(e.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
          )}
        </FormField>
      </EnvelopeFields>
      <InlinePhase
        phase={preview.error ? 'error' : preview.isPending ? 'loading' : 'ready'}
        error={preview.error}
        loadingMessage="Evaluating subscriptions…"
      />
      {result && (
        <section aria-label="Routing preview" className="flex flex-col gap-3 text-sm">
          <p role="status">
            Would reach <strong>{formatNumber(result.matched_count)}</strong> of{' '}
            {formatNumber(result.candidate_count)} candidate subscription
            {result.candidate_count === 1 ? '' : 's'}.
            {result.filter_mismatch_count > 0 &&
              ` ${formatNumber(result.filter_mismatch_count)} excluded by content filters.`}
            {(result.schema_version_mismatch_count ?? 0) > 0 &&
              ` ${formatNumber(result.schema_version_mismatch_count ?? 0)} excluded by schema version.`}
          </p>
          <PreviewList title="Would receive" items={result.matches} />
          <PreviewList title="Would not receive" items={result.non_matches} />
          {result.truncated && (
            <p className="text-xs text-muted-foreground">
              The lists are samples; the counts above cover every candidate.
            </p>
          )}
          <p className="text-xs text-muted-foreground">Nothing was published.</p>
        </section>
      )}
      <DialogActions>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
        <Button type="submit" size="sm" disabled={preview.isPending}>
          Preview routing
        </Button>
      </DialogActions>
    </form>
  );
}

function PreviewList({ title, items }: { title: string; items: PreviewSubscription[] }) {
  if (!items.length) return null;
  return (
    <div>
      <h3 className="label-mono text-muted-foreground">{title}</h3>
      <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
        {items.map((item) => (
          <li
            key={`${item.subscription_id}:${item.workflow_name ?? ''}`}
            className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
          >
            <span className="min-w-0">
              <span className="block truncate font-medium">{consumerName(item)}</span>
              <span className="font-mono text-xs text-muted-foreground">
                {item.source} · {item.type}
              </span>
            </span>
            <span className="text-xs text-muted-foreground">
              {PREVIEW_REASONS[item.reason] ?? item.reason}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* --- Publish ------------------------------------------------------------- */

type PublishMode = 'account' | 'app';
interface Published {
  lookup: ReceiptLookup;
  acceptedAt: string;
  duplicate: boolean;
}

function publishError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code === 'conflict')
      return 'This ID was already accepted with different content. Use a new ID, or resend the original content unchanged.';
    if (error.code === 'event_storage_capacity_exhausted')
      return 'Retained event storage is full. Storage frees as receipts age out of retention.';
  }
  return errorMessage(error);
}

export function PublishEventDialog({
  open,
  accountId,
  onClose,
  onViewReceipt,
}: {
  open: boolean;
  accountId: string;
  onClose: () => void;
  onViewReceipt: (lookup: ReceiptLookup) => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Publish event"
      description="Publishing delivers the event to every subscription that matches it. An accepted event cannot be recalled."
      width="max-w-2xl"
    >
      {open && (
        <PublishBody accountId={accountId} onClose={onClose} onViewReceipt={onViewReceipt} />
      )}
    </Modal>
  );
}

function PublishBody({
  accountId,
  onClose,
  onViewReceipt,
}: {
  accountId: string;
  onClose: () => void;
  onViewReceipt: (lookup: ReceiptLookup) => void;
}) {
  const [mode, setMode] = useState<PublishMode>('account');
  const [env, setEnv] = useState<Envelope>(EMPTY_ENVELOPE);
  const [id, setId] = useState<string>(() => crypto.randomUUID());
  const [slug, setSlug] = useState('');
  const [key, setKey] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [published, setPublished] = useState<Published | null>(null);
  const confirm = useConfirm();
  const { toast } = useToast();
  const publish = usePublishEvent(accountId);
  const publishApp = usePublishAppEvent(accountId);
  const apps = useApps({ enabled: mode === 'app' });
  const chosenSlug = slug || apps.data?.[0]?.slug || '';
  const pending = publish.isPending || publishApp.isPending;

  const errors: Errors = {
    ...validateEnvelope(env, mode === 'account'),
    ...(mode === 'account' && !id.trim() ? { id: 'Enter an event ID.' } : {}),
    ...(mode === 'app' && !/^[!-~]{1,256}$/.test(key)
      ? { key: 'Enter a key of printable characters without spaces.' }
      : {}),
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    setFailure(null);
    const payload = parsePayload(env.data);
    if (hasErrors(errors) || !payload.ok || (mode === 'app' && !chosenSlug)) return;
    const target =
      mode === 'account'
        ? `${env.source.trim()} / ${id.trim()}`
        : `${chosenSlug}, producer key ${key}`;
    const ok = await confirm({
      title: `Publish ${env.type.trim()}?`,
      description: `${target}. Every matching subscription receives it and runs its handler. This cannot be undone; retrying with the same identity and content is safe.`,
      confirmLabel: 'Publish',
    });
    if (!ok) return;
    try {
      if (mode === 'account') {
        const receipt = await publish.mutateAsync({
          id: id.trim(),
          source: env.source.trim(),
          type: env.type.trim(),
          data: payload.value,
          ...schemaField(env),
        });
        setPublished({
          lookup: { source: env.source.trim(), id: id.trim() },
          acceptedAt: receipt.accepted_at,
          duplicate: false,
        });
      } else {
        const result = await publishApp.mutateAsync({
          slug: chosenSlug,
          body: { key, type: env.type.trim(), data: payload.value, ...schemaField(env) },
        });
        setPublished({
          lookup: { source: result.source, id: result.receipt.id },
          acceptedAt: result.receipt.accepted_at,
          duplicate: result.duplicate,
        });
      }
      toast({ kind: 'success', title: 'Event accepted' });
    } catch (error) {
      setFailure(publishError(error));
    }
  };

  if (published) {
    return (
      <div className="flex flex-col gap-4 text-sm">
        <p role="status">
          {published.duplicate
            ? 'Already accepted earlier with identical content; nothing was published again.'
            : 'Accepted for routing. Acceptance is not delivery — the receipt shows where it went.'}
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Source</dt>
          <dd className="break-all font-mono">{published.lookup.source}</dd>
          <dt className="text-muted-foreground">Event ID</dt>
          <dd className="break-all font-mono">{published.lookup.id}</dd>
          <dt className="text-muted-foreground">Accepted at</dt>
          <dd className="font-mono">{published.acceptedAt}</dd>
        </dl>
        <DialogActions>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button type="button" size="sm" onClick={() => onViewReceipt(published.lookup)}>
            View receipt
          </Button>
        </DialogActions>
      </div>
    );
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4" noValidate>
      <SegmentedControl
        label="Publish as"
        value={mode}
        onChange={(next) => {
          setMode(next);
          setFailure(null);
        }}
        options={[
          { key: 'account', label: 'Account event' },
          { key: 'app', label: 'App producer key' },
        ]}
      />
      <EnvelopeFields
        prefix="publish"
        value={env}
        onChange={setEnv}
        errors={errors}
        showErrors={attempted}
        withSource={mode === 'account'}
      >
        {mode === 'account' ? (
          <FormField
            id="publish-id"
            label="Event ID"
            hint="Unique per source. Resending the same ID and content returns the original acceptance."
            error={errors.id}
            showError={attempted}
          >
            {(props) => (
              <Input
                {...props}
                value={id}
                onChange={(e) => setId(e.target.value)}
                spellCheck={false}
                autoComplete="off"
                className="font-mono"
              />
            )}
          </FormField>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField id="publish-app" label="App">
              {(props) => (
                <Select
                  {...props}
                  value={chosenSlug}
                  onChange={(e) => setSlug(e.target.value)}
                  disabled={!apps.data?.length}
                >
                  {(apps.data ?? []).map((a) => (
                    <option key={a.slug} value={a.slug}>
                      {a.slug}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField
              id="publish-key"
              label="Producer key"
              hint="Stable per publication; the app's UUID becomes the source."
              error={errors.key}
              showError={attempted}
            >
              {(props) => (
                <Input
                  {...props}
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                  className="font-mono"
                />
              )}
            </FormField>
          </div>
        )}
      </EnvelopeFields>
      {failure && (
        <p role="alert" className="text-sm" style={{ color: 'var(--status-critical)' }}>
          {failure}
        </p>
      )}
      <DialogActions>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Publishing…' : 'Publish…'}
        </Button>
      </DialogActions>
    </form>
  );
}
