import type { Deployment, Workflow } from '@/lib/mock-data';

/** An error share at or above this reads as trouble. */
export const HOT_ERROR_PCT = 5;

/**
 * A runtime id as a person says it: `node22` → "Node 22", `python313` →
 * "Python 3.13", `go124-alpine` → "Go 1.24 (Alpine)", and the bare `app` type
 * (a container image) → "Container". Anything unknown is shown as it came.
 */
export function runtimeLabel(runtime: string | undefined): string {
  if (!runtime) return '';
  if (runtime === 'app') return 'Container';
  const m = /^(node|python|go|bun|deno|ruby|java)(\d+)(?:-(\w+))?$/.exec(runtime);
  if (!m) return runtime;
  const [, lang, digits, variant] = m;
  const name = {
    node: 'Node',
    python: 'Python',
    go: 'Go',
    bun: 'Bun',
    deno: 'Deno',
    ruby: 'Ruby',
    java: 'Java',
  }[lang]!;
  // Node and Java versions are whole numbers; the others read major.minor.
  const version =
    lang === 'node' || lang === 'java' || digits.length === 1
      ? digits
      : `${digits[0]}.${digits.slice(1)}`;
  return `${name} ${version}${variant ? ` (${variant[0].toUpperCase()}${variant.slice(1)})` : ''}`;
}

export interface DeployNote {
  tone: 'critical' | 'warning';
  text: string;
  at: number;
}

/**
 * What a person should know about an app's latest deployment, if anything.
 * A finished, successful deploy is the norm and says nothing; a failed one or
 * one still in progress is worth a line, because the app may keep running the
 * previous version meanwhile.
 */
export function latestDeployNote(
  slug: string,
  deployments: Pick<Deployment, 'workflowId' | 'state' | 'createdAt'>[]
): DeployNote | null {
  const latest = deployments
    .filter((d) => d.workflowId === slug)
    .reduce<(typeof deployments)[number] | null>(
      (best, d) => (!best || d.createdAt > best.createdAt ? d : best),
      null
    );
  if (!latest) return null;
  if (latest.state === 'failed')
    return { tone: 'critical', text: 'deploy failed', at: latest.createdAt };
  if (latest.state === 'building')
    return { tone: 'warning', text: 'deploying', at: latest.createdAt };
  return null;
}

/** True when the app's 24 h figures are real and its error share is high. */
export function failingShare(app: Workflow): number | null {
  if (app.metricsUnavailable || app.state === 'undeployed' || app.invocations24h <= 0) return null;
  return app.errorRatePct >= HOT_ERROR_PCT ? app.errorRatePct : null;
}

/**
 * The page's opening answer: what there is, then what needs a look — at most
 * two named problems, then a count of the rest.
 */
export function projectsSummary({
  apps,
  projectCount,
  standaloneCount,
  deployments,
}: {
  apps: Workflow[];
  projectCount: number;
  standaloneCount: number;
  deployments: Pick<Deployment, 'workflowId' | 'state' | 'createdAt'>[];
}): { what: string; problems: string[]; extra: number } {
  const appWord = (n: number) => `${n} ${n === 1 ? 'app' : 'apps'}`;
  const parts = [
    projectCount > 0 &&
      `${appWord(apps.length - standaloneCount)} in ${projectCount} ${projectCount === 1 ? 'project' : 'projects'}`,
    standaloneCount > 0 && `${standaloneCount} standalone`,
  ].filter(Boolean);
  const what =
    projectCount === 0
      ? `${appWord(apps.length)}, none in a project yet.`
      : `${parts.join(' and ')}.`;

  // One sentence per app, so an app with two problems is named once.
  const problems: string[] = [];
  for (const app of apps) {
    const share = failingShare(app);
    const failedDeploy = latestDeployNote(app.id, deployments)?.tone === 'critical';
    if (share != null && failedDeploy)
      problems.push(
        `${app.name} is failing ${share.toFixed(1)}% of requests and its latest deploy failed`
      );
    else if (share != null)
      problems.push(`${app.name} is failing ${share.toFixed(1)}% of requests`);
    else if (failedDeploy) problems.push(`${app.name}'s latest deploy failed`);
  }
  const deploying = apps.filter(
    (app) => latestDeployNote(app.id, deployments)?.tone === 'warning'
  ).length;
  if (deploying)
    problems.push(`${deploying} ${deploying === 1 ? 'deploy is' : 'deploys are'} in progress`);
  return { what, problems: problems.slice(0, 2), extra: Math.max(0, problems.length - 2) };
}
