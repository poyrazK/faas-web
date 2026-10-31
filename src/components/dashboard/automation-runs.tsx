import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Panel, InlinePhase, queryPhase } from './primitives';
import { ResourceTable, type Column } from './resource-table';
import { JsonReadout } from './automation-editor';
import { AutomationStatus, Pagination } from './automation-primitives';
import {
  useAutomationRuns,
  useAutomationRun,
  useAutomationSteps,
  useAutomationAttempts,
} from '@/lib/api/automations';

export function AutomationRuns({
  account,
  slug,
  appId,
  name,
  selectedId,
  onSelect,
}: {
  account: string;
  slug: string;
  appId: string;
  name: string;
  selectedId?: string;
  onSelect: (id: string | undefined) => void;
}) {
  const [offset, setOffset] = useState(0);
  const q = useAutomationRuns(account, slug, name, offset);
  type Row = NonNullable<typeof q.data>['runs'][number];
  const columns: Column<Row>[] = [
    {
      key: 'id',
      label: 'Run',
      render: (run) => (
        <button
          type="button"
          onClick={() => onSelect(run.id)}
          className="font-mono text-xs text-brand hover:underline"
        >
          {run.id}
        </button>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (run) => <AutomationStatus status={run.cancelled_at ? 'cancelled' : run.status} />,
    },
    { key: 'current_step', label: 'Current step', render: (run) => run.current_step ?? '—' },
    {
      key: 'created_at',
      label: 'Created',
      render: (run) => new Date(run.created_at).toLocaleString(),
    },
  ];
  return (
    <>
      <Panel
        title="Run history"
        description="Real durable runs for this automation. Updates every 10 seconds."
      >
        <ResourceTable
          rows={q.data?.runs ?? []}
          columns={columns}
          loading={q.isPending}
          error={q.error}
          onRetry={() => void q.refetch()}
          emptyMessage="No retained runs for this automation."
          minWidth="min-w-[640px]"
        />
        <Pagination
          offset={offset}
          total={q.data?.total ?? 0}
          busy={q.isPending}
          onChange={setOffset}
        />
      </Panel>
      {selectedId && (
        <RunDetail
          key={selectedId}
          account={account}
          slug={slug}
          appId={appId}
          name={name}
          id={selectedId}
          onClose={() => onSelect(undefined)}
        />
      )}
    </>
  );
}

function RunDetail({
  account,
  slug,
  appId,
  name,
  id,
  onClose,
}: {
  account: string;
  slug: string;
  appId: string;
  name: string;
  id: string;
  onClose: () => void;
}) {
  const q = useAutomationRun(account, slug, id);
  const run = q.data;
  const matches = run?.app_id === appId && run.workflow_name === name;
  return (
    <Panel
      title="Run detail"
      description={id}
      actions={
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close run
        </Button>
      }
    >
      <InlinePhase
        phase={queryPhase({ loading: q.isPending, error: q.error })}
        error={q.error}
        onRetry={() => void q.refetch()}
      />
      {run &&
        !q.error &&
        (matches ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-5 text-sm">
              <AutomationStatus status={run.cancelled_at ? 'cancelled' : run.status} />
              <span>Created: {new Date(run.created_at).toLocaleString()}</span>
              {run.started_at && <span>Started: {new Date(run.started_at).toLocaleString()}</span>}
              {run.finished_at && (
                <span>Finished: {new Date(run.finished_at).toLocaleString()}</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Each run retains its captured definition. The run API does not report a publication
              revision.
            </p>
            {run.last_error && (
              <p
                className="rounded-md border border-border p-3 text-sm"
                style={{ color: 'var(--status-critical)' }}
              >
                {run.last_error}
              </p>
            )}
            <details className="text-sm">
              <summary className="cursor-pointer">Run input and result</summary>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="mb-2 text-xs text-muted-foreground">Input</p>
                  <JsonReadout value={run.input} />
                </div>
                <div>
                  <p className="mb-2 text-xs text-muted-foreground">Result</p>
                  <JsonReadout value={run.output} />
                </div>
              </div>
            </details>
            <RunSteps account={account} slug={slug} id={id} />
          </div>
        ) : (
          <p role="alert" className="text-sm text-muted-foreground">
            This run does not belong to the selected app and automation.
          </p>
        ))}
    </Panel>
  );
}

function RunSteps({ account, slug, id }: { account: string; slug: string; id: string }) {
  const q = useAutomationSteps(account, slug, id);
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">Steps and attempts</h3>
      <InlinePhase
        phase={queryPhase({
          loading: q.isPending,
          error: q.error,
          isEmpty: q.data?.steps.length === 0,
        })}
        error={q.error}
        emptyMessage="No steps recorded yet."
        onRetry={() => void q.refetch()}
      />
      {!q.error &&
        q.data?.steps.map((step) => (
          <StepDetails key={step.step_name} account={account} slug={slug} id={id} step={step} />
        ))}
    </div>
  );
}

function StepDetails({
  account,
  slug,
  id,
  step,
}: {
  account: string;
  slug: string;
  id: string;
  step: NonNullable<ReturnType<typeof useAutomationSteps>['data']>['steps'][number];
}) {
  const [open, setOpen] = useState(false);
  const attempts = useAutomationAttempts(account, slug, open ? id : '', open ? step.step_name : '');
  return (
    <details
      className="rounded-lg border border-border p-4"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer text-sm">
        <span className="mr-3 font-mono">{step.step_name}</span>
        <AutomationStatus status={step.status} />
        <span className="ml-3 text-xs text-muted-foreground">{step.attempt} attempts</span>
      </summary>
      {open && (
        <div className="mt-4 flex flex-col gap-3">
          {step.error && (
            <p className="text-sm" style={{ color: 'var(--status-critical)' }}>
              {step.error}
            </p>
          )}
          {step.skip_reason && (
            <p className="text-xs text-muted-foreground">
              Skipped: {step.skip_reason.replaceAll('_', ' ')}
            </p>
          )}
          {step.next_retry_at && (
            <p className="text-xs text-muted-foreground">Next retry: {step.next_retry_at}</p>
          )}
          {step.next_check_at && (
            <p className="text-xs text-muted-foreground">Next check: {step.next_check_at}</p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-2 text-xs text-muted-foreground">Input</p>
              <JsonReadout value={step.input} />
            </div>
            <div>
              <p className="mb-2 text-xs text-muted-foreground">Output</p>
              <JsonReadout value={step.output} />
            </div>
          </div>
          <InlinePhase
            phase={queryPhase({
              loading: attempts.isPending,
              error: attempts.error,
              isEmpty: attempts.data?.attempts.length === 0,
            })}
            error={attempts.error}
            emptyMessage="No executor attempts recorded for this step."
            onRetry={() => void attempts.refetch()}
          />
          {!attempts.error &&
            attempts.data?.attempts.map((attempt) => (
              <div key={attempt.attempt} className="rounded-md border border-border p-3 text-xs">
                <p className="flex flex-wrap items-center gap-3">
                  <span>Attempt {attempt.attempt}</span>
                  <AutomationStatus status={attempt.status} />
                  {attempt.http_status && <span>HTTP {attempt.http_status}</span>}
                  <time>{new Date(attempt.started_at).toLocaleString()}</time>
                </p>
                {attempt.error && (
                  <p className="mt-2" style={{ color: 'var(--status-critical)' }}>
                    {attempt.error}
                  </p>
                )}
                {attempt.next_attempt_at && (
                  <p className="mt-2 text-muted-foreground">
                    Next attempt: {attempt.next_attempt_at}
                  </p>
                )}
              </div>
            ))}
        </div>
      )}
    </details>
  );
}
