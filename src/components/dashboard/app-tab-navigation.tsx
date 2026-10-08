import { useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export const APP_TAB_GROUPS = [
  { label: 'Overview', tabs: ['Overview', 'Metrics', 'Invoke'] },
  { label: 'Delivery', tabs: ['Deployments', 'Activity'] },
  { label: 'Observe', tabs: ['Logs', 'Errors', 'Alerts', 'Debugger'] },
  {
    label: 'Connect',
    tabs: ['Routes', 'Upstreams', 'Edge rules', 'Mirrors', 'Tenant surfaces', 'OpenAPI'],
  },
  { label: 'Automate', tabs: ['Automations', 'Queues', 'Webhooks'] },
  { label: 'Configure', tabs: ['Secrets', 'Env vars', 'Configuration'] },
] as const;
export type AppTab = (typeof APP_TAB_GROUPS)[number]['tabs'][number];
export const APP_DETAIL_TABS: readonly AppTab[] = APP_TAB_GROUPS.flatMap((g) => [...g.tabs]);

export function AppTabNavigation({
  tab,
  onSelect,
  panelId,
}: {
  tab: AppTab;
  onSelect: (tab: AppTab) => void;
  panelId: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [remembered, setRemembered] = useState<Partial<Record<string, AppTab>>>({});
  const active = APP_TAB_GROUPS.find((g) => (g.tabs as readonly string[]).includes(tab))!;
  const select = (next: AppTab) => {
    const target = APP_TAB_GROUPS.find((g) => (g.tabs as readonly string[]).includes(next))!;
    setRemembered((current) => ({ ...current, [active.label]: tab, [target.label]: next }));
    onSelect(next);
  };
  return (
    <div className="flex flex-col gap-3">
      <nav
        aria-label="App sections"
        className="flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1"
      >
        {APP_TAB_GROUPS.map((group) => (
          <button
            key={group.label}
            type="button"
            aria-pressed={group === active}
            aria-label={`${group.label} app section`}
            onClick={() => select(remembered[group.label] ?? group.tabs[0])}
            className={cn(
              'pressable rounded-md px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-brand',
              group === active
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {group.label}
          </button>
        ))}
      </nav>
      <div
        role="tablist"
        aria-label={`${active.label} tabs`}
        className="flex flex-wrap gap-1 border-b border-border"
      >
        {active.tabs.map((name, index) => (
          <button
            key={name}
            type="button"
            role="tab"
            id={`${panelId}-tab-${name}`}
            ref={(el) => {
              refs.current[index] = el;
            }}
            aria-selected={tab === name}
            aria-controls={panelId}
            tabIndex={tab === name ? 0 : -1}
            onClick={() => select(name)}
            onKeyDown={(event) => {
              const last = active.tabs.length - 1;
              const next =
                event.key === 'ArrowRight'
                  ? (index + 1) % active.tabs.length
                  : event.key === 'ArrowLeft'
                    ? (index + last) % active.tabs.length
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? last
                        : null;
              if (next === null) return;
              event.preventDefault();
              refs.current[next]?.focus();
              select(active.tabs[next]);
            }}
            className={cn(
              'pressable -mb-px border-b-2 px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-brand',
              tab === name
                ? 'border-brand text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {name}
          </button>
        ))}
      </div>
    </div>
  );
}
