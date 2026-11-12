import { CliCommand } from '@/components/dashboard/cli-command';
import { PlanGated } from '@/components/dashboard/plan-gated';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  UnreachableState,
  queryPhase,
} from '@/components/dashboard/primitives';
import { Pill } from '@/components/dashboard/resource-table';
import { HelpTip } from '@/components/dashboard/kit/help-tip';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { CopyableId } from '@/components/ui/copyable-id';
import { FIELD, Select } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { Timestamp } from '@/components/ui/timestamp';
import { useToast } from '@/components/ui/toast';
import { ApiError, errorMessage } from '@/lib/api/errors';
import {
  usePostgresUsage,
  usePurgePostgresDatabase,
  useUndeletePostgresDatabase,
} from '@/lib/api/postgres';
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
import { useCapabilityAccess } from '@/lib/api/capabilities';
import { useWorkspaceTarget } from '@/lib/api/workspace-apps';
import { cliPostgresRestoreCommand } from '@/lib/cli-commands';
import { absoluteTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import { Link } from '@tanstack/react-router';
import { Clock, Pause, Plus, Trash, Undo } from 'iconoir-react';
import { useReducedMotion } from 'motion/react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Sheet } from './kit/sheet';
import { DetailDisclosure } from './detail-disclosure';
import { DatabaseCompute, type ComputeOperation } from './postgres-compute';
import { ConnectionBudget, DatabaseConditions } from './postgres-health';
import { TONE, explainPostgres } from './postgres-shared';
import {
  SERVICE_CLASS_NAMES,
  bindingsSentence,
  describeDatabase,
  regionName,
  spelledAgo,
  type DatabaseWords,
} from './postgres-words';
import { PostgresUsage } from './postgres-usage';
import { LiveQueries } from './postgres-live-queries';

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
  { explain: (whose: string, database: PostgresDatabase) => string }
> = {
  database_limit: {
    explain: (whose) =>
      `${whose} plan allows fewer databases than there are, so this one, among the newest, is suspended. Its data, credentials and bindings are kept. Upgrade, or delete a database, to resume it; the next usage sweep, within minutes, does.`,
  },
  service_class: {
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

export function PostgresDatabases() {
  const databases = usePostgresDatabases();
  // The same read as the usage panel's: the cap holds every database at once.
  const capSuspended = usePostgresUsage().data?.compute_cap_state === 'suspended';
  const { org, label } = useWorkspaceTarget();
  // Resize lives in the detail, behind its capability; offer it only where it is.
  const canResize = useCapabilityAccess('postgres-compute-policy').access === 'on';
  const reduce = useReducedMotion();
  // Read once: tiles count days, and a stale "3 more days" is corrected by the
  // next poll or render long before it matters.
  const [now] = useState(() => Date.now());
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // A fix that lives in the detail opens it and brings it into view.
  const [reveal, setReveal] = useState(0);
  const detail = useRef<HTMLDivElement>(null);
  // The resize or policy change started for each database, kept here so it is
  // still followed after its detail is closed and opened again: the API has no
  // list of a database's changes to find it by.
  const [operations, setOperations] = useState<Record<string, ComputeOperation>>({});
  const phase = queryPhase({ error: databases.error, loading: databases.isPending });
  const items = databases.data?.items ?? [];
  const open = items.find((d) => d.id === selected);
  const context = { capSuspended, whose: org ? `${label}’s` : 'your', canResize, now };

  useEffect(() => {
    if (reveal === 0) return;
    detail.current?.scrollIntoView?.({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }, [reveal, reduce]);

  const create = (
    <Button size="sm" onClick={() => setCreating(true)}>
      <Plus className="h-3.5 w-3.5" />
      Create database
    </Button>
  );

  return (
    <PlanGated error={databases.error} feature="Managed PostgreSQL">
      <div className="flex flex-col gap-6">
        <PostgresUsage />
        <section aria-labelledby="databases-title" className="flex flex-col gap-4">
          <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex items-center gap-1">
                <h2 id="databases-title" className="text-xl font-bold tracking-[-0.01em]">
                  Databases
                </h2>
                <HelpTip label="About Databases">
                  Connection details reach your apps as secrets, never this page.
                </HelpTip>
              </div>
              <p className="text-sm text-muted-foreground">
                Managed PostgreSQL your apps connect to. You don&apos;t run or patch it.
              </p>
            </div>
            <div className="shrink-0">{create}</div>
          </header>
          {phase === 'unreachable' ? (
            <div className="surface rounded-[1.25rem] bg-card p-5">
              <UnreachableState onRetry={() => void databases.refetch()} />
            </div>
          ) : phase === 'loading' ? (
            <div className="surface rounded-[1.25rem] bg-card p-5">
              <LoadingState message="Loading databases…" />
            </div>
          ) : phase === 'error' ? (
            <div className="surface rounded-[1.25rem] bg-card p-5">
              <ErrorState error={databases.error} onRetry={() => void databases.refetch()} />
            </div>
          ) : items.length === 0 ? (
            <div className="surface rounded-[1.25rem] bg-card p-5">
              <EmptyState
                message="No managed databases yet."
                action={
                  <Button size="sm" onClick={() => setCreating(true)}>
                    Create database
                  </Button>
                }
              />
            </div>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {items.map((database) => (
                <li key={database.id} className="flex">
                  <DatabaseTile
                    database={database}
                    words={describeDatabase(database, context)}
                    now={now}
                    open={database.id === selected}
                    onToggle={() => setSelected(database.id === selected ? null : database.id)}
                    onReveal={() => {
                      setSelected(database.id);
                      setReveal((n) => n + 1);
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
        <Sheet open={creating} onClose={() => setCreating(false)} title="Create database">
          <CreateDatabase onDone={() => setCreating(false)} />
        </Sheet>

        {/* Keyed on the database: the restore and binding forms belong to the
            one that is open, and must not carry over to the next. */}
        {open && (
          <div ref={detail} className="scroll-mt-6">
            <DatabaseDetail
              key={open.id}
              database={open}
              words={describeDatabase(open, context)}
              capSuspended={capSuspended}
              operation={operations[open.id]}
              onOperation={(operation) =>
                setOperations((all) => ({ ...all, [open.id]: operation }))
              }
            />
          </div>
        )}
      </div>
    </PlanGated>
  );
}

/** One status word with its dot: filled while it runs, a hollow ring when it does not. */
function StatusWord({ words }: { words: DatabaseWords }) {
  const colour = TONE[words.tone];
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[13px]"
      style={{ color: words.gone ? 'var(--muted-foreground)' : colour }}
    >
      <span
        aria-hidden
        className="size-[7px] rounded-full"
        style={
          words.ring ? { boxShadow: `inset 0 0 0 1.5px ${colour}` } : { backgroundColor: colour }
        }
      />
      {words.word}
    </span>
  );
}

/** The sentence, with its time left (or other key value) set apart. */
function Sentence({ words }: { words: DatabaseWords }) {
  const at = words.emphasis ? words.sentence.indexOf(words.emphasis) : -1;
  if (at < 0 || !words.emphasis) return <>{words.sentence}</>;
  return (
    <>
      {words.sentence.slice(0, at)}
      <span className="font-medium text-foreground">{words.emphasis}</span>
      {words.sentence.slice(at + words.emphasis.length)}
    </>
  );
}

const CHIP =
  'inline-flex h-6 items-center rounded-full bg-muted px-2.5 text-[13px] text-muted-foreground';

/**
 * A database as a tile: its name, one status word, one sentence saying what
 * that means for its apps, the fixes that exist for it, then the facts. The
 * name is the tile's button: its hit area covers the tile, and the fixes sit
 * above it, so a click anywhere else opens the detail.
 */
function DatabaseTile({
  database,
  words,
  now,
  open,
  onToggle,
  onReveal,
}: {
  database: PostgresDatabase;
  words: DatabaseWords;
  now: number;
  open: boolean;
  onToggle: () => void;
  onReveal: () => void;
}) {
  const recover = useRecover(database);
  const created = Date.parse(database.created_at);
  const nameId = `database-${database.id}`;
  const tint =
    words.tone === 'critical' || words.tone === 'warning'
      ? {
          background: `radial-gradient(90% 80% at 100% 0%, color-mix(in oklab, ${TONE[words.tone]} ${words.tone === 'critical' ? 12 : 8}%, transparent), transparent 65%), var(--card)`,
        }
      : undefined;
  const fixes = words.fixes.map((fix, i) => {
    const variant = i === 0 && fix !== 'restore' ? 'default' : 'outline';
    switch (fix) {
      case 'upgrade':
        return (
          <Button key={fix} asChild variant={variant}>
            <Link to="/dashboard/plans">Upgrade plan</Link>
          </Button>
        );
      case 'resize':
        return (
          <Button key={fix} variant={variant} onClick={onReveal}>
            Choose another size
          </Button>
        );
      case 'restore':
        return (
          <Button
            key={fix}
            variant={variant}
            busy={recover.pending}
            onClick={() => void recover.run()}
          >
            <Undo className="h-3.5 w-3.5" />
            Restore database
          </Button>
        );
      case 'open':
        return (
          <Button key={fix} variant={variant} onClick={onReveal}>
            See details
          </Button>
        );
    }
  });

  return (
    <section
      aria-labelledby={nameId}
      className={cn(
        'relative flex w-full flex-col gap-4 rounded-[1.25rem] p-5 transition-shadow sm:p-6',
        words.gone ? 'border-[1.5px] border-border bg-transparent' : 'surface bg-card',
        open && 'outline-2 outline-offset-2 outline-brand/60'
      )}
      style={tint}
    >
      <div className="flex items-start justify-between gap-3">
        <h3
          id={nameId}
          className={cn(
            'min-w-0 text-lg leading-7 font-bold tracking-[-0.01em] break-words',
            words.gone && 'text-muted-foreground'
          )}
        >
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="text-left outline-none after:absolute after:inset-0 after:rounded-[1.25rem] focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-brand hover:underline hover:decoration-muted-foreground/50 hover:underline-offset-4"
          >
            {database.name}
          </button>
        </h3>
        <span className="pt-1">
          <StatusWord words={words} />
        </span>
      </div>
      <p
        className={cn('text-[15px] leading-6', words.gone && 'text-muted-foreground')}
        title={words.term}
      >
        <Sentence words={words} />
      </p>
      {fixes.length > 0 && <div className="relative z-10 flex flex-wrap gap-2">{fixes}</div>}
      <ul aria-label="Details" className="mt-auto flex flex-wrap gap-1.5">
        <li className={CHIP}>PostgreSQL {database.postgres_major}</li>
        <li className={CHIP} title={`Service class: ${database.service_class}`}>
          {SERVICE_CLASS_NAMES[database.service_class] ?? database.service_class}
        </li>
        <li className={CHIP} title={`Region: ${database.region}`}>
          {regionName(database.region)}
        </li>
        <li className={cn(CHIP, 'tabular-nums')} title="Storage limit">
          {gb(database.storage_limit_bytes)}
        </li>
        {database.availability === 'high_availability' && (
          <li className={CHIP} title="High availability">
            Two zones
          </li>
        )}
        {database.scale_to_zero && (
          <li className={CHIP} title="Scales to zero">
            Sleeps when idle
          </li>
        )}
      </ul>
      <p className="text-xs text-muted-foreground tabular-nums">
        Created{' '}
        {Number.isNaN(created) ? (
          'at an unknown time'
        ) : (
          <time dateTime={database.created_at} title={absoluteTime(created)}>
            {spelledAgo(created, now)}
          </time>
        )}
      </p>
    </section>
  );
}

function DatabaseDetail({
  database,
  words,
  capSuspended,
  operation,
  onOperation,
}: {
  database: PostgresDatabase;
  words: DatabaseWords;
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
  const [restoring, setRestoring] = useState(false);
  const [binding, setBinding] = useState(false);
  const bindings = usePostgresBindings(database.id);
  const apps = useApps();
  const appName = (id: string) => apps.data?.find((a) => a.id === id)?.slug ?? id.slice(0, 8);
  const titleId = useId();
  const paused = Boolean(database.plan_excess) || (capSuspended && database.state === 'ready');

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
      setRestoring(false);
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

  const restoreForm = (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (restoreReady && !restore.isPending) void onRestore();
      }}
    >
      <p className="text-sm text-muted-foreground">
        Makes a new database from this one as it was at a moment you choose, leaving this one
        running. Anything within the last {hours(database.restore_window_seconds)} can be chosen.
      </p>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">New database name</span>
        <input
          value={restoreName}
          onChange={(e) => setRestoreName(e.target.value)}
          placeholder={`${database.name}-restored`}
          aria-label="Restored database name"
          className={FIELD}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Point in time</span>
        <input
          type="datetime-local"
          value={pointInTime}
          onChange={(e) => setPointInTime(e.target.value)}
          aria-label="Restore point in time"
          className={FIELD}
        />
      </label>
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={!restoreReady} busy={restore.isPending}>
          Restore into a new database
        </Button>
      </div>
      <CliCommand
        label="Or restore from the CLI"
        copyLabel={`restore command for ${database.name}`}
        command={restoreCommand}
      />
    </form>
  );

  const items = bindings.data?.items ?? [];

  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-5 surface rounded-[1.25rem] bg-card p-5 sm:p-6"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <h2
            id={titleId}
            className="min-w-0 text-2xl leading-tight font-semibold tracking-[-0.01em] break-words"
          >
            {database.name}
          </h2>
          <StatusWord words={words} />
        </div>
        {!scheduled && (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => void onDelete()}
            disabled={remove.isPending}
          >
            <Trash className="h-3.5 w-3.5" />
            Delete
          </Button>
        )}
      </header>

      <div className="flex flex-col gap-1.5">
        <p
          className={cn(
            'max-w-3xl text-lg leading-snug sm:text-xl',
            words.gone && 'text-muted-foreground'
          )}
          title={words.term}
        >
          <Sentence words={words} />
        </p>
        {!scheduled && !words.gone && !bindings.isPending && !bindings.error && (
          <p className="text-sm text-muted-foreground">{bindingsSentence(items, appName)}</p>
        )}
      </div>

      {scheduled && <ScheduledDeletion database={database} />}
      {database.plan_excess ? (
        <Suspension>{PLAN_EXCESS[database.plan_excess].explain(whose, database)}</Suspension>
      ) : (
        capSuspended &&
        database.state === 'ready' && (
          <Suspension>
            This database refuses connections until the compute cap lifts; Usage this month, above,
            says when and how. Its data is kept.
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
            <Timestamp value={database.restore_slot_until} mode="absolute" /> to keep it; otherwise
            its delete is scheduled then.
          </span>
        </p>
      )}

      {scheduled ? (
        <p className="text-sm text-muted-foreground">
          Restore it to bind apps to it or make a copy from it.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {(apps.data?.length ?? 0) > 0 && (
              <Button
                size="sm"
                variant={paused ? 'outline' : 'default'}
                onClick={() => setBinding(true)}
              >
                <Plus className="h-3.5 w-3.5" />
                Connect an app
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setRestoring(true)}>
              <Undo className="h-3.5 w-3.5" />
              Restore a copy…
            </Button>
          </div>
          <Bindings
            database={database}
            appName={appName}
            sheetOpen={binding}
            onSheetChange={setBinding}
          />
        </>
      )}

      <div className="flex flex-col gap-4 border-t border-border pt-5">
        {!scheduled && (
          <DetailDisclosure
            title="Size and compute"
            summary={`${SERVICE_CLASS_NAMES[database.service_class] ?? database.service_class}${database.scale_to_zero ? ' · sleeps when idle' : ''}`}
            defaultOpen={database.plan_excess === 'service_class' || Boolean(operation)}
          >
            <DatabaseCompute database={database} operation={operation} onOperation={onOperation} />
          </DetailDisclosure>
        )}
        <DetailDisclosure
          title="Health and connections"
          summary="conditions and connection planning"
        >
          {org ? (
            <p className="text-xs text-muted-foreground">
              Conditions and connection planning are read for personal databases only: the API has
              no organization route for them.
            </p>
          ) : (
            <div className="grid gap-5 lg:grid-cols-2">
              <DatabaseConditions database={database} />
              {!scheduled && <ConnectionBudget database={database} />}
            </div>
          )}
        </DetailDisclosure>
        {!scheduled && (
          <DetailDisclosure title="Live queries" summary="preview, from the CLI">
            <LiveQueries database={database} />
          </DetailDisclosure>
        )}
        <DetailDisclosure title="Technical details" summary="IDs, restore window, bindings">
          <TechnicalDetails database={database} bindings={items} appName={appName} />
        </DetailDisclosure>
      </div>

      <Sheet
        open={restoring}
        onClose={() => setRestoring(false)}
        title={`Restore a copy of ${database.name}`}
      >
        {restoreForm}
      </Sheet>
    </section>
  );
}

/** Ids, windows and per-binding facts: one click away, never on the page by default. */
function TechnicalDetails({
  database,
  bindings,
  appName,
}: {
  database: PostgresDatabase;
  bindings: PostgresBinding[];
  appName: (id: string) => string;
}) {
  return (
    <dl className="grid gap-x-6 gap-y-3 text-xs sm:grid-cols-[max-content_minmax(0,1fr)]">
      <dt className="text-muted-foreground">Database ID</dt>
      <dd>
        <CopyableId value={database.id} label="database ID" full />
      </dd>
      <dt className="text-muted-foreground">Engine</dt>
      <dd>
        PostgreSQL {database.postgres_major} · {regionName(database.region)} ({database.region})
      </dd>
      <dt className="text-muted-foreground">Restore window</dt>
      <dd>{hours(database.restore_window_seconds)}</dd>
      <dt className="text-muted-foreground">Availability</dt>
      <dd>{database.availability === 'high_availability' ? 'High availability' : 'Single zone'}</dd>
      <dt className="text-muted-foreground">State</dt>
      <dd className="font-mono">
        {database.state}
        {database.last_error_code ? ` · ${database.last_error_code}` : ''}
      </dd>
      {database.restore_source_database_id && (
        <>
          <dt className="text-muted-foreground">Restored from</dt>
          <dd className="flex flex-wrap items-center gap-1">
            <CopyableId
              value={database.restore_source_database_id}
              label="source database ID"
              full
            />{' '}
            at{' '}
            {database.restore_point_in_time
              ? new Date(database.restore_point_in_time).toLocaleString()
              : 'an unrecorded point'}
          </dd>
        </>
      )}
      {bindings.length > 0 && (
        <>
          <dt className="text-muted-foreground">Bindings</dt>
          <dd>
            <ul className="flex flex-col gap-1.5">
              {bindings.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-mono">{appName(b.app_id)}</span>
                  <CopyableId value={b.id} label="binding ID" />
                  <span className="text-muted-foreground">scope {b.scope}</span>
                  <span className="text-muted-foreground">
                    credentials v{b.credential_generation}
                  </span>
                  {b.last_error_code && (
                    <span className="font-mono" style={{ color: 'var(--status-critical)' }}>
                      {b.last_error_code}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </dd>
        </>
      )}
    </dl>
  );
}

/** A suspension the customer can act on: colour, icon and the words for what to do. */
function Suspension({ children }: { children: ReactNode }) {
  return (
    <p
      className="flex items-start gap-2 rounded-lg border p-3 text-sm text-muted-foreground"
      style={{ backgroundColor: `color-mix(in oklab, ${TONE.critical} 14%, transparent)` }}
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
 * Recovering a scheduled delete, from its tile or its detail. One key per
 * recovery intent, as for rotation: a retry after an unknown outcome replays
 * the first answer (a second undelete of a ready database would answer 404);
 * after an ApiError the answer is known and the key goes.
 */
function useRecover(database: PostgresDatabase) {
  const { toast } = useToast();
  const undelete = useUndeletePostgresDatabase();
  const intent = useRef<string | null>(null);
  const run = async () => {
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
  return { run, pending: undelete.isPending };
}

/**
 * A database whose delete is scheduled: recover it while the window is open,
 * or purge it now. Recovery is not destructive, so it does not ask; purging
 * is final, so it asks for the name.
 */
function ScheduledDeletion({ database }: { database: PostgresDatabase }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const recover = useRecover(database);
  const purge = usePurgePostgresDatabase();
  const until = database.restorable_until ?? '';
  // Read once: the window is days long, and a recovery after it ends is
  // answered 404 and explained, so a stale "open" costs nothing.
  const [now] = useState(() => Date.now());
  const open = Date.parse(until) > now;

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
      style={{ backgroundColor: `color-mix(in oklab, ${TONE.warning} 14%, transparent)` }}
    >
      <p className="flex items-center gap-2 text-sm font-medium" style={{ color: TONE.warning }}>
        <Clock aria-hidden className="h-4 w-4 shrink-0" />
        Deletion scheduled
      </p>
      {open ? (
        <p className="text-sm text-muted-foreground">
          Restore it before <Timestamp value={until} mode="absolute" /> to get it back with its data
          and restore history. Until then it refuses connections and still counts toward the
          plan&apos;s database limit.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          The recovery window has ended; the database is being deleted for good.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {open && (
          <Button size="sm" busy={recover.pending} onClick={() => void recover.run()}>
            <Undo className="h-3.5 w-3.5" />
            Restore database
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

function Bindings({
  database,
  appName,
  sheetOpen: binding,
  onSheetChange: setBinding,
}: {
  database: PostgresDatabase;
  appName: (id: string) => string;
  /** The bind sheet, opened by the detail's "Connect an app". */
  sheetOpen: boolean;
  onSheetChange: (open: boolean) => void;
}) {
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
      setBinding(false);
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
    <div className="flex flex-col gap-2">
      {bindings.isPending ? (
        <p className="text-sm text-muted-foreground">Loading the apps that use it…</p>
      ) : bindings.error ? (
        <p className="text-sm text-muted-foreground">{errorMessage(bindings.error)}</p>
      ) : (
        items.length > 0 && (
          <ul aria-label="Apps using it" className="flex flex-col divide-y divide-border">
            {items.map((binding) => (
              <li
                key={binding.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5 text-sm first:pt-0 last:pb-0"
              >
                <span className="font-medium">{appName(binding.app_id)}</span>
                <Pill label={binding.state} color={STATE_COLOR[binding.state]} />
                <span className="text-muted-foreground">
                  as <span className="font-mono text-foreground/90">{binding.environment_key}</span>
                  {' · '}
                  {binding.access === 'read_only' ? 'reads only' : 'reads and writes'}
                </span>
                {binding.rotation_pending && (
                  <Pill label="rotation pending" color="var(--status-warning)" />
                )}
                {binding.last_error_code && (
                  <span
                    className="text-xs"
                    style={{ color: 'var(--status-critical)' }}
                    title={binding.last_error_code}
                  >
                    Last change failed
                  </span>
                )}
                <span className="ml-auto flex items-center gap-1">
                  <Button
                    size="xs"
                    variant="ghost"
                    aria-label={`Rotate credentials for ${appName(binding.app_id)}`}
                    title={
                      binding.rotation_pending
                        ? 'A rotation is still refreshing the app; wait for it to finish.'
                        : `Credentials v${binding.credential_generation}`
                    }
                    onClick={() => void onRotate(binding)}
                    disabled={
                      rotate.isPending || binding.rotation_pending || binding.state !== 'ready'
                    }
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
                </span>
              </li>
            ))}
          </ul>
        )
      )}
      <Sheet
        open={binding}
        onClose={() => setBinding(false)}
        title={`Connect an app to ${database.name}`}
      >
        <form
          className="flex flex-col gap-4"
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
              className={cn(FIELD, 'font-mono')}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Access</span>
            <Select
              value={access}
              onChange={(e) => setAccess(e.target.value as 'read_write' | 'read_only')}
              aria-label="Binding access"
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
              className={FIELD}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            The connection string reaches the app as this secret and is never shown in the console.
          </p>
          <div className="flex justify-end">
            <Button
              type="submit"
              size="sm"
              disabled={!environmentKey.trim()}
              busy={create.isPending}
            >
              Bind app
            </Button>
          </div>
        </form>
      </Sheet>
    </div>
  );
}

function CreateDatabase({ onDone }: { onDone: () => void }) {
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
      onDone();
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
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !create.isPending) void submit();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-xs text-muted-foreground">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="orders"
            aria-label="Database name"
            className={FIELD}
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
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={ha}
            onCheckedChange={setHa}
            aria-label="High availability"
            className="data-[state=checked]:bg-brand"
          />
          High availability
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={scaleToZero}
            onCheckedChange={setScaleToZero}
            aria-label="Scale to zero"
            className="data-[state=checked]:bg-brand"
          />
          Scale to zero
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        {SERVICE_CLASSES.find((s) => s.value === serviceClass)?.blurb} Lower-case letters, digits
        and dashes in the name.
      </p>
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={!ready} busy={create.isPending}>
          Create database
        </Button>
      </div>
    </form>
  );
}
