import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';
const snapshot = () => window.matchMedia(QUERY).matches;
const serverSnapshot = () => true;
function subscribe(notify: () => void) {
  const media = window.matchMedia(QUERY);
  media.addEventListener('change', notify);
  return () => media.removeEventListener('change', notify);
}

/** Motion's installed hook snapshots on mount; console feedback must also
 * stop when the preference changes while the page is open. */
export function useConsoleReducedMotion() {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
