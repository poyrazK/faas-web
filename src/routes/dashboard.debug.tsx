import { createFileRoute, Navigate, redirect } from '@tanstack/react-router';
import { PageHeader } from '@/components/dashboard/primitives';
import { AppScope, AppSelect, useSelectedApp } from '@/components/dashboard/app-select';
import { remembered } from '@/components/dashboard/selected-app';
import { DebugBody } from '@/components/dashboard/debug-body';
import { validateDebugSearch } from '@/components/dashboard/debug-search';
import { WakeDrawer } from '@/components/dashboard/wake-drawer';
import { withCapability } from '@/components/dashboard/capability-gate';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/debug')({
  component: withCapability('debug', 'Debugger', DebugPage),
  validateSearch: validateDebugSearch,
  // Explicit deep links can redirect immediately. A remembered selection
  // must first be checked against the current inventory in DebugPage.
  beforeLoad: ({ search }) => {
    const app = search.app;
    if (!app) return;
    throw redirect({
      to: '/dashboard/apps/$appSlug',
      params: { appSlug: app },
      search: { ...search, app: undefined, tab: 'Debugger' },
      replace: true,
    });
  },
  head: () => consoleHead('debug'),
});

function DebugPage() {
  const appState = useSelectedApp();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const slug = search.app ?? appState.slug;
  const available = appState.apps.some((app) => app.slug === slug);
  const select = (app: string) => {
    appState.select(app);
    void navigate({
      search: (current) => ({
        ...current,
        app,
        request: undefined,
        regression: undefined,
        debugSource: undefined,
        debugMirror: undefined,
        debugRoute: undefined,
      }),
      hash: true,
      resetScroll: false,
    });
  };

  if (!search.app && remembered() && !appState.loadingApps && !appState.appsError && available)
    return (
      <Navigate
        to="/dashboard/apps/$appSlug"
        params={{ appSlug: slug }}
        search={{ ...search, app: undefined, tab: 'Debugger' }}
        hash
        replace
      />
    );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Debugger"
        actions={
          <AppSelect
            slug={slug}
            onSelect={select}
            apps={!available && slug ? [{ slug }, ...appState.apps] : appState.apps}
          />
        }
      />
      <AppScope state={appState} resource="requests">
        {available ? (
          <DebugBody
            slug={slug}
            search={search}
            onSelect={(patch) =>
              void navigate({
                search: (current) => ({ ...current, app: slug, ...patch }),
                hash: true,
                resetScroll: false,
              })
            }
          />
        ) : (
          <p className="text-sm text-muted-foreground">The selected app is unavailable.</p>
        )}
      </AppScope>
      <WakeDrawer
        slug={available ? slug : undefined}
        wakeId={search.wake}
        onClose={() =>
          void navigate({
            search: (current) => ({ ...current, wake: undefined }),
            replace: true,
            hash: true,
            resetScroll: false,
          })
        }
      />
    </div>
  );
}
