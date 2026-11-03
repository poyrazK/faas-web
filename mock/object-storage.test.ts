import { afterEach, describe, expect, it, vi } from 'vitest';
import * as storage from './object-storage';

const bucket = (name: string) => ({ id: `${name}-${Math.random()}`, name });

afterEach(() => vi.useRealTimers());

describe('versioning in the mock', () => {
  it('walks a change through apid states and refuses the opposite target meanwhile', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const b = bucket('media');
    expect(storage.readVersioning(b)).toMatchObject({ observed_status: '', state: 'ready' });
    expect(storage.requestVersioning(b, 'Enabled', false)).toMatchObject({
      desired_status: 'Enabled',
      state: 'waiting',
      revision: 1,
    });
    expect(() => storage.requestVersioning(b, 'Suspended', false)).toThrow(
      expect.objectContaining({ status: 409, code: 'object_storage_conflict' })
    );
    vi.advanceTimersByTime(3_500);
    expect(storage.readVersioning(b).state).toBe('propagating');
    vi.advanceTimersByTime(6_000);
    expect(storage.readVersioning(b)).toMatchObject({ observed_status: 'Enabled', state: 'ready' });
  });

  it('keeps Object Lock buckets versioned', () => {
    const b = bucket('assets');
    expect(() => storage.requestVersioning(b, 'Suspended', true)).toThrow(
      expect.objectContaining({ code: 'object_storage_conflict' })
    );
  });
});

describe('versions in the mock', () => {
  it('keeps a delete marker on a versioned delete, and removing it undeletes', () => {
    const b = bucket('assets');
    const where = `app/${b.id}`;
    storage.ensureVersions(where, b, [
      { key: 'notes.txt', size_bytes: 3, last_modified: '2026-10-01T00:00:00Z' },
    ]);
    storage.recordDelete(where, b, 'notes.txt');
    const page = storage.listVersions(where, new URLSearchParams({ prefix: 'notes' }));
    const [marker, data] = page.items;
    expect(marker).toMatchObject({ key: 'notes.txt', delete_marker: true, is_latest: true });
    expect(data).toMatchObject({ delete_marker: false, is_latest: false });
    const { result, current } = storage.deleteVersion(where, 'notes.txt', marker.version_id);
    expect(result).toEqual({ version_id: marker.version_id, delete_marker: true });
    expect(current).toMatchObject({ key: 'notes.txt', size_bytes: 3 });
  });

  it('groups deeper keys under the delimiter and pages with both markers', () => {
    const b = bucket('plain');
    const where = `app/${b.id}`;
    storage.ensureVersions(where, b, [
      { key: 'a.txt', size_bytes: 1, last_modified: '2026-10-01T00:00:00Z' },
      { key: 'b.txt', size_bytes: 1, last_modified: '2026-10-01T00:00:00Z' },
      { key: 'dir/c.txt', size_bytes: 1, last_modified: '2026-10-01T00:00:00Z' },
    ]);
    const first = storage.listVersions(where, new URLSearchParams({ delimiter: '/', limit: '1' }));
    expect(first.common_prefixes).toEqual(['dir/']);
    expect(first.items.map((v) => v.key)).toEqual(['a.txt']);
    expect(first.items[0].version_id).toBe('null');
    const second = storage.listVersions(
      where,
      new URLSearchParams({
        delimiter: '/',
        limit: '1',
        key_marker: first.next_key_marker!,
        version_id_marker: first.next_version_id_marker!,
      })
    );
    expect(second.items.map((v) => v.key)).toEqual(['b.txt']);
  });
});

describe('lifecycle in the mock', () => {
  it('replaces the policy, names unnamed rules, and refuses what apid refuses', () => {
    const b = bucket('plain');
    const saved = storage.writeLifecycle(b, {
      rules: [{ status: 'Enabled', expiration: { days: 7 } }],
    });
    expect(saved.revision).toBe(1);
    expect(saved.rules[0].id).toMatch(/^rule-1-/);
    expect(() =>
      storage.writeLifecycle(b, {
        rules: [
          { status: 'Enabled', filter: { tags: { a: 'b' } }, abort_incomplete_multipart_days: 1 },
        ],
      })
    ).toThrow(expect.objectContaining({ status: 400, code: 'object_storage_invalid' }));
    expect(storage.clearLifecycle(b)).toMatchObject({ rules: [], revision: 2 });
  });
});
