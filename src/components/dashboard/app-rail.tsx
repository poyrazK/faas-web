import { useEffect, useRef, type ComponentType, type SVGProps } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import {
  Antenna,
  ArrowLeft,
  Bell,
  Bug,
  ClockRotateRight,
  Cpu,
  Code,
  Community,
  Copy,
  CreditCard,
  Database,
  DownloadDataWindow,
  FilterList,
  Flash,
  GitFork,
  Globe,
  GraphUp,
  Heart,
  Journal,
  Key,
  Link as LinkIcon,
  List,
  Lock,
  Page,
  Puzzle,
  Rocket,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Terminal,
  ViewGrid,
  WarningTriangle,
} from 'iconoir-react';
import { useAuth } from '@/lib/auth';
import { useProjectMembership } from '@/lib/api/projects';
import { useData } from '@/lib/store';
import { cn } from '@/lib/utils';
import {
  APP_TAB_CAPABILITY,
  APP_TAB_GROUPS,
  resolveAppTab,
  type AppTab,
} from './app-tab-navigation';
import { useCapabilityOff } from './nav-access';

const ICON: Record<AppTab, ComponentType<SVGProps<SVGSVGElement>>> = {
  Overview: ViewGrid,
  Deployments: Rocket,
  Activity: ClockRotateRight,
  Metrics: GraphUp,
  Wakes: Flash,
  Logs: Page,
  'Log drains': DownloadDataWindow,
  Errors: WarningTriangle,
  Issues: Bug,
  Alerts: Bell,
  Debugger: Search,
  'Request audit': Journal,
  Routes: LinkIcon,
  Upstreams: Database,
  Outbound: Send,
  Services: Puzzle,
  MCP: Terminal,
  'Edge rules': FilterList,
  'Edge protection': ShieldCheck,
  Mirrors: Copy,
  'Tenant surfaces': Globe,
  OpenAPI: Code,
  Consumers: Community,
  'Consumer plans': CreditCard,
  Automations: GitFork,
  Workflows: GitFork,
  Queues: List,
  Webhooks: Antenna,
  Environment: Key,
  General: Settings,
  Runtime: Cpu,
  'Health and releases': Heart,
  'Source and access': Lock,
};

const GROUP_COLOR: Record<string, string> = {
  Overview: 'text-brand/80',
  Delivery: 'text-cat-compute/80',
  Observe: 'text-cat-security/80',
  Connect: 'text-cat-network/80',
  Monetize: 'text-cat-network/80',
  Automate: 'text-cat-compute/80',
  Configure: 'text-cat-storage/80',
};

/** The app a pathname is inside, or undefined off an app page. */
export function appOfPath(pathname: string): string | undefined {
  const match = /^\/dashboard\/apps\/([^/]+)\/?$/.exec(pathname);
  return match && match[1] !== 'new' ? decodeURIComponent(match[1]) : undefined;
}

/**
 * The rail while an app is open: that app's sections, grouped.
 *
 * Per-app resources used to be two strips of tabs above the page; here they
 * read like every other destination in the console, and the page below
 * starts with its content. The section lives in `?tab=`, as before.
 */
export function AppRail({
  slug,
  collapsed,
  labelCls,
  onNavigate,
}: {
  slug: string;
  collapsed: boolean;
  labelCls: string;
  onNavigate?: () => void;
}) {
  const search = useRouterState({ select: (s) => s.location.search as { tab?: unknown } });
  const navRef = useRef<HTMLElement>(null);
  const current = resolveAppTab(search.tab) ?? 'Overview';
  const isOff = useCapabilityOff();
  const { workflows } = useData();
  const { account } = useAuth();
  const project = useProjectMembership(account?.id ?? '').projectOfApp.get(slug);
  const shown = (tab: AppTab) => {
    const id = APP_TAB_CAPABILITY[tab];
    return tab === current || !id || !isOff(id);
  };
  const groups = APP_TAB_GROUPS.map((group) => ({
    ...group,
    tabs: (group.tabs as readonly AppTab[]).filter(shown),
  })).filter((group) => group.tabs.length > 0);

  const sections = groups.flatMap((group) => group.tabs).join('|');
  useEffect(() => {
    // The router restores scrolling after navigation. Reveal the destination
    // after that restoration and the rail's layout, without scrolling the page.
    let layoutFrame = 0;
    const frame = requestAnimationFrame(() => {
      layoutFrame = requestAnimationFrame(() => {
        const nav = navRef.current;
        const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
        if (!nav || !active) return;
        const bounds = nav.getBoundingClientRect();
        const row = active.getBoundingClientRect();
        if (row.top < bounds.top || row.bottom > bounds.bottom) {
          nav.scrollTop += row.top - bounds.top - nav.clientHeight / 2 + row.height / 2;
        }
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(layoutFrame);
    };
  }, [current, slug, collapsed, sections]);

  return (
    <nav
      ref={navRef}
      aria-label="App"
      className="scrollbar-none mt-3 flex min-h-0 flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto"
    >
      <div className="flex flex-col gap-px">
        {project ? (
          <Link
            to="/dashboard/projects/$projectSlug"
            params={{ projectSlug: project }}
            onClick={onNavigate}
            aria-label={collapsed ? `Back to ${project}` : undefined}
            className="pressable flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4 shrink-0" />
            <span className={labelCls}>{project}</span>
          </Link>
        ) : (
          <Link
            to="/dashboard/projects"
            onClick={onNavigate}
            aria-label={collapsed ? 'Back to projects' : undefined}
            className="pressable flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4 shrink-0" />
            <span className={labelCls}>Projects</span>
          </Link>
        )}
        <p
          className={cn('truncate px-2.5 pt-2 font-mono text-sm font-medium', labelCls)}
          title={slug}
        >
          {workflows.find((w) => w.id === slug)?.name ?? slug}
        </p>
      </div>
      {groups.map((group) => (
        <div key={group.label}>
          {group.label !== 'Overview' && (
            <p
              className={cn(
                'h-6 px-2.5 pt-1.5 text-xs font-medium text-muted-foreground/70',
                labelCls
              )}
            >
              {group.label}
            </p>
          )}
          <ul className="flex flex-col gap-px">
            {group.tabs.map((tab) => {
              const Icon = ICON[tab];
              const active = tab === current;
              return (
                <li key={tab}>
                  <Link
                    to="/dashboard/apps/$appSlug"
                    params={{ appSlug: slug }}
                    search={(prev: Record<string, unknown>) => ({
                      ...prev,
                      tab: tab === 'Overview' ? undefined : tab,
                    })}
                    activeOptions={{ exact: true, includeSearch: true }}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    aria-label={collapsed ? tab : undefined}
                    title={collapsed ? tab : undefined}
                    className={cn(
                      'pressable flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
                      active
                        ? 'bg-muted font-medium text-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                  >
                    <Icon
                      aria-hidden="true"
                      className={cn(
                        'h-4 w-4 shrink-0',
                        active ? 'text-brand' : GROUP_COLOR[group.label]
                      )}
                    />
                    <span className={labelCls}>{tab}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
