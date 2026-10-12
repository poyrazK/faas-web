import { useCallback, useEffect, useRef, useState } from 'react';
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
 * blinks. Finishing, live or failed, also refreshes the app list.
 * A failed launch keeps its seed, so a reload still shows the failure.
 */
export function useLaunches() {
  const [seeds, setSeeds] = useState(read);
  const [launches, setLaunches] = useState<Record<string, LaunchState>>({});
  const qc = useQueryClient();
  // The stage each launch last reported, so a finish refreshes once, not on
  // every later report (a late log line on a failed build).
  const stages = useRef(new Map<string, LaunchState['stage']>());

  useEffect(() => write(seeds), [seeds]);

  const seed = useCallback((s: LaunchSeed) => setSeeds((m) => ({ ...m, [s.slug]: s })), []);
  const onChange = useCallback(
    (state: LaunchState) => {
      setLaunches((m) => ({ ...m, [state.slug]: state }));
      const was = stages.current.get(state.slug);
      stages.current.set(state.slug, state.stage);
      // A finished deploy changed the app's status: reread it, or the
      // inspector and the node fall back to one read mid-build.
      if (state.stage !== was && (state.stage === 'live' || state.stage === 'failed'))
        void qc.invalidateQueries({ queryKey: keys.apps });
      if (state.stage !== 'live') return;
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
