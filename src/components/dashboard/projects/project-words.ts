import type { Deployment, Workflow } from '@/lib/mock-data';
import type { ProjectDetail } from '@/lib/api/projects';
import { failingShare, latestDeployNote, type DeployNote } from '../app-tile-words';

type Workload = ProjectDetail['workloads'][number];

/** faas deployments_status_check: the states before `live`. */
const IN_PROGRESS = new Set(['pending', 'building', 'imaging', 'snapshotting']);

/**
 * What a person should know about a workload's latest deployment, from the
 * project's own answer (`deployment_status`, `build_status`). A live deploy
 * says nothing. The time comes from the deployment list when it agrees; the
 * project response carries none.
 */
export function workloadNote(
  workload: Workload,
  deployments: Pick<Deployment, 'workflowId' | 'state' | 'createdAt'>[] = []
): DeployNote | null {
  const listed = latestDeployNote(workload.slug, deployments);
  // No deployment reported for the workload: the list is all there is.
  if (!workload.deployment_status) return listed;
  const own: Omit<DeployNote, 'at'> | null =
    workload.build_status === 'failed'
      ? { tone: 'critical', text: 'build failed' }
      : workload.deployment_status === 'failed'
        ? { tone: 'critical', text: 'deploy failed' }
        : IN_PROGRESS.has(workload.deployment_status)
          ? { tone: 'warning', text: 'deploying' }
          : null;
  if (!own) return null;
  return { ...own, at: listed?.tone === own.tone ? listed.at : undefined };
}

/** An app status as the API said it, capitalised: `parked` → "Parked". */
export function statusWord(status: string | undefined): string {
  if (!status) return '';
  const words = status.replace(/_/g, ' ');
  return words[0].toUpperCase() + words.slice(1);
}

/** One thing that needs a look: red when something failed, amber when it is only under way. */
export interface Problem {
  tone: 'critical' | 'warning';
  text: string;
}

const appWord = (n: number) => `${n} ${n === 1 ? 'app' : 'apps'}`;

/**
 * The page's opening answer: what the project is, then what needs a look —
 * at most two named problems, then a count of the rest. `good` is set only
 * when every app's latest deployment is reported live and nothing is wrong.
 */
export function projectSummary({
  project,
  apps,
  deployments,
}: {
  project: Pick<ProjectDetail, 'workloads' | 'repo_full_name' | 'production_branch'>;
  apps: Map<string, Workflow>;
  deployments: Pick<Deployment, 'workflowId' | 'state' | 'createdAt'>[];
}): { what: string; source: string; problems: Problem[]; extra: number; good: string | null } {
  const { workloads, repo_full_name: repo, production_branch: branch } = project;
  const what = workloads.length ? `${appWord(workloads.length)}.` : 'No apps yet.';
  const source = repo
    ? branch
      ? `Pushes to ${branch} in ${repo} deploy ${workloads.length === 1 ? 'it' : 'them'}.`
      : `Connected to ${repo}.`
    : 'Not connected to a repository.';

  const problems: Problem[] = [];
  let deploying = 0;
  for (const workload of workloads) {
    const name = workload.workload_name || workload.slug;
    const note = workloadNote(workload, deployments);
    const app = apps.get(workload.slug);
    const share = app ? failingShare(app) : null;
    const failed =
      note?.tone === 'critical'
        ? note.text === 'build failed'
          ? 'its latest build failed'
          : 'its latest deploy failed'
        : null;
    if (note?.tone === 'warning') deploying += 1;
    if (share != null && failed)
      problems.push({
        tone: 'critical',
        text: `${name} is failing ${share.toFixed(1)}% of requests and ${failed}`,
      });
    else if (share != null)
      problems.push({
        tone: 'critical',
        text: `${name} is failing ${share.toFixed(1)}% of requests`,
      });
    else if (failed)
      problems.push({ tone: 'critical', text: `${name}'s ${failed.replace(/^its /, '')}` });
  }
  if (deploying)
    problems.push({
      tone: 'warning',
      text: `${deploying} ${deploying === 1 ? 'deploy is' : 'deploys are'} in progress`,
    });

  const allLive =
    workloads.length > 0 && workloads.every((workload) => workload.deployment_status === 'live');
  const good =
    !problems.length && allLive
      ? workloads.length === 1
        ? 'Its latest deploy is live.'
        : 'Every latest deploy is live.'
      : null;
  return {
    what,
    source,
    problems: problems.slice(0, 2),
    extra: Math.max(0, problems.length - 2),
    good,
  };
}
