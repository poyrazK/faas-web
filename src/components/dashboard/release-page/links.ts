import { redirect } from '@tanstack/react-router';
import { panelForSection, type ReleasePanel } from './panels';

/**
 * Where a link to one release goes: its page under the app when the slug is
 * known, else the shortcut that finds the app. Spread into `<Link>` or
 * `navigate()`.
 */
export function releaseLink(
  deploymentId: string,
  { slug, panel }: { slug?: string; panel?: ReleasePanel } = {}
) {
  const search = panel ? { panel } : {};
  return slug
    ? ({
        to: '/dashboard/apps/$appSlug/releases/$deploymentId',
        params: { appSlug: slug, deploymentId },
        search,
      } as const)
    : ({ to: '/dashboard/releases/$deploymentId', params: { deploymentId }, search } as const);
}

/**
 * A `beforeLoad` step for pages that used to open the release dialog through
 * `?deployment=…&releaseSection=…`: bookmarks and pasted links land on the
 * release page with the popup that section became. `project` travels along.
 */
export function redirectOldReleaseLink(search: Record<string, unknown>, slug?: string): void {
  const deployment = search.deployment;
  if (typeof deployment !== 'string' || !deployment) return;
  const link = releaseLink(deployment, { slug, panel: panelForSection(search.releaseSection) });
  const project = typeof search.project === 'string' ? { project: search.project } : {};
  throw redirect({ ...link, search: { ...link.search, ...project }, replace: true } as never);
}
