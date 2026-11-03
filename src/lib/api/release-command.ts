import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { keys, retryPolicy } from './queries';
import type { components } from './schema';

export type AppTask = components['schemas']['AppTaskResponse'];
export type ReleaseRun = NonNullable<components['schemas']['DeploymentResponse']['release']>;

export interface ReleaseTaskRead {
  /** The deployment's release task, when one of the pages read holds it. */
  task?: AppTask;
  /** How many of the app's newest tasks were read. */
  searched: number;
  /** False when the page budget ran out before the end of the app's tasks. */
  complete: boolean;
}

const TASK_PAGE = 200;
const TASK_PAGES = 3;

/** The task has been admitted and has not ended (AppTaskResponse.status). */
export const RELEASE_IN_FLIGHT: readonly ReleaseRun['status'][] = [
  'queued',
  'restoring',
  'running',
];

/**
 * The receipt of a deployment's release command run: its command, exit code,
 * failure and the tail of its output. The deployment's `release` object says
 * only status and times (faas release/migrations.go ReleaseSummary); the
 * output lives on the app task imaged admitted for it (kind `release`, pinned
 * to the deployment; faas imaged/handler.go ensureReleaseTask), and
 * `release_command_failed` points there ("task output is available through
 * the app-task inspection surface", faas api/errors.go). The list has no
 * deployment filter, so this reads the app's newest tasks a page at a time
 * and says how far it looked rather than claiming the task does not exist.
 */
export function useReleaseTask(
  slug: string,
  deploymentId: string,
  options: { enabled?: boolean; poll?: boolean } = {}
) {
  return useQuery({
    queryKey: [...keys.app(slug), 'tasks', 'release', deploymentId],
    queryFn: async ({ signal }): Promise<ReleaseTaskRead> => {
      let offset = 0;
      let searched = 0;
      for (let page = 0; page < TASK_PAGES; page++) {
        const data = await unwrap(
          api.GET('/v1/apps/{slug}/tasks', {
            params: { path: { slug }, query: { limit: TASK_PAGE, offset } },
            signal,
          })
        );
        searched += data.tasks.length;
        const task = data.tasks.find(
          (row) => row.kind === 'release' && row.deployment_id === deploymentId
        );
        if (task) return { task, searched, complete: true };
        if (data.next_offset < 0) return { searched, complete: true };
        offset = data.next_offset;
      }
      return { searched, complete: false };
    },
    enabled: Boolean(slug && deploymentId) && (options.enabled ?? true),
    retry: retryPolicy,
    refetchInterval: options.poll ? 3_000 : false,
  });
}
