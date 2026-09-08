import { useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { PageHeader, Panel } from '@/components/dashboard/primitives';
import { Pill, ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { PlanGated } from '@/components/dashboard/plan-gated';
import { JobRuns } from '@/components/dashboard/job-runs';
import { JobTasks } from '@/components/dashboard/job-tasks';
import { useJobs } from '@/lib/api/queries';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/jobs')({
  component: JobsPage,
  head: () => consoleHead('jobs'),
});

/**
 * Batch and recurring workloads, from `/v1/jobs` (spec §14.A).
 *
 * Account-wide rather than per-app, so this is a sidebar page like Crons and
 * Triggers, not an app-detail tab.
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

function JobsPage() {
  const { data, isPending, error, refetch } = useJobs();
  const [job, setJob] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);

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
            setJob((cur) => (cur === j.name ? null : j.name));
            setRunId(null);
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
        title="Jobs"
        description="Batch and recurring workloads. Defined in the CLI; run, watched and cancelled here."
      />

      <PlanGated error={error} feature="Jobs">
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
            title={`Runs — ${job}`}
            description="Newest first. Cancel stops tasks still in flight."
          >
            <JobRuns name={job} onSelect={setRunId} selectedRunId={runId} />
          </Panel>
        )}

        {job && runId && (
          <Panel title="Tasks" description="One row per task. Open a task for the tail of its log.">
            <JobTasks name={job} runId={runId} />
          </Panel>
        )}
      </PlanGated>
    </div>
  );
}
