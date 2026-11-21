import type { SearchMiddleware } from '@tanstack/react-router';
import { validEnvironment, type ProjectEnvironment } from '@/lib/api/projects';

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
