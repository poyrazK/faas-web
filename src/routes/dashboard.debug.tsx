import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '@/components/dashboard/primitives';
import { AppScope, AppSelect, useSelectedApp } from '@/components/dashboard/app-select';
import { DebugBody } from '@/components/dashboard/debug-body';
import { validateDebugSearch } from '@/components/dashboard/debug-search';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/debug')({
  component: DebugPage,
  validateSearch: validateDebugSearch,
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
        description="What happened, what the evidence explains, and what to inspect next."
        actions={
          <AppSelect
            slug={slug}
            onSelect={select}
            apps={!available && slug ? [{ slug }, ...appState.apps] : appState.apps}
          />
        }
      />
      <AppScope state={appState} resource="request telemetry">
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
          <p className="text-sm text-muted-foreground">
            The selected app is unavailable. Select an app to investigate its requests.
          </p>
        )}
      </AppScope>
    </div>
  );
}
