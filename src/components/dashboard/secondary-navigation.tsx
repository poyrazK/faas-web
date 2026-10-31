import { Link, useRouterState } from '@tanstack/react-router';
import {
  APP_SECTIONS,
  findNavHub,
  matchesNavPath,
  type NavItem,
  sidebarSectionsFor,
} from './nav-config';
import { validateSettingsSearch } from './settings-search';
import { TabNav, tabClassName } from './tabs';

/** Route navigation uses native links: Tab/Enter, new tabs and history all work. */
export function SecondaryNavigation({ label, items }: { label: string; items: NavItem[] }) {
  const { pathname, hash, search } = useRouterState({ select: (s) => s.location });
  return (
    <TabNav label={label}>
      {items.map((item) => {
        const currentPath = matchesNavPath(pathname, { ...item, exact: true });
        if (item.search) {
          const active =
            currentPath &&
            item.search.section === (validateSettingsSearch(search).section ?? 'general');
          return (
            <Link
              key={`${item.to}-${item.search.section}`}
              to={item.to}
              search={(previous) => ({ ...previous, ...item.search })}
              hash={hash}
              aria-current={active ? 'page' : undefined}
              className={tabClassName(active)}
            >
              {item.label}
            </Link>
          );
        }
        const active = matchesNavPath(pathname, { ...item, exact: item.exact ?? false });
        return (
          <Link
            key={item.to}
            to={item.to}
            // Reselecting this page must not discard a bookmarked filter/detail.
            search={currentPath ? true : undefined}
            hash={currentPath ? hash : undefined}
            aria-current={active ? 'page' : undefined}
            className={tabClassName(active)}
          >
            {item.label}
          </Link>
        );
      })}
    </TabNav>
  );
}

export function DashboardSecondaryNavigation() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const hub = findNavHub(pathname);
  if (!hub || hub.pageOwnsNavigation) return null;
  // Standalone per-app pages (logs, routes, …) keep their strip. An app
  // section that is also a rail row (Debugger, Edge rules) is the account view
  // there, and the app page's tab is the per-app way in.
  const showAppSections =
    !matchesNavPath(pathname, { to: hub.to, exact: true }) &&
    APP_SECTIONS.some((item) => matchesNavPath(pathname, item));
  // A hub whose sections are nested rows in the rail must not restate them as
  // a tab strip: two controls for one choice, one of which silently scrolls
  // away. Settings keeps its strip — its eight `?section=` panels are the
  // page's own tabs and deliberately stay out of the rail.
  const hubSections = sidebarSectionsFor(hub).length === 0 ? (hub.sections ?? []) : [];
  if (hubSections.length === 0 && !showAppSections) return null;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {hubSections.length > 0 && (
        <SecondaryNavigation label={`${hub.label} sections`} items={hubSections} />
      )}
      {showAppSections && (
        <details open className="min-w-0">
          <summary className="pressable w-fit cursor-pointer rounded-md px-3 py-1 text-xs text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
            App sections
          </summary>
          <SecondaryNavigation label="App sections" items={APP_SECTIONS} />
        </details>
      )}
    </div>
  );
}
