import { useEffect, useRef } from 'react';
import { useAppDeployments, useDeployment } from '@/lib/api/queries';
import { useLogStream } from '@/lib/api/logs';
import { isDeploymentTerminal } from '@/lib/deployment-status';
import { failureSummary } from '@/components/dashboard/failure-summary';
import { launchStage, type LaunchState } from './launch';
import type { LaunchSeed } from './wizard/wizard';

/** Watches one app's first deploy and reports it as node state. Renders nothing. */
export function LaunchTracker({
  seed,
  onChange,
}: {
  seed: LaunchSeed;
  onChange: (s: LaunchState) => void;
}) {
  const latest = useAppDeployments(seed.slug, 1, {
    pollWhileEmpty: !seed.deploymentId && !seed.submitError,
  });
  const deploymentId = seed.deploymentId ?? latest.data?.pages[0]?.items[0]?.id;
  const deployment = useDeployment(deploymentId ?? '', {
    refetchInterval: (q) =>
      deploymentId && !isDeploymentTerminal(q.state.data?.status) ? 2_000 : false,
  });
  const log = useLogStream(
    { kind: 'build', deploymentId: deploymentId ?? '', limit: 50 },
    Boolean(deploymentId)
  );
  const last = useRef('');

  useEffect(() => {
    const d = deployment.data;
    const base = {
      slug: seed.slug,
      source: seed.source,
      repo: seed.repo,
      ref: seed.ref,
      deploymentId,
    };
    const next: LaunchState =
      seed.submitError && !deploymentId
        ? {
            ...base,
            stage: 'failed',
            step: 0,
            failure: `Build was not submitted: ${seed.submitError}`,
          }
        : {
            ...base,
            ...launchStage(deploymentId ? (d?.status ?? 'queued') : undefined),
            logLine: log.lines.at(-1)?.text,
            failure:
              d && launchStage(d.status).stage === 'failed'
                ? failureSummary({ deployment: d }).cause
                : undefined,
          };
    const key = JSON.stringify(next);
    if (key !== last.current) {
      last.current = key;
      onChange(next);
    }
  }, [deployment.data, deploymentId, log.lines, onChange, seed]);

  return null;
}
