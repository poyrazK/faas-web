import { useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Plus, Trash } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { PageHeader, Panel } from '@/components/dashboard/primitives';
import { ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { AppScope, AppSelect, useSelectedApp } from '@/components/dashboard/app-select';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { useAppSecrets, useDeleteSecret, useSetSecret } from '@/lib/api/queries';
import { errorMessage } from '@/lib/api/errors';
import { FieldError } from '@/components/ui/field';
import { cn } from '@/lib/utils';

/** Mirrors the API's `^[A-Z][A-Z0-9_]*$` CHECK on secret names. */
const KEY_RULE = /^[A-Z][A-Z0-9_]*$/;
import { formatRelative } from '@/lib/mock-data';
import { consoleHead } from '@/lib/seo';

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

function formatWhen(value: string | undefined): string {
  if (!value) return '—';
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? '—' : formatRelative(ms);
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
  const deleteSecret = useDeleteSecret(slug);

  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [keyTouched, setKeyTouched] = useState(false);
  // The server's own SQL CHECK for names, stated up front rather than as a
  // 422 after the round-trip.
  const keyOk = KEY_RULE.test(key.trim());
  const showKeyError = keyTouched && key.trim().length > 0 && !keyOk;

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
      render: (s) => (
        <span className="text-xs text-muted-foreground">{formatWhen(s.updatedAt)}</span>
      ),
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
                  'Sealed values cannot be recovered. The next boot of this app starts without it.',
                confirmLabel: 'Delete secret',
                destructive: true,
              }))
            )
              return;
            void deleteSecret
              .mutateAsync(s.key)
              .then(() => toast({ kind: 'success', title: `Deleted ${s.key}` }))
              .catch((err: unknown) =>
                toast({ kind: 'error', title: 'Could not delete', description: errorMessage(err) })
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
      <Panel lit title="Set a secret">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!keyOk || !value || setSecret.isPending) return;
            void setSecret
              .mutateAsync({ key: key.trim(), value })
              .then(() => {
                setKey('');
                setValue('');
                setKeyTouched(false);
                toast({ kind: 'success', title: 'Secret saved' });
              })
              .catch((err: unknown) =>
                toast({ kind: 'error', title: 'Could not save', description: errorMessage(err) })
              );
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
          <label className="flex min-w-56 flex-[2] flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">Value</span>
            <input
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoComplete="off"
              placeholder="Never shown again once saved"
              className="h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-brand"
            />
          </label>
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
      />
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
