import { useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Plus, Trash } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { InlinePhase, PageHeader, Panel, queryPhase } from '@/components/dashboard/primitives';
import { ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { AppScope, AppSelect, useSelectedApp } from '@/components/dashboard/app-select';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { useAppEnv, useDeleteEnv, useEnvDiff, useSetEnv } from '@/lib/api/queries';
import { EnvDiffMatrix } from '@/components/dashboard/env-diff-matrix';
import { diffSummary } from '@/lib/env-diff';
import { findSecrets } from '@/lib/secret-scan';
import { SecretFindings } from '@/components/dashboard/secret-findings';
import { errorMessage } from '@/lib/api/errors';
import { FieldError } from '@/components/ui/field';
import { cn } from '@/lib/utils';

/** Mirrors the API's `^[A-Z][A-Z0-9_]*$` CHECK on variable names. */
const KEY_RULE = /^[A-Z][A-Z0-9_]*$/;
import { formatRelative } from '@/lib/mock-data';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/env')({
  component: EnvPage,
  head: () => consoleHead('env'),
});

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

function formatWhen(value: string | undefined): string {
  if (!value) return '—';
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? '—' : formatRelative(ms);
}

/**
 * The env body, without the page chrome around it.
 *
 * Rendered both by this route and as a tab on the app detail page, so
 * the two can never drift into two different implementations of the
 * same resource.
 */
export function EnvBody({ slug }: { slug: string }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const { data, isPending, error, refetch } = useAppEnv(slug);
  const setEnv = useSetEnv(slug);
  const deleteEnv = useDeleteEnv(slug);

  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [keyTouched, setKeyTouched] = useState(false);
  // The CLI's --secret-scan pre-flight on a single value; acknowledging is
  // bound to this exact value, so an edit re-arms the gate.
  const [ackValue, setAckValue] = useState('');
  const findings = useMemo(
    () => (value ? findSecrets([{ key: key.trim() || 'VALUE', value }]) : []),
    [key, value]
  );
  const acknowledged = ackValue === value && value !== '';
  // The server's own SQL CHECK for names, stated up front rather than as a
  // 422 after the round-trip.
  const keyOk = KEY_RULE.test(key.trim());
  const showKeyError = keyTouched && key.trim().length > 0 && !keyOk;

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

  const columns: Column<EnvRow>[] = [
    {
      key: 'key',
      label: 'Name',
      render: (v) => <span className="font-mono text-xs">{v.key}</span>,
    },
    {
      key: 'scope',
      label: 'Scope',
      width: 'w-32',
      render: (v) => <span className="text-xs text-muted-foreground">{v.scope || '—'}</span>,
    },
    {
      key: 'updatedAt',
      label: 'Updated',
      numeric: true,
      render: (v) => (
        <span className="text-xs text-muted-foreground">{formatWhen(v.updatedAt)}</span>
      ),
    },
    {
      key: 'id',
      label: '',
      width: 'w-12',
      render: (v) => (
        <button
          type="button"
          aria-label={`Delete variable ${v.key}`}
          onClick={async () => {
            if (
              !(await confirm({
                title: `Delete ${v.key}?`,
                description: 'The next boot of this app starts without it.',
                confirmLabel: 'Delete variable',
                destructive: true,
              }))
            )
              return;
            void deleteEnv
              .mutateAsync(v.key)
              .then(() => toast({ kind: 'success', title: `Deleted ${v.key}` }))
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
      <Panel lit title="Set a variable">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!keyOk || setEnv.isPending) return;
            if (findings.length > 0 && !acknowledged) return;
            void setEnv
              .mutateAsync({ key: key.trim(), value })
              .then(() => {
                setKey('');
                setValue('');
                setKeyTouched(false);
                setAckValue('');
                toast({ kind: 'success', title: 'Variable saved' });
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
          <label className="flex min-w-56 flex-[2] flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">Value</span>
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="debug"
              className="h-10 rounded-lg border border-border bg-background px-3 font-mono text-sm outline-none focus:border-brand"
            />
          </label>
          {findings.length > 0 && (
            <div className="w-full">
              <SecretFindings
                findings={findings}
                acknowledged={acknowledged}
                onAcknowledge={(ok) => setAckValue(ok ? value : '')}
              />
            </div>
          )}
          <Button
            type="submit"
            size="sm"
            className="gap-1.5"
            disabled={!slug || (findings.length > 0 && !acknowledged)}
            busy={setEnv.isPending}
          >
            <Plus className="h-3.5 w-3.5" />
            Save variable
          </Button>
        </form>
      </Panel>

      <ResourceTable
        rows={rows}
        columns={columns}
        initialSort={{ key: 'key', dir: 'asc' }}
        searchKeys={['key', 'scope']}
        searchPlaceholder="Filter by name…"
        emptyMessage={`No variables set for ${slug}.`}
        minWidth="min-w-[720px]"
        loading={isPending}
        error={error}
        onRetry={() => void refetch()}
      />

      <EnvDiffPanel slug={slug} />
    </div>
  );
}

/**
 * `gregale env diff` for the browser: which keys exist where, and whether
 * their values match — by hash, never by value.
 */
function EnvDiffPanel({ slug }: { slug: string }) {
  const q = useEnvDiff(slug);
  const phase = queryPhase({
    error: q.error,
    loading: q.isPending,
    isEmpty: (q.data?.rows.length ?? 0) === 0,
  });
  const summary = q.data ? diffSummary(q.data) : null;
  return (
    <Panel
      title="Across scopes"
      description={
        summary ? `${summary.keys} keys · ${summary.uneven} uneven` : 'Comparing scopes…'
      }
    >
      {phase !== 'ready' || !q.data ? (
        <InlinePhase phase={phase} error={q.error} emptyMessage="No variables in any scope yet." />
      ) : (
        <EnvDiffMatrix scopes={q.data.scopes} rows={q.data.rows} />
      )}
    </Panel>
  );
}

function EnvPage() {
  const appState = useSelectedApp();
  const { slug, select, apps } = appState;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Env vars"
        description="Plain configuration injected at boot. Values are write-only; credentials belong in Secrets."
        actions={<AppSelect slug={slug} onSelect={select} apps={apps} />}
      />

      <AppScope state={appState} resource="environment variables">
        <EnvBody slug={slug} />
      </AppScope>
    </div>
  );
}
