import { Link, useRouterState } from '@tanstack/react-router';
import { APP_SECTIONS, findNavHub, matchesNavPath, type NavItem } from './nav-config';

/** Route navigation uses native links: Tab/Enter, new tabs and history all work. */
export function SecondaryNavigation({ label, items }: { label: string; items: NavItem[] }) {
  const { pathname, hash } = useRouterState({ select: (s) => s.location });
  return (
    <nav aria-label={label} className="flex flex-wrap gap-1 border-b border-border pb-1">
      {items.map((item) => {
        const currentPath = matchesNavPath(pathname, { ...item, exact: true });
        return (
          <Link
            key={item.to}
            to={item.to}
            // Reselecting this page must not discard a bookmarked filter/detail.
            search={currentPath ? true : undefined}
            hash={currentPath ? hash : undefined}
            activeOptions={{ exact: item.exact ?? false, includeSearch: false }}
            activeProps={{ 'aria-current': 'page', className: 'border-brand text-foreground' }}
            inactiveProps={{
              className: 'border-transparent text-muted-foreground hover:text-foreground',
            }}
            className="pressable rounded-t-md border-b-2 px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function DashboardSecondaryNavigation() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const hub = findNavHub(pathname);
  if (!hub?.sections) return null;
  const appSection = APP_SECTIONS.some((item) => matchesNavPath(pathname, item));
  // App detail already has scoped URL tabs, and New app owns its own flow.
  const showAppSections =
    hub.label === 'Apps' && !pathname.replace(/\/$/, '').startsWith('/dashboard/workflows/');
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <SecondaryNavigation label={`${hub.label} sections`} items={hub.sections} />
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
