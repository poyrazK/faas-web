import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { ApiError, errorMessage } from '@/lib/api/errors';
import {
  useAdvanceCanary,
  useClearObsoleteDeployments,
  useReorderDeployment,
  type Deployment,
} from '@/lib/api/queries';
import { deploymentPhase } from '@/lib/deployment-status';

/**
 * The write half of deployment control (ADR-122 canary, ADR-124 queue).
 *
 * Every button here is offered only when the API could say yes: a canary can
 * be advanced while it is rolling out with steps left, a deployment can be
 * reordered while it is still pending, and history can be cleared for any app.
 * The 409s that arrive anyway — the rollout moved on, the row left the queue
 * between paint and click — are facts about timing, and read as such.
 *
 * Plan gates are matched on the RFC 7807 code. `402` also means
 * `billing_past_due`, and `403` also means a scope was missing.
 */

export function canAdvanceCanary(deployment: Deployment): boolean {
  const total = deployment.canary_total_steps ?? 0;
  const step = deployment.canary_step ?? 0;
  return deployment.rollout_state === 'rolling_out' && total > 0 && step < total;
}

export function AdvanceCanaryButton({ deployment }: { deployment: Deployment }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const advance = useAdvanceCanary();
  if (!canAdvanceCanary(deployment)) return null;

  const step = deployment.canary_step ?? 0;
  const total = deployment.canary_total_steps ?? 0;

  const onAdvance = async () => {
    if (
      !(await confirm({
        title: `Advance canary to step ${step + 1} of ${total}?`,
        description:
          'Traffic shifts to the next percentage of the preset. A step cannot be taken back; abort the rollout instead.',
        confirmLabel: 'Advance',
      }))
    )
      return;
    try {
      const result = await advance.mutateAsync({ id: deployment.id, expected_step: step });
      const percent = result.deployment.traffic_percent;
      toast({
        kind: 'success',
        title: 'Canary advanced',
        description:
          percent != null ? `${percent}% of traffic now reaches this deployment.` : undefined,
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'canary_step_conflict') {
        toast({
          kind: 'info',
          title: 'The rollout moved on',
          description: 'This canary was advanced elsewhere first. The panel has refreshed.',
        });
        return;
      }
      if (err instanceof ApiError && err.code === 'plan_traffic_split_not_allowed') {
        toast({
          kind: 'info',
          title: 'Not on your plan',
          description: 'Canary rollouts need the Pro or Scale plan.',
        });
        return;
      }
      toast({ kind: 'error', title: 'Could not advance', description: errorMessage(err) });
    }
  };

  return (
    <Button
      size="xs"
      variant="outline"
      onClick={() => void onAdvance()}
      disabled={advance.isPending}
    >
      Advance canary ({step}/{total})
    </Button>
  );
}

const PRIORITIES = [
  { value: 0, label: 'Deploy next' },
  { value: 100, label: 'In turn' },
  { value: 1000, label: 'Background' },
] as const;

export function ReorderDeploymentControl({ deployment }: { deployment: Deployment }) {
  const { toast } = useToast();
  const reorder = useReorderDeployment();
  const [priority, setPriority] = useState<number>(100);
  if (deploymentPhase(deployment.status) !== 'queued') return null;

  const onApply = async () => {
    try {
      await reorder.mutateAsync({ id: deployment.id, priority });
      toast({
        kind: 'success',
        title: 'Deployment reordered',
        description: `Priority ${priority}: ${PRIORITIES.find((p) => p.value === priority)?.label.toLowerCase() ?? ''}.`,
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'deployment_reorder_not_pending') {
        toast({
          kind: 'info',
          title: 'Already left the queue',
          description: 'Only a pending deployment can be reordered; this one has started.',
        });
        return;
      }
      if (err instanceof ApiError && err.code === 'plan_reorder_disabled') {
        toast({
          kind: 'info',
          title: 'Not on your plan',
          description: 'Queue controls need the Hobby plan or higher.',
        });
        return;
      }
      toast({ kind: 'error', title: 'Could not reorder', description: errorMessage(err) });
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-xs text-muted-foreground" htmlFor={`priority-${deployment.id}`}>
        Queue position
      </label>
      <select
        id={`priority-${deployment.id}`}
        className="h-6 rounded-md border border-border bg-background px-2 text-xs"
        value={priority}
        onChange={(event) => setPriority(Number(event.target.value))}
      >
        {PRIORITIES.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>
      <Button
        size="xs"
        variant="outline"
        onClick={() => void onApply()}
        disabled={reorder.isPending}
      >
        Reorder
      </Button>
    </div>
  );
}

export function ClearObsoleteDeploymentsButton({ slug }: { slug: string }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const clear = useClearObsoleteDeployments();

  const onClear = async () => {
    if (
      !(await confirm({
        title: 'Clear obsolete deployments?',
        description:
          'Removes superseded, failed and cancelled deployments older than 7 days from this app’s history. The current deployment and anything newer stay.',
        confirmLabel: 'Clear',
        destructive: true,
      }))
    )
      return;
    try {
      const report = await clear.mutateAsync({ slug, older_than: '168h' });
      toast({
        kind: report.count === 0 ? 'info' : 'success',
        title: report.count === 0 ? 'Nothing to clear' : `Cleared ${report.count} deployments`,
        description: `Older than ${report.older_than}.`,
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'plan_reorder_disabled') {
        toast({
          kind: 'info',
          title: 'Not on your plan',
          description: 'Queue controls need the Hobby plan or higher.',
        });
        return;
      }
      toast({ kind: 'error', title: 'Could not clear', description: errorMessage(err) });
    }
  };

  return (
    <Button size="xs" variant="ghost" onClick={() => void onClear()} disabled={clear.isPending}>
      Clear obsolete
    </Button>
  );
}
