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
  exact?: boolean;
  search?: Record<string, string>;
}

export interface NavGroup {
  /** Undefined for the ungrouped lead item. */
  title?: string;
  items: NavItem[];
}

export interface NavHub extends NavItem {
  sections?: NavItem[];
  /** Page tabs own navigation; section destinations still support search and legacy URLs. */
  pageOwnsNavigation?: boolean;
}

/** Existing pages anchor each hub until its feature composition is ready. */
export const NAV_HUBS: NavHub[] = [
  { to: '/dashboard', label: 'Overview', icon: ViewGrid, exact: true },
  {
    to: '/dashboard/workflows',
    label: 'Apps',
    icon: WorkflowIcon,
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
    pageOwnsNavigation: true,
    sections: [
      { to: '/dashboard/deployments', label: 'Deployments', icon: Rocket },
      { to: '/dashboard/builds', label: 'Builds', icon: Package },
    ],
  },
  { to: '/dashboard/workers', label: 'Instances', icon: Server },
  { to: '/dashboard/domains', label: 'Domains', icon: Globe },
  {
    to: '/dashboard/storage',
    label: 'Data',
    icon: HardDrive,
    sections: [
      { to: '/dashboard/storage', label: 'Storage', icon: HardDrive },
      { to: '/dashboard/postgres', label: 'Postgres', icon: Database },
    ],
  },
  {
    to: '/dashboard/debug',
    label: 'Observe',
    icon: Search,
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

export const NAV_GROUPS: NavGroup[] = [{ items: NAV_HUBS }];

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
