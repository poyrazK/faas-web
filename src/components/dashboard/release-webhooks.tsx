import { useState, type FormEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { EditPencil, ListSelect, Plus, Refresh, Trash } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { CopyableId } from '@/components/ui/copyable-id';
import { FIELD, FieldError, fieldErrorProps } from '@/components/ui/field';
import { OneTimeSecret, useOneTimeSecret } from '@/components/ui/one-time-secret';
import { Switch } from '@/components/ui/switch';
import { Timestamp } from '@/components/ui/timestamp';
import { useToast } from '@/components/ui/toast';
import { useCapability, useCapabilityAccess } from '@/lib/api/capabilities';
import { ApiError, errorMessage } from '@/lib/api/errors';
import {
  createReleaseWebhookOnce,
  releaseWebhooksKey,
  rotateReleaseWebhookSecretOnce,
  useDeleteReleaseWebhook,
  useReleaseWebhooks,
  useUpdateReleaseWebhook,
  type ReleaseEvent,
  type ReleaseWebhook,
} from '@/lib/api/release-webhooks';
import { cn } from '@/lib/utils';
import { MaturityLabel } from './maturity-label';
import { Panel } from './primitives';
import { ProblemHelp } from './problem-help';
import { ResourceTable, type Column } from './resource-table';
import {
  RotateSecretDialog,
  WEBHOOK_SECRET_MAX,
  generateWebhookSecret,
} from './rotate-secret-dialog';
import { SegmentedControl } from './tabs';
import { WebhookDeliveries } from './webhook-deliveries';

/** The account release vocabulary (faas pkg/api/webhooks.go:141-144). */
const RELEASE_EVENTS = [
  'deployment.live',
  'deployment.failed',
  'rollout.completed',
  'rollout.aborted',
] as const satisfies readonly ReleaseEvent[];
/** Accepted too, for accounts with environment GitOps (preview). */
const GITOPS_EVENT = 'environment.gitops.changed' satisfies ReleaseEvent;

type Format = 'json' | 'cloudevents';
type Retry = 'default' | 'aggressive' | 'none';
const FORMATS: { key: Format; label: string }[] = [
  { key: 'json', label: 'Gregale JSON' },
  { key: 'cloudevents', label: 'CloudEvents 1.0' },
];
const RETRY_LABEL: Record<Retry, string> = {
  default: 'default — back off over 7 tries',
  aggressive: 'aggressive — tighter back-off',
  none: 'none — one attempt',
};

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function useEventOptions(): readonly ReleaseEvent[] {
  const gitops = useCapabilityAccess('environment-gitops').access === 'on';
  return gitops ? [...RELEASE_EVENTS, GITOPS_EVENT] : RELEASE_EVENTS;
}

function EventPicker({
  value,
  onChange,
  error,
  errorId,
}: {
  value: ReleaseEvent[];
  onChange: (events: ReleaseEvent[]) => void;
  error?: string;
  errorId: string;
}) {
  const options = useEventOptions();
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5" {...fieldErrorProps(error, errorId)}>
      <legend className="label-mono text-muted-foreground">Events</legend>
      <div className="flex flex-wrap gap-1.5 pt-1.5">
        {options.map((ev) => {
          const on = value.includes(ev);
          return (
            <label
              key={ev}
              className={cn(
                'pressable inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 font-mono text-xs',
                on
                  ? 'border-brand bg-brand/10 text-foreground'
                  : 'border-border text-muted-foreground'
              )}
            >
              <input
                type="checkbox"
                checked={on}
                onChange={() => onChange(on ? value.filter((x) => x !== ev) : [...value, ev])}
                className="h-3.5 w-3.5 accent-[color:var(--brand)]"
              />
              {ev}
            </label>
          );
        })}
      </div>
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </fieldset>
  );
}

/** A refusal in words: the plan gate and the shared webhook quota first. */
function refusal(err: unknown): string {
  if (err instanceof ApiError && err.code === 'plan_webhooks_not_allowed')
    return 'Release receivers come with outbound webhooks, on Hobby and above.';
  return errorMessage(err);
}

/**
 * Account release receivers (faas ADR-224): one signed endpoint for release
 * events from every app the account owns, including apps created later. Each
 * one takes a slot of the per-account webhook quota it shares with app
 * webhooks.
 */
export function ReleaseWebhooks() {
  const hooks = useReleaseWebhooks();
  const { capability } = useCapability('account-release-webhooks');
  const update = useUpdateReleaseWebhook();
  const remove = useDeleteReleaseWebhook();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { toast } = useToast();
  const evidence = useOneTimeSecret<string>();
  const [selected, setSelected] = useState<string | null>(null);
  const [rotating, setRotating] = useState<ReleaseWebhook | null>(null);

  const list = hooks.data ?? [];
  const planGated =
    hooks.error instanceof ApiError && hooks.error.code === 'plan_webhooks_not_allowed';
  const current = list.find((h) => h.id === selected);

  const setEnabled = (hook: ReleaseWebhook, enabled: boolean) =>
    void update
      .mutateAsync({ id: hook.id, body: { enabled } })
      .then(() =>
        toast({ kind: 'success', title: enabled ? 'Receiver enabled' : 'Receiver paused' })
      )
      .catch((err: unknown) => toast({ kind: 'error', title: 'Could not update', error: err }));

  const askDelete = async (hook: ReleaseWebhook) => {
    if (
      !(await confirm({
        title: 'Delete this release receiver?',
        description: `${hook.target_url} stops receiving release events, and its delivery history is deleted with it. Export anything you need for audit first.`,
        confirmLabel: 'Delete receiver',
        destructive: true,
      }))
    )
      return;
    try {
      await remove.mutateAsync(hook.id);
      if (selected === hook.id) setSelected(null);
      toast({ kind: 'success', title: 'Receiver deleted' });
    } catch (err) {
      toast({ kind: 'error', title: 'Could not delete', error: err });
    }
  };

  const columns: Column<ReleaseWebhook & { events: string }>[] = [
    {
      key: 'target_url',
      label: 'Target URL',
      render: (h) => <span className="break-all font-mono text-xs">{h.target_url}</span>,
    },
    {
      key: 'events',
      label: 'Events',
      priority: 'secondary',
      render: (h) => <span className="text-xs text-muted-foreground">{h.events}</span>,
    },
    {
      key: 'delivery_format',
      label: 'Format',
      width: 'w-32',
      priority: 'secondary',
      render: (h) => <span className="font-mono text-xs">{h.delivery_format}</span>,
    },
    {
      key: 'enabled',
      label: 'Enabled',
      width: 'w-24',
      render: (h) => (
        <Switch
          size="sm"
          checked={h.enabled}
          onCheckedChange={(on) => setEnabled(h, on)}
          aria-label={`${h.enabled ? 'Pause' : 'Enable'} receiver ${h.target_url}`}
          className="data-[state=checked]:bg-brand"
        />
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <Panel
        lit
        title="Add a release receiver"
        description="One signed endpoint for deployment and rollout events from every app on the account, including apps you create later. It shares the account's webhook quota with app webhooks."
        actions={<MaturityLabel capability={capability} />}
      >
        <div className="flex flex-col gap-4">
          {evidence.secret && (
            <OneTimeSecret
              key={evidence.version}
              value={evidence.secret}
              title="Signing secret"
              description="Gregale generated this secret and sealed it; the API never returns it. Store it in your receiver's secret manager."
              onDismiss={evidence.dismiss}
            />
          )}
          {planGated ? (
            <p role="status" className="text-sm text-muted-foreground">
              {refusal(hooks.error)}{' '}
              <a className="text-brand underline" href="/dashboard/plans">
                View plans
              </a>
            </p>
          ) : (
            <CreateReceiver
              onCreated={(hook, generated) => {
                void qc.invalidateQueries({ queryKey: releaseWebhooksKey });
                setSelected(hook.id);
                return generated ? evidence.capture()(generated) : true;
              }}
            />
          )}
        </div>
      </Panel>

      {!planGated && (
        <ResourceTable
          rows={list.map((h) => ({ ...h, events: h.event_filter.join(', ') }))}
          columns={columns}
          initialSort={{ key: 'target_url', dir: 'asc' }}
          searchKeys={['target_url', 'events']}
          searchPlaceholder="Filter by target URL…"
          emptyMessage="No release receivers yet."
          minWidth="min-w-[760px]"
          loading={hooks.isPending}
          error={hooks.error}
          onRetry={() => void hooks.refetch()}
          onRowClick={(h) => setSelected(h.id)}
          rowActions={(h) => (
            <span className="flex items-center gap-3">
              <button
                type="button"
                aria-label={`Details for ${h.target_url}`}
                aria-pressed={selected === h.id}
                onClick={() => setSelected((cur) => (cur === h.id ? null : h.id))}
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                <ListSelect className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label={`Rotate secret for ${h.target_url}`}
                onClick={() => setRotating(h)}
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                <Refresh className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label={`Delete receiver ${h.target_url}`}
                onClick={() => void askDelete(h)}
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                <Trash className="h-3.5 w-3.5" />
              </button>
            </span>
          )}
        />
      )}

      {current && <ReceiverDetail hook={current} onClose={() => setSelected(null)} />}

      {rotating && (
        <RotateSecretDialog
          name={rotating.target_url}
          onClose={() => setRotating(null)}
          onRotate={(secret) =>
            rotateReleaseWebhookSecretOnce(rotating.id, secret).then(() => {
              void qc.invalidateQueries({ queryKey: releaseWebhooksKey });
              toast({ kind: 'success', title: 'Secret rotated' });
            })
          }
        />
      )}
    </div>
  );
}

/**
 * Write-only by construction: the secret lives in this form's state until the
 * POST settles and goes through a direct call, so it never enters the query
 * or mutation cache. Left empty, one is generated and shown once.
 */
function CreateReceiver({
  onCreated,
}: {
  /** Returns whether the one-time secret was accepted for display. */
  onCreated: (hook: ReleaseWebhook, generated: string | null) => boolean;
}) {
  const { toast } = useToast();
  const [target, setTarget] = useState('');
  const [events, setEvents] = useState<ReleaseEvent[]>([...RELEASE_EVENTS]);
  const [format, setFormat] = useState<Format>('json');
  const [retry, setRetry] = useState<Retry>('default');
  const [secret, setSecret] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);

  const url = target.trim();
  const errors = {
    target:
      url.length > 2048
        ? 'Target URLs can be at most 2048 characters.'
        : isHttpsUrl(url)
          ? undefined
          : 'Enter a complete HTTPS target URL.',
    events: events.length ? undefined : 'Choose at least one event.',
    secret:
      secret.length > WEBHOOK_SECRET_MAX
        ? `Enter a secret of at most ${WEBHOOK_SECRET_MAX} characters, or leave it empty.`
        : undefined,
  };
  const shown = (k: keyof typeof errors) => (attempted ? errors[k] : undefined);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    setFailure(null);
    if (Object.values(errors).some(Boolean) || saving) return;
    const generated = secret ? null : generateWebhookSecret();
    setSaving(true);
    try {
      const hook = await createReleaseWebhookOnce({
        target_url: url,
        webhook_secret: secret || (generated as string),
        event_filter: events,
        retry_policy: retry,
        delivery_format: format,
        enabled: true,
      });
      setTarget('');
      setSecret('');
      setAttempted(false);
      onCreated(hook, generated);
      toast({ kind: 'success', title: 'Release receiver added' });
    } catch (err) {
      setFailure(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      noValidate
      autoComplete="off"
      onSubmit={(e) => void submit(e)}
      className="grid grid-cols-1 gap-4 sm:grid-cols-2"
    >
      <label className="flex flex-col gap-1.5">
        <span className="label-mono text-muted-foreground">Target URL</span>
        <input
          name="target"
          maxLength={2048}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="https://platform.example.com/gregale/releases"
          spellCheck={false}
          className={cn(FIELD, 'font-mono')}
          {...fieldErrorProps(shown('target'), 'release-target-error')}
        />
        {shown('target') && <FieldError id="release-target-error">{shown('target')}</FieldError>}
      </label>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="release-secret" className="label-mono text-muted-foreground">
          Signing secret
        </label>
        <input
          id="release-secret"
          name="secret"
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder="Leave empty to generate one"
          autoComplete="new-password"
          className={cn(FIELD, 'font-mono')}
          {...fieldErrorProps(shown('secret'), 'release-secret-error')}
        />
        {shown('secret') ? (
          <FieldError id="release-secret-error">{shown('secret')}</FieldError>
        ) : (
          <span className="text-xs text-muted-foreground">
            Sealed on save and never readable through the API. A generated one is shown once.
          </span>
        )}
      </div>
      <div className="sm:col-span-2">
        <EventPicker
          value={events}
          onChange={setEvents}
          error={shown('events')}
          errorId="release-events-error"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="label-mono text-muted-foreground">Format</span>
        <SegmentedControl
          label="Delivery format"
          value={format}
          options={FORMATS}
          onChange={setFormat}
        />
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="label-mono text-muted-foreground">Retries</span>
        <select value={retry} onChange={(e) => setRetry(e.target.value as Retry)} className={FIELD}>
          {(Object.keys(RETRY_LABEL) as Retry[]).map((r) => (
            <option key={r} value={r}>
              {RETRY_LABEL[r]}
            </option>
          ))}
        </select>
      </label>
      {failure !== null && (
        <div role="alert" className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span style={{ color: 'var(--status-critical)' }}>{refusal(failure)}</span>
          <ProblemHelp error={failure} />
        </div>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" size="sm" busy={saving} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Add receiver
        </Button>
      </div>
    </form>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="label-mono text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-sm">{children}</dd>
    </div>
  );
}

function ReceiverDetail({ hook, onClose }: { hook: ReleaseWebhook; onClose: () => void }) {
  const [editing, setEditing] = useState(false);
  return (
    <Panel
      title="Release receiver"
      description="Release events from every app on the account"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="xs"
            variant="outline"
            className="gap-1"
            aria-expanded={editing}
            onClick={() => setEditing((v) => !v)}
          >
            <EditPencil className="h-3.5 w-3.5" />
            Edit
          </Button>
          <Button size="xs" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Target URL">
            <span className="break-all font-mono text-xs">{hook.target_url}</span>
          </Fact>
          <Fact label="Events">
            <span className="font-mono text-xs">{hook.event_filter.join(', ')}</span>
          </Fact>
          <Fact label="Format">
            {FORMATS.find((f) => f.key === hook.delivery_format)?.label ?? hook.delivery_format}
          </Fact>
          <Fact label="Retries">{hook.retry_policy}</Fact>
          <Fact label="State">{hook.enabled ? 'Enabled' : 'Paused'}</Fact>
          <Fact label="Created">
            <Timestamp value={hook.created_at} />
          </Fact>
          <Fact label="Updated">
            <Timestamp value={hook.updated_at} />
          </Fact>
          <Fact label="Receiver ID">
            <CopyableId value={hook.id} label="receiver ID" />
          </Fact>
        </dl>
        {editing && <EditReceiver hook={hook} onDone={() => setEditing(false)} />}
        <WebhookDeliveries scope={{ account: true, id: hook.id }} />
      </div>
    </Panel>
  );
}

function EditReceiver({ hook, onDone }: { hook: ReleaseWebhook; onDone: () => void }) {
  const { toast } = useToast();
  const update = useUpdateReleaseWebhook();
  const [target, setTarget] = useState(hook.target_url);
  const [events, setEvents] = useState<ReleaseEvent[]>(hook.event_filter);
  const [format, setFormat] = useState<Format>(hook.delivery_format);
  const [retry, setRetry] = useState<Retry>(hook.retry_policy);
  const [attempted, setAttempted] = useState(false);
  const url = target.trim();
  const errors = {
    target: isHttpsUrl(url) ? undefined : 'Enter a complete HTTPS target URL.',
    events: events.length ? undefined : 'Choose at least one event.',
  };
  const shown = (k: keyof typeof errors) => (attempted ? errors[k] : undefined);
  const save = () => {
    setAttempted(true);
    if (Object.values(errors).some(Boolean) || update.isPending) return;
    const same = (a: string[], b: string[]) =>
      a.length === b.length && a.every((x) => b.includes(x));
    const body = {
      ...(url !== hook.target_url ? { target_url: url } : {}),
      ...(!same(events, hook.event_filter) ? { event_filter: events } : {}),
      ...(format !== hook.delivery_format ? { delivery_format: format } : {}),
      ...(retry !== hook.retry_policy ? { retry_policy: retry } : {}),
    };
    if (Object.keys(body).length === 0) return onDone();
    void update
      .mutateAsync({ id: hook.id, body })
      .then(() => {
        toast({ kind: 'success', title: 'Receiver updated' });
        onDone();
      })
      .catch((err: unknown) => toast({ kind: 'error', title: 'Could not update', error: err }));
  };
  return (
    <form
      noValidate
      aria-label="Edit receiver"
      className="grid grid-cols-1 gap-4 rounded-lg border border-border p-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <label className="flex flex-col gap-1.5 sm:col-span-2">
        <span className="label-mono text-muted-foreground">Target URL</span>
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          maxLength={2048}
          spellCheck={false}
          className={cn(FIELD, 'font-mono')}
          {...fieldErrorProps(shown('target'), 'edit-release-target-error')}
        />
        {shown('target') && (
          <FieldError id="edit-release-target-error">{shown('target')}</FieldError>
        )}
      </label>
      <div className="sm:col-span-2">
        <EventPicker
          value={events}
          onChange={setEvents}
          error={shown('events')}
          errorId="edit-release-events-error"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="label-mono text-muted-foreground">Format</span>
        <SegmentedControl
          label="Delivery format"
          value={format}
          options={FORMATS}
          onChange={setFormat}
        />
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="label-mono text-muted-foreground">Retries</span>
        <select value={retry} onChange={(e) => setRetry(e.target.value as Retry)} className={FIELD}>
          {(Object.keys(RETRY_LABEL) as Retry[]).map((r) => (
            <option key={r} value={r}>
              {RETRY_LABEL[r]}
            </option>
          ))}
        </select>
      </label>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" size="sm" busy={update.isPending}>
          Save changes
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
