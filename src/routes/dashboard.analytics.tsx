import { createFileRoute } from '@tanstack/react-router';
import {
  AccountAnalytics,
  AnalyticsWindowSelector,
  type AccountAnalyticsSearch,
} from '@/components/dashboard/account-analytics';
import { PageHeader } from '@/components/dashboard/primitives';
import { consoleHead } from '@/lib/seo';

const GROUPS = ['route', 'country', 'referrer_host', 'ua_family', 'status'] as const;
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

export const Route = createFileRoute('/dashboard/analytics')({
  component: AnalyticsPage,
  head: () => consoleHead('analytics'),
  validateSearch: (search: Record<string, unknown>): AccountAnalyticsSearch => {
    const group = GROUPS.find((value) => value === search.group);
    const method = METHODS.find((value) => value === search.method);
    const route =
      typeof search.route === 'string' && search.route.trim() ? search.route : undefined;
    return {
      ...(typeof search.app === 'string' && search.app.trim() ? { app: search.app } : {}),
      ...(search.window === '24h' || search.window === '7d' ? { window: search.window } : {}),
      ...(group ? { group } : {}),
      ...(route && method && (!group || group === 'route') ? { route, method } : {}),
    };
  },
});

function AnalyticsPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const setSearch: React.Dispatch<React.SetStateAction<AccountAnalyticsSearch>> = (next) => {
    void navigate({
      search: (previous) => (typeof next === 'function' ? next(previous) : next),
      replace: true,
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Analytics"
        description="Account health, app traffic, and request analytics over one window."
        actions={<AnalyticsWindowSelector search={search} setSearch={setSearch} />}
      />
      <AccountAnalytics search={search} setSearch={setSearch} />
    </div>
  );
}
