import { useMemo } from 'react';
import { useRouterState } from '@tanstack/react-router';
import { useAuth } from '@/lib/auth';
import { useData } from '@/lib/store';
import { useProjectMembership } from '@/lib/api/projects';

/**
 * The project the console is looking at, Supabase-style: pick a project first,
 * then everything in the sidebar is about that project.
 *
 * The choice lives in the URL as `?project=<slug>` — shareable, and kept as
 * you move between pages (the dashboard route retains it) — except on a
 * project's own page, whose path names it. Apps that belong to no project are
 * one more scope, `_standalone`, which no real slug can collide with (slugs
 * start with a letter or digit).
 *
 * The API has no "filter by project" on account-wide reads, so a page scopes
 * itself by the project's apps: project details list their workloads, and an
 * app outside every project is standalone. Until membership has loaded, the
 * app set is `null` — a page must wait rather than show everything.
 */

export const STANDALONE = '_standalone';
const SLUG = /^(?:_standalone|[a-z0-9][a-z0-9-]{0,62})$/;

export function validateProjectSearch(search: Record<string, unknown>): { project?: string } {
  return typeof search.project === 'string' && SLUG.test(search.project)
    ? { project: search.project }
    : {};
}

/** The project a location points at: a project's own page first, then `?project=`. */
export function projectOfLocation(
  pathname: string,
  search: Record<string, unknown>
): string | null {
  const page = /^\/dashboard\/projects\/([^/]+)/.exec(pathname)?.[1];
  if (page) return decodeURIComponent(page);
  return validateProjectSearch(search).project ?? null;
}

export const projectLabel = (slug: string) => (slug === STANDALONE ? 'Standalone apps' : slug);

/**
 * Pages that belong to the account rather than to any project: the way in
 * (Overview, the Projects list) and the account's own pages. Everywhere else
 * the rail is the project menu — scoped to the chosen project, or across all
 * apps when a page is opened without one (a bookmark, ⌘K).
 */
const ACCOUNT_PATHS = [
  /^\/dashboard\/?$/,
  /^\/dashboard\/projects\/?$/,
  /^\/dashboard\/(usage|budgets|invoices|plans|audit|settings|account)(\/|$)/,
  /^\/dashboard\/apps\/new(\/|$)/,
];

export const isAccountPath = (pathname: string) => ACCOUNT_PATHS.some((re) => re.test(pathname));

export interface ProjectScope {
  /** The scoped project's slug (or `_standalone`), or null at account level. */
  project: string | null;
  label: string;
  /** Slugs of the apps in scope; null while membership is loading or at account level. */
  appSlugs: Set<string> | null;
  /** True once membership has loaded (or failed) for a scoped project. */
  settled: boolean;
  /** Every project the switcher can offer, plus standalone when there are such apps. */
  choices: { slug: string; label: string }[];
}

export function useProjectScope(): ProjectScope {
  const { pathname, search } = useRouterState({
    select: (s) => ({ pathname: s.location.pathname, search: s.location.search }),
  });
  const project = projectOfLocation(pathname, (search ?? {}) as Record<string, unknown>);
  const { account } = useAuth();
  const { workflows } = useData();
  const membership = useProjectMembership(account?.id ?? '');

  return useMemo(() => {
    const standalone = workflows.filter((app) => !membership.projectOfApp.has(app.id));
    const ready = membership.state === 'ready';
    const choices = [
      ...membership.projects.map((p) => ({ slug: p.slug, label: p.slug })),
      ...(ready && standalone.length
        ? [{ slug: STANDALONE, label: projectLabel(STANDALONE) }]
        : []),
    ];
    if (!project) return { project, label: '', appSlugs: null, settled: true, choices };
    const appSlugs = !ready
      ? null
      : project === STANDALONE
        ? new Set(standalone.map((app) => app.id))
        : new Set((membership.workloadsOf.get(project) ?? []).map((w) => w.slug));
    return {
      project,
      label: projectLabel(project),
      appSlugs,
      settled: membership.state !== 'pending',
      choices,
    };
  }, [project, workflows, membership]);
}

/** Keep only what belongs to the scoped project's apps; everything at account level. */
export function inScope<T>(rows: T[], scope: ProjectScope, slugOf: (row: T) => string): T[] {
  if (!scope.project) return rows;
  if (!scope.appSlugs) return [];
  return rows.filter((row) => scope.appSlugs!.has(slugOf(row)));
}
