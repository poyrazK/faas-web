import { useMemo, useState } from 'react';
import { EditPencil, List, Refresh, Trash } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { IconButton } from '@/components/ui/icon-button';
import { Modal } from '@/components/ui/modal';
import { OneTimeSecret, useOneTimeSecret } from '@/components/ui/one-time-secret';
import { Switch } from '@/components/ui/switch';
import { Timestamp } from '@/components/ui/timestamp';
import { useToast } from '@/components/ui/toast';
import { useCapability } from '@/lib/api/capabilities';
import { useApps } from '@/lib/api/queries';
import { useAuth } from '@/lib/auth';
import {
  useCreateReleaseWebhook,
  useDeleteReleaseWebhook,
  useReleaseWebhooks,
  useRotateReleaseWebhookSecret,
  useUpdateReleaseWebhook,
  type CreateReleaseWebhook,
  type ReleaseWebhook,
  type UpdateReleaseWebhook,
} from '@/lib/api/release-webhooks';
import { useWorkspaceTarget } from '@/lib/api/workspace-apps';
import { setActiveOrg } from '@/lib/workspace';
import { CliCommand } from './cli-command';
import { InlinePhase, PageHeader, Panel, queryPhase } from './primitives';
import { ReleaseWebhookForm, type ReleaseWebhookValues } from './release-webhook-form';
import { Pill } from './resource-table';
import { RotateSecretDialog, generateWebhookSecret } from './rotate-secret-dialog';
import { WebhookDeliveries } from './webhook-deliveries';

const SIGNING =
  'Each delivery carries X-Faas-Webhook-Signature: sha256=<hex>, an HMAC-SHA256 with this secret over <X-Faas-Webhook-Timestamp>.<X-Faas-Delivery-Id>.<raw body>. Verify it before parsing, reject stale timestamps, and deduplicate by delivery ID.';

function valuesOf(hook: ReleaseWebhook): ReleaseWebhookValues {
  return {
    target: hook.target_url,
    events: hook.event_filter,
    retryPolicy: hook.retry_policy,
    format: hook.delivery_format,
    ownSecret: '',
    startPaused: false,
  };
}

/** Only the fields that changed: PATCH keeps what is omitted. */
function changes(before: ReleaseWebhook, after: ReleaseWebhookValues): UpdateReleaseWebhook {
  const body: UpdateReleaseWebhook = {};
  if (after.target !== before.target_url) body.target_url = after.target;
  if (after.events.join() !== before.event_filter.join())
    body.event_filter = after.events as UpdateReleaseWebhook['event_filter'];
  if (after.retryPolicy !== before.retry_policy) body.retry_policy = after.retryPolicy;
  if (after.format !== before.delivery_format) body.delivery_format = after.format;
  return body;
}

function Receivers() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const accountId = useAuth().account?.id ?? '';
  const hooks = useReleaseWebhooks(accountId);
  const apps = useApps();
  const create = useCreateReleaseWebhook(accountId);
  const update = useUpdateReleaseWebhook(accountId);
  const remove = useDeleteReleaseWebhook(accountId);
  const rotate = useRotateReleaseWebhookSecret(accountId);
  const evidence = useOneTimeSecret<{ value: string; target: string; paused: boolean }>();
  const [viewing, setViewing] = useState<ReleaseWebhook | null>(null);
  const [editing, setEditing] = useState<ReleaseWebhook | null>(null);
  const [rotating, setRotating] = useState<ReleaseWebhook | null>(null);
  const appNames = useMemo(
    () => new Map((apps.data ?? []).map((a) => [a.id, a.slug])),
    [apps.data]
  );
  const list = hooks.data ?? [];
  const phase = queryPhase({
    error: hooks.error,
    loading: hooks.isPending,
    isEmpty: list.length === 0,
  });

  const add = async (values: ReleaseWebhookValues) => {
    const secret = values.ownSecret || generateWebhookSecret();
    const receive = evidence.capture();
    try {
      await create.mutateAsync({
        target_url: values.target,
        webhook_secret: secret,
        event_filter: values.events as CreateReleaseWebhook['event_filter'],
        retry_policy: values.retryPolicy,
        delivery_format: values.format,
        enabled: !values.startPaused,
      });
    } catch {
      // The form shows create.error, worded by its code.
      return false;
    }
    // A pasted secret is already in the person's hands; never echo it.
    if (!values.ownSecret)
      receive({ value: secret, target: values.target, paused: values.startPaused });
    toast({
      kind: 'success',
      title: values.startPaused ? 'Receiver added, paused' : 'Receiver added',
      ...(values.startPaused
        ? { description: 'Turn it on once your receiver has the secret.' }
        : {}),
    });
    return true;
  };

  const save = async (hook: ReleaseWebhook, values: ReleaseWebhookValues) => {
    const body = changes(hook, values);
    if (Object.keys(body).length === 0) {
      setEditing(null);
      return false;
    }
    try {
      await update.mutateAsync({ id: hook.id, ...body });
    } catch {
      return false;
    }
    setEditing(null);
    toast({ kind: 'success', title: 'Receiver updated' });
    return false;
  };

  const setEnabled = (hook: ReleaseWebhook, enabled: boolean) =>
    void update
      .mutateAsync({ id: hook.id, enabled })
      .then(() =>
        toast({ kind: 'success', title: enabled ? 'Receiver enabled' : 'Receiver paused' })
      )
      .catch((err: unknown) => toast({ kind: 'error', title: 'Could not update', error: err }));

  const del = async (hook: ReleaseWebhook) => {
    if (
      !(await confirm({
        title: 'Delete this receiver?',
        description: `${hook.target_url} stops receiving release events, and its delivery history is deleted with it. Export anything you need for audit first.`,
        confirmLabel: 'Delete receiver',
        destructive: true,
      }))
    )
      return;
    void remove
      .mutateAsync(hook.id)
      .then(() => toast({ kind: 'success', title: 'Receiver deleted' }))
      .catch((err: unknown) => toast({ kind: 'error', title: 'Could not delete', error: err }));
  };

  return (
    <>
      <Panel
        lit
        title="Add a receiver"
        description="Release events from every app you own, including apps you create later, are POSTed to it and signed. Its slot counts toward the same per-account webhook limit as app webhooks."
      >
        <div className="flex flex-col gap-5">
          {evidence.secret && (
            <OneTimeSecret
              key={evidence.version}
              value={evidence.secret.value}
              title={`Signing secret for ${evidence.secret.target}`}
              description={`Install it on your receiver; you won't see it again.${
                evidence.secret.paused
                  ? ' The receiver is paused: turn it on in the list below once the secret is installed.'
                  : ''
              } ${SIGNING}`}
              onDismiss={evidence.dismiss}
            />
          )}
          <ReleaseWebhookForm
            mode="create"
            busy={create.isPending}
            error={create.error}
            onSubmit={add}
          />
        </div>
      </Panel>

      <Panel title="Receivers" padded={false}>
        {phase !== 'ready' ? (
          <div className="p-5">
            <InlinePhase
              phase={phase}
              error={hooks.error}
              loadingMessage="Loading receivers…"
              emptyMessage="No release receivers yet."
              onRetry={() => void hooks.refetch()}
            />
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {list.map((hook) => (
              <li
                key={hook.id}
                aria-label={hook.target_url}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3"
              >
                <div className="flex min-w-0 flex-1 basis-72 flex-col gap-1.5">
                  <span className="break-all font-mono text-xs">{hook.target_url}</span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    {hook.event_filter.map((event) => (
                      <Pill key={event} label={event} />
                    ))}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Retries {hook.retry_policy} ·{' '}
                    {hook.delivery_format === 'cloudevents' ? 'CloudEvents' : 'Gregale JSON'} ·
                    added <Timestamp value={hook.created_at} />
                  </span>
                </div>
                <span className="flex items-center gap-2">
                  <Switch
                    size="sm"
                    checked={hook.enabled}
                    onCheckedChange={(on) => setEnabled(hook, on)}
                    aria-label={`${hook.enabled ? 'Pause' : 'Enable'} receiver ${hook.target_url}`}
                    className="data-[state=checked]:bg-brand"
                  />
                  <IconButton
                    aria-label={`Deliveries for ${hook.target_url}`}
                    onClick={() => setViewing(hook)}
                    className="text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <List className="h-3.5 w-3.5" />
                  </IconButton>
                  <IconButton
                    aria-label={`Edit receiver ${hook.target_url}`}
                    onClick={() => {
                      update.reset();
                      setEditing(hook);
                    }}
                    className="text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <EditPencil className="h-3.5 w-3.5" />
                  </IconButton>
                  <IconButton
                    aria-label={`Rotate secret for ${hook.target_url}`}
                    onClick={() => setRotating(hook)}
                    className="text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <Refresh className="h-3.5 w-3.5" />
                  </IconButton>
                  <IconButton
                    aria-label={`Delete receiver ${hook.target_url}`}
                    disabled={remove.isPending}
                    onClick={() => void del(hook)}
                    className="text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <Trash className="h-3.5 w-3.5" />
                  </IconButton>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Verifying and recovering">
        <div className="flex flex-col gap-3 text-xs text-muted-foreground">
          <p>{SIGNING}</p>
          <p>
            Failed deliveries back off and go dead after their last try; a dead one can be sent
            again from its receiver's deliveries. Succeeded and dead deliveries, with their
            attempts, are kept for 90 days after their last update.
          </p>
          <CliCommand
            command="gregale webhooks account list"
            label="The same receivers from the CLI"
            copyLabel="release webhooks list command"
          />
        </div>
      </Panel>

      <Modal
        open={viewing !== null}
        onClose={() => setViewing(null)}
        title="Deliveries"
        description={viewing?.target_url}
        width="max-w-2xl"
      >
        {viewing && (
          <WebhookDeliveries
            source={{ id: viewing.id, accountId }}
            target={viewing.target_url}
            appName={(id) => appNames.get(id)}
          />
        )}
      </Modal>
      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title="Edit receiver"
        description="Changes apply to the next delivery. The secret is changed with Rotate."
        width="max-w-xl"
      >
        {editing && (
          <ReleaseWebhookForm
            key={editing.id}
            mode="edit"
            initial={valuesOf(editing)}
            busy={update.isPending}
            error={update.error}
            onSubmit={(values) => save(editing, values)}
          />
        )}
      </Modal>
      {rotating && (
        <RotateSecretDialog
          name={rotating.target_url}
          onClose={() => setRotating(null)}
          onRotate={(webhookSecret) =>
            rotate
              .mutateAsync({ id: rotating.id, webhookSecret })
              .then(() => toast({ kind: 'success', title: 'Secret rotated' }))
          }
        />
      )}
    </>
  );
}

/**
 * Account release webhooks (faas ADR-224): one signed receiver for deployment,
 * rollout and GitOps events from every app the signed-in account owns.
 *
 * They are the personal account's, whatever the workspace: the routes ignore
 * X-Active-Org. A company workspace gets an explanation instead of the
 * personal list; a receiver there still hears the company's events while its
 * owner is a member (ADR-20261026151103 §5).
 */
export function ReleaseWebhooks() {
  const workspace = useWorkspaceTarget();
  const { capability } = useCapability('account-release-webhooks');
  const maturity =
    capability?.maturity === 'beta' ? 'Beta' : capability?.maturity === 'preview' ? 'Preview' : '';
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Release webhooks"
        description="One signed receiver for deployment and rollout events from every app you own."
        actions={maturity ? <Pill label={maturity} /> : undefined}
      />
      {!workspace.ready ? null : workspace.org ? (
        <Panel title="Release webhooks are personal">
          <div className="flex flex-col items-start gap-3 text-sm text-muted-foreground">
            <p>
              Release webhooks belong to your personal account, not to {workspace.label}. A receiver
              you add there also gets {workspace.label}’s deployment, rollout and GitOps events for
              as long as you are a member.
            </p>
            <Button size="sm" variant="outline" onClick={() => setActiveOrg(null)}>
              Switch to your personal workspace
            </Button>
          </div>
        </Panel>
      ) : (
        <Receivers />
      )}
    </div>
  );
}
