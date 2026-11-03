import type { CapabilityAccess } from '@/lib/capability-state';

/**
 * The app page's sections, grouped as the rail shows them while the app is
 * open (`app-rail.tsx`). The group is a heading, the section a row; the
 * section lives in `?tab=`.
 */
export const APP_TAB_GROUPS = [
  { label: 'Overview', tabs: ['Overview'] },
  { label: 'Delivery', tabs: ['Deployments', 'Activity'] },
  {
    label: 'Observe',
    tabs: [
      'Metrics',
      'Wakes',
      'Logs',
      'Log drains',
      'Errors',
      'Issues',
      'Alerts',
      'Debugger',
      'Request audit',
    ],
  },
  {
    label: 'Connect',
    tabs: [
      'Routes',
      'Upstreams',
      'Outbound',
      'Services',
      'MCP',
      'Edge rules',
      'Edge protection',
      'Mirrors',
      'Tenant surfaces',
      'OpenAPI',
    ],
  },
  // Who pays for this API, and how much: consumers with their keys, plans and
  // statements. Not under Connect — that group is how traffic reaches the app,
  // this one is the commercial relationship with whoever sends it.
  { label: 'Monetize', tabs: ['Consumers', 'Consumer plans'] },
  { label: 'Automate', tabs: ['Automations', 'Workflows', 'Queues', 'Webhooks'] },
  // Configuration was one 16-panel page; it is four screens now.
  {
    label: 'Configure',
    tabs: ['Environment', 'General', 'Runtime', 'Health and releases', 'Source and access'],
  },
] as const;
export type AppTab = (typeof APP_TAB_GROUPS)[number]['tabs'][number];
type AppTabGroup = (typeof APP_TAB_GROUPS)[number];
export const APP_DETAIL_TABS: readonly AppTab[] = APP_TAB_GROUPS.flatMap((g) => [...g.tabs]);

/** Catalog ids (faas pkg/productcap/catalog.json) for tabs whose routes apid can gate off. */
export const APP_TAB_CAPABILITY: Partial<Record<AppTab, string>> = {
  'Log drains': 'log-drains',
  Routes: 'route-insights',
  Upstreams: 'data-upstreams',
  Mirrors: 'traffic-mirroring',
  'Tenant surfaces': 'tenant-surfaces',
  Debugger: 'production-debugger',
  Issues: 'issues',
  Errors: 'issues',
  MCP: 'mcp-hosting',
  OpenAPI: 'openapi-contract-preview',
  Consumers: 'api-consumers',
  'Consumer plans': 'api-monetization',
  Automations: 'automations',
  Workflows: 'workflows',
  Queues: 'queues',
  'Edge protection': 'edge-protection',
  Outbound: 'outbound-integrations',
};

/** Hide a tab only once the registry has said its capability is off. */
export function visibleAppTabs(access: (id: string) => CapabilityAccess): AppTab[] {
  return APP_DETAIL_TABS.filter((tab) => {
    const id = APP_TAB_CAPABILITY[tab];
    return !id || access(id) !== 'off';
  });
}

/**
 * Tabs that were merged away. Env vars and secrets are one question — what
 * does this app's environment contain — so they are one page now; links that
 * still name either land on it. Invoke is a header action on Overview now
 * (`?invoke=1`), and Configuration's first screen is General.
 */
const LEGACY_APP_TABS: Record<string, AppTab> = {
  Secrets: 'Environment',
  'Env vars': 'Environment',
  Invoke: 'Overview',
  Configuration: 'General',
};

/** The tab a `?tab=` value names, including retired names; undefined if none. */
export function resolveAppTab(value: unknown): AppTab | undefined {
  if (typeof value !== 'string') return undefined;
  if ((APP_DETAIL_TABS as readonly string[]).includes(value)) return value as AppTab;
  return LEGACY_APP_TABS[value];
}

export function appTabGroup(tab: AppTab): AppTabGroup {
  return APP_TAB_GROUPS.find((g) => (g.tabs as readonly string[]).includes(tab))!;
}
