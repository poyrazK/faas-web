import { describe, expect, it } from 'vitest';
import { affectedRows, onlyCsv } from './project-subset';
import type { ProjectPlan } from '@/lib/api/queries';

/**
 * `--exclude` is sugar over `--only`: the wire only knows the include list.
 * Excluding nothing sends nothing (so the server's default applies), and
 * excluding everything sends an empty string, which the server rejects — the
 * UI must block that before it gets here.
 */
describe('onlyCsv', () => {
  it('returns undefined when nothing is excluded', () => {
    expect(onlyCsv(['api', 'worker'], new Set())).toBeUndefined();
  });
  it('lists the survivors in scan order', () => {
    expect(onlyCsv(['api', 'worker', 'cron'], new Set(['worker']))).toBe('api,cron');
  });
});

describe('affectedRows', () => {
  it('flattens the three buckets, deploy first, with the moved-root note', () => {
    const plan = {
      will_deploy: [{ slug: 'api', action: 'update', existing_root_dir: 'services/api-old' }],
      unaffected: [{ slug: 'web', action: 'noop' }],
      skipped: [{ slug: 'worker', action: 'remove' }],
    } as unknown as ProjectPlan;
    expect(affectedRows(plan)).toEqual([
      { slug: 'api', action: 'update', bucket: 'deploy', note: 'root was services/api-old' },
      { slug: 'web', action: 'noop', bucket: 'unaffected', note: undefined },
      { slug: 'worker', action: 'remove', bucket: 'skipped', note: undefined },
    ]);
  });
  it('handles a plan without the affected buckets', () => {
    expect(affectedRows({} as unknown as ProjectPlan)).toEqual([]);
  });
});
