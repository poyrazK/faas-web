import { useState } from 'react';
import type { CapabilityAccess } from '@/lib/capability-state';
import { SegmentedControl, Tabs, tabId } from './tabs';

/**
 * The app page's pages, in seven groups.
 *
 * The groups are the tabs; a group's pages are a segmented control beneath
 * them, shown only when the group has more than one. It used to be the other
 * way round — the groups as a boxed pill bar and every page as an underline tab
 * — so the strip that changed least looked heaviest, and the eye landed on a
 * row of up to eight peers before it knew which group it was in.
 */
export const APP_TAB_GROUPS = [
  { label: 'Overview', tabs: ['Overview', 'Metrics', 'Invoke'] },
  { label: 'Delivery', tabs: ['Deployments', 'Activity'] },
  { label: 'Observe', tabs: ['Logs', 'Log drains', 'Errors', 'Issues', 'Alerts', 'Debugger'] },
  {
    label: 'Connect',
    tabs: [
      'Routes',
      'Upstreams',
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
  { label: 'Automate', tabs: ['Automations', 'Queues', 'Webhooks'] },
  { label: 'Configure', tabs: ['Environment', 'Configuration'] },
] as const;
export type AppTab = (typeof APP_TAB_GROUPS)[number]['tabs'][number];
type AppTabGroup = (typeof APP_TAB_GROUPS)[number];
type AppTabGroupLabel = AppTabGroup['label'];
export const APP_DETAIL_TABS: readonly AppTab[] = APP_TAB_GROUPS.flatMap((g) => [...g.tabs]);

/** Catalog ids (faas pkg/productcap/catalog.json) for tabs that are not GA or beta. */
export const APP_TAB_CAPABILITY: Partial<Record<AppTab, string>> = {
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
  Queues: 'queues',
  'Edge protection': 'edge-protection',
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
 * still name either land on it.
 */
const LEGACY_APP_TABS: Record<string, AppTab> = {
  Secrets: 'Environment',
  'Env vars': 'Environment',
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

/** The id of the group tab that labels the panel showing `tab`. */
export function appTabPanelLabel(panelId: string, tab: AppTab) {
  return tabId(panelId, appTabGroup(tab).label);
}

export function AppTabNavigation({
  tab,
  onSelect,
  panelId,
  visible = APP_DETAIL_TABS,
}: {
  tab: AppTab;
  onSelect: (tab: AppTab) => void;
  panelId: string;
  /** Tabs the account can use; the selected tab always shows, so a deep link explains itself. */
  visible?: readonly AppTab[];
}) {
  const shown = (name: AppTab) => name === tab || visible.includes(name);
  const groups = APP_TAB_GROUPS.map((group) => ({
    label: group.label,
    tabs: (group.tabs as readonly AppTab[]).filter(shown),
  })).filter((group) => group.tabs.length > 0);
  const [remembered, setRemembered] = useState<Partial<Record<AppTabGroupLabel, AppTab>>>({});
  const active = appTabGroup(tab);
  const select = (next: AppTab) => {
    setRemembered((current) => ({
      ...current,
      [active.label]: tab,
      [appTabGroup(next).label]: next,
    }));
    onSelect(next);
  };
  const activeTabs = groups.find((g) => g.label === active.label)?.tabs ?? [tab];
  const pages = activeTabs.map((name) => ({ key: name, label: name }));
  return (
    <div className="flex flex-col gap-3">
      <Tabs
        label="App sections"
        value={active.label}
        options={groups.map((group) => ({ key: group.label, label: group.label }))}
        onChange={(label) => {
          const group = groups.find((g) => g.label === label)!;
          const last = remembered[group.label];
          select(last && group.tabs.includes(last) ? last : group.tabs[0]);
        }}
        panelId={panelId}
      />
      {pages.length > 1 && (
        <SegmentedControl
          label={`${active.label} pages`}
          value={tab}
          options={pages}
          onChange={select}
        />
      )}
    </div>
  );
}
