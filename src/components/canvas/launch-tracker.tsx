import { useEffect, useRef } from 'react';
import { useAppDeployments, useDeployment } from '@/lib/api/queries';
import { useLogStream } from '@/lib/api/logs';
import { errorMessage } from '@/lib/api/errors';
import { isDeploymentTerminal } from '@/lib/deployment-status';
import { failureSummary } from '@/components/dashboard/failure-summary';
import { launchStage, type LaunchState } from './launch';
import type { LaunchSeed } from './wizard/wizard';

const newer = (a?: string, b?: string) => Boolean(a && b && Date.parse(a) > Date.parse(b));

/**
 * Watches one app's first deploy and reports it as node state. Renders nothing.
 *
 * It follows the deployment the launch submitted, or, without one, the app's
 * latest. A newer deployment on the app (a retry elsewhere, a push to the
 * bound branch) overtakes the pinned one, so a failure fixed elsewhere does
 * not stay on the node. A deployment that cannot be read is reported as such
 * and not polled again until the person retries.
 */
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
  const latestItem = latest.data?.pages[0]?.items[0];
  const pinned = seed.deploymentId ?? latestItem?.id;
  const deployment = useDeployment(pinned ?? '', {
    refetchInterval: (q) =>
      pinned && !q.state.error && !isDeploymentTerminal(q.state.data?.status) ? 2_000 : false,
  });
  const overtaken =
    latestItem &&
    latestItem.id !== pinned &&
    newer(latestItem.created_at, deployment.data?.created_at);
  const current = overtaken ? latestItem : deployment.data;
  const deploymentId = overtaken ? latestItem.id : pinned;
  const log = useLogStream(
    { kind: 'build', deploymentId: deploymentId ?? '', limit: 50 },
    Boolean(deploymentId)
  );
  const readError = !overtaken && deployment.error;
  const last = useRef('');

  useEffect(() => {
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
        : readError
          ? {
              ...base,
              stage: 'unavailable',
              step: 0,
              failure: errorMessage(readError),
            }
          : {
              ...base,
              ...launchStage(deploymentId ? (current?.status ?? 'queued') : undefined),
              logLine: log.lines.at(-1)?.text,
              failure:
                current && launchStage(current.status).stage === 'failed'
                  ? failureSummary({ deployment: current }).cause
                  : undefined,
            };
    const key = JSON.stringify(next);
    if (key !== last.current) {
      last.current = key;
      onChange(next);
    }
  }, [current, deploymentId, readError, log.lines, onChange, seed]);

  return null;
}
