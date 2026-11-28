import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { InlinePhase } from '@/components/dashboard/primitives';
import type { APISandboxLibraryScenarioSummary } from '@/lib/api/api-sandboxes';
import {
  getSandboxSuite,
  saveSandboxSuite,
  listSandboxSuiteRuns,
  getSandboxSuiteRun,
  startSandboxSuiteRun,
  type APISandboxSuiteRunReport,
  type APISandboxSuiteRunRequest,
  type APISandboxSuiteRunsResponse,
  type APISandboxSuiteSaveRequest,
} from '@/lib/api/api-sandbox-suites';
import { errorMessage } from '@/lib/api/errors';
import { ComparisonResult } from './api-sandbox-comparisons';

const scenarioLimit = 5;
const verdicts: Record<APISandboxSuiteRunReport['verdict'], string> = {
  running: 'Running',
  passed: 'All scenarios passed',
  regression: 'Regression detected',
  inconclusive: 'Inconclusive',
  stale: 'Stale result',
};
const staleReasons: Record<NonNullable<APISandboxSuiteRunReport['stale_reason']>, string> = {
  candidate_artifact_changed: 'The candidate artifact changed.',
  live_baseline_changed: 'The live baseline changed.',
  suite_changed: 'The saved suite changed.',
  suite_scenario_changed: 'A saved scenario in the suite changed or was removed.',
};
const failures: Record<NonNullable<APISandboxSuiteRunReport['failure_code']>, string> = {
  approval_inputs_changed: 'The held build or live baseline changed before the suite finished.',
  entitlement_changed: 'Sandbox access for this app changed before the suite finished.',
  timed_out: 'The suite reached its time limit.',
};
const automaticMessages: Partial<
  Record<NonNullable<APISandboxSuiteRunsResponse['automatic_status']>, string>
> = {
  queued: 'The automatic suite is queued.',
  waiting_for_capacity: 'The automatic suite is waiting for the app’s active suite to finish.',
  waiting_for_baseline: 'The automatic suite is waiting for an eligible live baseline.',
  waiting_for_scenarios: 'Edit the suite to replace missing library scenarios.',
  unavailable: 'The automatic suite is waiting for sandbox access and release readiness.',
};

const gateMessages: Record<
  NonNullable<APISandboxSuiteRunsResponse['release_gate']>['status'],
  string
> = {
  waiting: 'Waiting for a passing suite run.',
  failed: 'The latest suite did not pass. Review the results and run the suite again.',
  stale: 'The latest suite is stale. Run the suite again with the current inputs.',
  no_suite: 'Set up a regression suite to continue.',
  unavailable:
    'A suite needs an eligible candidate and one live baseline serving all production traffic.',
  passed: 'The current suite passed.',
  admitted: 'The production release command accepted a passing suite.',
};

export function SandboxApprovalSuites({
  deploymentId,
  slug,
  beforeReleaseCommand,
  baseline,
  library,
}: {
  deploymentId: string;
  slug: string;
  beforeReleaseCommand: boolean;
  baseline?: string;
  library: APISandboxLibraryScenarioSummary[];
}) {
  const client = useQueryClient();
  const [edit, setEdit] = useState<APISandboxSuiteSaveRequest>();
  const [view, setView] = useState('');
  const suiteKey = ['api-sandbox-suite', slug] as const;
  const runsKey = ['release-sandbox-suite-runs', deploymentId] as const;
  const config = useQuery({
    queryKey: suiteKey,
    queryFn: ({ signal }) => getSandboxSuite(slug, signal),
    enabled: beforeReleaseCommand,
  });
  const suite = config.data?.suite;
  const autoEnabled = beforeReleaseCommand && !!suite?.run_before_approval;
  const list = useQuery({
    queryKey: runsKey,
    queryFn: ({ signal }) => listSandboxSuiteRuns(deploymentId, signal),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.runs.some((run) => !run.finished_at)) return 2500;
      if (data?.release_gate && data.release_gate.status !== 'admitted') return 5000;
      const status = data?.automatic_status;
      return autoEnabled && status !== 'started' && status !== 'approval_ended' ? 5000 : false;
    },
  });
  const runs = list.data?.runs ?? [];
  const gate = list.data?.release_gate;
  const canRun = beforeReleaseCommand && gate?.status !== 'admitted';
  const gateRun = runs.find((run) => run.id === gate?.suite_run_id);
  const runId = view || gateRun?.id || runs[0]?.id || '';
  const report = useQuery({
    queryKey: [...runsKey, runId],
    queryFn: ({ signal }) => getSandboxSuiteRun(deploymentId, runId, signal),
    enabled: !!runId,
    refetchInterval: (query) => (query.state.data && !query.state.data.finished_at ? 2500 : false),
  });
  const save = useMutation({
    mutationFn: (input: APISandboxSuiteSaveRequest) => saveSandboxSuite(slug, input),
    onSuccess: (response) => {
      client.setQueryData(suiteKey, response);
      setEdit(undefined);
      void client.invalidateQueries({ queryKey: runsKey });
    },
    onError: () => void client.invalidateQueries({ queryKey: suiteKey }),
  });
  const launch = useMutation({
    mutationFn: ({ id, input }: { id: string; input: APISandboxSuiteRunRequest }) =>
      startSandboxSuiteRun(deploymentId, id, input),
    onSuccess: (run) => {
      client.setQueryData([...runsKey, run.id], run);
      client.setQueryData<APISandboxSuiteRunsResponse>(runsKey, (previous) => ({
        ...previous,
        runs: [run, ...(previous?.runs ?? []).filter((other) => other.id !== run.id)],
      }));
      setView(run.id);
    },
    onSettled: () => void client.invalidateQueries({ queryKey: runsKey }),
  });
  if (!beforeReleaseCommand && !gate && !runs.length && !list.error) return null;
  const selected = suite?.scenario_ids ?? [];
  const names = new Map(library.map((item) => [item.id, item.name]));
  const missing = selected.some((id) => !names.has(id));
  const running = runs.some((run) => !run.finished_at);
  const automaticStatus = list.data?.automatic_status;
  const awaitingAutomatic =
    (autoEnabled || (gate?.status === 'waiting' && selected.length > 0)) &&
    !runs.some((run) => run.automatic) &&
    automaticStatus !== 'started' &&
    automaticStatus !== 'approval_ended';
  const retry =
    launch.isError &&
    launch.variables?.input.suite_revision === suite?.revision &&
    launch.variables?.input.baseline_deployment_id === baseline
      ? launch.variables
      : undefined;
  const error = save.error ?? launch.error ?? config.error ?? list.error ?? report.error;

  return (
    <section
      aria-label="Regression suite"
      className="grid gap-3 rounded-md border border-border p-3"
    >
      <h3 className="text-sm font-medium">Regression suite</h3>
      {gate ? (
        <div role="status" className="grid gap-1 rounded-md bg-muted/40 p-2 text-sm">
          {gate.status !== 'admitted' ? (
            <p className="font-medium">
              A passing suite is required before the production release command.
            </p>
          ) : null}
          <p>{gateMessages[gate.status]}</p>
          {gate.status === 'admitted' && gate.suite_run_id ? (
            <p className="break-all text-xs text-muted-foreground">
              Accepted run <code>{gate.suite_run_id}</code>
            </p>
          ) : null}
        </div>
      ) : null}
      {canRun && config.isPending ? (
        <InlinePhase phase="loading" loadingMessage="Loading saved suite…" />
      ) : null}
      {canRun && config.isSuccess ? (
        edit ? (
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!save.isPending) save.mutate(edit);
            }}
          >
            <fieldset className="grid gap-2" disabled={save.isPending}>
              <legend className="mb-2 text-sm">Choose up to five library scenarios</legend>
              {library.map((item) => {
                const checked = edit.scenario_ids.includes(item.id);
                return (
                  <label key={item.id} className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={checked}
                      disabled={!checked && edit.scenario_ids.length >= scenarioLimit}
                      onChange={(event) =>
                        setEdit({
                          ...edit,
                          scenario_ids: event.target.checked
                            ? [...edit.scenario_ids, item.id]
                            : edit.scenario_ids.filter((id) => id !== item.id),
                        })
                      }
                    />
                    {item.name}
                  </label>
                );
              })}
            </fieldset>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={!!edit.run_before_approval && edit.scenario_ids.length > 0}
                disabled={save.isPending || !edit.scenario_ids.length}
                onChange={(event) =>
                  setEdit({ ...edit, run_before_approval: event.target.checked })
                }
              />
              Run suite before approval
            </label>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" busy={save.isPending}>
                Save suite
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={save.isPending}
                onClick={() => {
                  save.reset();
                  setEdit(undefined);
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div className="grid gap-2">
            {selected.length ? (
              <ol className="list-decimal space-y-1 pl-5 text-sm">
                {selected.map((id) => (
                  <li key={id}>{names.get(id) ?? 'Removed library scenario'}</li>
                ))}
              </ol>
            ) : (
              <p className="text-xs text-muted-foreground">
                {library.length
                  ? 'Save library scenarios to check together before approving this build.'
                  : 'Add a scenario to the app library to set up a suite.'}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {library.length || selected.length ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setEdit({
                      expected_revision: suite?.revision ?? '',
                      scenario_ids: selected.filter((id) => names.has(id)),
                      ...(suite?.run_before_approval ? { run_before_approval: true } : {}),
                    })
                  }
                >
                  {selected.length ? 'Edit suite' : 'Set up suite'}
                </Button>
              ) : null}
              {baseline &&
              suite &&
              selected.length &&
              !missing &&
              (!awaitingAutomatic || !!gate) ? (
                <Button
                  type="button"
                  size="sm"
                  busy={launch.isPending}
                  disabled={running || launch.isPending}
                  onClick={() =>
                    launch.mutate(
                      retry ?? {
                        id: crypto.randomUUID(),
                        input: { suite_revision: suite.revision, baseline_deployment_id: baseline },
                      }
                    )
                  }
                >
                  {retry
                    ? 'Retry suite launch'
                    : gate?.status === 'failed' || gate?.status === 'stale'
                      ? 'Run suite again'
                      : 'Run regression suite'}
                </Button>
              ) : null}
            </div>
            {awaitingAutomatic ? (
              <p role="status" className="text-sm text-muted-foreground">
                {(automaticStatus && automaticMessages[automaticStatus]) ??
                  'Waiting for the release hold to queue the automatic suite.'}
              </p>
            ) : null}
          </div>
        )
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(error)}
        </p>
      ) : null}
      {runs.length > 1 ? (
        <label className="grid max-w-sm gap-1 text-xs">
          Suite run
          <select
            value={runId}
            onChange={(event) => setView(event.target.value)}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          >
            {runs.map((run) => (
              <option value={run.id} key={run.id}>
                {new Date(run.created_at).toLocaleString()}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {runId && report.isPending ? (
        <InlinePhase phase="loading" loadingMessage="Loading suite results…" />
      ) : null}
      {report.data ? <SuiteResult report={report.data} /> : null}
    </section>
  );
}

function SuiteResult({ report }: { report: APISandboxSuiteRunReport }) {
  return (
    <div className="grid gap-2">
      <p role="status" className="text-sm font-medium">
        {verdicts[report.verdict]} · {report.completed_count} of {report.scenario_count} scenarios
        completed
      </p>
      {report.automatic ? (
        <p className="text-xs text-muted-foreground">Started automatically at approval.</p>
      ) : null}
      {report.waiting_for_capacity && !report.finished_at ? (
        <p className="text-xs text-muted-foreground">Waiting for available sandbox capacity.</p>
      ) : null}
      {report.stale_reason ? (
        <p className="text-xs text-muted-foreground">{staleReasons[report.stale_reason]}</p>
      ) : null}
      {report.failure_code ? (
        <p className="text-xs text-muted-foreground">{failures[report.failure_code]}</p>
      ) : null}
      {report.scenarios.map((item) =>
        item.comparison ? (
          <ComparisonResult key={item.scenario_id} report={item.comparison} />
        ) : (
          <p key={item.scenario_id} className="rounded-md border border-border px-3 py-2 text-sm">
            {item.scenario_name} · {item.status === 'not_run' ? 'Did not run' : 'Queued'}
          </p>
        )
      )}
    </div>
  );
}
