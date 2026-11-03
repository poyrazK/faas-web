import { CapabilityGate } from '@/components/dashboard/capability-gate';
import { useCapabilityStage } from '@/lib/api/capabilities';
import { WorkflowRunDetail } from './workflow-run-detail';
import { WorkflowRuns } from './workflow-runs';

/**
 * App › Automate › Workflows: durable workflow runs (faas capability
 * `workflows`, beta). Declared in `gregale.yaml` — YAML steps or a code-first
 * entry handler (docs/code-workflows.md) — and run by one engine, so both
 * kinds list, inspect and recover the same way here.
 *
 * Not the Automations editor: automations are dashboard-authored workflow
 * definitions behind their own internal capability. This page operates the
 * runs, whichever way their workflow was declared.
 */
export function WorkflowsBody({
  slug,
  run,
  onRun,
}: {
  slug: string;
  run?: string;
  onRun: (id: string | undefined) => void;
}) {
  return (
    <CapabilityGate capability="workflows" title="Workflows">
      <Workflows slug={slug} run={run} onRun={onRun} />
    </CapabilityGate>
  );
}

function Workflows({
  slug,
  run,
  onRun,
}: {
  slug: string;
  run?: string;
  onRun: (id: string | undefined) => void;
}) {
  const stage = useCapabilityStage('workflows');
  if (run)
    return <WorkflowRunDetail key={run} slug={slug} id={run} onClose={() => onRun(undefined)} />;
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">
        {stage && (
          <span className="mr-2 rounded-full border border-border px-2 py-0.5 text-xs">
            {stage}
          </span>
        )}
        Multi-step work that survives restarts and deploys: each step runs at least once and its
        result is kept, and waits park the run without keeping a VM awake. Declare workflows in
        gregale.yaml as YAML steps or as code with the SDK.
      </p>
      <WorkflowRuns slug={slug} onOpen={(id) => onRun(id)} />
    </div>
  );
}
