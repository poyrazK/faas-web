import { useState } from 'react';
import { useCapabilityRegistry } from '@/lib/api/capabilities';
import { capabilityViewState } from '@/lib/capability-state';
import { capabilityEntrypoint } from '@/lib/capability-entrypoints';
import { CapabilityNotice } from './capability-notice';
import { Panel } from './primitives';

export function PlatformCapabilities() {
  const { query, phase, plan } = useCapabilityRegistry();
  const [search, setSearch] = useState('');
  const entries = (query.data?.capabilities ?? []).filter(
    (entry) =>
      entry.maturity !== 'internal' &&
      `${entry.name} ${entry.category} ${entry.description}`
        .toLowerCase()
        .includes(search.toLowerCase())
  );
  const [limit, setLimit] = useState(10);
  return (
    <Panel
      title="Platform capabilities"
      description="Availability for this account and installation. This is not a runtime health report."
    >
      <div className="flex flex-col gap-4 p-4">
        <label className="text-sm">
          Search capabilities
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setLimit(10);
            }}
            className="mt-2 block h-9 w-full max-w-md rounded-md border border-border bg-background px-3"
          />
        </label>
        {phase !== 'ready' ? (
          <CapabilityNotice
            state={phase === 'error' ? 'registry-error' : 'loading'}
            onRetry={() => void query.refetch()}
          />
        ) : (
          <>
            {!entries.length && (
              <p className="text-sm text-muted-foreground">No matching capabilities.</p>
            )}
            <ul className="divide-y divide-border">
              {entries.slice(0, limit).map((entry) => {
                const state = capabilityViewState(entry, phase, plan);
                const target = capabilityEntrypoint(entry.key);
                return (
                  <li key={entry.key} className="flex flex-col gap-2 py-4">
                    <h3 className="text-sm font-medium">{entry.name}</h3>
                    <p className="max-w-2xl text-sm text-muted-foreground">{entry.description}</p>
                    <CapabilityNotice
                      capability={entry}
                      state={state}
                      onRetry={() => void query.refetch()}
                    />
                    {state === 'available' &&
                      (target.href ? (
                        <a href={target.href} className="w-fit text-sm text-brand underline">
                          {target.label}
                        </a>
                      ) : (
                        <p className="max-w-2xl text-xs text-muted-foreground">
                          {target.instruction}
                        </p>
                      ))}
                  </li>
                );
              })}
            </ul>
            {entries.length > limit && (
              <button
                className="w-fit text-sm text-brand underline"
                onClick={() => setLimit((current) => current + 10)}
              >
                Show more capabilities
              </button>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}
