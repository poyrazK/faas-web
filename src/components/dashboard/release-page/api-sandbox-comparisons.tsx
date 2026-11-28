import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { CopyIconButton } from '@/components/ui/copy-button';
import {
  sandboxScenarioLibraryKey,
  listReleaseSandboxComparisons,
  startReleaseSandboxComparison,
  type APISandboxComparisonReport,
} from '@/lib/api/api-sandboxes';
import { errorMessage } from '@/lib/api/errors';
import { SandboxRunReportDetails, sandboxRunStatus } from './api-sandbox-run-report';

const verdicts: Record<APISandboxComparisonReport['verdict'], string> = {
  running: 'Comparing releases',
  passed: 'Both passed',
  regression: 'Regression detected',
  inconclusive: 'Inconclusive',
};

const reasons: Record<NonNullable<APISandboxComparisonReport['reason']>, string> = {
  candidate_check_failed: 'The baseline passed and the candidate failed a scenario check.',
  baseline_check_failed: 'The baseline failed a scenario check.',
  baseline_unavailable: 'The baseline could not complete the comparison.',
  candidate_unavailable: 'The candidate could not complete the comparison.',
};

export function SandboxComparisons({
  slug,
  deployment,
  revision,
}: {
  slug: string;
  deployment: string;
  revision?: string;
}) {
  const client = useQueryClient();
  const queryKey = ['release-sandbox-comparisons', slug, deployment];
  const [selected, setSelected] = useState('');
  const listing = useQuery({
    queryKey,
    queryFn: ({ signal }) => listReleaseSandboxComparisons({ slug, deployment }, signal),
    refetchInterval: (query) =>
      query.state.data?.comparisons.some((report) => report.verdict === 'running') ? 2500 : false,
  });
  const baselines = listing.data?.baselines ?? [];
  const baseline = baselines.find((release) => release.deployment_id === selected) ?? baselines[0];
  const launch = useMutation({
    mutationFn: (input: { id: string; baselineID: string; revision: string }) =>
      startReleaseSandboxComparison({ slug, deployment }, input.id, {
        baseline_deployment_id: input.baselineID,
        scenario_revision: input.revision,
      }),
    onSuccess: async (report) => {
      client.setQueryData(queryKey, (previous: typeof listing.data) => ({
        baselines: previous?.baselines ?? [],
        comparisons: [
          report,
          ...(previous?.comparisons ?? []).filter((comparison) => comparison.id !== report.id),
        ],
      }));
      await client.invalidateQueries({ queryKey });
    },
    onError: () => {
      void client.invalidateQueries({
        queryKey: ['release-api-sandbox-scenario', slug, deployment],
      });
      void client.invalidateQueries({ queryKey: sandboxScenarioLibraryKey(slug) });
    },
  });
  const failure = launch.error ?? listing.error;
  const retry =
    launch.isError &&
    launch.variables?.revision === revision &&
    launch.variables?.baselineID === baseline?.deployment_id
      ? launch.variables
      : undefined;

  if (!revision && !listing.data?.comparisons.length) return null;
  return (
    <section className="grid gap-3 rounded-lg border border-border p-3">
      <div>
        <h3 className="text-sm font-medium">Release comparisons</h3>
        <p className="text-xs text-muted-foreground">
          Run the saved scenario on two releases with the same seed data.
        </p>
      </div>
      {revision && baseline ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (launch.isPending) return;
            launch.mutate(
              retry ?? { id: crypto.randomUUID(), baselineID: baseline.deployment_id, revision }
            );
          }}
        >
          <label className="grid min-w-0 gap-1 text-xs">
            Baseline release
            <select
              value={baseline.deployment_id}
              disabled={launch.isPending}
              onChange={(event) => setSelected(event.target.value)}
              className="min-w-0 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            >
              {baselines.map((release) => (
                <option key={release.deployment_id} value={release.deployment_id}>
                  {release.commit_sha?.slice(0, 8) ?? release.deployment_id.slice(0, 8)} ·{' '}
                  {new Date(release.created_at).toLocaleString()}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" size="sm" busy={launch.isPending} disabled={launch.isPending}>
            {retry ? 'Retry comparison' : 'Compare with previous release'}
          </Button>
        </form>
      ) : revision && listing.isSuccess ? (
        <p className="text-xs text-muted-foreground">No earlier eligible release is available.</p>
      ) : null}
      {failure ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(failure)}
        </p>
      ) : null}
      {(listing.data?.comparisons ?? []).map((report) => (
        <ComparisonResult key={report.id} report={report} />
      ))}
    </section>
  );
}

export function ComparisonResult({
  report,
  verdictLabel = verdicts[report.verdict],
}: {
  report: APISandboxComparisonReport;
  verdictLabel?: string;
}) {
  const step = report.first_failing_step;
  return (
    <details className="rounded-md border border-border p-3">
      <summary className="cursor-pointer text-sm font-medium">
        {report.scenario_name} · {verdictLabel}
      </summary>
      <div className="mt-3 grid gap-3">
        {report.reason ? <p className="text-sm">{reasons[report.reason]}</p> : null}
        {step ? (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span>
              {report.failure_side === 'baseline' ? 'Baseline' : 'Candidate'} step {step.index} ·{' '}
              {step.title}
              {step.failed_pointer ? (
                <>
                  {' '}
                  · <code>{step.failed_pointer}</code>
                </>
              ) : null}
            </span>
            {step.request_id ? (
              <CopyIconButton text={step.request_id} label={`request ID ${step.request_id}`} />
            ) : null}
          </div>
        ) : report.failure_code ? (
          <p className="break-all text-xs text-muted-foreground">{report.failure_code}</p>
        ) : null}
        <div className="grid gap-3 lg:grid-cols-2">
          <ComparisonRun label="Baseline" run={report.baseline} />
          <ComparisonRun label="Candidate" run={report.candidate} />
        </div>
      </div>
    </details>
  );
}

function ComparisonRun({
  label,
  run,
}: {
  label: string;
  run: APISandboxComparisonReport['baseline'];
}) {
  return (
    <section
      className="grid min-w-0 content-start gap-2 rounded-md border border-border p-3"
      aria-label={label}
    >
      <h4 className="text-sm font-medium">
        {label} · {sandboxRunStatus[run.status]}
      </h4>
      <p className="break-all text-xs text-muted-foreground">
        Release <code>{run.source_deployment_id}</code>
      </p>
      <SandboxRunReportDetails run={run} />
    </section>
  );
}
