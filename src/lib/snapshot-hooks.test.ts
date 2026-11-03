import { describe, expect, it } from 'vitest';
import type { App } from '@/lib/api/queries';
import {
  hookChange,
  hookDraft,
  hookErrors,
  hooksApply,
  hooksYaml,
  type HookDraft,
} from './snapshot-hooks';

const app = (manifest: object) => ({ slug: 'a', manifest }) as unknown as App;
const draft = (path: string, timeout_ms = ''): HookDraft => ({ path, timeout_ms });

describe('snapshot hooks', () => {
  it('reads the stored hooks, with an unset timeout left empty for the 500 ms default', () => {
    const a = app({
      entrypoint: ['x'],
      after_restore: { path: '/internal/after-restore', timeout_ms: 1500 },
      before_checkpoint: { path: '/internal/before-checkpoint' },
    });
    expect(hookDraft(a, 'after_restore')).toEqual(draft('/internal/after-restore', '1500'));
    expect(hookDraft(a, 'before_checkpoint')).toEqual(draft('/internal/before-checkpoint'));
    expect(hookDraft(app({ entrypoint: ['x'] }), 'after_restore')).toEqual(draft(''));
  });

  it('refuses the paths and timeouts apid refuses (appmanifest.go validateLifecycleHook)', () => {
    for (const bad of ['internal/x', '//evil', '/x?y=1', '/x#y', '/x%20y', '/x\ty']) {
      expect(hookErrors(draft(bad)).path, bad).toBeDefined();
    }
    expect(hookErrors(draft('/internal/after-restore'))).toEqual({});
    for (const bad of ['-1', '2001', '1.5', 'abc']) {
      expect(hookErrors(draft('/x', bad)).timeout_ms, bad).toBeDefined();
    }
    expect(hookErrors(draft('/x', '0'))).toEqual({});
    expect(hookErrors(draft('/x', '2000'))).toEqual({});
    // A timeout alone is not a hook: apid would store a hook with no path.
    expect(hookErrors(draft('', '500')).path).toMatch(/path/i);
  });

  it('sends nothing unchanged, the hook when set, and {} to clear it', () => {
    const base = draft('/a', '800');
    expect(hookChange(base, draft('/a', '800'))).toBeUndefined();
    expect(hookChange(base, draft('/b', '800'))).toEqual({ path: '/b', timeout_ms: 800 });
    // An empty timeout is apid's default; it is left out rather than pinned.
    expect(hookChange(base, draft('/a'))).toEqual({ path: '/a' });
    expect(hookChange(base, draft(''))).toEqual({});
    expect(hookChange(draft(''), draft(''))).toBeUndefined();
  });

  it('applies only to request and service apps', () => {
    expect(hooksApply(app({ entrypoint: ['x'] }))).toBe(true);
    expect(hooksApply(app({ entrypoint: ['x'], execution_mode: 'service' }))).toBe(true);
    expect(hooksApply(app({ entrypoint: ['x'], execution_mode: 'worker' }))).toBe(false);
    expect(hooksApply(app({ entrypoint: ['x'], execution_mode: 'job' }))).toBe(false);
  });

  it('writes the set hooks as a gregale.yaml lifecycle block, and nothing when none is', () => {
    expect(hooksYaml({ after_restore: draft(''), before_checkpoint: draft('') })).toBe('');
    expect(
      hooksYaml({
        after_restore: draft('/internal/after-restore', '500'),
        before_checkpoint: draft('/hooks/flush: now'),
      })
    ).toBe(
      [
        'lifecycle:',
        '  after_restore:',
        '    path: /internal/after-restore',
        '    timeout_ms: 500',
        '  before_checkpoint:',
        '    path: "/hooks/flush: now"',
      ].join('\n')
    );
  });
});
