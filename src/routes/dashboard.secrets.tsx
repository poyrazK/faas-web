import { useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Plus, Trash } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { PageHeader, Panel } from '@/components/dashboard/primitives';
import { ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { AppScope, AppSelect, useSelectedApp } from '@/components/dashboard/app-select';
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

/** Mirrors the API's `^[A-Z][A-Z0-9_]*$` CHECK on secret names. */
const KEY_RULE = /^[A-Z][A-Z0-9_]*$/;
import { Timestamp } from '@/components/ui/timestamp';
import { consoleHead } from '@/lib/seo';
import { configChangeNote } from '@/lib/config-history';

export const Route = createFileRoute('/dashboard/secrets')({
  component: SecretsPage,
  head: () => consoleHead('secrets'),
});

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
  kid: string;
}

/**
 * The secrets body, without the page chrome around it.
 *
 * Rendered both by this route and as a tab on the app detail page, so
 * the two can never drift into two different implementations of the
 * same resource.
 */
export function SecretsBody({ slug }: { slug: string }) {
  const { toast } = useToast();
  const confirm = useConfirm();
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
        kid: s.kid ?? '',
      })),
    [data]
  );

  const columns: Column<SecretRow>[] = [
    {
      key: 'key',
      label: 'Name',
      render: (s) => <span className="font-mono text-xs">{s.key}</span>,
    },
    {
      key: 'kid',
      label: 'Value',
      render: () => (
        <span className="font-mono text-xs text-muted-foreground">•••••••• (sealed)</span>
      ),
    },
    {
      key: 'updatedAt',
      label: 'Updated',
      numeric: true,
      render: (s) => <Timestamp value={s.updatedAt} className="text-xs text-muted-foreground" />,
    },
    {
      key: 'id',
      label: '',
      width: 'w-12',
      render: (s) => (
        <button
          type="button"
          aria-label={`Delete secret ${s.key}`}
          onClick={async () => {
            if (
              !(await confirm({
                title: `Delete ${s.key}?`,
                description:
                  'Sealed values cannot be recovered. The next boot of this app starts without it; running instances that cannot reload secrets keep it in memory until they restart.',
                confirmLabel: 'Delete secret',
                destructive: true,
              }))
            )
              return;
            void deleteSecret
              .mutateAsync(s.key)
              .then((receipt) => {
                // The revocation card says per instance whether a restart is
                // needed; without a receipt (legacy 204), fall back to the notice.
                if (receipt?.id) setRevocation(receipt);
                else setUnappliedFor(slug);
                toast({ kind: 'success', title: `Deleted ${s.key}` });
              })
              .catch((err: unknown) =>
                toast({ kind: 'error', title: 'Could not delete', error: err })
              );
          }}
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          <Trash className="h-3.5 w-3.5" />
        </button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Migrations arrive as .env files; the importer takes them whole. */}
      <div className="flex justify-end">
        <EnvImportButton
          slug={slug}
          existingKeys={rows.map((r) => r.key)}
          onChanged={() => setUnappliedFor(slug)}
        />
      </div>

      {unapplied && (
        <div
          role="status"
          aria-label="Apply the new values"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3"
        >
          <p className="text-sm text-muted-foreground">
            Running instances keep the previous values until they restart.
          </p>
          <Button size="sm" variant="outline" busy={freshRestart.isPending} onClick={applyNow}>
            Restart with the new values
          </Button>
        </div>
      )}

      <Panel lit title="Set a secret">
        <form
          className="flex flex-wrap items-end gap-3"
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
          <label className="flex min-w-44 flex-1 flex-col gap-1.5">
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
            className="min-w-56 flex-[2]"
          />
          <Button
            type="submit"
            size="sm"
            className="gap-1.5"
            disabled={!slug}
            busy={setSecret.isPending}
          >
            <Plus className="h-3.5 w-3.5" />
            Save secret
          </Button>
        </form>
      </Panel>

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
        minWidth="min-w-[720px]"
        loading={isPending}
        error={error}
        onRetry={() => void refetch()}
        rowActions={(row) => (
          <button
            type="button"
            onClick={() => {
              setRotating(row.key);
              setRotateValue('');
            }}
            className="pressable rounded text-xs text-muted-foreground hover:text-foreground"
          >
            Rotate
          </button>
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

function SecretsPage() {
  const appState = useSelectedApp();
  const { slug, select, apps } = appState;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Secrets"
        description="Sealed per-app values injected at boot. The server cannot read them back — set a new value to change one."
        actions={<AppSelect slug={slug} onSelect={select} apps={apps} />}
      />

      <AppScope state={appState} resource="secrets">
        <SecretsBody slug={slug} />
      </AppScope>
    </div>
  );
}
