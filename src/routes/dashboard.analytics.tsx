import { createFileRoute } from '@tanstack/react-router';
import {
  AccountAnalytics,
  AnalyticsWindowSelector,
  type AccountAnalyticsSearch,
} from '@/components/dashboard/account-analytics';
import { ANALYTICS_GROUPS } from '@/components/dashboard/app-analytics';
import { PageHeader } from '@/components/dashboard/primitives';
import { WakeDrawer } from '@/components/dashboard/wake-drawer';
import { consoleHead } from '@/lib/seo';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

export const Route = createFileRoute('/dashboard/analytics')({
  component: AnalyticsPage,
  head: () => consoleHead('analytics'),
  validateSearch: (search: Record<string, unknown>): AccountAnalyticsSearch => {
    const group = ANALYTICS_GROUPS.find(({ value }) => value === search.group)?.value;
    const method = METHODS.find((value) => value === search.method);
    const route =
      typeof search.route === 'string' && search.route.trim() ? search.route : undefined;
    return {
      ...(typeof search.app === 'string' && search.app.trim() ? { app: search.app } : {}),
      ...(search.window === '24h' || search.window === '7d' ? { window: search.window } : {}),
      ...(typeof search.wake === 'string' && search.wake.trim() ? { wake: search.wake } : {}),
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
      resetScroll: false,
    });
  };

  // Opening pushes, so Back closes the drawer; the app is pinned because the
  // page may be showing a default app that is not in the URL.
  const openWake = (wake: string, app: string) =>
    void navigate({ search: (previous) => ({ ...previous, app, wake }), resetScroll: false });
  const closeWake = () =>
    void navigate({
      search: (previous) => ({ ...previous, wake: undefined }),
      replace: true,
      resetScroll: false,
    });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Analytics"
        description="Account health, app traffic, and request analytics over one window."
        actions={<AnalyticsWindowSelector search={search} setSearch={setSearch} />}
      />
      <AccountAnalytics search={search} setSearch={setSearch} onOpenWake={openWake} />
      <WakeDrawer slug={search.app} wakeId={search.wake} onClose={closeWake} />
    </div>
  );
}
