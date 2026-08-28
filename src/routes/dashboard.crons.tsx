import { useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Clock, Play, Plus, Trash } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { FIELD } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { Modal } from '@/components/ui/modal';
import { InlinePhase, PageHeader, Panel, queryPhase } from '@/components/dashboard/primitives';
import { Pill, ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import {
  useApps,
  useCreateCron,
  useCronRuns,
  useCrons,
  useDeleteCron,
  useRunCron,
  useUpdateCron,
} from '@/lib/api/queries';
import { slugIndex } from '@/lib/api/adapters';
import { errorMessage } from '@/lib/api/errors';
import { formatRelative } from '@/lib/mock-data';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/crons')({
  component: CronsPage,
  head: () => consoleHead('crons'),
});

/**
 * Scheduled requests into an app.
 *
 * This page could delete a cron and fire one by hand, and that was all: no
 * way to create one, no way to pause one (the State column showed a pill
 * nothing could change), and no way to see whether the last run worked —
 * `useCronRuns` had been written and imported nowhere.
 */

interface CronRow {
  id: string;
  app: string;
  schedule: string;
  path: string;
  enabled: boolean;
  lastFiredAt: string | null;
}

function formatWhen(value: string | null | undefined): string {
  if (!value) return 'Never';
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? 'Never' : formatRelative(ms);
}

const OUTCOME_COLOR: Record<string, string | undefined> = {
  success: 'var(--status-good)',
  failed: 'var(--status-critical)',
  timeout: 'var(--status-serious)',
  dead_letter: 'var(--status-critical)',
  running: 'var(--status-warning)',
};

/** The last runs of one cron — outcome, duration, and the error if any. */
function RunHistory({ cron, onClose }: { cron: CronRow | null; onClose: () => void }) {
  const runs = useCronRuns(cron?.id ?? '');
  const runsPhase = queryPhase({
    error: runs.error,
    loading: runs.isPending,
    isEmpty: (runs.data?.runs ?? []).length === 0,
  });
  return (
    <Modal
      open={cron !== null}
      onClose={onClose}
      title={cron ? `${cron.schedule} → ${cron.path}` : ''}
      description="Recent runs, newest first."
      width="max-w-2xl"
    >
      {runsPhase !== 'ready' ? (
        <InlinePhase
          phase={runsPhase}
          error={runs.error}
          loadingMessage="Loading runs…"
          emptyMessage="This cron has not run yet."
        />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {(runs.data?.runs ?? []).map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-sm">
              <Pill label={r.outcome} color={OUTCOME_COLOR[r.outcome]} />
              <span className="text-xs text-muted-foreground">{formatWhen(r.started_at)}</span>
              <span className="font-mono text-xs [font-variant-numeric:tabular-nums]">
                {r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(1)}s` : '—'}
              </span>
              {r.attempts > 1 && (
                <span className="text-xs text-muted-foreground">{r.attempts} attempts</span>
              )}
              {r.error && (
                <span className="font-mono text-xs text-muted-foreground">{r.error}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function CronsPage() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const { data, isPending, error, refetch } = useCrons();
  const { data: apps } = useApps();
  const runCron = useRunCron();
  const deleteCron = useDeleteCron();
  const updateCron = useUpdateCron();
  const createCron = useCreateCron();

  const [appId, setAppId] = useState('');
  const [schedule, setSchedule] = useState('');
  const [path, setPath] = useState('/');
  const [history, setHistory] = useState<CronRow | null>(null);

  const targetApp = appId || apps?.[0]?.id || '';
  const scheduleOk = schedule.trim().split(/\s+/).length === 5;

  const rows = useMemo<CronRow[]>(() => {
    const bySlug = slugIndex(apps ?? []);
    return (data ?? []).map((c) => ({
      id: c.id,
      app: bySlug.get(c.app_id) ?? c.app_id,
      schedule: c.schedule,
      path: c.path,
      enabled: c.enabled,
      lastFiredAt: c.last_fired_at ?? null,
    }));
  }, [data, apps]);

  const setEnabled = (c: CronRow, enabled: boolean) =>
    void updateCron
      .mutateAsync({ id: c.id, enabled })
      .then(() => toast({ kind: 'success', title: enabled ? 'Cron resumed' : 'Cron paused' }))
      .catch((err: unknown) =>
        toast({ kind: 'error', title: 'Could not update', description: errorMessage(err) })
      );

  const columns: Column<CronRow>[] = [
    {
      key: 'schedule',
      label: 'Schedule',
      render: (c) => <span className="font-mono text-xs">{c.schedule}</span>,
    },
    {
      key: 'app',
      label: 'App',
      render: (c) => <span className="font-mono text-xs text-muted-foreground">{c.app}</span>,
    },
    {
      key: 'path',
      label: 'Path',
      render: (c) => <span className="font-mono text-xs text-muted-foreground">{c.path}</span>,
    },
    {
      key: 'enabled',
      label: 'Enabled',
      width: 'w-24',
      render: (c) => (
        <Switch
          size="sm"
          checked={c.enabled}
          onCheckedChange={(on) => setEnabled(c, on)}
          aria-label={`${c.enabled ? 'Pause' : 'Resume'} ${c.schedule}`}
          className="data-[state=checked]:bg-brand"
        />
      ),
    },
    {
      key: 'lastFiredAt',
      label: 'Last fired',
      numeric: true,
      render: (c) => (
        <span className="text-xs text-muted-foreground">{formatWhen(c.lastFiredAt)}</span>
      ),
    },
    {
      key: 'id',
      label: '',
      width: 'w-28',
      render: (c) => (
        <span className="flex items-center gap-3">
          <button
            type="button"
            aria-label={`Run history for ${c.schedule}`}
            onClick={() => setHistory(c)}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <Clock className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label={`Run ${c.schedule} now`}
            onClick={() => {
              void runCron
                .mutateAsync(c.id)
                .then(() => toast({ kind: 'success', title: 'Cron fired' }))
                .catch((err: unknown) =>
                  toast({ kind: 'error', title: 'Could not fire', description: errorMessage(err) })
                );
            }}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <Play className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label={`Delete cron ${c.id}`}
            onClick={async () => {
              if (
                !(await confirm({
                  title: 'Delete this cron?',
                  description: `${c.schedule} → ${c.path} stops firing. This cannot be undone.`,
                  confirmLabel: 'Delete cron',
                  destructive: true,
                }))
              )
                return;
              void deleteCron
                .mutateAsync(c.id)
                .then(() => toast({ kind: 'success', title: 'Cron deleted' }))
                .catch((err: unknown) =>
                  toast({
                    kind: 'error',
                    title: 'Could not delete',
                    description: errorMessage(err),
                  })
                );
            }}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <Trash className="h-3.5 w-3.5" />
          </button>
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Cron Jobs"
        description="Scheduled synthetic requests into your apps. Firing one by hand does not change its schedule."
      />

      <Panel lit title="Add a cron">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!targetApp || !scheduleOk || createCron.isPending) return;
            void createCron
              .mutateAsync({
                app_id: targetApp,
                schedule: schedule.trim(),
                path: path.trim() || '/',
              })
              .then((c) => {
                setSchedule('');
                setPath('/');
                toast({
                  kind: 'success',
                  title: 'Cron added',
                  description: `${c.schedule} → ${c.path}`,
                });
              })
              .catch((err: unknown) =>
                toast({ kind: 'error', title: 'Could not add', description: errorMessage(err) })
              );
          }}
        >
          <label className="flex flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">App</span>
            <select
              value={targetApp}
              onChange={(e) => setAppId(e.target.value)}
              className={`${FIELD} min-w-44`}
            >
              {(apps ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.slug}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-48 flex-1 flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">Schedule</span>
            <input
              value={schedule}
              onChange={(e) => setSchedule(e.target.value)}
              placeholder="*/15 * * * *"
              spellCheck={false}
              className={`${FIELD} font-mono`}
            />
          </label>
          <label className="flex min-w-40 flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">Path</span>
            <input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/run"
              spellCheck={false}
              className={`${FIELD} font-mono`}
            />
          </label>
          <Button
            type="submit"
            size="sm"
            className="gap-1.5"
            disabled={!targetApp || !scheduleOk}
            busy={createCron.isPending}
          >
            <Plus className="h-3.5 w-3.5" />
            Add cron
          </Button>
          <p className="basis-full text-xs text-muted-foreground">
            Five fields, UTC: minute, hour, day of month, month, day of week. The request is a GET
            to the path on a fresh or warm instance.
          </p>
        </form>
      </Panel>

      <ResourceTable
        rows={rows}
        columns={columns}
        initialSort={{ key: 'schedule', dir: 'asc' }}
        searchKeys={['schedule', 'path', 'app']}
        searchPlaceholder="Filter by schedule or path…"
        emptyMessage="No scheduled jobs yet."
        minWidth="min-w-[820px]"
        loading={isPending}
        error={error}
        onRetry={() => void refetch()}
      />

      <RunHistory cron={history} onClose={() => setHistory(null)} />
    </div>
  );
}
