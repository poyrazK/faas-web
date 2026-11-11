import { useMemo, useState, type ReactNode } from 'react';
import { Copy, Plus, RefreshDouble, Trash } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/dashboard/kit/sheet';
import { ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { useToast } from '@/components/ui/toast';
import { Modal } from '@/components/ui/modal';
import { useConfirm } from '@/components/ui/confirm';
import { useAppSecrets, useFreshRestart, useSetSecret, useRotateSecret } from '@/lib/api/queries';
import { useRevokeSecret, type SecretRevocation } from '@/lib/api/secret-references';
import { SecretReferences } from '@/components/dashboard/secret-references';
import { SecretRevocationStatus } from '@/components/dashboard/secret-revocation-status';
import { EnvImportButton } from '@/components/dashboard/env-import';
import { SecretValueField } from '@/components/dashboard/secret-value-field';
import { FieldError } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import { Timestamp } from '@/components/ui/timestamp';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { useCopy } from '@/components/ui/copy-button';
import { configChangeNote } from '@/lib/config-history';
import {
  secretChangeVerb,
  secretDelivery,
  secretsLead,
  secretsState,
  type SecretRow as ApiSecret,
} from '@/components/dashboard/environment-words';
import { DANGER_ITEM, Lead, RowMenu, ToneWord } from '@/components/dashboard/environment-parts';

/** Mirrors the API's `^[A-Z][A-Z0-9_]*$` CHECK on secret names. */
const KEY_RULE = /^[A-Z][A-Z0-9_]*$/;

/**
 * Sealed secrets, from `/v1/apps/{slug}/secrets`.
 *
 * **Values are never readable, by anyone, including the server.** Each row is a
 * sealed envelope; the API returns the key name and timestamps and nothing
 * else. So there is no "reveal" affordance here and there cannot be one —
 * writing a new value is the only way to change a secret.
 *
 * Secrets are per-app: there is no account-wide list to show.
 */
interface SecretRow {
  id: string;
  key: string;
  updatedAt: string;
  createdAt: string;
  kid: string;
  /** Plain delivery word, also what the status column sorts on. */
  status: string;
  secret: ApiSecret;
}

/**
 * The secrets body, without the page chrome around it.
 *
 * Rendered both by this route and as a tab on the app detail page, so
 * the two can never drift into two different implementations of the
 * same resource.
 */
/** Where a body's actions go when the page gives it no heading of its own. */
const ownRow = (actions: ReactNode) => <div className="flex justify-end gap-2">{actions}</div>;

/**
 * `header` lets the page put this body's actions in its own heading row
 * rather than on a row of their own.
 */
export function SecretsBody({
  slug,
  header,
}: {
  slug: string;
  header?: (actions: ReactNode) => ReactNode;
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const { copy } = useCopy();
  const { data, isPending, error, refetch } = useAppSecrets(slug);
  const setSecret = useSetSecret(slug);
  const deleteSecret = useRevokeSecret(slug);
  // The receipt of the last delete: which running instances still hold it.
  const [revocation, setRevocation] = useState<SecretRevocation | null>(null);
  const rotate = useRotateSecret(slug);
  const freshRestart = useFreshRestart(slug);
  // A write seals the value and stamps the change, but starts nothing:
  // running instances read their environment once, at boot. Tracked per app so
  // switching apps never carries the notice across.
  const [unappliedFor, setUnappliedFor] = useState<string | null>(null);
  const unapplied = unappliedFor === slug;
  const [rotating, setRotating] = useState<string | null>(null);
  const [rotateValue, setRotateValue] = useState('');
  // Closing drops the typed value, which also puts the field back to masked.
  const closeRotate = () => {
    setRotating(null);
    setRotateValue('');
  };

  const [creating, setCreating] = useState(false);
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [keyTouched, setKeyTouched] = useState(false);
  // The server's own SQL CHECK for names, stated up front rather than as a
  // 422 after the round-trip.
  const keyOk = KEY_RULE.test(key.trim());
  const showKeyError = keyTouched && key.trim().length > 0 && !keyOk;

  const saveSecret = (name: string) =>
    void setSecret
      .mutateAsync({ key: name, value })
      .then((saved) => {
        setKey('');
        setValue('');
        setKeyTouched(false);
        setUnappliedFor(slug);
        setCreating(false);
        toast({
          kind: 'success',
          title: 'Secret saved',
          description: configChangeNote(saved?.config_change),
        });
      })
      .catch((err: unknown) => toast({ kind: 'error', title: 'Could not save', error: err }));

  const applyNow = async () => {
    if (
      !(await confirm({
        title: 'Restart with the new values?',
        description:
          'Replacement instances boot from scratch with the current secrets and environment variables. Old instances stop taking new requests and drain before they are destroyed.',
        confirmLabel: 'Restart now',
      }))
    )
      return;
    void freshRestart
      .mutateAsync()
      .then(() => {
        setUnappliedFor(null);
        toast({
          kind: 'success',
          title: 'Restart queued',
          description: 'Instances are replaced in the background.',
        });
      })
      .catch((err: unknown) => toast({ kind: 'error', title: 'Could not restart', error: err }));
  };

  const rows = useMemo<SecretRow[]>(
    () =>
      (data?.secrets ?? []).map((s) => ({
        id: s.key,
        key: s.key,
        updatedAt: s.updated_at,
        createdAt: s.created_at,
        kid: s.kid ?? '',
        status: secretDelivery(s)?.word ?? '',
        secret: s,
      })),
    [data]
  );
  // From the API: values written but not yet started in any runtime.
  const pendingCount = data ? secretsState(data.secrets ?? []).pending.length : 0;

  const remove = async (name: string) => {
    if (
      !(await confirm({
        title: `Delete ${name}?`,
        description:
          'Sealed values cannot be recovered. The next boot of this app starts without it; running instances that cannot reload secrets keep it in memory until they restart.',
        confirmLabel: 'Delete secret',
        destructive: true,
      }))
    )
      return;
    void deleteSecret
      .mutateAsync(name)
      .then((receipt) => {
        // The revocation card says per instance whether a restart is
        // needed; without a receipt (legacy 204), fall back to the notice.
        if (receipt?.id) setRevocation(receipt);
        else setUnappliedFor(slug);
        toast({ kind: 'success', title: `Deleted ${name}` });
      })
      .catch((err: unknown) => toast({ kind: 'error', title: 'Could not delete', error: err }));
  };

  const columns: Column<SecretRow>[] = [
    {
      key: 'key',
      label: 'Name',
      render: (s) => (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className="font-mono text-xs [overflow-wrap:anywhere]"
            title={s.kid ? `Sealed under host key ${s.kid}` : 'Sealed'}
          >
            {s.key}
          </span>
          {s.secret.secret_class === 'ephemeral' && (
            <span
              className="rounded-full bg-muted px-2 text-[11px] leading-5 text-muted-foreground"
              title="secret_class: ephemeral. While it exists, this scope's VMs are not snapshotted."
            >
              Blocks snapshots
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (s) => {
        const delivery = secretDelivery(s.secret);
        return delivery ? (
          <ToneWord tone={delivery.tone} word={delivery.word} term={delivery.term} />
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        );
      },
    },
    {
      key: 'updatedAt',
      label: 'Last changed',
      numeric: true,
      priority: 'secondary',
      width: 'w-36',
      render: (s) => (
        <span className="text-xs whitespace-nowrap text-muted-foreground">
          {secretChangeVerb(s.createdAt, s.updatedAt)} <Timestamp value={s.updatedAt} />
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      {/* Migrations arrive as .env files; the importer takes them whole. */}
      {(header ?? ownRow)(
        <>
          <EnvImportButton
            slug={slug}
            existingKeys={rows.map((r) => r.key)}
            onChanged={() => setUnappliedFor(slug)}
          />
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" />
            Add secret
          </Button>
        </>
      )}

      {!error && !isPending && <Lead>{secretsLead(rows.length, data?.quota_max)}</Lead>}

      {(unapplied || pendingCount > 0) && (
        <div
          role="status"
          aria-label="Apply the new values"
          className="flex flex-wrap items-center justify-between gap-3 surface rounded-[1.25rem] bg-card px-4 py-3"
        >
          <p className="text-sm text-muted-foreground">
            {!unapplied &&
              `${pendingCount === 1 ? 'One secret has a new value' : `${pendingCount} secrets have new values`} the app hasn’t started with yet. `}
            Running instances keep the previous values until they restart.
          </p>
          <Button size="sm" variant="outline" busy={freshRestart.isPending} onClick={applyNow}>
            Restart with the new values
          </Button>
        </div>
      )}

      <Sheet open={creating} onClose={() => setCreating(false)} title="Add secret">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!keyOk || !value || setSecret.isPending) return;
            const name = key.trim();
            const exists = rows.some((row) => row.key === name);
            // A set on an existing name replaces its sealed value, which
            // cannot be read back. Ask, as Rotate's own dialog effectively does.
            void (
              exists
                ? confirm({
                    title: `Replace ${name}?`,
                    description:
                      "Its current value is overwritten and cannot be recovered. The new value applies on the app's next cold start, or when you restart it.",
                    confirmLabel: 'Replace secret',
                    destructive: true,
                  })
                : Promise.resolve(true)
            ).then((proceed) => {
              if (!proceed) return;
              saveSecret(name);
            });
          }}
        >
          <label className="flex flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">Name</span>
            <input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onBlur={() => setKeyTouched(true)}
              aria-invalid={showKeyError || undefined}
              aria-describedby={showKeyError ? 'secret-key-error' : undefined}
              placeholder="DATABASE_URL"
              className={cn(
                'h-10 rounded-lg border bg-background px-3 font-mono text-sm outline-none focus:border-brand',
                showKeyError ? 'border-[color:var(--status-critical)]' : 'border-border'
              )}
            />
            {showKeyError && (
              <FieldError id="secret-key-error">
                UPPER_SNAKE_CASE: a letter first, then letters, digits, or underscores.
              </FieldError>
            )}
          </label>
          <SecretValueField
            label="Value"
            value={value}
            onChange={setValue}
            placeholder="Never shown again once saved"
          />
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={!slug} busy={setSecret.isPending}>
              Save secret
            </Button>
          </div>
        </form>
      </Sheet>

      {revocation && (
        <SecretRevocationStatus
          key={revocation.id}
          slug={slug}
          revocation={revocation}
          onDismiss={() => setRevocation(null)}
        />
      )}

      <ResourceTable
        rows={rows}
        columns={columns}
        initialSort={{ key: 'key', dir: 'asc' }}
        searchKeys={['key']}
        searchPlaceholder="Filter by name…"
        emptyMessage={`No secrets set for ${slug}.`}
        minWidth="min-w-0"
        loading={isPending}
        error={error}
        onRetry={() => void refetch()}
        rowActions={(row) => (
          <RowMenu label={`Actions for ${row.key}`}>
            <DropdownMenuItem
              onSelect={() => {
                setRotating(row.key);
                setRotateValue('');
              }}
            >
              <RefreshDouble aria-hidden="true" className="size-4" />
              Rotate value
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                void copy(row.key).then((ok) =>
                  toast(
                    ok
                      ? { kind: 'success', title: `Copied ${row.key}` }
                      : { kind: 'error', title: 'Could not copy the name' }
                  )
                )
              }
            >
              <Copy aria-hidden="true" className="size-4" />
              Copy name
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className={DANGER_ITEM} onSelect={() => void remove(row.key)}>
              <Trash aria-hidden="true" className="size-4" />
              Delete secret
            </DropdownMenuItem>
          </RowMenu>
        )}
      />

      {/* Rotation re-seals under the current host identity. The value
          crosses the wire once, exactly like create, and is never echoed. */}
      <Modal
        open={rotating !== null}
        onClose={closeRotate}
        title={rotating ? `Rotate ${rotating}` : ''}
        description="Provide the value again; it is re-sealed under the current host key and never shown after this."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={closeRotate}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!rotateValue}
              busy={rotate.isPending}
              onClick={() => {
                if (!rotating) return;
                void rotate
                  .mutateAsync({ key: rotating, value: rotateValue })
                  .then((r) => {
                    closeRotate();
                    setUnappliedFor(slug);
                    toast({
                      kind: 'success',
                      title: `Rotated ${r.key}`,
                      description: `Sealed under key ${r.kid}.`,
                    });
                  })
                  .catch((err: unknown) =>
                    toast({
                      kind: 'error',
                      title: 'Could not rotate',
                      error: err,
                    })
                  );
              }}
            >
              Rotate secret
            </Button>
          </>
        }
      >
        <SecretValueField
          key={rotating ?? ''}
          label="New value"
          value={rotateValue}
          onChange={setRotateValue}
        />
      </Modal>

      <SecretReferences slug={slug} />
    </div>
  );
}
