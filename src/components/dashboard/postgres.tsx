import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Clock, Database, Pause, Plus, Trash, Undo } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { CopyableId } from '@/components/ui/copyable-id';
import { FIELD, Select } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { Timestamp } from '@/components/ui/timestamp';
import { useToast } from '@/components/ui/toast';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Panel,
  UnreachableState,
  queryPhase,
} from '@/components/dashboard/primitives';
import { CliCommand } from '@/components/dashboard/cli-command';
import { PlanGated } from '@/components/dashboard/plan-gated';
import { Pill } from '@/components/dashboard/resource-table';
import { ApiError, errorMessage } from '@/lib/api/errors';
import {
  usePostgresUsage,
  usePurgePostgresDatabase,
  useUndeletePostgresDatabase,
} from '@/lib/api/postgres';
import { useWorkspaceTarget } from '@/lib/api/workspace-apps';
import {
  useApps,
  useCreatePostgresBinding,
  useCreatePostgresDatabase,
  useDeletePostgresBinding,
  useDeletePostgresDatabase,
  usePostgresBindings,
  usePostgresDatabases,
  useRestorePostgresDatabase,
  useRotatePostgresBinding,
  type PostgresBinding,
  type PostgresDatabase,
} from '@/lib/api/queries';
import { cliPostgresRestoreCommand } from '@/lib/cli-commands';
import { formatRelative } from '@/lib/mock-data';
import { absoluteTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import { DatabaseCompute, type ComputeOperation } from './postgres-compute';
import { ConnectionBudget, DatabaseConditions } from './postgres-health';
import { StatusTag, TONE, explainPostgres } from './postgres-shared';
import { PostgresUsage } from './postgres-usage';

export { explainPostgres } from './postgres-shared';

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
 *
 * Deleting a ready database schedules it (faas ADR-20261029174950): it is kept
 * for seven days with its compute stopped, shows `restorable_until`, and can
 * be recovered (`POST …/undelete`) or purged (`DELETE …?purge=true`) until
 * then. Any other database is deleted at once. A database is also suspended,
 * with its data kept, when the workspace reaches its compute cap (the usage
 * panel says when it resumes) or when the plan no longer includes it
 * (`plan_excess`).
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
  deleting: 'var(--chart-muted)',
  failed: 'var(--status-critical)',
  deleted: 'var(--chart-muted)',
};

/** A delete the customer can still undo: kept until `restorable_until`. */
function scheduledDelete(database: PostgresDatabase): boolean {
  return database.state === 'deleting' && Boolean(database.restorable_until);
}

/** apid's own wording for each plan-excess suspension (pkg/dashboard/templates/postgres.html). */
const PLAN_EXCESS: Record<
  NonNullable<PostgresDatabase['plan_excess']>,
  { tag: string; explain: (whose: string, database: PostgresDatabase) => string }
> = {
  database_limit: {
    tag: 'over the database limit',
    explain: (whose) =>
      `${whose} plan allows fewer databases than there are, so this one, among the newest, is suspended. Its data, credentials and bindings are kept. Upgrade, or delete a database, to resume it; the next usage sweep, within minutes, does.`,
  },
  service_class: {
    tag: 'class not in plan',
    explain: (whose, database) =>
      `${whose} plan does not include the ${database.service_class} class, so this database is suspended. Its data, credentials and bindings are kept. Upgrade, or resize it to a class the plan includes, to resume it.`,
  },
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

export function PostgresDatabases() {
  const databases = usePostgresDatabases();
  // The same read as the usage panel's: the cap holds every database at once.
  const capSuspended = usePostgresUsage().data?.compute_cap_state === 'suspended';
  const [selected, setSelected] = useState<string | null>(null);
  // The resize or policy change started for each database, kept here so it is
  // still followed after its detail is closed and opened again: the API has no
  // list of a database's changes to find it by.
  const [operations, setOperations] = useState<Record<string, ComputeOperation>>({});
  const phase = queryPhase({ error: databases.error, loading: databases.isPending });
  const items = databases.data?.items ?? [];
  const open = items.find((d) => d.id === selected);

  return (
    <PlanGated error={databases.error} feature="Managed PostgreSQL">
      <div className="flex flex-col gap-6">
        <PostgresUsage />
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
                        capSuspended={capSuspended}
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
        {open && (
          <DatabaseDetail
            key={open.id}
            database={open}
            capSuspended={capSuspended}
            operation={operations[open.id]}
            onOperation={(operation) => setOperations((all) => ({ ...all, [open.id]: operation }))}
          />
        )}
      </div>
    </PlanGated>
  );
}

function DatabaseRow({
  database,
  capSuspended,
  open,
  onToggle,
}: {
  database: PostgresDatabase;
  capSuspended: boolean;
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
      {database.scale_to_zero && <Pill label="scales to zero" color="var(--chart-muted)" />}
      <span className="text-muted-foreground">{gb(database.storage_limit_bytes)}</span>
      {database.last_error_code && (
        <span style={{ color: 'var(--status-critical)' }}>{database.last_error_code}</span>
      )}
      {scheduledDelete(database) && (
        <span className="text-muted-foreground">
          recoverable until <Timestamp value={database.restorable_until} />
        </span>
      )}
      {database.plan_excess ? (
        <StatusTag tone="critical" icon={Pause}>
          suspended · {PLAN_EXCESS[database.plan_excess].tag}
        </StatusTag>
      ) : (
        capSuspended &&
        database.state === 'ready' && (
          <StatusTag tone="critical" icon={Pause}>
            suspended · compute cap
          </StatusTag>
        )
      )}
      <span className="ml-auto text-muted-foreground">created {when(database.created_at)}</span>
    </button>
  );
}

function DatabaseDetail({
  database,
  capSuspended,
  operation,
  onOperation,
}: {
  database: PostgresDatabase;
  capSuspended: boolean;
  operation?: ComputeOperation;
  onOperation: (operation: ComputeOperation) => void;
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const { org, label } = useWorkspaceTarget();
  const whose = org ? `${label}'s` : 'Your';
  const scheduled = scheduledDelete(database);
  const remove = useDeletePostgresDatabase();
  const restore = useRestorePostgresDatabase();
  const [restoreName, setRestoreName] = useState('');
  const [pointInTime, setPointInTime] = useState('');

  const onDelete = async () => {
    // apid schedules only a ready database; any other is deleted at once
    // (managedpostgres/delete_grace.go ScheduleDelete).
    const kept = database.state === 'ready';
    if (
      !(await confirm({
        title: `Delete ${database.name}?`,
        description: kept
          ? 'Its compute stops and it refuses connections at once. It is kept for 7 days and can be recovered until then, after which it is deleted for good. Apps must be unbound from it first.'
          : 'It is not ready, so it is deleted at once, with no undo. Apps must be unbound from it first.',
        confirmLabel: 'Delete database',
        destructive: true,
        typeToConfirm: database.name,
      }))
    )
      return;
    try {
      const deleted = await remove.mutateAsync(database.id);
      const until = Date.parse(deleted.restorable_until ?? '');
      toast(
        Number.isNaN(until)
          ? { kind: 'success', title: `${database.name} is being deleted` }
          : {
              kind: 'success',
              title: `${database.name} is scheduled for deletion`,
              description: `Recover it until ${absoluteTime(until)}.`,
            }
      );
    } catch (err) {
      toast(
        err instanceof ApiError && err.code === 'managed_postgres_conflict'
          ? {
              kind: 'error',
              title: 'Unbind its apps first',
              description:
                'A database with bound apps, or with a database restored from it, cannot be deleted.',
              error: err,
            }
          : explainPostgres(err)
      );
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
  // Same values the form submits: the trimmed name and the instant as UTC ISO.
  const restoreCommand = cliPostgresRestoreCommand(
    database.id,
    restoreName.trim() || undefined,
    Number.isNaN(Date.parse(pointInTime)) ? undefined : new Date(pointInTime).toISOString()
  );

  return (
    <Panel
      title={database.name}
      description={`Restore window ${hours(database.restore_window_seconds)} · ${database.availability === 'high_availability' ? 'high availability' : 'single zone'}`}
      actions={
        scheduled ? undefined : (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => void onDelete()}
            disabled={remove.isPending}
          >
            <Trash className="h-3.5 w-3.5" />
            Delete
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>Database ID</span>
          <CopyableId value={database.id} label="database ID" full />
        </div>
        {scheduled && <ScheduledDeletion database={database} />}
        {database.plan_excess ? (
          <Suspension>{PLAN_EXCESS[database.plan_excess].explain(whose, database)}</Suspension>
        ) : (
          capSuspended &&
          database.state === 'ready' && (
            <Suspension>
              This database refuses connections until the compute cap lifts; Usage this month,
              above, says when and how. Its data is kept.
            </Suspension>
          )
        )}
        {database.restore_slot_until && (
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Clock
              aria-hidden
              className="mt-0.5 h-3.5 w-3.5 shrink-0"
              style={{ color: TONE.warning }}
            />
            <span>
              This restored copy is past {org ? `${label}'s` : 'your'} plan&apos;s database limit.
              Purge a database or upgrade before{' '}
              <Timestamp value={database.restore_slot_until} mode="absolute" /> to keep it;
              otherwise its delete is scheduled then.
            </span>
          </p>
        )}
        {org ? (
          <p className="text-xs text-muted-foreground">
            Conditions and connection planning are read for personal databases only: the API has no
            organization route for them.
          </p>
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">
            <DatabaseConditions database={database} />
            {!scheduled && <ConnectionBudget database={database} />}
          </div>
        )}
        {database.restore_source_database_id && (
          <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            Restored from{' '}
            <CopyableId
              value={database.restore_source_database_id}
              label="source database ID"
              full
            />{' '}
            at{' '}
            {database.restore_point_in_time
              ? new Date(database.restore_point_in_time).toLocaleString()
              : 'an unrecorded point'}
            .
          </p>
        )}

        {scheduled ? (
          <p className="text-sm text-muted-foreground">
            Recover it to bind apps to it or restore from it.
          </p>
        ) : (
          <>
            <DatabaseCompute database={database} operation={operation} onOperation={onOperation} />

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
              <CliCommand
                label="Or restore from the CLI"
                copyLabel={`restore command for ${database.name}`}
                command={restoreCommand}
              />
            </form>
          </>
        )}
      </div>
    </Panel>
  );
}

/** A suspension the customer can act on: colour, icon and the words for what to do. */
function Suspension({ children }: { children: ReactNode }) {
  return (
    <p
      className="flex items-start gap-2 rounded-lg border p-3 text-sm text-muted-foreground"
      style={{ borderColor: `color-mix(in oklab, ${TONE.critical} 35%, transparent)` }}
    >
      <Pause aria-hidden className="mt-0.5 h-4 w-4 shrink-0" style={{ color: TONE.critical }} />
      <span>
        <span className="font-medium" style={{ color: TONE.critical }}>
          Suspended.
        </span>{' '}
        {children}
      </span>
    </p>
  );
}

function explainRecover(err: unknown): ReturnType<typeof explainPostgres> {
  if (err instanceof ApiError) {
    switch (err.code) {
      // ClaimUndelete: past the window, or never scheduled, is not found.
      case 'managed_postgres_not_found':
        return {
          kind: 'info',
          title: 'The recovery window has ended',
          description: 'The database is deleted for good and can no longer be brought back.',
        };
      case 'managed_postgres_not_in_plan':
        return {
          kind: 'info',
          title: 'Your plan no longer allows this database',
          description: 'Recovering makes the same plan check as creating. Upgrade to recover it.',
          error: err,
        };
      case 'managed_postgres_quota_exceeded':
        return { kind: 'info', title: 'No room under the database limit', error: err };
      case 'managed_postgres_conflict':
        return {
          kind: 'error',
          title: 'Another change holds this database',
          description: 'Wait for it to finish, then try again.',
          error: err,
        };
    }
  }
  return explainPostgres(err);
}

/**
 * A database whose delete is scheduled: recover it while the window is open,
 * or purge it now. Recovery is not destructive, so it does not ask; purging
 * is final, so it asks for the name.
 */
function ScheduledDeletion({ database }: { database: PostgresDatabase }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const undelete = useUndeletePostgresDatabase();
  const purge = usePurgePostgresDatabase();
  // One key per recovery intent, as for rotation: a retry after an unknown
  // outcome replays the first answer (a second undelete of a ready database
  // would answer 404); after an ApiError the answer is known and the key goes.
  const intent = useRef<string | null>(null);
  const until = database.restorable_until ?? '';
  // Read once: the window is days long, and a recovery after it ends is
  // answered 404 and explained, so a stale "open" costs nothing.
  const [now] = useState(() => Date.now());
  const open = Date.parse(until) > now;

  const onRecover = async () => {
    const key = intent.current ?? crypto.randomUUID();
    intent.current = key;
    try {
      const recovered = await undelete.mutateAsync({ id: database.id, idempotencyKey: key });
      intent.current = null;
      toast({
        kind: 'success',
        title: `${recovered.name} is recovered`,
        description:
          'It is ready again, with its data and restore history. Bind apps to it again to use it.',
      });
    } catch (err) {
      if (err instanceof ApiError) intent.current = null;
      toast(explainRecover(err));
    }
  };

  const onPurge = async () => {
    if (
      !(await confirm({
        title: `Delete ${database.name} now?`,
        description:
          'This deletes the database and its restore history at once and ends the recovery window. It cannot be undone through Gregale.',
        confirmLabel: 'Delete now',
        destructive: true,
        typeToConfirm: database.name,
      }))
    )
      return;
    try {
      await purge.mutateAsync(database.id);
      toast({ kind: 'success', title: `${database.name} is being deleted` });
    } catch (err) {
      toast(explainPostgres(err));
    }
  };

  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-lg border p-4"
      style={{ borderColor: `color-mix(in oklab, ${TONE.warning} 35%, transparent)` }}
    >
      <p className="flex items-center gap-2 text-sm font-medium" style={{ color: TONE.warning }}>
        <Clock aria-hidden className="h-4 w-4 shrink-0" />
        Deletion scheduled
      </p>
      {open ? (
        <p className="text-sm text-muted-foreground">
          Its compute is stopped and it refuses connections. Recover it before{' '}
          <Timestamp value={until} mode="absolute" /> to return it to ready with its data and
          restore history; after that it is deleted for good. Until then it counts toward the
          plan&apos;s database limit and keeps its name.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          The recovery window has ended; the database is being deleted for good.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {open && (
          <Button size="sm" busy={undelete.isPending} onClick={() => void onRecover()}>
            <Undo className="h-3.5 w-3.5" />
            Recover database
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={purge.isPending} onClick={() => void onPurge()}>
          <Trash className="h-3.5 w-3.5" />
          Delete now
        </Button>
      </div>
    </div>
  );
}

function Bindings({ database }: { database: PostgresDatabase }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const bindings = usePostgresBindings(database.id);
  const apps = useApps();
  const create = useCreatePostgresBinding(database.id);
  const remove = useDeletePostgresBinding(database.id);
  const rotate = useRotatePostgresBinding(database.id);
  // One key per intent: a retry after an unknown outcome (the request may have
  // landed) replays the first answer instead of asking for a second replacement.
  // After an ApiError the answer is known, so the key is dropped.
  const rotation = useRef(new Map<string, { generation: number; key: string }>());
  const [appId, setAppId] = useState('');
  const [environmentKey, setEnvironmentKey] = useState('DATABASE_URL');
  const [access, setAccess] = useState<'read_write' | 'read_only'>('read_write');
  const [scope, setScope] = useState('default');

  const items = bindings.data?.items ?? [];
  const appList = apps.data ?? [];
  const chosenApp = appId || appList[0]?.id || '';
  const appName = (id: string) => appList.find((a) => a.id === id)?.slug ?? id.slice(0, 8);
  // Rotations started here that apid answered as still pending, keyed by
  // binding id, with the generation each one minted. Polling keeps running
  // while any binding is pending, so the settle is seen and said once.
  const settling = useRef(new Map<string, number>());

  const polled = bindings.data;
  const knownApps = apps.data;
  useEffect(() => {
    if (!polled) return;
    for (const [id, generation] of settling.current) {
      const binding = polled.items.find((b) => b.id === id);
      // A read from before the rotation landed still carries the old generation.
      if (binding && (binding.rotation_pending || binding.credential_generation < generation))
        continue;
      settling.current.delete(id);
      // apid clears the pending flag on a finished refresh (back to ready) and
      // on a delete; only the first is a rotation completing.
      if (binding?.state !== 'ready') continue;
      const app =
        knownApps?.find((a) => a.id === binding.app_id)?.slug ?? binding.app_id.slice(0, 8);
      toast({
        kind: 'success',
        title: `Credentials rotated to v${binding.credential_generation}`,
        description: `${app} has finished refreshing onto the new ${binding.environment_key} secret. The previous credential no longer works.`,
      });
    }
  }, [polled, knownApps, toast]);

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

  const onRotate = async (binding: PostgresBinding) => {
    if (
      !(await confirm({
        title: `Rotate credentials for ${appName(binding.app_id)}?`,
        description: `This creates a replacement credential and refreshes the app's runtime so it picks up the new ${binding.environment_key} secret. The previous credential keeps working until that rolling refresh completes, then stops. Until then the binding shows rotation pending. The connection string is never shown here.`,
        confirmLabel: 'Rotate credentials',
        destructive: true,
      }))
    )
      return;
    const prior = rotation.current.get(binding.id);
    const attempt =
      prior?.generation === binding.credential_generation
        ? prior
        : { generation: binding.credential_generation, key: crypto.randomUUID() };
    rotation.current.set(binding.id, attempt);
    try {
      const result = await rotate.mutateAsync({ id: binding.id, idempotencyKey: attempt.key });
      if (result.rotation_pending) settling.current.set(binding.id, result.credential_generation);
      toast(
        result.rotation_pending
          ? {
              kind: 'info',
              title: `Rotation accepted: credentials v${result.credential_generation}`,
              description: `The app is refreshing onto the new ${result.environment_key} secret. It has not finished: the previous credential keeps working until the refresh completes.`,
            }
          : {
              kind: 'success',
              title: `Credentials rotated to v${result.credential_generation}`,
              description: `The app holds the new ${result.environment_key} secret and the previous credential no longer applies.`,
            }
      );
    } catch (err) {
      // apid stores almost every answer under the key for 24 h, refusals
      // included, so a retry that reused it would replay the refusal even once
      // the binding is ready. Keep the key only when the outcome is unknown.
      if (err instanceof ApiError) rotation.current.delete(binding.id);
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
              <CopyableId value={binding.id} label="binding ID" />
              <Pill label={binding.state} color={STATE_COLOR[binding.state]} />
              <span className="font-mono text-muted-foreground">{binding.environment_key}</span>
              <span className="text-muted-foreground">{binding.access.replace('_', ' ')}</span>
              <span className="text-muted-foreground">scope {binding.scope}</span>
              <span className="text-muted-foreground">
                credentials v{binding.credential_generation}
              </span>
              {binding.rotation_pending && (
                <Pill label="rotation pending" color="var(--status-warning)" />
              )}
              {binding.last_error_code && (
                <span style={{ color: 'var(--status-critical)' }}>{binding.last_error_code}</span>
              )}
              <Button
                size="xs"
                variant="ghost"
                className="ml-auto"
                aria-label={`Rotate credentials for ${appName(binding.app_id)}`}
                title={
                  binding.rotation_pending
                    ? 'A rotation is still refreshing the app; wait for it to finish.'
                    : undefined
                }
                onClick={() => void onRotate(binding)}
                disabled={rotate.isPending || binding.rotation_pending || binding.state !== 'ready'}
              >
                Rotate credentials
              </Button>
              <Button
                size="xs"
                variant="ghost"
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
