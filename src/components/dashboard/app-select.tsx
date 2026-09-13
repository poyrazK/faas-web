import { useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { Select as SelectPrimitive } from 'radix-ui';
import { Check, NavArrowDown, Plus } from 'iconoir-react';
import { useApps } from '@/lib/api/queries';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, LoadingState, UnreachableState, queryPhase } from './primitives';

/**
 * Scope picker for the resources the API keys by app.
 *
 * Secrets, env vars, alerts, webhooks, and queues are all
 * `/v1/apps/{slug}/…` — there is no account-wide read for any of them. These
 * pages used to show a flat fixture list, which quietly implied a workspace-wide
 * view that the API cannot answer. Every one of them now picks an app first.
 *
 * The choice is remembered across pages and reloads, so moving between Secrets
 * and Env Vars while debugging one app does not mean re-selecting it each time.
 */

const STORAGE_KEY = 'gregale.selectedApp';

function remembered(): string {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(STORAGE_KEY) ?? '';
}

/**
 * Returns the selected app slug, the setter, and the app list state.
 *
 * `slug` is empty until the apps load. Callers pass it straight to a per-app
 * query, which stays disabled while it is empty rather than firing at
 * `/v1/apps//secrets`.
 */
export function useSelectedApp() {
  const { data: apps, isPending, error, refetch } = useApps();
  const [chosen, setChosen] = useState<string>(remembered);

  // Derived, not synchronised. The default — the remembered app if it still
  // exists, otherwise the first one — falls out of a computation rather than an
  // effect that writes state, so there is no render where the selection is
  // briefly wrong and no cascading re-render to correct it. A remembered app
  // that has since been deleted simply stops matching.
  const list = apps ?? [];
  const slug = list.some((a) => a.slug === chosen) ? chosen : (list[0]?.slug ?? '');

  const select = (next: string) => {
    setChosen(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  };

  return {
    slug,
    select,
    apps: list,
    loadingApps: isPending,
    appsError: error,
    refetchApps: refetch,
  };
}

export type SelectedApp = ReturnType<typeof useSelectedApp>;

/**
 * Gate for a page whose data hangs off one app.
 *
 * Every per-app read is `/v1/apps/{slug}/…` and is gated on having a slug, so
 * with no app the query never runs — and TanStack reports a query that never
 * ran as pending forever. Pages that forwarded that straight through sat on
 * "Loading…" for eternity, and rendered their editors besides, offering to
 * write a secret to nothing.
 *
 * So the app list is resolved first and the page body only exists once there
 * is an app to point it at.
 */
export function AppScope({
  state,
  resource,
  children,
}: {
  state: SelectedApp;
  /** Plural, lowercase — "secrets", "queue jobs". Names what needs an app. */
  resource: string;
  children: ReactNode;
}) {
  const phase = queryPhase({
    error: state.appsError,
    loading: state.loadingApps,
    isEmpty: state.apps.length === 0,
  });

  if (phase === 'unreachable') return <UnreachableState onRetry={() => void state.refetchApps()} />;
  if (phase === 'error')
    return <ErrorState error={state.appsError} onRetry={() => void state.refetchApps()} />;
  if (phase === 'loading') return <LoadingState message="Loading apps…" />;
  if (phase === 'empty')
    return (
      <EmptyState
        message={`${resource[0].toUpperCase()}${resource.slice(1)} belong to an app, and this workspace has none yet.`}
        action={
          <Button asChild size="sm" variant="outline" className="gap-1.5">
            <Link to="/dashboard/workflows/new">
              <Plus className="h-3.5 w-3.5" />
              Create an app
            </Link>
          </Button>
        }
      />
    );

  return <>{children}</>;
}

/**
 * Which app the page is about.
 *
 * A real listbox rather than a native `<select>`. The native popup is themed by
 * the UA, not by us — on the console's near-black it renders as a light OS menu
 * with a system-blue highlight, which is the one control on the page that does
 * not look like the page. Radix keeps the semantics that mattered about the
 * native element (listbox roles, typeahead, arrow keys, Escape) and lets the
 * menu take the surface it sits on.
 *
 * Same props as before, so all fifteen call sites are untouched.
 */
export function AppSelect({
  slug,
  onSelect,
  apps,
  label = 'App',
}: {
  slug: string;
  onSelect: (slug: string) => void;
  apps: { slug: string }[];
  label?: string;
}) {
  // With nothing to choose between, the picker is furniture — and "No apps"
  // in a dropdown is a worse way to say it than the empty state below.
  if (apps.length === 0) return null;

  return (
    <SelectPrimitive.Root value={slug} onValueChange={onSelect}>
      <SelectPrimitive.Trigger
        // The accessible name the console has always used for this control,
        // kept through the change of primitive: the value is announced from the
        // trigger's own content, so the name says what the control is for.
        aria-label={label === 'App' ? 'Select an app' : `Select ${label.toLowerCase()}`}
        className="pressable flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <SelectPrimitive.Value />
        <SelectPrimitive.Icon>
          <NavArrowDown aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          className="z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-border bg-popover shadow-[var(--elevation-3)]"
        >
          <SelectPrimitive.Viewport className="p-1">
            {apps.map((a) => (
              <SelectPrimitive.Item
                key={a.slug}
                value={a.slug}
                className="pressable flex cursor-pointer items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground outline-none select-none data-[highlighted]:bg-muted data-[highlighted]:text-foreground data-[state=checked]:text-foreground"
              >
                <SelectPrimitive.ItemText>{a.slug}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator>
                  <Check aria-hidden="true" className="h-4 w-4 text-brand" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
