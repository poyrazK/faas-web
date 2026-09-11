import { useState } from 'react';
import { Refresh, Trash } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import {
  FIELD,
  Select,
  FieldError,
  fieldErrorProps,
  useFormValidation,
} from '@/components/ui/field';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { ActionDisclosure } from '@/components/ui/action-disclosure';
import { OneTimeSecret, useOneTimeSecret } from '@/components/ui/one-time-secret';
import { KeyRotationContext, useKeyRotationPolicy } from './key-rotation-policy';
import { EmptyState, InlinePhase, Panel, queryPhase } from './primitives';
import {
  useCreateOrgKey,
  useOrgKeys,
  useDeleteOrgKey,
  useOrg,
  useOrgMembers,
  usePatchOrg,
  useRotateOrgKey,
  useSeatUsage,
  useTransferOwnership,
} from '@/lib/api/queries';
import { errorMessage } from '@/lib/api/errors';
import { formatRelative } from '@/lib/mock-data';
import { useAuth } from '@/lib/auth';

/**
 * Organization identity, seats and ownership. Shared keys have their own scope.
 */
export function OrgPanel({ slug }: { slug: string }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const org = useOrg(slug);
  const seats = useSeatUsage(slug);
  const members = useOrgMembers(slug);
  const patch = usePatchOrg(slug);
  const transfer = useTransferOwnership(slug);
  const { user } = useAuth();
  const ownRole = members.error
    ? undefined
    : members.data?.members.find((m) => m.email === user?.email)?.role;
  const mutable = Boolean(org.data && !org.error && !org.data.personal);
  const canRename = mutable && (ownRole === 'owner' || ownRole === 'billing');
  const canTransfer = mutable && ownRole === 'owner';

  const [name, setName] = useState('');
  const [newOwner, setNewOwner] = useState('');
  const validation = useFormValidation<'name'>();
  const nameError =
    name.trim() && name.trim().length <= 256 ? undefined : 'Enter a name of 1–256 characters.';
  const shownNameError = validation.submitAttempted ? nameError : undefined;

  const memberRows = (members.data?.members ?? []).filter((m) => m.role !== 'owner');

  return (
    <Panel
      title="Organisation"
      description={
        seats.data
          ? seats.data.limit === 0
            ? `Personal organizations only on the ${seats.data.plan} plan. Shared member seats are not included.`
            : `${seats.data.used} of ${seats.data.limit} seats used on the ${seats.data.plan} plan.`
          : 'Identity and ownership.'
      }
    >
      <div className="flex flex-col gap-5">
        {org.error || members.error || seats.error ? (
          <div>
            <p role="alert">{errorMessage(org.error ?? members.error ?? seats.error)}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void org.refetch();
                void members.refetch();
                void seats.refetch();
              }}
            >
              Retry organization
            </Button>
          </div>
        ) : null}
        {org.data && <p className="text-sm">{org.data.name}</p>}
        {org.data?.personal && (
          <p className="text-sm text-muted-foreground">
            Personal organizations cannot be renamed or deleted.
          </p>
        )}
        {canRename && (
          <form
            noValidate
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!validation.validate({ name: nameError }, e.currentTarget) || patch.isPending)
                return;
              void patch
                .mutateAsync({ name: name.trim() })
                .then(() => {
                  setName('');
                  validation.resetValidation();
                  toast({ kind: 'success', title: 'Organisation renamed' });
                })
                .catch((err: unknown) =>
                  toast({
                    kind: 'error',
                    title: 'Could not rename',
                    description: errorMessage(err),
                  })
                );
            }}
          >
            <label className="flex min-w-52 flex-col gap-1.5">
              <span className="label-mono text-muted-foreground">Display name</span>
              <input
                name="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={org.data?.name ?? slug}
                className={FIELD}
                {...fieldErrorProps(shownNameError, 'org-rename-error')}
              />
            </label>
            {shownNameError && <FieldError id="org-rename-error">{shownNameError}</FieldError>}
            <Button type="submit" size="sm" variant="outline" busy={patch.isPending}>
              Rename
            </Button>
          </form>
        )}

        {canTransfer && (
          <div className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
            <label className="flex min-w-52 flex-col gap-1.5">
              <span className="label-mono text-muted-foreground">Transfer ownership to</span>
              <Select value={newOwner} onChange={(e) => setNewOwner(e.target.value)}>
                <option value="">Choose a member…</option>
                {memberRows.map((m) => (
                  <option key={m.account_id} value={m.account_id}>
                    {m.email}
                  </option>
                ))}
              </Select>
            </label>
            <Button
              size="sm"
              variant="outline"
              disabled={!newOwner}
              busy={transfer.isPending}
              onClick={async () => {
                const target = memberRows.find((m) => m.account_id === newOwner);
                if (
                  !(await confirm({
                    title: `Transfer ownership to ${target?.email}?`,
                    description:
                      'They become the owner; you become an admin. Only the new owner can transfer it back.',
                    confirmLabel: 'Transfer ownership',
                    destructive: true,
                    typeToConfirm: slug,
                  }))
                )
                  return;
                void transfer
                  .mutateAsync(newOwner)
                  .then(() => {
                    setNewOwner('');
                    toast({ kind: 'success', title: 'Ownership transferred' });
                  })
                  .catch((err: unknown) =>
                    toast({
                      kind: 'error',
                      title: 'Could not transfer',
                      description: errorMessage(err),
                    })
                  );
              }}
            >
              Transfer
            </Button>
          </div>
        )}
      </div>
    </Panel>
  );
}

/**
 * Org-scoped API keys: minted against the organisation, so CI keeps working
 * when a person leaves. Plaintext appears exactly once, on create or
 * rotate.
 */
export function OrgKeysPanel({ slug, canManage = true }: { slug: string; canManage?: boolean }) {
  return <OrgKeysBody key={slug} slug={slug} canManage={canManage} />;
}

function OrgKeysBody({ slug, canManage }: { slug: string; canManage: boolean }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const keys = useOrgKeys(slug);
  const create = useCreateOrgKey(slug);
  const remove = useDeleteOrgKey(slug);
  const rotate = useRotateOrgKey(slug);
  const policy = useKeyRotationPolicy();

  const [label, setLabel] = useState('');
  const [creating, setCreating] = useState(false);
  const evidence = useOneTimeSecret<string>();
  const validation = useFormValidation<'label'>();
  const labelError = !label.trim()
    ? 'Enter a label.'
    : label.length > 100
      ? 'Use 100 characters or fewer.'
      : undefined;
  const shownLabelError = validation.submitAttempted ? labelError : undefined;

  const rows = keys.data?.keys ?? [];
  const phase = queryPhase({
    error: keys.error,
    loading: keys.isPending,
    isEmpty: rows.length === 0,
  });

  return (
    <Panel
      title="Organisation keys"
      description="Minted against the org, not a person — CI keeps deploying when someone leaves."
    >
      {!creating && evidence.secret && (
        <OneTimeSecret
          key={evidence.version}
          value={evidence.secret}
          title="Organisation key rotated"
          description="This key will not be shown again."
          onDismiss={evidence.dismiss}
        />
      )}

      <ActionDisclosure
        action="Create key"
        title="Create a key"
        open={creating}
        disabled={!canManage}
        onOpenChange={(open) => {
          evidence.clear();
          setLabel('');
          validation.resetValidation();
          setCreating(open);
        }}
      >
        <div className="flex flex-col gap-4">
          <KeyRotationContext context={policy.context} />
          {evidence.secret ? (
            <OneTimeSecret
              key={evidence.version}
              value={evidence.secret}
              title="New organisation key"
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
                  create.isPending ||
                  !canManage
                )
                  return;
                const receive = evidence.capture();
                void create
                  .mutateAsync({ label: label.trim(), scopes: ['deploy:write', 'apps:read'] })
                  .then((key) => {
                    if (receive(key.plaintext ?? null)) {
                      setLabel('');
                      validation.resetValidation();
                      toast({ kind: 'success', title: 'Key created' });
                    }
                  })
                  .catch((err: unknown) =>
                    toast({
                      kind: 'error',
                      title: 'Could not create',
                      description: errorMessage(err),
                    })
                  )
                  .finally(() => create.reset());
              }}
            >
              <label className="flex min-w-44 flex-col gap-1.5">
                <span className="label-mono text-muted-foreground">Label</span>
                <input
                  autoFocus
                  name="label"
                  maxLength={100}
                  value={label}
                  {...fieldErrorProps(shownLabelError, 'org-key-label-error')}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="ci-deploy"
                  className={`${FIELD} font-mono`}
                />
                {shownLabelError && (
                  <FieldError id="org-key-label-error">{shownLabelError}</FieldError>
                )}
              </label>
              <Button type="submit" size="sm" busy={create.isPending}>
                Create key
              </Button>
            </form>
          )}
        </div>
      </ActionDisclosure>
      {!canManage && (
        <p className="mt-3 text-sm text-muted-foreground">
          Only organization owners and admins can create, rotate or revoke keys.
        </p>
      )}

      <div className="mt-4 border-t border-border pt-1">
        {phase !== 'ready' ? (
          <div className="pt-3">
            {phase === 'empty' ? (
              <EmptyState
                message="No organization keys yet."
                action={
                  canManage && !creating ? (
                    <Button
                      size="sm"
                      onClick={() => {
                        evidence.clear();
                        setCreating(true);
                      }}
                    >
                      Create your first key
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <InlinePhase phase={phase} error={keys.error} loadingMessage="Loading keys…" />
            )}
            {keys.error && (
              <Button
                className="mt-3"
                variant="outline"
                size="sm"
                onClick={() => void keys.refetch()}
              >
                Retry keys
              </Button>
            )}
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {rows.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-xs">
                <span className="font-mono">{k.label ?? '—'}</span>
                <span className="font-mono text-muted-foreground">{k.prefix}…</span>
                <span className="text-muted-foreground">
                  {k.last_used_at
                    ? `used ${formatRelative(Date.parse(k.last_used_at))}`
                    : 'never used'}
                </span>
                <span className="ml-auto flex items-center gap-2">
                  {canManage && (
                    <>
                      <IconButton
                        type="button"
                        aria-label={`Rotate key ${k.label ?? k.prefix}`}
                        disabled={policy.days === undefined || rotate.isPending}
                        onClick={async (event) => {
                          const origin = event.currentTarget;
                          if (policy.days === undefined) return;
                          if (
                            !(await confirm({
                              title: `Rotate ${k.label ?? k.prefix}?`,
                              description: `A new key is minted and shown once. ${policy.context}`,
                              confirmLabel: 'Rotate key',
                            }))
                          )
                            return;
                          const receive = evidence.capture(() => origin.focus());
                          void rotate
                            .mutateAsync(k.id)
                            .then((r) => {
                              receive(r.key_plaintext ?? null);
                              toast({ kind: 'success', title: 'Key rotated' });
                            })
                            .catch((err: unknown) =>
                              toast({
                                kind: 'error',
                                title: 'Could not rotate',
                                description: errorMessage(err),
                              })
                            )
                            .finally(() => rotate.reset());
                        }}
                        className="pressable rounded p-1 text-muted-foreground hover:text-foreground"
                      >
                        <Refresh className="h-3.5 w-3.5" />
                      </IconButton>
                      <IconButton
                        type="button"
                        aria-label={`Revoke key ${k.label ?? k.prefix}`}
                        onClick={async () => {
                          if (
                            !(await confirm({
                              title: `Revoke ${k.label ?? k.prefix}?`,
                              description: 'Anything deploying with it fails on its next call.',
                              confirmLabel: 'Revoke key',
                              destructive: true,
                            }))
                          )
                            return;
                          void remove
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
                        className="pressable rounded p-1 text-muted-foreground hover:text-foreground"
                      >
                        <Trash className="h-3.5 w-3.5" />
                      </IconButton>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
