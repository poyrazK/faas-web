import { useMemo, useState } from 'react';
import { Plus, Refresh, Trash } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { ActionDisclosure } from '@/components/ui/action-disclosure';
import { OneTimeSecret, useOneTimeSecret } from '@/components/ui/one-time-secret';
import {
  KeyRotationContext,
  useKeyRotationPolicy,
} from '@/components/dashboard/key-rotation-policy';
import { FieldError, fieldErrorProps, useFormValidation } from '@/components/ui/field';
import { PageHeader, Panel } from '@/components/dashboard/primitives';
import { Pill, ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import {
  useApiKeys,
  useCreateApiKey,
  useDeleteApiKey,
  useRotateApiKey,
  useGraceWindow,
  useSetGraceWindow,
} from '@/lib/api/queries';
import { errorMessage } from '@/lib/api/errors';

/**
 * API keys, from `/v1/keys`.
 *
 * **The plaintext is returned exactly once**, on create and on rotate. After
 * that the API only ever surfaces the prefix, and there is no recovery path —
 * so the reveal panel below is not a nicety, it is the only chance the customer
 * gets. It stays until dismissed rather than auto-hiding.
 *
 * Rotation is not deletion: the old key keeps working for a grace window
 * (`/v1/account/keys/grace_window_days`) so a deploy mid-rotation does not fail.
 */
const SCOPES = [
  'admin',
  'deploy:write',
  'apps:read',
  'secrets:read',
  'secrets:write',
  'env:read',
  'env:write',
  'usage:read',
] as const;
type Scope = (typeof SCOPES)[number];

interface KeyRow {
  id: string;
  label: string;
  prefix: string;
  scopes: string;
  lastUsedAt: string | null;
}

function formatWhen(value: string | null | undefined): string {
  if (!value) return 'Never';
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? 'Never' : new Date(ms).toLocaleDateString();
}

/** How long a rotated key's predecessor keeps working. Plan default unless
 * overridden here — a deploy mid-rotation should not fail. */
function GraceWindowPanel() {
  const { toast } = useToast();
  const q = useGraceWindow();
  const set = useSetGraceWindow();
  const [days, setDays] = useState('');
  const validation = useFormValidation<'days'>();
  const parsedDays = Number(days);
  const daysError =
    days !== '' && Number.isInteger(parsedDays) && parsedDays >= 0
      ? undefined
      : 'Enter a whole number of days, zero or greater.';
  const shownDaysError = validation.submitAttempted ? daysError : undefined;
  return (
    <Panel
      title="Rotation grace window"
      description="Account-wide override for future personal-key rotations. Zero revokes the old key immediately; restoring the plan default clears the override."
    >
      <form
        noValidate
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!validation.validate({ days: daysError }, event.currentTarget) || set.isPending)
            return;
          void set
            .mutateAsync(parsedDays)
            .then(() => {
              validation.resetValidation();
              toast({ kind: 'success', title: 'Grace window updated' });
            })
            .catch((err: unknown) =>
              toast({ kind: 'error', title: 'Could not update', description: errorMessage(err) })
            );
        }}
      >
        <label className="flex flex-col gap-1.5">
          <span className="label-mono text-muted-foreground">Days</span>
          <input
            name="days"
            type="number"
            min={0}
            step={1}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            placeholder={q.data?.days == null ? undefined : String(q.data.days)}
            {...fieldErrorProps(shownDaysError, 'grace-days-error')}
            className="h-9 w-24 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand/50 [font-variant-numeric:tabular-nums]"
          />
          {shownDaysError && <FieldError id="grace-days-error">{shownDaysError}</FieldError>}
        </label>
        <Button type="submit" size="sm" variant="outline" busy={set.isPending}>
          Save
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={q.data?.days == null}
          busy={set.isPending}
          onClick={() =>
            void set
              .mutateAsync(null)
              .then(() => {
                setDays('');
                validation.resetValidation();
                toast({ kind: 'success', title: 'Plan default restored' });
              })
              .catch((err: unknown) =>
                toast({
                  kind: 'error',
                  title: 'Could not restore default',
                  description: errorMessage(err),
                })
              )
          }
        >
          Use plan default
        </Button>
        {q.data && (
          <p className="text-xs text-muted-foreground">Plan default {q.data.plan_default} days.</p>
        )}
      </form>
    </Panel>
  );
}

export function PersonalKeysBody() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const { data, isPending, error, refetch } = useApiKeys();
  const createKey = useCreateApiKey();
  const deleteKey = useDeleteApiKey();
  const rotateKey = useRotateApiKey();
  const policy = useKeyRotationPolicy('personal');
  const [creating, setCreating] = useState(false);

  const [label, setLabel] = useState('');
  // Admin is the whole account; the others are the least a CI job or an
  // exporter needs. A key minted with nothing selected gets the server's
  // default, which is admin — so the picker defaults to something narrower.
  const [scopes, setScopes] = useState<Scope[]>(['apps:read', 'deploy:write']);
  const evidence = useOneTimeSecret<string>();
  const validation = useFormValidation<'label'>();
  const labelError = label.length > 100 ? 'Use 100 characters or fewer.' : undefined;
  const shownLabelError = validation.submitAttempted ? labelError : undefined;

  const rows = useMemo<KeyRow[]>(
    () =>
      (data ?? []).map((k) => ({
        id: k.id,
        label: k.label ?? '—',
        prefix: k.prefix,
        scopes: k.scopes.join(', '),
        lastUsedAt: k.last_used_at ?? null,
      })),
    [data]
  );

  const columns: Column<KeyRow>[] = [
    { key: 'label', label: 'Label' },
    {
      key: 'prefix',
      label: 'Key',
      render: (k) => <span className="font-mono text-xs">{k.prefix}…</span>,
    },
    {
      key: 'scopes',
      label: 'Scopes',
      priority: 'secondary',
      render: (k) => (
        <span className="flex flex-wrap gap-1">
          {k.scopes ? (
            k.scopes.split(', ').map((s) => <Pill key={s} label={s} />)
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </span>
      ),
    },
    {
      key: 'lastUsedAt',
      label: 'Last used',
      priority: 'secondary',
      numeric: true,
      render: (k) => (
        <span className="text-xs text-muted-foreground">{formatWhen(k.lastUsedAt)}</span>
      ),
    },
    {
      key: 'id',
      label: '',
      width: 'w-20',
      render: (k) => (
        <span className="flex items-center gap-3">
          <IconButton
            type="button"
            aria-label={`Rotate ${k.label}`}
            disabled={policy.days === undefined || rotateKey.isPending}
            onClick={async (event) => {
              const origin = event.currentTarget;
              if (policy.days === undefined) return;
              if (
                !(await confirm({
                  title: `Rotate ${k.label}?`,
                  description: `A new key is minted and shown once. ${policy.context}`,
                  confirmLabel: 'Rotate key',
                }))
              )
                return;
              const receive = evidence.capture(() => origin.focus());
              void rotateKey
                .mutateAsync(k.id)
                .then((result) => {
                  receive(result.key_plaintext);
                  toast({
                    kind: 'success',
                    title: 'Key rotated',
                    description: policy.context,
                  });
                })
                .catch((err: unknown) =>
                  toast({
                    kind: 'error',
                    title: 'Could not rotate',
                    description: errorMessage(err),
                  })
                )
                .finally(() => rotateKey.reset());
            }}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <Refresh className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton
            type="button"
            aria-label={`Revoke ${k.label}`}
            onClick={async () => {
              if (
                !(await confirm({
                  title: `Revoke ${k.label}?`,
                  description:
                    'Anything using this key — CI, the CLI — fails on its next request. There is no grace window.',
                  confirmLabel: 'Revoke key',
                  destructive: true,
                }))
              )
                return;
              void deleteKey
                .mutateAsync(k.id)
                .then(() => toast({ kind: 'success', title: 'Key revoked' }))
                .catch((err: unknown) =>
                  toast({
                    kind: 'error',
                    title: 'Could not revoke',
                    description: errorMessage(err),
                  })
                );
            }}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <Trash className="h-3.5 w-3.5" />
          </IconButton>
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Personal API keys"
        description="Bearer keys for the CLI and the API. Revoking is immediate; rotating leaves the old key valid for its grace window."
      />

      {!creating && evidence.secret && (
        <OneTimeSecret
          key={evidence.version}
          value={evidence.secret}
          title="API key rotated"
          description="This key will not be shown again."
          onDismiss={evidence.dismiss}
        />
      )}

      <ActionDisclosure
        action="Create key"
        title="Create a key"
        open={creating}
        onOpenChange={(open) => {
          evidence.clear();
          setLabel('');
          setScopes(['apps:read', 'deploy:write']);
          validation.resetValidation();
          setCreating(open);
        }}
      >
        <div className="flex flex-col gap-5">
          <KeyRotationContext context={policy.context} />
          {evidence.secret ? (
            <OneTimeSecret
              key={evidence.version}
              value={evidence.secret}
              title="New API key"
              description="This key will not be shown again."
              onDismiss={evidence.clear}
            />
          ) : (
            <form
              noValidate
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (
                  !validation.validate({ label: labelError }, e.currentTarget) ||
                  scopes.length === 0 ||
                  createKey.isPending
                )
                  return;
                const receive = evidence.capture();
                void createKey
                  .mutateAsync({ label: label.trim() || undefined, scopes })
                  .then((result) => {
                    // `plaintext` on create; the rotate response calls the same
                    // thing `key_plaintext`. Both are the only copy that exists.
                    if (receive(result.plaintext ?? null)) {
                      setLabel('');
                      validation.resetValidation();
                    }
                  })
                  .catch((err: unknown) =>
                    toast({
                      kind: 'error',
                      title: 'Could not create key',
                      description: errorMessage(err),
                    })
                  )
                  .finally(() => createKey.reset());
              }}
            >
              <label className="flex min-w-56 flex-1 flex-col gap-1.5">
                <span className="label-mono text-muted-foreground">Label</span>
                <input
                  autoFocus
                  name="label"
                  maxLength={100}
                  value={label}
                  {...fieldErrorProps(shownLabelError, 'key-label-error')}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="ci-deploy"
                  className="h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-brand"
                />
                {shownLabelError && <FieldError id="key-label-error">{shownLabelError}</FieldError>}
              </label>
              <fieldset className="flex basis-full flex-col gap-1.5">
                <legend className="label-mono text-muted-foreground">Scopes</legend>
                <div className="flex flex-wrap gap-1.5 pt-1.5">
                  {SCOPES.map((scope) => {
                    const on = scopes.includes(scope);
                    return (
                      <button
                        key={scope}
                        type="button"
                        aria-pressed={on}
                        onClick={() =>
                          setScopes((prev) =>
                            // admin implies the rest; picking it clears the narrower ones
                            scope === 'admin'
                              ? on
                                ? []
                                : ['admin']
                              : (on ? prev.filter((x) => x !== scope) : [...prev, scope]).filter(
                                  (x) => x !== 'admin'
                                )
                          )
                        }
                        className={`pressable h-8 rounded-md border px-2.5 font-mono text-xs ${
                          on
                            ? 'border-brand bg-brand/10 text-foreground'
                            : 'border-border text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {scope}
                      </button>
                    );
                  })}
                </div>
                <span className="text-xs text-muted-foreground">
                  {scopes.includes('admin')
                    ? 'Admin can do everything this account can, including minting more keys.'
                    : scopes.length === 0
                      ? 'Pick at least one scope.'
                      : 'Least privilege: a CI job needs deploy:write and apps:read, nothing more.'}
                </span>
              </fieldset>
              <Button
                type="submit"
                size="sm"
                className="gap-1.5"
                disabled={scopes.length === 0}
                busy={createKey.isPending}
              >
                <Plus className="h-3.5 w-3.5" />
                Create key
              </Button>
            </form>
          )}
          <GraceWindowPanel />
        </div>
      </ActionDisclosure>

      <ResourceTable
        rows={rows}
        columns={columns}
        initialSort={{ key: 'label', dir: 'asc' }}
        searchKeys={['label', 'prefix']}
        searchPlaceholder="Filter by label…"
        emptyMessage="No API keys yet."
        emptyAction={
          !creating && (
            <Button
              size="sm"
              onClick={() => {
                evidence.clear();
                setCreating(true);
              }}
            >
              Create your first key
            </Button>
          )
        }
        minWidth="min-w-[820px]"
        loading={isPending}
        error={error}
        onRetry={() => void refetch()}
      />
    </div>
  );
}
