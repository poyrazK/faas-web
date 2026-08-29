import { useState } from 'react';
import { Refresh, Trash } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { FIELD, Select } from '@/components/ui/field';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { InlinePhase, Panel, queryPhase } from './primitives';
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

/**
 * The organisation itself — name, plan, seats, and the two owner-level acts
 * (transfer, and the org-scoped API keys CI should use instead of a
 * person's account key).
 */
export function OrgPanel({ slug }: { slug: string }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const org = useOrg(slug);
  const seats = useSeatUsage(slug);
  const members = useOrgMembers(slug);
  const patch = usePatchOrg(slug);
  const transfer = useTransferOwnership(slug);

  const [name, setName] = useState('');
  const [newOwner, setNewOwner] = useState('');

  const memberRows = members.data?.members ?? [];

  return (
    <Panel
      title="Organisation"
      description={
        seats.data
          ? `${seats.data.used} of ${seats.data.limit} seats used on the ${seats.data.plan} plan.`
          : 'Identity and ownership.'
      }
    >
      <div className="flex flex-col gap-5">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim() || patch.isPending) return;
            void patch
              .mutateAsync({ name: name.trim() })
              .then(() => {
                setName('');
                toast({ kind: 'success', title: 'Organisation renamed' });
              })
              .catch((err: unknown) =>
                toast({ kind: 'error', title: 'Could not rename', description: errorMessage(err) })
              );
          }}
        >
          <label className="flex min-w-52 flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">Display name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={org.data?.name ?? slug}
              className={FIELD}
            />
          </label>
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={!name.trim()}
            busy={patch.isPending}
          >
            Rename
          </Button>
        </form>

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
                    'They become the owner; you keep your current role. Only the new owner can transfer it back.',
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
      </div>
    </Panel>
  );
}

/**
 * Org-scoped API keys: minted against the organisation, so CI keeps working
 * when a person leaves. Plaintext appears exactly once, on create or
 * rotate.
 */
export function OrgKeysPanel({ slug }: { slug: string }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const keys = useOrgKeys(slug);
  const create = useCreateOrgKey(slug);
  const remove = useDeleteOrgKey(slug);
  const rotate = useRotateOrgKey(slug);

  const [label, setLabel] = useState('');
  const [plaintext, setPlaintext] = useState<string | null>(null);

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
      {plaintext && (
        <div
          role="alert"
          className="mb-4 flex flex-col gap-2 rounded-lg border p-4"
          style={{ borderColor: 'color-mix(in oklab, var(--status-warning) 45%, transparent)' }}
        >
          <p className="text-sm font-medium">Copy this key now — it will not be shown again</p>
          <code className="select-all rounded-md border border-border bg-background px-3 py-2 font-mono text-xs break-all">
            {plaintext}
          </code>
          <Button
            size="sm"
            variant="ghost"
            className="self-start"
            onClick={() => setPlaintext(null)}
          >
            I have saved it
          </Button>
        </div>
      )}

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!label.trim() || create.isPending) return;
          void create
            .mutateAsync({ label: label.trim(), scopes: ['deploy:write', 'apps:read'] })
            .then((key) => {
              setLabel('');
              setPlaintext(key.plaintext ?? null);
              toast({ kind: 'success', title: 'Key created' });
            })
            .catch((err: unknown) =>
              toast({ kind: 'error', title: 'Could not create', description: errorMessage(err) })
            );
        }}
      >
        <label className="flex min-w-44 flex-col gap-1.5">
          <span className="label-mono text-muted-foreground">Label</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="ci-deploy"
            className={`${FIELD} font-mono`}
          />
        </label>
        <Button type="submit" size="sm" disabled={!label.trim()} busy={create.isPending}>
          Create key
        </Button>
      </form>

      <div className="mt-4 border-t border-border pt-1">
        {phase !== 'ready' ? (
          <div className="pt-3">
            <InlinePhase
              phase={phase}
              error={keys.error}
              loadingMessage="Reading keys…"
              emptyMessage="No organisation keys yet."
            />
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
                  <button
                    type="button"
                    aria-label={`Rotate key ${k.label ?? k.prefix}`}
                    onClick={async () => {
                      if (
                        !(await confirm({
                          title: `Rotate ${k.label ?? k.prefix}?`,
                          description:
                            'A new key is minted; the old one keeps working for the grace window.',
                          confirmLabel: 'Rotate key',
                        }))
                      )
                        return;
                      void rotate
                        .mutateAsync(k.id)
                        .then((r) => {
                          setPlaintext(r.key_plaintext ?? null);
                          toast({ kind: 'success', title: 'Key rotated' });
                        })
                        .catch((err: unknown) =>
                          toast({
                            kind: 'error',
                            title: 'Could not rotate',
                            description: errorMessage(err),
                          })
                        );
                    }}
                    className="pressable rounded p-1 text-muted-foreground hover:text-foreground"
                  >
                    <Refresh className="h-3.5 w-3.5" />
                  </button>
                  <button
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
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
