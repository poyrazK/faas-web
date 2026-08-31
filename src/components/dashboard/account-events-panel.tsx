import { useState } from 'react';
import { Panel } from '@/components/dashboard/primitives';
import { Pill } from '@/components/dashboard/resource-table';
import { useAccountEvents } from '@/lib/account-events';

const STATE_COLOR: Record<string, string | undefined> = {
  completed: 'var(--status-good)',
  running: 'var(--status-warning)',
  queued: undefined,
  failed: 'var(--status-critical)',
};

/**
 * `gregale tail`: one line per invocation state change, across every app the
 * account owns. The filter is client-side, exactly as the CLI's `--app` is.
 */
export function AccountEventsPanel() {
  const { events, status } = useAccountEvents();
  const [filter, setFilter] = useState('');
  const shown = filter.trim()
    ? events.filter((e) => e.app_slug.includes(filter.trim()) || e.app_id === filter.trim())
    : events;

  return (
    <Panel
      title="Account activity"
      description="Every invocation state change, newest first. Held open like the CLI's tail."
      actions={
        <span className="flex items-center gap-3">
          <input
            aria-label="Filter by app"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by app…"
            className="h-8 rounded-md border border-border bg-background px-2 font-mono text-xs outline-none focus:border-brand/50"
          />
          <Pill
            label={status}
            color={
              status === 'streaming'
                ? 'var(--status-good)'
                : status === 'error'
                  ? 'var(--status-critical)'
                  : 'var(--status-warning)'
            }
          />
        </span>
      }
    >
      {shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Waiting for the first event…
        </p>
      ) : (
        <ul className="flex max-h-[32rem] flex-col divide-y divide-border overflow-y-auto">
          {shown.map((e) => (
            <li
              key={`${e.invocation_id}-${e.state}-${e.receivedAt}`}
              className="flex items-center gap-3 py-1.5 font-mono text-xs"
            >
              <span className="w-20 shrink-0 text-muted-foreground">
                {new Date(e.receivedAt).toLocaleTimeString()}
              </span>
              <span className="w-36 shrink-0 truncate">{e.app_slug || e.app_id.slice(0, 8)}</span>
              <Pill label={e.state || '—'} color={STATE_COLOR[e.state]} />
              <span className="truncate text-muted-foreground">{e.invocation_id}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
