import { describe, expect, it } from 'vitest';
import type { App } from '@/lib/api/queries';
import { HOOK_NAMES, hookWaitWords, hooksSentence, warmSentence } from './snapshot-words';

const app = (fields: Record<string, unknown>) => ({ slug: 'api', ...fields }) as unknown as App;

describe('warmSentence', () => {
  it('says how many copies wait paused, and whether warm snapshots are on', () => {
    expect(warmSentence(app({ warm_pool_size: 1, warm_snapshot_enabled: true }))).toBe(
      '1 copy is kept paused, ready to wake. Warm snapshots are on.'
    );
    expect(warmSentence(app({ warm_pool_size: 3, warm_snapshot_enabled: false }))).toBe(
      '3 copies are kept paused, ready to wake. Warm snapshots are off.'
    );
  });

  it('says no copies when the pool is off or unreported, never a guessed number', () => {
    expect(warmSentence(app({}))).toBe('No copies are kept paused. Warm snapshots are off.');
    expect(warmSentence(app({ warm_pool_size: 0, warm_snapshot_enabled: true }))).toBe(
      'No copies are kept paused. Warm snapshots are on.'
    );
  });

  it('says warm snapshots are not taken while a before-snapshot hook is set', () => {
    expect(
      warmSentence(
        app({ warm_snapshot_enabled: true, manifest: { before_checkpoint: { path: '/flush' } } })
      )
    ).toBe(
      'No copies are kept paused. Warm snapshots are on, but none are taken while a before-snapshot hook is set.'
    );
  });
});

describe('hooksSentence', () => {
  it('names the path that runs after a restore, and says when nothing runs before', () => {
    expect(hooksSentence({ after_restore: { path: '/internal/after-restore' } })).toBe(
      'After a restore, Gregale calls /internal/after-restore before sending traffic. Nothing runs before a snapshot.'
    );
  });

  it('covers a before-snapshot hook alone, both hooks, and none', () => {
    expect(hooksSentence({ before_checkpoint: { path: '/flush' } })).toBe(
      'Before a snapshot, Gregale calls /flush. Nothing runs after a restore.'
    );
    expect(
      hooksSentence({ after_restore: { path: '/up' }, before_checkpoint: { path: '/down' } })
    ).toBe(
      'After a restore, Gregale calls /up before sending traffic. Before a snapshot, it calls /down.'
    );
    expect(hooksSentence(undefined)).toBe(
      'No hooks are set, so Gregale takes and restores snapshots without calling your app.'
    );
    // A cleared hook comes back as an empty object.
    expect(hooksSentence({ after_restore: {} })).toMatch(/^No hooks are set/);
  });

  it('gives each hook a plain name', () => {
    expect(HOOK_NAMES.after_restore).toBe('After waking from a snapshot');
    expect(HOOK_NAMES.before_checkpoint).toBe('Before taking a snapshot');
  });
});

describe('hookWaitWords', () => {
  it('says the timeout exactly, or the default when none is set', () => {
    expect(hookWaitWords(1500)).toBe('waits up to 1,500 ms');
    expect(hookWaitWords(undefined)).toBe('waits up to 500 ms (the default)');
  });
});
