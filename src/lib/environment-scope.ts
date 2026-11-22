import { useMemo } from 'react';
import { useRouterState, type SearchMiddleware } from '@tanstack/react-router';
import {
  useEnvironmentState,
  useProjectEnvironments,
  validEnvironment,
  type ProjectEnvironment,
} from '@/lib/api/projects';
import { useWorkspaceTarget } from '@/lib/api/workspace-apps';
import { useAuth } from '@/lib/auth';
import { STANDALONE, isAccountPath, useProjectScope } from '@/lib/project-scope';

/**
 * The environment the console is in, inside a project: production by default,
 * or a stage or preview named in the URL as `?env=<slug>`. Like `?project=`, it
 * rides along as you move between pages, and it is dropped when you leave the
 * project or switch to another one (that project may have no such stage).
 * Nothing is remembered outside the URL. Design:
 * docs/superpowers/specs/2026-11-21-environment-scope-design.md.
 */

/** Production is the absence of the param, so `?env=production` normalises away. */
export function validateEnvironmentSearch(search: Record<string, unknown>): { env?: string } {
  const env = search.env;
  return typeof env === 'string' && env !== 'production' && validEnvironment(env) ? { env } : {};
}

type ScopeSearch = { project?: string; env?: string };
const hasOwn = (value: unknown, key: string) =>
  typeof value === 'object' && value !== null && Object.prototype.hasOwnProperty.call(value, key);

/**
 * Keeps `?env=` on a navigation unless the link sets or clears it itself,
 * clears the project, or names a different project. A current project of
 * `undefined` is a project page path (`/dashboard/projects/<slug>`), whose
 * links into the project rail name it, so that counts as the same project.
 *
 * The link's own search arrives as `meta.explicit` when the middleware asks
 * `next` to collect meta — the same mechanism `retainSearchParams` uses.
 */
export const retainEnvironment: SearchMiddleware<ScopeSearch> = ({ search, next }) => {
  const collect = next as unknown as (
    s: ScopeSearch,
    collectMeta: true
  ) => { search: ScopeSearch; meta: { explicit?: unknown } };
  const { search: result, meta } = collect(search, true);
  const explicit = meta.explicit;
  if (search.env === undefined || hasOwn(explicit, 'env')) return result;
  if (hasOwn(explicit, 'project')) {
    const project = (explicit as ScopeSearch).project;
    if (project === undefined) return result;
    if (search.project !== undefined && project !== search.project) return result;
  }
  return { ...result, env: search.env };
};

/** "Staging" for `staging`: slugs are lower-case, names are not. */
export const environmentName = (slug: string) => slug.charAt(0).toUpperCase() + slug.slice(1);

export type EnvironmentKind = 'production' | 'stage' | 'preview';

/** A preview environment follows a branch; anything else but production is a stage. */
export function environmentKind(slug: string, environment?: ProjectEnvironment): EnvironmentKind {
  if (slug === 'production') return 'production';
  return environment?.branch ? 'preview' : 'stage';
}

export interface EnvironmentScope {
  /** False where environments don't apply: account pages, no project, standalone apps, a company workspace. */
  applies: boolean;
  /** The environment slug in force: the URL's, else 'production'. */
  environment: string;
  kind: EnvironmentKind;
  name: string;
  /** The project's environments, production first then by name; null while loading or on error. */
  choices: ProjectEnvironment[] | null;
  /** True when the project has this environment; null while unknown. Production always counts. */
  available: boolean | null;
  /** The list query, for the dropdown's loading, error and retry states. */
  list: { isPending: boolean; isError: boolean; refetch: () => void };
}

const byStage = (a: ProjectEnvironment, b: ProjectEnvironment) =>
  a.slug === 'production' ? -1 : b.slug === 'production' ? 1 : a.slug.localeCompare(b.slug);

/**
 * The environment in force for the page: the URL's `?env=`, checked against the
 * project's environments. Reads nothing where environments don't apply.
 */
export function useEnvironmentScope(): EnvironmentScope {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const env = useRouterState({
    select: (s) =>
      validateEnvironmentSearch((s.location.search ?? {}) as Record<string, unknown>).env,
  });
  const { project } = useProjectScope();
  const { account } = useAuth();
  const { org } = useWorkspaceTarget();
  // Company projects: environment routes resolve under the signed-in account
  // (faas ProjectBySlug), so a company project's environments can't be read.
  const applies = Boolean(project) && project !== STANDALONE && !org && !isAccountPath(pathname);
  const query = useProjectEnvironments(
    applies ? (account?.id ?? '') : '',
    applies ? (project ?? '') : ''
  );
  const environment = env ?? 'production';
  const choices = useMemo(
    () =>
      query.data ? [...query.data].filter((e) => validEnvironment(e.slug)).sort(byStage) : null,
    [query.data]
  );
  const current = choices?.find((e) => e.slug === environment);
  return {
    applies,
    environment,
    kind: environmentKind(environment, current),
    name: environmentName(environment),
    choices,
    available: environment === 'production' ? true : choices ? Boolean(current) : null,
    list: {
      isPending: query.isPending,
      isError: query.isError,
      refetch: () => void query.refetch(),
    },
  };
}

export interface AppEnvironment {
  /** The scope to send: undefined in production (today's requests). */
  scope: string | undefined;
  name: string;
  kind: EnvironmentKind;
  /** Whether the environment lists this app at all; null while unknown; always true in production. */
  present: boolean | null;
  /** Whether the app has a release there; null while unknown; always true in production. */
  deployed: boolean | null;
  /** True for a protected non-production environment: read-only in the console. */
  readOnly: boolean;
  /** The environment's state could not be read. */
  failed: boolean;
  /** The URL names an environment this project doesn't have. */
  unavailable: boolean;
  retry: () => void;
}

const PRODUCTION_APP: AppEnvironment = {
  scope: undefined,
  name: 'Production',
  kind: 'production',
  present: true,
  deployed: true,
  readOnly: false,
  failed: false,
  unavailable: false,
  retry: () => undefined,
};

/**
 * One app's place in the environment in force: the scope its values are read
 * and written under, whether the environment lists it and has deployed it,
 * and whether the console may edit it there. Presence, deployment and
 * protection all come from the one environment-state read, so they arrive
 * together. Where environments don't apply, or in production, it is exactly
 * today: no scope, present, editable.
 */
export function useAppEnvironment(slug: string): AppEnvironment {
  const env = useEnvironmentScope();
  const { project } = useProjectScope();
  const { account } = useAuth();
  const staged = env.applies && env.environment !== 'production';
  const unavailable = staged && env.available === false;
  const state = useEnvironmentState(
    staged && !unavailable ? (account?.id ?? '') : '',
    staged && !unavailable ? (project ?? '') : '',
    staged && !unavailable ? env.environment : ''
  );
  if (!staged) return PRODUCTION_APP;
  const data = state.data?.environment === env.environment ? state.data : undefined;
  // faas lists every project app in an environment's state; one it never
  // deployed there has `release.status: 'not_deployed'`.
  const workload = data?.workloads.find((w) => w.workload_slug === slug);
  return {
    scope: env.environment,
    name: env.name,
    kind: env.kind,
    present: data ? Boolean(workload) : null,
    deployed: workload ? workload.release.status !== 'not_deployed' : data ? false : null,
    readOnly: Boolean(data?.protected),
    failed: !unavailable && state.isError,
    unavailable,
    retry: () => void state.refetch(),
  };
}
