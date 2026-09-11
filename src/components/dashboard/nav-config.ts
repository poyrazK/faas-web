import type { ComponentType, SVGProps } from 'react';
import { SETTINGS_SECTIONS } from './settings-search';
import {
  Activity,
  Antenna,
  Coins,
  Database,
  CreditCard,
  Cube,
  GitFork as WorkflowIcon,
  Github,
  Globe,
  GraphUp,
  Group,
  HardDrive,
  Journal,
  Key,
  Package,
  Play,
  Rocket,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Timer,
  Upload,
  ViewGrid,
} from 'iconoir-react';

/** Any Iconoir glyph: they are plain SVG components. */
export type NavIcon = ComponentType<SVGProps<SVGSVGElement>>;

export interface NavItem {
  to: string;
  label: string;
  icon: NavIcon;
  /** Small wayfinding accents in the sidebar; labels and other menus stay neutral. */
  sidebarIconClassName?: string;
  exact?: boolean;
  search?: Record<string, string>;
}

export interface NavGroup {
  /** Undefined for the ungrouped lead item. */
  title?: string;
  items: NavHub[];
}

export interface NavHub extends NavItem {
  sections?: NavItem[];
  /** Page tabs own navigation; section destinations still support search and legacy URLs. */
  pageOwnsNavigation?: boolean;
  /**
   * Sections render as nested sidebar rows unless this is false.
   *
   * Settings opts out: its eight `?section=` panels are one page's internal
   * tabs, not eight destinations, and listing them in the rail would triple
   * the Account group to sell navigation that the page already does better.
   */
  sidebarSections?: boolean;
}

/** Existing pages anchor each hub until its feature composition is ready. */
export const NAV_HUBS: NavHub[] = [
  {
    to: '/dashboard',
    label: 'Overview',
    icon: ViewGrid,
    exact: true,
    sidebarIconClassName: 'text-brand/80',
  },
  {
    to: '/dashboard/workflows',
    label: 'Apps',
    icon: WorkflowIcon,
    sidebarIconClassName: 'text-cat-compute/80',
    sections: [
      { to: '/dashboard/workflows', label: 'Apps', icon: WorkflowIcon },
      { to: '/dashboard/templates', label: 'Templates', icon: Cube },
      { to: '/dashboard/import', label: 'Import', icon: Upload },
    ],
  },
  {
    to: '/dashboard/jobs',
    label: 'Jobs',
    icon: Play,
    sidebarIconClassName: 'text-cat-compute/80',
    pageOwnsNavigation: true,
    sections: [
      { to: '/dashboard/jobs', label: 'Jobs', icon: Play },
      { to: '/dashboard/crons', label: 'Cron Jobs', icon: Timer },
      { to: '/dashboard/triggers', label: 'Triggers', icon: Antenna },
    ],
  },
  {
    to: '/dashboard/deployments',
    label: 'Releases',
    icon: Rocket,
    sidebarIconClassName: 'text-cat-compute/80',
    pageOwnsNavigation: true,
    sections: [
      { to: '/dashboard/deployments', label: 'Deployments', icon: Rocket },
      { to: '/dashboard/builds', label: 'Builds', icon: Package },
    ],
  },
  {
    to: '/dashboard/workers',
    label: 'Instances',
    icon: Server,
    sidebarIconClassName: 'text-cat-compute/80',
  },
  {
    to: '/dashboard/domains',
    label: 'Domains',
    icon: Globe,
    sidebarIconClassName: 'text-cat-network/80',
  },
  {
    to: '/dashboard/storage',
    label: 'Data',
    icon: HardDrive,
    sidebarIconClassName: 'text-cat-storage/80',
    sections: [
      { to: '/dashboard/storage', label: 'Storage', icon: HardDrive },
      { to: '/dashboard/postgres', label: 'Postgres', icon: Database },
    ],
  },
  {
    to: '/dashboard/analytics',
    label: 'Analytics',
    icon: GraphUp,
    sidebarIconClassName: 'text-brand/80',
  },
  {
    to: '/dashboard/debug',
    label: 'Observe',
    icon: Search,
    sidebarIconClassName: 'text-cat-security/80',
    sections: [
      { to: '/dashboard/debug', label: 'Debugger', icon: Search },
      { to: '/dashboard/traces', label: 'Invocations', icon: Activity },
      { to: '/dashboard/audit', label: 'Audit Log', icon: Journal },
    ],
  },
  {
    to: '/dashboard/usage',
    label: 'Billing',
    icon: GraphUp,
    sections: [
      { to: '/dashboard/usage', label: 'Usage', icon: GraphUp },
      { to: '/dashboard/invoices', label: 'Invoices', icon: Coins },
      { to: '/dashboard/plans', label: 'Plans', icon: CreditCard },
    ],
  },
  {
    to: '/dashboard/settings',
    label: 'Settings',
    icon: Settings,
    sidebarSections: false,
    sections: SETTINGS_SECTIONS.map(([section, label]) => ({
      to: '/dashboard/settings',
      label,
      icon:
        section === 'members'
          ? Group
          : section === 'api-keys'
            ? Key
            : section === 'integrations'
              ? Github
              : section === 'security'
                ? ShieldCheck
                : Settings,
      search: { section },
    })),
  },
];

/**
 * The sidebar's shape.
 *
 * Hubs consolidate *pages*; they must not consolidate *navigation*. An earlier
 * pass did both at once — ten untitled rows, every second-level destination
 * reachable only after guessing which hub owned it — and the rail lost both its
 * scent and two thirds of its rows. Titles and nested sections come back here;
 * the hub pages themselves are untouched.
 */
const SIDEBAR_GROUPS: { title?: string; hubs: string[] }[] = [
  { hubs: ['Overview'] },
  { title: 'Build', hubs: ['Apps', 'Jobs', 'Releases', 'Instances'] },
  { title: 'Operate', hubs: ['Domains', 'Data', 'Analytics', 'Observe'] },
  { title: 'Account', hubs: ['Billing', 'Settings'] },
];

export const NAV_GROUPS: NavGroup[] = SIDEBAR_GROUPS.map(({ title, hubs }) => ({
  ...(title ? { title } : {}),
  items: hubs.map((label) => {
    const hub = NAV_HUBS.find((item) => item.label === label);
    // A hub missing from a group would silently vanish from the rail. Fail at
    // module load instead, where the test suite and the dev server both see it.
    if (!hub) throw new Error(`nav-config: no hub labelled ${label}`);
    return hub;
  }),
}));

/**
 * The sections a hub contributes to the rail as nested rows.
 *
 * A section pointing at the hub's own label is dropped — "Apps › Apps" is the
 * hub row restated, and the row above already links there. Sections whose label
 * differs (Releases › Deployments) stay, because the hub renamed the page and
 * the old name is still the one people search for.
 */
export function sidebarSectionsFor(hub: NavHub): NavItem[] {
  // A hub whose page owns its navigation has no section *routes* — Jobs and
  // Releases switch views with `?section=` / `?view=` on a single path, and the
  // entries here are the legacy URLs kept alive for old bookmarks. Listing them
  // in the rail would offer a second, staler way to make a choice the page
  // already owns. Settings opts out for the same reason by flag.
  if (hub.sidebarSections === false || hub.pageOwnsNavigation) return [];
  // The hub's own page becomes the group's first child rather than a second
  // link on the parent row. The parent is a disclosure, not a destination, so
  // "Apps › Apps" would say the same word twice — and "Overview" would collide
  // with the rail's own Overview row, leaving two links of that name meaning
  // different things. "All apps" is what the row actually is.
  return (hub.sections ?? []).map((section) =>
    section.to === hub.to && section.label === hub.label
      ? { ...section, label: `All ${hub.label.toLowerCase()}` }
      : section
  );
}

/** A hub is a disclosure when it has rail sections, and a link otherwise. */
export function isDisclosureHub(hub: NavHub): boolean {
  return sidebarSectionsFor(hub).length > 0;
}

/** Path segment -> label, for breadcrumb section titles. */
/**
 * The resources that belong to one app rather than the account.
 *
 * They were nine sidebar entries, each carrying its own app picker — the same
 * "which app?" question answered nine times. They are tabs on the app detail
 * page now, where the app is already in the URL. Their standalone routes still
 * resolve, so an old bookmark lands somewhere sensible, and they keep their
 * labels here for the breadcrumb and the page title.
 */
export const APP_TABS: { tab: string; segment: string }[] = [
  { tab: 'Metrics', segment: 'metrics' },
  { tab: 'Logs', segment: 'logs' },
  { tab: 'Routes', segment: 'apis' },
  { tab: 'Secrets', segment: 'secrets' },
  { tab: 'Env vars', segment: 'env' },
  { tab: 'Queues', segment: 'queues' },
  { tab: 'Upstreams', segment: 'databases' },
  { tab: 'Alerts', segment: 'alerts' },
  { tab: 'Webhooks', segment: 'webhooks' },
  { tab: 'Edge rules', segment: 'edge-rules' },
  { tab: 'Debugger', segment: 'debug' },
  { tab: 'Mirrors', segment: 'mirrors' },
  { tab: 'Tenant surfaces', segment: 'tenant-surfaces' },
  { tab: 'OpenAPI', segment: 'openapi' },
];

export const APP_SECTIONS: NavItem[] = APP_TABS.map(({ tab, segment }) => ({
  to: `/dashboard/${segment}`,
  label: tab,
  icon: Search,
}));

/** Both hub names and familiar page names remain searchable. */
export const NAV_ITEMS: NavItem[] = [
  ...NAV_HUBS,
  ...NAV_HUBS.flatMap((hub) => hub.sections ?? []),
  ...APP_SECTIONS,
].filter(
  (item, index, all) =>
    all.findIndex((other) => other.to === item.to && other.label === item.label) === index
);

export function matchesNavPath(pathname: string, item: Pick<NavItem, 'to' | 'exact'>): boolean {
  const path = pathname.replace(/\/$/, '');
  return path === item.to || (!item.exact && path.startsWith(`${item.to}/`));
}

/** Shared ownership for primary active states, breadcrumbs and section links. */
export function findNavHub(pathname: string): NavHub | undefined {
  if (
    ['/dashboard/team', '/dashboard/keys', '/dashboard/account', '/dashboard/security'].includes(
      pathname.replace(/\/$/, '')
    )
  )
    return NAV_HUBS.find((hub) => hub.label === 'Settings');
  const hub = NAV_HUBS.find(
    (item) =>
      matchesNavPath(pathname, item) ||
      item.sections?.some((section) => matchesNavPath(pathname, section))
  );
  // Debugger belongs to Observe globally, even though it also has an app tab.
  return (
    hub ??
    (APP_SECTIONS.some((item) => matchesNavPath(pathname, item))
      ? NAV_HUBS.find((item) => item.label === 'Apps')
      : undefined)
  );
}

export const SECTION_LABELS: Record<string, string> = {
  // Derived from APP_TABS, so the breadcrumb, the ⌘K palette, and the app
  // page's tab strip can never call the same page three different names —
  // they used to ("Routes" vs "APIs", "Env" vs "Env Vars", and `edge-rules`
  // was missing entirely).
  ...Object.fromEntries(APP_TABS.map((t) => [t.segment, t.tab])),
  ...Object.fromEntries(
    NAV_ITEMS.filter((i) => i.to !== '/dashboard' && !i.search).map((i) => [
      i.to.split('/').pop()!,
      i.label,
    ])
  ),
  team: 'Team',
  keys: 'API Keys',
  account: 'Account',
  security: 'Security',
};
