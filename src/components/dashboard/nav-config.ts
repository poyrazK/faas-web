import type { ComponentType, SVGProps } from 'react';
import {
  Activity,
  Timer,
  CreditCard,
  Globe,
  HardDrive,
  Key,
  Server,
  ViewGrid,
  Package,
  Coins,
  Rocket,
  Journal,
  Settings,
  ShieldCheck,
  Shuffle,
  GraphUp,
  Group,
  GitFork as WorkflowIcon,
} from 'iconoir-react';

/**
 * Grouped sidebar navigation.
 *
 * `to` is typed against the router's generated route ids, so a nav entry
 * cannot point at a route that does not exist.
 */

/** Any Iconoir glyph: they are plain SVG components. */
export type NavIcon = ComponentType<SVGProps<SVGSVGElement>>;

export interface NavItem {
  to: string;
  label: string;
  icon: NavIcon;
  exact?: boolean;
}

export interface NavGroup {
  /** Undefined for the ungrouped lead item. */
  title?: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    items: [{ to: '/dashboard', label: 'Overview', icon: ViewGrid, exact: true }],
  },
  {
    title: 'Build',
    items: [
      { to: '/dashboard/workflows', label: 'Apps', icon: WorkflowIcon },
      { to: '/dashboard/crons', label: 'Cron Jobs', icon: Timer },
      { to: '/dashboard/workers', label: 'Instances', icon: Server },
      { to: '/dashboard/deployments', label: 'Deployments', icon: Rocket },
      { to: '/dashboard/builds', label: 'Builds', icon: Package },
    ],
  },
  {
    title: 'Manage',
    items: [
      { to: '/dashboard/domains', label: 'Domains', icon: Globe },
      { to: '/dashboard/edge-rules', label: 'Edge Rules', icon: Shuffle },
      { to: '/dashboard/storage', label: 'Storage', icon: HardDrive },
    ],
  },
  {
    title: 'Observability',
    items: [
      { to: '/dashboard/traces', label: 'Invocations', icon: Activity },
      { to: '/dashboard/audit', label: 'Audit Log', icon: Journal },
    ],
  },
  {
    title: 'Billing',
    items: [
      { to: '/dashboard/usage', label: 'Usage', icon: GraphUp },
      { to: '/dashboard/invoices', label: 'Invoices', icon: Coins },
      { to: '/dashboard/plans', label: 'Plans', icon: CreditCard },
    ],
  },
  {
    title: 'Account',
    items: [
      { to: '/dashboard/keys', label: 'API Keys', icon: Key },
      { to: '/dashboard/team', label: 'Team', icon: Group },
      { to: '/dashboard/security', label: 'Security', icon: ShieldCheck },
      { to: '/dashboard/settings', label: 'Settings', icon: Settings },
    ],
  },
];

/** Flat lookup for breadcrumbs and the command palette. */
export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

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
  { tab: 'Env', segment: 'env' },
  { tab: 'Queues', segment: 'queues' },
  { tab: 'Upstreams', segment: 'databases' },
  { tab: 'Alerts', segment: 'alerts' },
  { tab: 'Webhooks', segment: 'webhooks' },
  { tab: 'Edge rules', segment: 'edge-rules' },
];

const APP_TAB_LABELS: Record<string, string> = {
  metrics: 'Metrics',
  logs: 'Logs',
  apis: 'APIs',
  secrets: 'Secrets',
  env: 'Env Vars',
  queues: 'Queue Jobs',
  databases: 'Upstreams',
  alerts: 'Alerts',
  webhooks: 'Webhooks',
};

export const SECTION_LABELS: Record<string, string> = {
  ...APP_TAB_LABELS,
  ...Object.fromEntries(
    NAV_ITEMS.filter((i) => i.to !== '/dashboard').map((i) => [i.to.split('/').pop()!, i.label])
  ),
};
