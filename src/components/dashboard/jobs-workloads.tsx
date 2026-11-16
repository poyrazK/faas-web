import { CapabilityGate } from '@/components/dashboard/capability-gate';
import { JobActions } from '@/components/dashboard/job-actions';
import { JobDefinition, JobRunDetail } from '@/components/dashboard/job-detail';
import { JobRuns } from '@/components/dashboard/job-runs';
import { JobTasks } from '@/components/dashboard/job-tasks';
import { isPlanGate, PlanGated } from '@/components/dashboard/plan-gated';
import { InlinePhase, PageHeader, Panel, queryPhase } from '@/components/dashboard/primitives';
import { JobRegistryCredentialsPanel } from '@/components/dashboard/registry-credentials';
import { Pill, ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { Button } from '@/components/ui/button';
import { CopyIconButton } from '@/components/ui/copy-button';
import { Tooltip, TooltipProvider } from '@/components/ui/tooltip';
import { useCapabilityStage } from '@/lib/api/capabilities';
import { useInfiniteJobs, useJobs } from '@/lib/api/queries';
import { Plus } from 'iconoir-react';
import { useMemo, useState } from 'react';
import { JobCreateDialog } from './job-create-dialog';
import { accountWideNote, useScopeGate } from './scope-gate';
import type { JobsSelectionProps } from './jobs-search';

/**
 * Batch and recurring workloads, from `/v1/jobs` (spec §14.A).
 *
 * Account-wide workloads rendered as the Jobs hub's Workloads section.
 *
 * Jobs are plan-gated — Free answers `402 jobs_not_allowed` — so the page
 * leads with that rather than an error when the account cannot use them.
 *
 * New definitions can be created here or through the CLI.
 *
 * `/v1/jobs` belongs to the `workflows-and-jobs` capability (faas
 * catalog.json), which apid's capability gate answers with 404 while hidden,
 * so nothing here mounts or reads until the account has it, and the section
 * carries the capability's maturity.
 */
interface JobRow {
  id: string;
  name: string;
  kind: string;
  status: string;
  image: string;
  ram: number;
  parallelism: number;
  retries: number;
}

const STATUS_COLOR: Record<string, string> = {
  active: 'var(--status-good)',
  paused: 'var(--status-warning)',
  deleted: 'var(--status-idle)',
};

export function WorkloadsBody(props: JobsSelectionProps) {
  return (
    <CapabilityGate capability="workflows-and-jobs" title="Workloads">
      <Workloads {...props} />
    </CapabilityGate>
  );
}

function Workloads({ search, onSelection }: JobsSelectionProps) {
  const stage = useCapabilityStage('workflows-and-jobs');
  // `/v1/jobs` rows name no app, so workloads cannot be placed in a project.
  const note = accountWideNote(useScopeGate().scope);
  const [creating, setCreating] = useState(false);
  // Browsing uses the paged query so a large account is not silently capped
  // at the first response. A selected URL keeps the older lookup query, which
  // walks pages until it finds the requested job before rendering its detail.
  const jobs = useInfiniteJobs(50, !search.job);
  const selectedJobs = useJobs(search.job, Boolean(search.job));
  const data = useMemo(
    () =>
      search.job
        ? (selectedJobs.data?.jobs ?? [])
        : (jobs.data?.pages.flatMap((page) => page.jobs) ?? []),
    [jobs.data, search.job, selectedJobs.data]
  );
  const error = search.job ? selectedJobs.error : jobs.error;
  const isPending = search.job ? selectedJobs.isPending : jobs.isPending;
  // Keep already loaded jobs usable if a later page fails; only an initial
  // failure should replace the table with its full-page error state.
  const listError = data.length === 0 ? error : undefined;
  const listLoading = isPending && !error && data.length === 0;
  const selectedJob = data.find((j) => j.id === search.job);
  const job = selectedJob?.name ?? null;
  const runId = search.run ?? null;

  const rows = useMemo<JobRow[]>(
    () =>
      data.map((j) => ({
        id: j.id,
        name: j.name,
        kind: j.kind,
        status: j.status,
        image: j.image_ref,
        ram: j.ram_mb,
        parallelism: j.max_parallelism,
        retries: j.retry_max,
      })),
    [data]
  );

  const columns: Column<JobRow>[] = [
    {
      key: 'name',
      label: 'Job',
      width: 'w-[65%] md:w-52',
      render: (j) => (
        <button
          type="button"
          onClick={() => {
            onSelection({
              job: search.job === j.id ? undefined : j.id,
              run: undefined,
              task: undefined,
            });
          }}
          title={j.name}
          className="block w-full truncate text-left font-mono text-xs underline-offset-2 hover:underline"
        >
          {j.name}
        </button>
      ),
    },
    {
      key: 'kind',
      label: 'Kind',
      priority: 'secondary',
      width: 'w-24',
      render: (j) => (
        <Pill
          label={j.kind}
          color={j.kind === 'recurring' ? 'var(--cat-compute)' : 'var(--cat-storage)'}
        />
      ),
    },
    {
      key: 'status',
      label: 'Status',
      width: 'w-[35%] md:w-24',
      render: (j) => <Pill label={j.status} color={STATUS_COLOR[j.status]} />,
    },
    {
      key: 'image',
      label: 'Image',
      priority: 'secondary',
      render: (j) => (
        <TooltipProvider>
          <Tooltip content={<span className="break-all font-mono">{j.image}</span>}>
            <span
              tabIndex={0}
              className="flex min-w-0 items-start gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring md:items-center"
            >
              <span className="min-w-0 flex-1 break-all font-mono text-xs text-muted-foreground md:truncate">
                {j.image}
              </span>
              <CopyIconButton text={j.image} label={`image reference for ${j.name}`} />
            </span>
          </Tooltip>
        </TooltipProvider>
      ),
    },
    {
      key: 'ram',
      label: 'RAM',
      priority: 'secondary',
      numeric: true,
      width: 'w-20',
      render: (j) => (
        <span className="whitespace-nowrap [font-variant-numeric:tabular-nums]">{j.ram} MB</span>
      ),
    },
    {
      key: 'parallelism',
      label: 'Parallel',
      priority: 'secondary',
      numeric: true,
      width: 'w-24',
      render: (j) => <span className="[font-variant-numeric:tabular-nums]">{j.parallelism}</span>,
    },
    {
      key: 'retries',
      label: 'Retries',
      priority: 'secondary',
      numeric: true,
      width: 'w-20',
      render: (j) => <span className="[font-variant-numeric:tabular-nums]">{j.retries}</span>,
    },
  ];

  return (
    <div className="@container flex flex-col gap-6">
      <PageHeader
        title="Workloads"
        actions={
          <>
            {stage && <Pill label={stage} />}
            {!isPlanGate(error) && (
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" />
                New workload
              </Button>
            )}
          </>
        }
      />
      {creating && (
        <JobCreateDialog
          onClose={() => setCreating(false)}
          onCreated={(created) => {
            setCreating(false);
            onSelection({ job: created.id, run: undefined, task: undefined });
          }}
        />
      )}

      {note && <p className="-mt-3 text-xs text-muted-foreground">{note}</p>}
      <PlanGated error={error} feature="Jobs">
        {search.job && data && !job && <p role="status">Workload not found</p>}
        <p className="hidden text-xs text-muted-foreground md:@max-[900px]:block">
          Scroll the table horizontally to see all workload settings.
        </p>
        <ResourceTable
          rows={rows}
          columns={columns}
          initialSort={{ key: 'name', dir: 'asc' }}
          searchKeys={['name', 'image', 'kind']}
          searchPlaceholder="Filter by job, image, or kind…"
          emptyMessage="No workloads yet."
          emptyAction={
            <Button size="sm" onClick={() => setCreating(true)}>
              Create your first workload
            </Button>
          }
          tableLayout="fixed"
          desktopMinWidth="md:min-w-[900px]"
          loading={listLoading}
          error={listError}
          onRetry={() => void (search.job ? selectedJobs.refetch() : jobs.refetch())}
        />

        {!search.job && data.length > 0 && Boolean(jobs.error) && (
          <div className="flex flex-wrap items-center justify-center gap-3">
            <InlinePhase phase={queryPhase({ error: jobs.error })} error={jobs.error} />
            <Button
              size="xs"
              variant="ghost"
              onClick={() =>
                void (jobs.isFetchNextPageError ? jobs.fetchNextPage() : jobs.refetch()).catch(
                  () => undefined
                )
              }
            >
              Retry
            </Button>
          </div>
        )}

        {!search.job && jobs.hasNextPage && (
          <div className="flex justify-center">
            <Button
              size="sm"
              variant="outline"
              busy={jobs.isFetchingNextPage}
              onClick={() => void jobs.fetchNextPage().catch(() => undefined)}
            >
              Load older jobs
            </Button>
          </div>
        )}

        {job && selectedJob && (
          <Panel
            title={`Definition — ${job}`}
            help="Current configuration and schedule. Changing the image, command, environment or resources still takes gregale job update."
            actions={
              <JobActions
                name={job}
                status={selectedJob.status}
                onStarted={(run) => onSelection({ run, task: undefined })}
                onDeleted={() => onSelection({ job: undefined, run: undefined, task: undefined })}
              />
            }
          >
            <JobDefinition name={job} />
          </Panel>
        )}

        {job && <JobRegistryCredentialsPanel name={job} />}

        {job && (
          <Panel
            title={`Runs — ${job}`}
            help="Newest first. Cancel stops tasks still in flight; Replay failed reruns a finished run's failed inputs."
          >
            <JobRuns
              name={job}
              onSelect={(run) => onSelection({ run, task: undefined })}
              selectedRunId={runId}
              renderSelected={(selectedRun) => (
                <div className="mt-6 flex flex-col gap-6">
                  <Panel title="Run">
                    <JobRunDetail name={job} runId={selectedRun} />
                  </Panel>
                  <Panel
                    title="Tasks"
                    help="One row per task. Open a task for the tail of its log; retry a failed one, or download what a successful one published."
                  >
                    <JobTasks
                      name={job}
                      runId={selectedRun}
                      selectedTask={search.task ?? null}
                      onSelect={(task) => onSelection({ task: task ?? undefined })}
                    />
                  </Panel>
                </div>
              )}
            />
          </Panel>
        )}
      </PlanGated>
    </div>
  );
}
