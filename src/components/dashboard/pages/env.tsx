import { useMemo, useState, type ReactNode } from 'react';
import { Copy, EditPencil, NavArrowDown, Plus, Trash, Upload } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/dashboard/kit/sheet';
import { ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { useCopy } from '@/components/ui/copy-button';
import { Timestamp } from '@/components/ui/timestamp';
import { useAppEnv, useAppSecrets, useDeleteEnv, useSetEnv } from '@/lib/api/queries';
import { FieldError } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import { EnvTransferPanel } from '@/components/dashboard/env-transfer';
import { EnvDiffPanel } from '@/components/dashboard/app-insights';
import { configChangeNote } from '@/lib/config-history';
import { environmentHeadline, variablesLead } from '@/components/dashboard/environment-words';
import { DANGER_ITEM, Lead, RowMenu, ToneDot } from '@/components/dashboard/environment-parts';

/** Mirrors the API's `^[A-Z][A-Z0-9_]*$` CHECK on variable names. */
const KEY_RULE = /^[A-Z][A-Z0-9_]*$/;

/**
 * Plain environment variables, from `/v1/apps/{slug}/env`.
 *
 * Note that the API does **not** echo values here either — a row is a key, a
 * scope, and timestamps. The difference from Secrets is not readability, it is
 * that a secret is sealed so the server itself cannot read it, while an env var
 * is stored plainly and injected as-is. Credentials still belong in Secrets.
 *
 * Because values never come back, editing is write-only: submitting a name that
 * already exists overwrites it.
 */
interface EnvRow {
  id: string;
  key: string;
  scope: string;
  updatedAt: string;
}

/**
 * The Environment tab's opening answer: how many variables and secrets the app
 * has and, from each secret's delivery status, whether the app has started
 * with the newest values. Shares its reads with the two bodies below it.
 */
export function EnvironmentSummary({ slug }: { slug: string }) {
  const env = useAppEnv(slug);
  const secrets = useAppSecrets(slug);
  if (env.isPending && secrets.isPending)
    return (
      <section
        aria-label="Environment summary"
        className="well rounded-2xl bg-muted/40 px-5 py-5 sm:px-6"
      >
        <p className="text-sm text-muted-foreground">Reading the environment…</p>
      </section>
    );
  const headline = environmentHeadline({
    app: slug,
    variables: env.data ? (env.data.env ?? []).length : undefined,
    secrets: secrets.data ? (secrets.data.secrets ?? []) : undefined,
  });
  // Both reads failed: each section below shows its own error.
  if (!headline) return null;
  return (
    <section
      aria-label="Environment summary"
      className="well flex flex-col gap-1 rounded-2xl bg-muted/40 px-5 py-5 sm:px-6"
    >
      {headline.word && headline.tone && (
        <span className="bento-label flex items-center gap-2">
          <ToneDot tone={headline.tone} />
          {headline.word}
        </span>
      )}
      <p className="text-xl leading-7 font-medium tracking-[-0.01em] text-balance">
        {headline.sentence}
      </p>
      {headline.detail && <p className="text-sm text-muted-foreground">{headline.detail}</p>}
    </section>
  );
}

/** Where a body's actions go when the page gives it no heading of its own. */
const ownRow = (actions: ReactNode) => <div className="flex justify-end gap-2">{actions}</div>;

/**
 * The env body, without the page chrome around it.
 *
 * `header` lets the page put this body's actions in its own heading row
 * rather than on a row of their own.
 */
export function EnvBody({
  slug,
  header,
}: {
  slug: string;
  header?: (actions: ReactNode) => ReactNode;
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const { copy } = useCopy();
  const { data, isPending, error, refetch } = useAppEnv(slug);
  const setEnv = useSetEnv(slug);
  const deleteEnv = useDeleteEnv(slug);

  // `null` is closed; `''` adds a new variable; a name changes that one.
  const [editing, setEditing] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [keyTouched, setKeyTouched] = useState(false);
  // The server's own SQL CHECK for names, stated up front rather than as a
  // 422 after the round-trip.
  const keyOk = KEY_RULE.test(key.trim());
  const showKeyError = keyTouched && key.trim().length > 0 && !keyOk;

  const open = (name: string) => {
    setKey(name);
    setValue('');
    setKeyTouched(false);
    setEditing(name);
  };

  const rows = useMemo<EnvRow[]>(
    () =>
      (data?.env ?? []).map((v) => ({
        id: v.key,
        key: v.key,
        scope: v.scope,
        updatedAt: v.updated_at,
      })),
    [data]
  );

  const remove = async (name: string) => {
    if (
      !(await confirm({
        title: `Delete ${name}?`,
        description: 'The next boot of this app starts without it.',
        confirmLabel: 'Delete variable',
        destructive: true,
      }))
    )
      return;
    void deleteEnv
      .mutateAsync(name)
      .then(() => toast({ kind: 'success', title: `Deleted ${name}` }))
      .catch((err: unknown) => toast({ kind: 'error', title: 'Could not delete', error: err }));
  };

  const columns: Column<EnvRow>[] = [
    {
      key: 'key',
      label: 'Name',
      render: (v) => (
        <span
          className="font-mono text-xs [overflow-wrap:anywhere]"
          title={`scope: ${v.scope || 'default'}`}
        >
          {v.key}
        </span>
      ),
    },
    {
      key: 'updatedAt',
      label: 'Last changed',
      numeric: true,
      priority: 'secondary',
      width: 'w-32',
      render: (v) => <Timestamp value={v.updatedAt} className="text-xs text-muted-foreground" />,
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      {(header ?? ownRow)(
        <>
          <Button size="sm" variant="outline" onClick={() => setImporting(true)}>
            <Upload className="h-3.5 w-3.5" />
            Import .env
          </Button>
          <Button size="sm" onClick={() => open('')}>
            <Plus className="h-3.5 w-3.5" />
            Add variable
          </Button>
        </>
      )}
      {!error && !isPending && <Lead>{variablesLead(rows.length, data?.quota_max)}</Lead>}
      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing ? `Change ${editing}` : 'Add variable'}
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!keyOk || setEnv.isPending) return;
            void setEnv
              .mutateAsync({ key: key.trim(), value })
              .then((saved) => {
                setKey('');
                setValue('');
                setKeyTouched(false);
                setEditing(null);
                toast({
                  kind: 'success',
                  title: 'Variable saved',
                  description: configChangeNote(saved?.config_change),
                });
              })
              .catch((err: unknown) =>
                toast({ kind: 'error', title: 'Could not save', error: err })
              );
          }}
        >
          <label className="flex flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">Name</span>
            <input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onBlur={() => setKeyTouched(true)}
              aria-invalid={showKeyError || undefined}
              aria-describedby={showKeyError ? 'env-key-error' : undefined}
              placeholder="LOG_LEVEL"
              className={cn(
                'h-10 rounded-lg border bg-background px-3 font-mono text-sm outline-none focus:border-brand',
                showKeyError ? 'border-[color:var(--status-critical)]' : 'border-border'
              )}
            />
            {showKeyError && (
              <FieldError id="env-key-error">
                UPPER_SNAKE_CASE: a letter first, then letters, digits, or underscores.
              </FieldError>
            )}
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">Value</span>
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="debug"
              className="h-10 rounded-lg border border-border bg-background px-3 font-mono text-sm outline-none focus:border-brand"
            />
          </label>
          <p className="text-xs text-muted-foreground">
            {editing
              ? 'The current value is replaced. The app reads it on its next start.'
              : 'The app reads it on its next start. Passwords and tokens belong in Secrets.'}
          </p>
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={!slug} busy={setEnv.isPending}>
              Save variable
            </Button>
          </div>
        </form>
      </Sheet>

      <Sheet
        open={importing}
        onClose={() => setImporting(false)}
        title="Import environment variables"
        size="lg"
      >
        <p className="mb-4 text-xs text-muted-foreground">Credentials belong in Secrets.</p>
        <EnvTransferPanel key={slug} slug={slug} framed={false} />
      </Sheet>

      <ResourceTable
        rows={rows}
        columns={columns}
        initialSort={{ key: 'key', dir: 'asc' }}
        searchKeys={['key']}
        searchPlaceholder="Filter by name…"
        emptyMessage={`No variables set for ${slug}.`}
        minWidth="min-w-0"
        loading={isPending}
        error={error}
        onRetry={() => void refetch()}
        rowActions={(v) => (
          <RowMenu label={`Actions for ${v.key}`}>
            <DropdownMenuItem onSelect={() => open(v.key)}>
              <EditPencil aria-hidden="true" className="size-4" />
              Change value
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                void copy(v.key).then((ok) =>
                  toast(
                    ok
                      ? { kind: 'success', title: `Copied ${v.key}` }
                      : { kind: 'error', title: 'Could not copy the name' }
                  )
                )
              }
            >
              <Copy aria-hidden="true" className="size-4" />
              Copy name
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className={DANGER_ITEM} onSelect={() => void remove(v.key)}>
              <Trash aria-hidden="true" className="size-4" />
              Delete variable
            </DropdownMenuItem>
          </RowMenu>
        )}
      />

      <div className="flex flex-col gap-3">
        <button
          type="button"
          aria-expanded={comparing}
          onClick={() => setComparing((v) => !v)}
          className="pressable inline-flex w-fit items-center gap-1 rounded text-[13px] text-muted-foreground hover:text-foreground"
        >
          <NavArrowDown
            aria-hidden="true"
            className={cn('size-3.5 transition-transform', comparing && 'rotate-180')}
          />
          {comparing ? 'Hide the comparison' : 'Compare with other environments'}
        </button>
        {comparing && <EnvDiffPanel slug={slug} />}
      </div>
    </div>
  );
}
