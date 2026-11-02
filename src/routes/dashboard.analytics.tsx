import { createFileRoute, redirect } from '@tanstack/react-router';
import {
  AccountAnalytics,
  AnalyticsWindowSelector,
  type AccountAnalyticsSearch,
} from '@/components/dashboard/account-analytics';
import { PageHeader } from '@/components/dashboard/primitives';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/analytics')({
  component: AnalyticsPage,
  head: () => consoleHead('analytics'),
  validateSearch: (
    search: Record<string, unknown>
  ): AccountAnalyticsSearch & { app?: string; wake?: string } => ({
    ...(search.window === '24h' || search.window === '7d' ? { window: search.window } : {}),
    ...(typeof search.app === 'string' && search.app.trim() ? { app: search.app } : {}),
    ...(typeof search.wake === 'string' && search.wake.trim() ? { wake: search.wake } : {}),
  }),
  // One app's analytics moved to its Metrics section; old links follow.
  beforeLoad: ({ search }) => {
    if (search.app)
      throw redirect({
        to: '/dashboard/apps/$appSlug',
        params: { appSlug: search.app },
        search: { tab: 'Metrics', ...(search.wake ? { wake: search.wake } : {}) },
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

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Analytics"
        actions={<AnalyticsWindowSelector search={search} setSearch={setSearch} />}
      />
      <AccountAnalytics search={search} />
    </div>
  );
}
