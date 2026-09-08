import { useState } from 'react';
import { Database, Plus, Trash } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { FIELD, Select } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Panel,
  UnreachableState,
  queryPhase,
} from '@/components/dashboard/primitives';
import { PlanGated } from '@/components/dashboard/plan-gated';
import { Pill } from '@/components/dashboard/resource-table';
import { ApiError, errorMessage } from '@/lib/api/errors';
import {
  useApps,
  useCreatePostgresBinding,
  useCreatePostgresDatabase,
  useDeletePostgresBinding,
  useDeletePostgresDatabase,
  usePostgresBindings,
  usePostgresDatabases,
  useRestorePostgresDatabase,
  type PostgresDatabase,
} from '@/lib/api/queries';
import { formatRelative } from '@/lib/mock-data';
import { cn } from '@/lib/utils';

/**
 * Managed PostgreSQL: databases the platform provisions, and the bindings
 * that hand one to an app.
 *
 * **No credential ever reaches this page.** A binding delivers the connection
 * string to the app as a secret under the environment key the customer picks;
 * the console shows that the binding exists, which key carries it, and which
 * generation of credentials the app currently holds. That is deliberate and
 * the copy says so, because "where is my password" is otherwise the first
 * question.
 *
 * Provisioning and deletion happen on the provider's clock, so those two
 * states poll and the rest do not. A failed database keeps its
 * `last_error_code`, which is shown rather than flattened into "failed".
 *
 * Restore is always into a *new* database (the API takes a name and a point
 * in time and returns a new row), so the form says that rather than implying
 * the current database is rewound.
 */

const SERVICE_CLASSES = [
  { value: 'development', label: 'Development', blurb: 'Smallest instance, single zone.' },
  { value: 'burstable', label: 'Burstable', blurb: 'Bursts above its baseline under load.' },
  {
    value: 'production',
    label: 'Production',
    blurb: 'Reserved capacity, sized for steady traffic.',
  },
] as const;

const STATE_COLOR: Record<string, string> = {
  provisioning: 'var(--status-warning)',
  ready: 'var(--status-good)',
  updating: 'var(--status-warning)',
  deleting: 'var(--status-idle)',
  failed: 'var(--status-critical)',
  deleted: 'var(--status-idle)',
};

function gb(bytes: number): string {
  return `${Math.round((bytes / 1024 ** 3) * 10) / 10} GB`;
}

function hours(seconds: number): string {
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  const h = seconds / 3600;
  return h >= 48 ? `${Math.round(h / 24)} days` : `${Math.round(h)} h`;
}

function when(value: string | null | undefined): string {
  if (!value) return '—';
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? value : formatRelative(ms);
}

export function explainPostgres(err: unknown): {
  kind: 'info' | 'error';
  title: string;
  description?: string;
} {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'managed_postgres_not_in_plan':
        return { kind: 'info', title: 'Not on your plan', description: errorMessage(err) };
      case 'managed_postgres_quota_exceeded':
        return { kind: 'info', title: 'Database limit reached', description: errorMessage(err) };
      case 'managed_postgres_unsupported':
        return {
          kind: 'error',
          title: 'Not supported',
          description: errorMessage(err),
        };
      case 'managed_postgres_conflict':
        return {
          kind: 'error',
          title: 'That name or binding is taken',
          description: errorMessage(err),
        };
      case 'managed_postgres_invalid':
        return { kind: 'error', title: 'The request was rejected', description: errorMessage(err) };
      case 'managed_postgres_unavailable':
      case 'managed_postgres_usage_stale':
        return {
          kind: 'info',
          title: 'The database provider is unavailable',
          description: 'Nothing was changed. This is upstream of Gregale; try again shortly.',
        };
      case 'managed_postgres_not_found':
        return { kind: 'info', title: 'Already gone', description: 'It was removed elsewhere.' };
    }
  }
  return { kind: 'error', title: 'Could not complete that', description: errorMessage(err) };
}

export function PostgresDatabases() {
  const databases = usePostgresDatabases();
  const [selected, setSelected] = useState<string | null>(null);
  const phase = queryPhase({ error: databases.error, loading: databases.isPending });
  const items = databases.data?.items ?? [];
  const open = items.find((d) => d.id === selected);

  return (
    <PlanGated error={databases.error} feature="Managed PostgreSQL">
      <div className="flex flex-col gap-6">
        <Panel
          title="Databases"
          description="Provisioned and run by the platform. Connection details reach your apps as secrets, never this page."
        >
          {phase === 'unreachable' ? (
            <UnreachableState onRetry={() => void databases.refetch()} />
          ) : phase === 'loading' ? (
            <LoadingState message="Loading databases…" />
          ) : phase === 'error' ? (
            <ErrorState error={databases.error} onRetry={() => void databases.refetch()} />
          ) : (
            <div className="flex flex-col gap-5">
              {items.length === 0 ? (
                <EmptyState message="No managed databases yet. Create one below and bind it to an app." />
              ) : (
                <ul className="flex flex-col divide-y divide-border">
                  {items.map((database) => (
                    <li key={database.id}>
                      <DatabaseRow
                        database={database}
                        open={database.id === selected}
                        onToggle={() => setSelected(database.id === selected ? null : database.id)}
                      />
                    </li>
                  ))}
                </ul>
              )}
              <CreateDatabase />
            </div>
          )}
        </Panel>

        {/* Keyed on the database: the restore and binding forms belong to the
            one that is open, and must not carry over to the next. */}
        {open && <DatabaseDetail key={open.id} database={open} />}
      </div>
    </PlanGated>
  );
}

function DatabaseRow({
  database,
  open,
  onToggle,
}: {
  database: PostgresDatabase;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex w-full flex-wrap items-center gap-3 py-3 text-left text-xs transition-colors first:pt-0 last:pb-0 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand"
    >
      <Database className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="text-sm font-medium">{database.name}</span>
      <Pill label={database.state} color={STATE_COLOR[database.state]} />
      <span className="text-muted-foreground">
        PostgreSQL {database.postgres_major} · {database.service_class} · {database.region}
      </span>
      {database.availability === 'high_availability' && (
        <Pill label="HA" color="var(--status-good)" />
      )}
      {database.scale_to_zero && <Pill label="scales to zero" color="var(--status-idle)" />}
      <span className="text-muted-foreground">{gb(database.storage_limit_bytes)}</span>
      {database.last_error_code && (
        <span style={{ color: 'var(--status-critical)' }}>{database.last_error_code}</span>
      )}
      <span className="ml-auto text-muted-foreground">created {when(database.created_at)}</span>
    </button>
  );
}

function DatabaseDetail({ database }: { database: PostgresDatabase }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const remove = useDeletePostgresDatabase();
  const restore = useRestorePostgresDatabase();
  const [restoreName, setRestoreName] = useState('');
  const [pointInTime, setPointInTime] = useState('');

  const onDelete = async () => {
    if (
      !(await confirm({
        title: `Delete ${database.name}?`,
        description:
          'The database and its data are destroyed. Bindings to it are removed and the apps holding its credentials lose access.',
        confirmLabel: 'Delete database',
        destructive: true,
        typeToConfirm: database.name,
      }))
    )
      return;
    try {
      await remove.mutateAsync(database.id);
      toast({ kind: 'success', title: `${database.name} is being deleted` });
    } catch (err) {
      toast(explainPostgres(err));
    }
  };

  const onRestore = async () => {
    try {
      const created = await restore.mutateAsync({
        id: database.id,
        name: restoreName.trim(),
        point_in_time: new Date(pointInTime).toISOString(),
      });
      setRestoreName('');
      setPointInTime('');
      toast({
        kind: 'success',
        title: `Restoring into ${created.name}`,
        description: 'The original database is untouched.',
      });
    } catch (err) {
      toast(explainPostgres(err));
    }
  };

  const restoreReady = restoreName.trim().length > 0 && !Number.isNaN(Date.parse(pointInTime));

  return (
    <Panel
      title={database.name}
      description={`Restore window ${hours(database.restore_window_seconds)} · ${database.availability === 'high_availability' ? 'high availability' : 'single zone'}`}
      actions={
        <Button
          size="xs"
          variant="ghost"
          onClick={() => void onDelete()}
          disabled={remove.isPending}
        >
          <Trash className="h-3.5 w-3.5" />
          Delete
        </Button>
      }
    >
      <div className="flex flex-col gap-6">
        {database.restore_source_database_id && (
          <p className="text-xs text-muted-foreground">
            Restored from {database.restore_source_database_id.slice(0, 8)} at{' '}
            {database.restore_point_in_time
              ? new Date(database.restore_point_in_time).toLocaleString()
              : 'an unrecorded point'}
            .
          </p>
        )}

        <Bindings database={database} />

        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (restoreReady && !restore.isPending) void onRestore();
          }}
        >
          <p className="label-mono text-muted-foreground">Point-in-time restore</p>
          <p className="text-xs text-muted-foreground">
            Restores into a new database, leaving this one running. Anything within the last{' '}
            {hours(database.restore_window_seconds)} can be chosen.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">New database name</span>
              <input
                value={restoreName}
                onChange={(e) => setRestoreName(e.target.value)}
                placeholder={`${database.name}-restored`}
                aria-label="Restored database name"
                className={cn(FIELD, 'w-56')}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">Point in time</span>
              <input
                type="datetime-local"
                value={pointInTime}
                onChange={(e) => setPointInTime(e.target.value)}
                aria-label="Restore point in time"
                className={cn(FIELD, 'w-56')}
              />
            </label>
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={!restoreReady}
              busy={restore.isPending}
            >
              Restore into a new database
            </Button>
          </div>
        </form>
      </div>
    </Panel>
  );
}

function Bindings({ database }: { database: PostgresDatabase }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const bindings = usePostgresBindings(database.id);
  const apps = useApps();
  const create = useCreatePostgresBinding(database.id);
  const remove = useDeletePostgresBinding(database.id);
  const [appId, setAppId] = useState('');
  const [environmentKey, setEnvironmentKey] = useState('DATABASE_URL');
  const [access, setAccess] = useState<'read_write' | 'read_only'>('read_write');
  const [scope, setScope] = useState('default');

  const items = bindings.data?.items ?? [];
  const appList = apps.data ?? [];
  const chosenApp = appId || appList[0]?.id || '';
  const appName = (id: string) => appList.find((a) => a.id === id)?.slug ?? id.slice(0, 8);

  const submit = async () => {
    try {
      await create.mutateAsync({
        app_id: chosenApp,
        scope: scope.trim() || 'default',
        environment_key: environmentKey.trim(),
        access,
      });
      toast({
        kind: 'success',
        title: 'Binding created',
        description: `${appName(chosenApp)} receives the connection string as the secret ${environmentKey.trim()}.`,
      });
    } catch (err) {
      toast(explainPostgres(err));
    }
  };

  const onRemove = async (id: string, key: string) => {
    if (
      !(await confirm({
        title: 'Remove this binding?',
        description: `The ${key} secret is withdrawn and the app loses access at its next start.`,
        confirmLabel: 'Remove binding',
        destructive: true,
      }))
    )
      return;
    try {
      await remove.mutateAsync(id);
      toast({ kind: 'success', title: 'Binding removed' });
    } catch (err) {
      toast(explainPostgres(err));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="label-mono text-muted-foreground">Bound apps</p>
      {bindings.isPending ? (
        <p className="text-sm text-muted-foreground">Loading bindings…</p>
      ) : bindings.error ? (
        <p className="text-sm text-muted-foreground">{errorMessage(bindings.error)}</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No app is bound to this database yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {items.map((binding) => (
            <li
              key={binding.id}
              className="flex flex-wrap items-center gap-3 py-2 text-xs first:pt-0 last:pb-0"
            >
              <span className="font-mono">{appName(binding.app_id)}</span>
              <Pill label={binding.state} color={STATE_COLOR[binding.state]} />
              <span className="font-mono text-muted-foreground">{binding.environment_key}</span>
              <span className="text-muted-foreground">{binding.access.replace('_', ' ')}</span>
              <span className="text-muted-foreground">scope {binding.scope}</span>
              <span className="text-muted-foreground">
                credentials v{binding.credential_generation}
              </span>
              {binding.last_error_code && (
                <span style={{ color: 'var(--status-critical)' }}>{binding.last_error_code}</span>
              )}
              <Button
                size="xs"
                variant="ghost"
                className="ml-auto"
                aria-label={`Remove binding for ${appName(binding.app_id)}`}
                onClick={() => void onRemove(binding.id, binding.environment_key)}
                disabled={remove.isPending}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      {appList.length > 0 && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (environmentKey.trim() && !create.isPending) void submit();
          }}
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">App</span>
            <Select
              value={chosenApp}
              onChange={(e) => setAppId(e.target.value)}
              aria-label="App to bind"
              className="h-8 text-xs"
            >
              {appList.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.slug}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Secret name</span>
            <input
              value={environmentKey}
              onChange={(e) => setEnvironmentKey(e.target.value)}
              aria-label="Environment key"
              className={cn(FIELD, 'h-8 w-44 text-xs font-mono')}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Access</span>
            <Select
              value={access}
              onChange={(e) => setAccess(e.target.value as 'read_write' | 'read_only')}
              aria-label="Binding access"
              className="h-8 text-xs"
            >
              <option value="read_write">Read and write</option>
              <option value="read_only">Read only</option>
            </Select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Scope</span>
            <input
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              aria-label="Binding scope"
              className={cn(FIELD, 'h-8 w-28 text-xs')}
            />
          </label>
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={!environmentKey.trim()}
            busy={create.isPending}
          >
            <Plus className="h-3.5 w-3.5" />
            Bind app
          </Button>
        </form>
      )}
      <p className="text-xs text-muted-foreground">
        The connection string is written into the app as a secret under that name. It is never shown
        in the console and never returned by the API.
      </p>
    </div>
  );
}

function CreateDatabase() {
  const { toast } = useToast();
  const create = useCreatePostgresDatabase();
  const [name, setName] = useState('');
  const [region, setRegion] = useState('fra');
  const [major, setMajor] = useState('17');
  const [serviceClass, setServiceClass] =
    useState<(typeof SERVICE_CLASSES)[number]['value']>('development');
  const [ha, setHa] = useState(false);
  const [scaleToZero, setScaleToZero] = useState(true);
  const ready = /^[a-z][a-z0-9-]{1,62}$/.test(name.trim());

  const submit = async () => {
    try {
      const database = await create.mutateAsync({
        name: name.trim(),
        region,
        postgres_major: Number(major),
        service_class: serviceClass,
        availability: ha ? 'high_availability' : 'single_zone',
        scale_to_zero: scaleToZero,
      });
      setName('');
      toast({
        kind: 'success',
        title: `${database.name} is provisioning`,
        description: 'It becomes bindable once the provider reports it ready.',
      });
    } catch (err) {
      toast(explainPostgres(err));
    }
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !create.isPending) void submit();
      }}
    >
      <p className="label-mono text-muted-foreground">New database</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="orders"
            aria-label="Database name"
            className={cn(FIELD, 'w-44')}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Region</span>
          <Select value={region} onChange={(e) => setRegion(e.target.value)} aria-label="Region">
            <option value="fra">fra</option>
            <option value="ams">ams</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">PostgreSQL</span>
          <Select
            value={major}
            onChange={(e) => setMajor(e.target.value)}
            aria-label="PostgreSQL major version"
          >
            <option value="17">17</option>
            <option value="16">16</option>
            <option value="15">15</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Class</span>
          <Select
            value={serviceClass}
            onChange={(e) => setServiceClass(e.target.value as typeof serviceClass)}
            aria-label="Service class"
          >
            {SERVICE_CLASSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex h-9 items-center gap-2 text-xs text-muted-foreground">
          <Switch
            checked={ha}
            onCheckedChange={setHa}
            aria-label="High availability"
            className="data-[state=checked]:bg-brand"
          />
          High availability
        </label>
        <label className="flex h-9 items-center gap-2 text-xs text-muted-foreground">
          <Switch
            checked={scaleToZero}
            onCheckedChange={setScaleToZero}
            aria-label="Scale to zero"
            className="data-[state=checked]:bg-brand"
          />
          Scale to zero
        </label>
        <Button
          type="submit"
          size="sm"
          className="gap-1.5"
          disabled={!ready}
          busy={create.isPending}
        >
          <Plus className="h-3.5 w-3.5" />
          Create database
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {SERVICE_CLASSES.find((s) => s.value === serviceClass)?.blurb} Lower-case letters, digits
        and dashes in the name.
      </p>
    </form>
  );
}
