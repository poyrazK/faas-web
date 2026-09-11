import { useMemo } from 'react';
import { PageHeader, Panel } from '@/components/dashboard/primitives';
import { Pill, ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { PlanGated } from '@/components/dashboard/plan-gated';
import { JobRuns } from '@/components/dashboard/job-runs';
import { JobTasks } from '@/components/dashboard/job-tasks';
import { JobDefinition, JobRunDetail } from '@/components/dashboard/job-detail';
import { useJobs } from '@/lib/api/queries';
import type { JobsSelectionProps } from './jobs-search';

/**
 * Batch and recurring workloads, from `/v1/jobs` (spec §14.A).
 *
 * Account-wide workloads rendered as the Jobs hub's Workloads section.
 *
 * Jobs are plan-gated — Free answers `402 jobs_not_allowed` — so the page
 * leads with that rather than an error when the account cannot use them.
 *
 * Creating and editing stay in the CLI: a job is an image reference, a
 * command, a parallelism and a retry policy, which is configuration that
 * belongs in version control rather than in a form.
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

export function WorkloadsBody({ search, onSelection }: JobsSelectionProps) {
  const { data, isPending, error, refetch } = useJobs(search.job);
  const job = data?.jobs.find((j) => j.id === search.job)?.name ?? null;
  const runId = search.run ?? null;

  const rows = useMemo<JobRow[]>(
    () =>
      (data?.jobs ?? []).map((j) => ({
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
          className="font-mono text-xs underline-offset-2 hover:underline"
        >
          {j.name}
        </button>
      ),
    },
    {
      key: 'kind',
      label: 'Kind',
      width: 'w-28',
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
      width: 'w-24',
      render: (j) => <Pill label={j.status} color={STATUS_COLOR[j.status]} />,
    },
    {
      key: 'image',
      label: 'Image',
      render: (j) => (
        <span className="truncate font-mono text-xs text-muted-foreground" title={j.image}>
          {j.image}
        </span>
      ),
    },
    {
      key: 'ram',
      label: 'RAM',
      numeric: true,
      width: 'w-24',
      render: (j) => <span className="[font-variant-numeric:tabular-nums]">{j.ram} MB</span>,
    },
    {
      key: 'parallelism',
      label: 'Parallel',
      numeric: true,
      width: 'w-24',
      render: (j) => <span className="[font-variant-numeric:tabular-nums]">{j.parallelism}</span>,
    },
    {
      key: 'retries',
      label: 'Retries',
      numeric: true,
      width: 'w-24',
      render: (j) => <span className="[font-variant-numeric:tabular-nums]">{j.retries}</span>,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Workloads"
        description="CLI-defined container and batch jobs. Run, watched and cancelled here."
      />

      <PlanGated error={error} feature="Jobs">
        {search.job && data && !job && <p role="status">Workload not found</p>}
        <ResourceTable
          rows={rows}
          columns={columns}
          initialSort={{ key: 'name', dir: 'asc' }}
          searchKeys={['name', 'image', 'kind']}
          searchPlaceholder="Filter by job, image, or kind…"
          emptyMessage="No jobs yet. Create one with the CLI."
          minWidth="min-w-[900px]"
          loading={isPending}
          error={error}
          onRetry={() => void refetch()}
        />

        {job && (
          <Panel
            title={`Definition — ${job}`}
            description="As deployed. Jobs are defined and changed with the CLI."
          >
            <JobDefinition name={job} />
          </Panel>
        )}

        {job && (
          <Panel
            title={`Runs — ${job}`}
            description="Newest first. Cancel stops tasks still in flight."
          >
            <JobRuns
              name={job}
              onSelect={(run) => onSelection({ run, task: undefined })}
              selectedRunId={runId}
              renderSelected={(selectedRun) => (
                <div className="mt-6 flex flex-col gap-6">
                  <Panel
                    title="Run"
                    description="What this run did, counted as the API reports it."
                  >
                    <JobRunDetail name={job} runId={selectedRun} />
                  </Panel>
                  <Panel
                    title="Tasks"
                    description="One row per task. Open a task for the tail of its log."
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
