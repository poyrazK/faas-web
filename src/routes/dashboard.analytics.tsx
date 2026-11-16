import { createFileRoute, redirect } from '@tanstack/react-router';
import {
  AccountAnalytics,
  AnalyticsWindowSelector,
  type AccountAnalyticsSearch,
} from '@/components/dashboard/account-analytics';
import { validateAppAnalyticsSearch } from '@/components/dashboard/app-analytics-search';
import { PageHeader } from '@/components/dashboard/primitives';
import { useProjectScope } from '@/lib/project-scope';
import { consoleHead } from '@/lib/seo';

/** A link from before one app's analytics moved to its Metrics section. */
type LegacyAppLink = {
  app?: string;
  wake?: string;
  group?: unknown;
  route?: unknown;
  method?: unknown;
};

export const Route = createFileRoute('/dashboard/analytics')({
  component: AnalyticsPage,
  head: () => consoleHead('analytics'),
  validateSearch: (search: Record<string, unknown>): AccountAnalyticsSearch & LegacyAppLink => {
    const window = search.window === '24h' || search.window === '7d' ? search.window : undefined;
    const app = typeof search.app === 'string' && search.app.trim() ? search.app : undefined;
    return {
      ...(window ? { window } : {}),
      ...(typeof search.trendApp === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(search.trendApp)
        ? { trendApp: search.trendApp }
        : {}),
      // The per-app keys only matter long enough to redirect.
      ...(app
        ? {
            app,
            ...(typeof search.wake === 'string' && search.wake.trim() ? { wake: search.wake } : {}),
            ...(search.group !== undefined ? { group: search.group } : {}),
            ...(search.route !== undefined ? { route: search.route } : {}),
            ...(search.method !== undefined ? { method: search.method } : {}),
          }
        : {}),
    };
  },
  // One app's analytics moved to its Metrics section; old links follow, and
  // keep their window, grouping and route filter.
  beforeLoad: ({ search }) => {
    if (!search.app) return;
    throw redirect({
      to: '/dashboard/apps/$appSlug',
      params: { appSlug: search.app },
      search: {
        tab: 'Metrics',
        ...(search.wake ? { wake: search.wake } : {}),
        ...validateAppAnalyticsSearch({
          analyticsSince: search.window,
          analyticsGroup: search.group,
          analyticsRoute: search.route,
          analyticsMethod: search.method,
        }),
      },
      replace: true,
    });
  },
});

function AnalyticsPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const setSearch: React.Dispatch<React.SetStateAction<AccountAnalyticsSearch>> = (next) => {
    void navigate({
      search: (previous) => (typeof next === 'function' ? next(previous) : next),
      replace: true,
      resetScroll: false,
    });
  };

  const scope = useProjectScope();
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={scope.project ? `${scope.label} analytics` : 'Account analytics'}
        actions={<AnalyticsWindowSelector search={search} setSearch={setSearch} />}
      />
      <p className="-mt-2 max-w-3xl text-sm text-muted-foreground">
        Traffic, response times, and the apps contributing to them. Select a metric to explore it
        here.
      </p>
      <AccountAnalytics
        search={search}
        onTrendChange={(trendApp) => setSearch((previous) => ({ ...previous, trendApp }))}
      />
    </div>
  );
}
