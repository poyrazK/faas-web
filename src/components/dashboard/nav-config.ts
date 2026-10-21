import type { ComponentType, SVGProps } from 'react';
import { SETTINGS_SECTIONS } from './settings-search';
import {
  Activity,
  Antenna,
  Coins,
  DataTransferBoth,
  Database,
  FilterList,
  Folder,
  CreditCard,
  Community,
  Cube,
  GitFork as WorkflowIcon,
  Github,
  Globe,
  GraphUp,
  Group,
  HardDrive,
  Journal,
  Key,
  Network,
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
    // Projects are the way in: apps live inside them (standalone apps are a
    // group on the Projects page), so there is no separate Apps row. The app
    // list, app pages and standalone per-app pages light this row. Templates
    // and Import used to nest here; both redirect into the New app wizard, so
    // they live in PALETTE_ONLY rather than as rows that are never current.
    to: '/dashboard/projects',
    label: 'Projects',
    icon: Folder,
    sidebarIconClassName: 'text-cat-compute/80',
  },
  {
    // Not in the rail. Kept as a hub so `/dashboard/apps` keeps its title,
    // breadcrumb and ⌘K entry.
    to: '/dashboard/apps',
    label: 'Apps',
    icon: WorkflowIcon,
    sidebarIconClassName: 'text-cat-compute/80',
  },
  {
    to: '/dashboard/releases',
    label: 'Releases',
    icon: Rocket,
    sidebarIconClassName: 'text-cat-compute/80',
    pageOwnsNavigation: true,
    sections: [
      { to: '/dashboard/releases', label: 'Deployments', icon: Rocket },
      { to: '/dashboard/builds', label: 'Builds', icon: Package },
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
      {
        to: '/dashboard/jobs',
        label: 'Automations',
        icon: WorkflowIcon,
        search: { section: 'automations' },
      },
      { to: '/dashboard/crons', label: 'Cron Jobs', icon: Timer },
      { to: '/dashboard/triggers', label: 'Triggers', icon: Antenna },
    ],
  },
  {
    // The microVMs that run apps: compute you can see, not a way of watching it.
    to: '/dashboard/instances',
    label: 'Instances',
    icon: Server,
    sidebarIconClassName: 'text-cat-compute/80',
  },
  {
    // Not "Storage": the heading above already says that word. The page also
    // carries the app-capacity meter, and its description says so.
    to: '/dashboard/storage',
    label: 'Object storage',
    icon: HardDrive,
    sidebarIconClassName: 'text-cat-storage/80',
  },
  {
    to: '/dashboard/postgres',
    label: 'Postgres',
    icon: Database,
    sidebarIconClassName: 'text-cat-storage/80',
  },
  {
    to: '/dashboard/domains',
    label: 'Domains',
    icon: Globe,
    sidebarIconClassName: 'text-cat-network/80',
  },
  {
    // The account view: every app's rules plus CORS presets. The per-app view
    // is the app page's Connect tab. The label matches APP_TABS, so ⌘K and the
    // breadcrumb list the page once.
    to: '/dashboard/edge-rules',
    label: 'Edge rules',
    icon: FilterList,
    sidebarIconClassName: 'text-cat-network/80',
  },
  {
    // Account-wide: the event router has no per-app read for its backlog,
    // storage, or receipts, so this is its own hub rather than an app tab.
    to: '/dashboard/events',
    label: 'Events',
    icon: DataTransferBoth,
    sidebarIconClassName: 'text-cat-network/80',
  },
  {
    // Outbound integrations are account-owned; apps bind to them, but the
    // integration, its credential, and its budget exist once per account.
    to: '/dashboard/integrations',
    label: 'Integrations',
    icon: Network,
    sidebarIconClassName: 'text-cat-network/80',
  },
  {
    // Your end customers across apps (platform tenants). Monetize rather than
    // Account: they are resources you run — consumers, hostnames, prices —
    // not settings of your own Gregale account, and Billing there is what
    // Gregale charges you, not what you charge them.
    to: '/dashboard/customers',
    label: 'Customers',
    icon: Community,
    sidebarIconClassName: 'text-cat-network/80',
  },
  {
    to: '/dashboard/analytics',
    label: 'Analytics',
    icon: GraphUp,
    sidebarIconClassName: 'text-cat-security/80',
  },
  {
    to: '/dashboard/debug',
    label: 'Debugger',
    icon: Search,
    sidebarIconClassName: 'text-cat-security/80',
  },
  {
    to: '/dashboard/invocations',
    label: 'Invocations',
    icon: Activity,
    sidebarIconClassName: 'text-cat-security/80',
  },
  {
    to: '/dashboard/audit',
    label: 'Audit Log',
    icon: Journal,
    sidebarIconClassName: 'text-cat-security/80',
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
 * The sidebar's shape: account-wide destinations, grouped by the kind of
 * resource they manage.
 *
 * People arriving from other clouds look for a thing by its kind, so the
 * headings are resource categories rather than tasks. Only account-wide pages
 * are rows. Per-app resources (logs, secrets, queues, routes and the rest) are
 * tabs on the app page, where the app is already in the URL; listing them here
 * would ask "which app?" once per row. Reasoning and history:
 * docs/superpowers/specs/2026-10-20-sidebar-categories-design.md.
 *
 * Hubs consolidate pages, not navigation: a hub keeps its sections as nested
 * rows (Billing) unless its page owns them (Jobs, Releases, Settings).
 */
const SIDEBAR_GROUPS: { title?: string; hubs: string[] }[] = [
  { hubs: ['Overview'] },
  { title: 'Compute', hubs: ['Projects', 'Releases', 'Jobs', 'Instances'] },
  { title: 'Storage', hubs: ['Object storage', 'Postgres'] },
  { title: 'Networking', hubs: ['Domains', 'Edge rules'] },
  { title: 'Messaging', hubs: ['Events', 'Integrations'] },
  { title: 'Monetize', hubs: ['Customers'] },
  { title: 'Observe', hubs: ['Analytics', 'Debugger', 'Invocations', 'Audit Log'] },
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
  { tab: 'Routes', segment: 'routes' },
  { tab: 'Secrets', segment: 'secrets' },
  { tab: 'Env vars', segment: 'env' },
  { tab: 'Queues', segment: 'queues' },
  { tab: 'Upstreams', segment: 'upstreams' },
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

/**
 * Destinations ⌘K and the breadcrumb know but the rail does not list. Both
 * redirect into the New app wizard (`?source=template|import`), so a rail row
 * could never be the current page. The New app button is the visible way in.
 */
const PALETTE_ONLY: NavItem[] = [
  { to: '/dashboard/templates', label: 'Templates', icon: Cube },
  { to: '/dashboard/import', label: 'Import', icon: Upload },
];

/** Both hub names and familiar page names remain searchable. */
export const NAV_ITEMS: NavItem[] = [
  ...NAV_HUBS,
  ...NAV_HUBS.flatMap((hub) => hub.sections ?? []),
  ...PALETTE_ONLY,
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
  // Apps live under Projects: the app list, app pages and standalone app
  // sections all light the Projects row. Debugger and Edge rules are rail
  // rows of their own, so they match above, before the app-section fallback.
  const projects = NAV_HUBS.find((item) => item.label === 'Projects');
  if (hub?.label === 'Apps') return projects;
  return (
    hub ?? (APP_SECTIONS.some((item) => matchesNavPath(pathname, item)) ? projects : undefined)
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
  // The Releases page keeps "Deployments" as a searchable section name, but its
  // title is the page's own.
  releases: 'Releases',
  team: 'Team',
  keys: 'API Keys',
  account: 'Account',
  security: 'Security',
};
