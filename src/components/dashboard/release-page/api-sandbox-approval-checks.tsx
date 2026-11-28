import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  listSandboxApprovalChecks,
  startSandboxApprovalCheck,
  type APISandboxApprovalCheck,
} from '@/lib/api/api-sandboxes';
import { errorMessage } from '@/lib/api/errors';
import { ComparisonResult } from './api-sandbox-comparisons';
import { SandboxApprovalSuites } from './api-sandbox-approval-suites';

const staleReasons: Record<NonNullable<APISandboxApprovalCheck['stale_reason']>, string> = {
  candidate_artifact_changed: 'The candidate artifact changed. Run a fresh check to review it.',
  live_baseline_changed: 'The serving baseline changed. Run a fresh check against it.',
  baseline_scenario_changed:
    'The saved scenario changed or was removed. Select a current scenario for a fresh check.',
};

export function SandboxApprovalChecks({
  deploymentId,
  slug,
  beforeReleaseCommand,
}: {
  deploymentId: string;
  slug: string;
  beforeReleaseCommand: boolean;
}) {
  const client = useQueryClient();
  const [scenarioId, setScenarioId] = useState('');
  const queryKey = ['release-sandbox-approval-checks', deploymentId];
  const listing = useQuery({
    queryKey,
    queryFn: ({ signal }) => listSandboxApprovalChecks(deploymentId, signal),
    refetchInterval: (query) => {
      if (query.state.data?.checks.some((check) => check.verdict === 'running')) return 2500;
      return beforeReleaseCommand || query.state.data?.checks.length ? 15_000 : false;
    },
  });
  const launch = useMutation({
    mutationFn: (input: { id: string; baseline: string; revision: string }) =>
      startSandboxApprovalCheck(deploymentId, input.id, {
        baseline_deployment_id: input.baseline,
        scenario_revision: input.revision,
      }),
    onSettled: () => void client.invalidateQueries({ queryKey }),
    onSuccess: (check) => {
      client.setQueryData(queryKey, (previous: typeof listing.data) =>
        previous
          ? {
              ...previous,
              checks: [
                check,
                ...previous.checks.filter((other) => other.comparison.id !== check.comparison.id),
              ],
            }
          : previous
      );
    },
  });
  const data = listing.data;
  const showChecks =
    beforeReleaseCommand || !!data?.checks.length || data?.availability === 'ready';
  const baseline = data?.baseline_deployment_id;
  const library = data?.library_scenarios ?? [];
  const choices = data?.scenario_revision
    ? [
        {
          id: 'live',
          name: data.scenario_name ?? 'Live release scenario',
          revision: data.scenario_revision,
        },
        ...library,
      ]
    : library;
  const selected =
    scenarioId && library.length ? choices.find((item) => item.id === scenarioId) : choices[0];
  const revision = selected?.revision;
  const running = data?.checks.some((check) => check.verdict === 'running');
  const retry =
    launch.isError &&
    launch.variables?.baseline === baseline &&
    launch.variables?.revision === revision
      ? launch.variables
      : undefined;
  const failure = launch.error ?? listing.error;

  return (
    <>
      {showChecks ? (
        <section
          aria-label="Sandbox checks"
          className="grid gap-3 rounded-md border border-border p-3"
        >
          <h3 className="text-sm font-medium">Sandbox checks</h3>
          {data?.availability === 'ready' && baseline ? (
            <>
              {library.length ? (
                <label className="grid max-w-sm gap-1 text-xs">
                  Scenario for this check
                  <select
                    value={selected?.id ?? ''}
                    onChange={(event) => setScenarioId(event.target.value)}
                    className="min-w-0 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                  >
                    {!selected ? (
                      <option value="" disabled>
                        Choose a scenario
                      </option>
                    ) : null}
                    {choices.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Compare this build with the live release using <strong>{selected?.name}</strong>.
                </p>
              )}
              <div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  busy={launch.isPending}
                  disabled={!revision || launch.isPending || running}
                  onClick={() => {
                    if (revision)
                      launch.mutate(retry ?? { id: crypto.randomUUID(), baseline, revision });
                  }}
                >
                  {retry ? 'Retry sandbox check' : 'Run sandbox check'}
                </Button>
              </div>
            </>
          ) : data?.availability === 'no_scenario' && baseline ? (
            <p className="text-xs text-muted-foreground">
              Save a scenario on the{' '}
              <Link
                to="/dashboard/apps/$appSlug/releases/$deploymentId"
                params={{ appSlug: slug, deploymentId: baseline }}
                className="underline underline-offset-2"
              >
                live baseline release
              </Link>{' '}
              to run this check.
            </p>
          ) : data?.availability === 'no_baseline' ? (
            <p className="text-xs text-muted-foreground">
              A check needs one eligible live release serving all production traffic.
            </p>
          ) : data?.availability === 'unsupported' ? (
            <p className="text-xs text-muted-foreground">
              This release is unavailable for a sandbox check.
            </p>
          ) : null}
          {failure ? (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage(failure)}
            </p>
          ) : null}
          {data?.checks.map((check) => (
            <div key={check.comparison.id} className="grid gap-1">
              {check.stale_reason ? (
                <p className="text-xs text-muted-foreground">{staleReasons[check.stale_reason]}</p>
              ) : null}
              <ComparisonResult
                report={check.comparison}
                verdictLabel={check.verdict === 'stale' ? 'Stale result' : undefined}
              />
            </div>
          ))}
        </section>
      ) : null}
      <SandboxApprovalSuites
        key={deploymentId}
        deploymentId={deploymentId}
        slug={slug}
        beforeReleaseCommand={beforeReleaseCommand}
        baseline={data?.availability === 'ready' ? baseline : undefined}
        library={library}
      />
    </>
  );
}
