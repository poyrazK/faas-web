import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { keys } from '@/lib/api/queries';
import type { LaunchState } from './launch';
import type { LaunchSeed } from './wizard/wizard';

const KEY = 'gregale.canvas.launches';

function read(): Record<string, LaunchSeed> {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? '{}');
    return value && typeof value === 'object' ? (value as Record<string, LaunchSeed>) : {};
  } catch {
    return {};
  }
}

function write(seeds: Record<string, LaunchSeed>) {
  try {
    if (Object.keys(seeds).length) sessionStorage.setItem(KEY, JSON.stringify(seeds));
    else sessionStorage.removeItem(KEY);
  } catch {
    // Storage is a convenience: without it a reload drops the rail, nothing else.
  }
}

/**
 * The first deploys the canvas is watching. Seeds (what was submitted) live in
 * session storage so a reload mid-build keeps the rail; the tracker recovers
 * the deployment itself from the app's latest one. A seed is dropped once its
 * launch is live, and its last state stays so the node settles rather than
 * blinks. Going live also refreshes the app list, or the node would fall back
 * to an app status read before the deploy finished.
 */
export function useLaunches() {
  const [seeds, setSeeds] = useState(read);
  const [launches, setLaunches] = useState<Record<string, LaunchState>>({});
  const qc = useQueryClient();

  useEffect(() => write(seeds), [seeds]);

  const seed = useCallback((s: LaunchSeed) => setSeeds((m) => ({ ...m, [s.slug]: s })), []);
  const onChange = useCallback(
    (state: LaunchState) => {
      setLaunches((m) => ({ ...m, [state.slug]: state }));
      if (state.stage !== 'live') return;
      void qc.invalidateQueries({ queryKey: keys.apps });
      setSeeds((m) => {
        if (!(state.slug in m)) return m;
        const rest = { ...m };
        delete rest[state.slug];
        return rest;
      });
    },
    [qc]
  );

  return { seeds, launches, seed, onChange };
}
