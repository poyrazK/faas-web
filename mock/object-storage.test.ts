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

describe('encryption, Object Lock and protection in the mock', () => {
  it('verifies a new encryption default before it applies, and refuses unenrolled keys', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const b = bucket('plain');
    expect(() =>
      storage.requestEncryption(b, { algorithm: 'aws:kms', key_id: 'arn:other' })
    ).toThrow(expect.objectContaining({ code: 'object_storage_invalid' }));
    expect(storage.requestEncryption(b, { algorithm: 'AES256' })).toMatchObject({
      state: 'waiting',
      desired_encryption: { algorithm: 'AES256' },
    });
    expect(() => storage.requestEncryption(b, undefined)).toThrow(
      expect.objectContaining({ code: 'object_storage_conflict' })
    );
    vi.advanceTimersByTime(7_000);
    expect(storage.readEncryption(b)).toMatchObject({
      state: 'ready',
      encryption: { algorithm: 'AES256' },
    });
  });

  it('turns versioning on with Object Lock, and never off again', () => {
    const b = bucket('plain');
    expect(() => storage.requestLock(b, { configuration: { enabled: false } })).toThrow(
      expect.objectContaining({ code: 'object_storage_invalid' })
    );
    expect(storage.requestLock(b, { configuration: { enabled: true } })).toMatchObject({
      enabled_required: true,
      state: 'waiting',
    });
    expect(storage.readVersioning(b).desired_status).toBe('Enabled');
    expect(storage.lockOn(b)).toBe(true);
  });

  it('applies a legal hold through an operation, and a held version cannot be deleted', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const b = bucket('locked');
    const where = `app/${b.id}`;
    storage.requestLock(b, { configuration: { enabled: true } });
    vi.advanceTimersByTime(10_000);
    storage.ensureVersions(where, b, [
      { key: 'a.pdf', size_bytes: 1, last_modified: '2026-10-01T00:00:00Z' },
    ]);
    const [v] = storage.listVersions(where, new URLSearchParams()).items;
    const op = storage.requestLegalHold(where, b, 'a.pdf', v.version_id, {
      id: 'op-1',
      legal_hold: { status: 'ON' },
    });
    expect(op.state).toBe('waiting');
    vi.advanceTimersByTime(4_000);
    expect(storage.readOperation(b, 'op-1').state).toBe('ready');
    expect(storage.readLegalHold(where, 'a.pdf', v.version_id).legal_hold.status).toBe('ON');
    expect(() => storage.deleteVersion(where, 'a.pdf', v.version_id)).toThrow(
      expect.objectContaining({ code: 'object_storage_conflict' })
    );
  });

  it('refuses to shorten active retention', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const b = bucket('locked');
    const where = `app/${b.id}`;
    storage.requestLock(b, { configuration: { enabled: true } });
    storage.ensureVersions(where, b, [
      { key: 'a.pdf', size_bytes: 1, last_modified: '2026-10-01T00:00:00Z' },
    ]);
    const [v] = storage.listVersions(where, new URLSearchParams()).items;
    storage.requestRetention(where, b, 'a.pdf', v.version_id, {
      id: 'r-1',
      retention: { mode: 'GOVERNANCE', retain_until_date: '2099-06-01T00:00:00Z' },
    });
    vi.advanceTimersByTime(4_000);
    expect(() =>
      storage.requestRetention(where, b, 'a.pdf', v.version_id, {
        id: 'r-2',
        retention: { mode: 'GOVERNANCE', retain_until_date: '2099-01-01T00:00:00Z' },
      })
    ).toThrow(expect.objectContaining({ code: 'object_storage_conflict' }));
  });

  it('keeps CORS rules as a set and clears them', () => {
    const b = bucket('plain');
    expect(() =>
      storage.writeCors(b, {
        rules: [{ allowed_origins: ['example.com'], allowed_methods: ['GET'] }],
      })
    ).toThrow(expect.objectContaining({ code: 'object_storage_invalid' }));
    expect(
      storage.writeCors(b, {
        rules: [{ allowed_origins: ['https://app.example.com'], allowed_methods: ['GET'] }],
      }).revision
    ).toBe(1);
    storage.clearCors(b);
    expect(storage.readCors(b).rules).toEqual([]);
  });
});

describe('uploads in parts, routes, notifications and receipts in the mock', () => {
  it('resumes the same upload and completes only with every confirmed part', () => {
    const where = `app/${Math.random()}`;
    const size = storage.MOCK_PART_BYTES + 10;
    const body = { key: 'big.bin', size_bytes: size, content_type: 'application/octet-stream' };
    const first = storage.startSession(where, body, 5 * 1024 ** 3);
    expect(first.status).toBe(201);
    expect(first.body.part_count).toBe(2);
    expect(storage.startSession(where, body, 5 * 1024 ** 3)).toMatchObject({
      status: 200,
      body: { id: first.body.id },
    });
    expect(storage.partSize(where, first.body.id, 2)).toBe(10);
    storage.recordPart(where, first.body.id, 1, storage.MOCK_PART_BYTES, '"a"');
    expect(() =>
      storage.completeSession(where, first.body.id, { parts: [{ part_number: 1, etag: '"a"' }] })
    ).toThrow(expect.objectContaining({ code: 'object_storage_invalid' }));
    storage.recordPart(where, first.body.id, 2, 10, '"b"');
    const done = storage.completeSession(where, first.body.id, {
      parts: [
        { part_number: 1, etag: '"a"' },
        { part_number: 2, etag: '"b"' },
      ],
    });
    expect(done.session.state).toBe('completed');
    expect(done.object).toMatchObject({ key: 'big.bin', size_bytes: size });
    expect(() => storage.abortSession(where, first.body.id)).toThrow(
      expect.objectContaining({ code: 'object_storage_conflict' })
    );
  });

  it('upserts upload routes by name', () => {
    const slug = `app-${Math.random()}`;
    expect(storage.listRoutes(slug).items).toEqual([]);
    expect(storage.saveRoute(slug, { name: 'avatar', bucket_id: 'b', max_bytes: 10 }).status).toBe(
      201
    );
    expect(
      storage.saveRoute(slug, { name: 'avatar', bucket_id: 'b', max_bytes: 10, enabled: false })
    ).toMatchObject({ status: 200, body: { enabled: false } });
    storage.deleteRoute(slug, 'avatar');
    expect(storage.listRoutes(slug).items).toEqual([]);
  });

  it('refuses a destination outside Gregale, and a manual save clears managed ownership', () => {
    const b = bucket('assets');
    const appId = '0b5c3a52-27a4-4b8e-9e3f-0f6c6c2c2a01';
    const seeded = storage.readNotifications(b, appId);
    expect(seeded.managed_rule_ids).toHaveLength(1);
    expect(() =>
      storage.writeNotifications(b, appId, [
        { destination: 'arn:aws:lambda:x', events: ['s3:ObjectCreated:*'] },
      ])
    ).toThrow(expect.objectContaining({ code: 'validation_failed' }));
    const saved = storage.writeNotifications(b, appId, seeded.rules);
    expect(saved.managed_rule_ids).toBeUndefined();
    expect(saved.revision).toBe(seeded.revision + 1);
  });

  it('filters receipts by status', () => {
    const b = bucket('assets');
    expect(storage.listReceipts(b, new URLSearchParams()).items.map((r) => r.status)).toEqual([
      'pending',
    ]);
    expect(storage.listReceipts(b, new URLSearchParams({ status: 'all' })).items).toHaveLength(3);
  });
});
