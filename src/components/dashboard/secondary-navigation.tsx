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
  if (!hub?.sections || hub.pageOwnsNavigation) return null;
  const appSection = APP_SECTIONS.some((item) => matchesNavPath(pathname, item));
  // Keep this navigation scoped to standalone app pages, not the All apps list.
  const showAppSections = hub.label === 'Apps' && appSection;
  // A hub whose sections are nested rows in the rail must not restate them as
  // a tab strip: two controls for one choice, one of which silently scrolls
  // away. Settings keeps its strip — its eight `?section=` panels are the
  // page's own tabs and deliberately stay out of the rail.
  const showHubSections = sidebarSectionsFor(hub).length === 0;
  if (!showHubSections && !showAppSections) return null;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {showHubSections && (
        <SecondaryNavigation label={`${hub.label} sections`} items={hub.sections} />
      )}
      {showAppSections && (
        <details open={appSection} className="min-w-0">
          <summary className="pressable w-fit cursor-pointer rounded-md px-3 py-1 text-xs text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
            App sections
          </summary>
          <SecondaryNavigation label="App sections" items={APP_SECTIONS} />
        </details>
      )}
    </div>
  );
}
