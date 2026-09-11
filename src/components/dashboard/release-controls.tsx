import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/api/errors';
import { useUpdateDeploymentMinInstances, useUpdateDeploymentTraffic } from '@/lib/api/queries';
import type { components } from '@/lib/api/schema';
export function DeploymentControls({
  deployment,
  version,
}: {
  deployment: components['schemas']['DeploymentResponse'];
  version: string;
}) {
  const updateMinInstances = useUpdateDeploymentMinInstances();
  const updateTraffic = useUpdateDeploymentTraffic();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [minInstances, setMinInstances] = useState(deployment.min_instances ?? 0);
  const [trafficPercent, setTrafficPercent] = useState(deployment.traffic_percent ?? 0);

  return (
    <div className="rounded-lg border border-border p-4">
      <p className="label-mono mb-3 text-muted-foreground">Runtime controls</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Minimum instances</span>
          <span className="text-xs text-muted-foreground">
            0 inherits the app setting. Higher values keep this deployment warm.
          </span>
          <div className="mt-1 flex gap-2">
            <input
              type="number"
              min={0}
              value={minInstances}
              onChange={(e) => setMinInstances(Math.max(0, Number(e.target.value) || 0))}
              className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 font-mono text-sm outline-none focus:border-brand/50"
            />
            <Button
              size="xs"
              variant="outline"
              disabled={minInstances === deployment.min_instances}
              busy={updateMinInstances.isPending}
              onClick={() => {
                void updateMinInstances
                  .mutateAsync({ id: deployment.id, min_instances: minInstances })
                  .then(() => toast({ kind: 'success', title: 'Minimum instances updated' }))
                  .catch((error: unknown) =>
                    toast({
                      kind: 'error',
                      title: 'Could not update instances',
                      description: errorMessage(error),
                    })
                  );
              }}
            >
              Save
            </Button>
          </div>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Traffic weight</span>
          <span className="text-xs text-muted-foreground">
            Setting this deployment's weight sets other live deployments for the app to 0.
          </span>
          <div className="mt-1 flex gap-2">
            <input
              type="number"
              min={0}
              max={100}
              value={trafficPercent}
              onChange={(e) =>
                setTrafficPercent(Math.min(100, Math.max(0, Number(e.target.value) || 0)))
              }
              className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 font-mono text-sm outline-none focus:border-brand/50"
            />
            <Button
              size="xs"
              variant="outline"
              disabled={trafficPercent === deployment.traffic_percent}
              busy={updateTraffic.isPending}
              onClick={async () => {
                if (
                  !(await confirm({
                    title: `Set ${trafficPercent}% traffic for ${version}?`,
                    description:
                      'The traffic API rebalances the app by setting every other live deployment to 0%. Continue only if this is intentional.',
                    confirmLabel: 'Update traffic',
                  }))
                )
                  return;
                void updateTraffic
                  .mutateAsync({ id: deployment.id, traffic_percent: trafficPercent })
                  .then(() => toast({ kind: 'success', title: 'Traffic weight updated' }))
                  .catch((error: unknown) =>
                    toast({
                      kind: 'error',
                      title: 'Could not update traffic',
                      description: errorMessage(error),
                    })
                  );
              }}
            >
              Save
            </Button>
          </div>
        </label>
      </div>
    </div>
  );
}
