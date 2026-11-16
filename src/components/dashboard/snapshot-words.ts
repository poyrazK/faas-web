import type { App } from '@/lib/api/queries';
import type { HookKey } from '@/lib/snapshot-hooks';
import { HOOK_DEFAULT_TIMEOUT_MS } from '@/lib/snapshot-hooks';

/**
 * Warm starts and snapshot hooks in plain words (docs/console-plain-english.md).
 * Every sentence is built from the saved app read, never from a draft: it says
 * what is set now. No timings are claimed that the API does not report.
 */

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The Warm starts panel's opening sentence, from the saved settings. */
export function warmSentence(app: App): string {
  const pool = app.warm_pool_size ?? 0;
  const first =
    pool > 0
      ? `${plural(pool, 'copy is', 'copies are')} kept paused, ready to wake.`
      : 'No copies are kept paused.';
  const blocked = Boolean(app.warm_snapshot_enabled && app.manifest?.before_checkpoint?.path);
  const second = !app.warm_snapshot_enabled
    ? 'Warm snapshots are off.'
    : blocked
      ? 'Warm snapshots are on, but none are taken while a before-snapshot hook is set.'
      : 'Warm snapshots are on.';
  return `${first} ${second}`;
}

/** Each hook's plain name; the exact key stays in a `title`. */
export const HOOK_NAMES: Record<HookKey, string> = {
  after_restore: 'After waking from a snapshot',
  before_checkpoint: 'Before taking a snapshot',
};

/** What each hook is for, shown on a row that has no path yet. */
export const HOOK_USES: Record<HookKey, string> = {
  after_restore: 'Use it to reopen connections before traffic arrives.',
  before_checkpoint: 'Use it to close connections before the app is frozen.',
};

type Hooks = Partial<Record<HookKey, { path?: string } | null | undefined>>;

/** The Snapshot hooks panel's opening sentence, from the saved hooks. */
export function hooksSentence(manifest: Hooks | undefined): string {
  const after = manifest?.after_restore?.path;
  const before = manifest?.before_checkpoint?.path;
  if (after && before)
    return `After a restore, Gregale calls ${after} before sending traffic. Before a snapshot, it calls ${before}.`;
  if (after)
    return `After a restore, Gregale calls ${after} before sending traffic. Nothing runs before a snapshot.`;
  if (before) return `Before a snapshot, Gregale calls ${before}. Nothing runs after a restore.`;
  return 'No hooks are set, so Gregale takes and restores snapshots without calling your app.';
}

/** How long Gregale waits for a hook: 1500 → "waits up to 1,500 ms". */
export function hookWaitWords(timeoutMs: number | undefined): string {
  return timeoutMs
    ? `waits up to ${timeoutMs.toLocaleString('en-US')} ms`
    : `waits up to ${HOOK_DEFAULT_TIMEOUT_MS} ms (the default)`;
}
