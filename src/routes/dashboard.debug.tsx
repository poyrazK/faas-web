import { createFileRoute, redirect } from '@tanstack/react-router';
import { PageHeader } from '@/components/dashboard/primitives';
import { AppScope, AppSelect, remembered, useSelectedApp } from '@/components/dashboard/app-select';
import { DebugBody } from '@/components/dashboard/debug-body';
import { validateDebugSearch } from '@/components/dashboard/debug-search';
import { WakeDrawer } from '@/components/dashboard/wake-drawer';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/debug')({
  component: DebugPage,
  validateSearch: validateDebugSearch,
  // The Debugger is an app's Observe section now. A link that names an app,
  // or an app picked earlier, opens it there with the investigation intact;
  // this page remains only as the picker for someone who has chosen none.
  beforeLoad: ({ search }) => {
    const app = search.app ?? remembered();
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
