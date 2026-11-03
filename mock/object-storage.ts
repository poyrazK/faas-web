import { randomUUID } from 'node:crypto';
import type { components } from '../src/lib/api/schema';

type S = components['schemas'];
type Status = S['ObjectBucketVersioning']['observed_status'];
type Version = S['ObjectVersion'];
export interface StoredObject {
  key: string;
  size_bytes: number;
  last_modified: string;
}
/** The fields of a bucket this module needs; plugin.ts owns the bucket list. */
export interface BucketRef {
  id: string;
  name: string;
  created_at?: string;
}

/**
 * A refusal in apid's words: plugin.ts turns it into its own Problem, so this
 * module does not depend on the plugin. Codes are apid's `BucketProblem`
 * codes (faas pkg/apid/object/storage.go:197).
 */
export class StorageRefusal extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    detail: string
  ) {
    super(detail);
  }
}

const now = () => new Date().toISOString();
const conflict = (detail: string) => new StorageRefusal(409, 'object_storage_conflict', detail);
const invalid = (detail: string) => new StorageRefusal(400, 'object_storage_invalid', detail);

/* ------------------------------------------------------------------ *
 * Versioning. apid fences writes for at least fifteen minutes while a change
 * drains, propagates and inventories (faas pkg/state/object_bucket_versioning.go);
 * the mock walks the same states in ~9 s, computed from the request's age.
 * ------------------------------------------------------------------ */

const STEP_MS = 3_000;
interface VersioningRecord {
  desired: Status;
  observed: Status;
  revision: number;
  required: boolean;
  requestedAt?: number;
  from?: Status;
  updatedAt: string;
}
const versioning = new Map<string, VersioningRecord>();

function versioningRecord(bucket: BucketRef): VersioningRecord {
  let record = versioning.get(bucket.id);
  if (!record) {
    // The seeded `assets` bucket keeps versions; every other bucket starts off.
    const on = bucket.name === 'assets';
    record = {
      desired: on ? 'Enabled' : '',
      observed: on ? 'Enabled' : '',
      revision: on ? 2 : 0,
      required: on,
      updatedAt: bucket.created_at ?? now(),
    };
    versioning.set(bucket.id, record);
  }
  if (record.requestedAt !== undefined && Date.now() - record.requestedAt >= 3 * STEP_MS) {
    record.observed = record.desired;
    record.requestedAt = undefined;
    record.updatedAt = now();
  }
  return record;
}

export function readVersioning(bucket: BucketRef): S['ObjectBucketVersioning'] {
  const r = versioningRecord(bucket);
  const age = r.requestedAt === undefined ? Infinity : Date.now() - r.requestedAt;
  const state =
    age < STEP_MS
      ? 'waiting'
      : age < 2 * STEP_MS
        ? 'propagating'
        : age < 3 * STEP_MS
          ? 'inventory'
          : 'ready';
  return {
    bucket_id: bucket.id,
    desired_status: r.desired,
    observed_status: state === 'ready' || state === 'inventory' ? r.desired : r.observed,
    state,
    revision: r.revision,
    versions_required: r.required,
    ...(r.requestedAt !== undefined
      ? { propagation_until: new Date(r.requestedAt + 3 * STEP_MS).toISOString() }
      : {}),
    updated_at: r.updatedAt,
  };
}

/** What a write sees now: during a change the bucket behaves as it did before. */
export function versioningStatus(bucket: BucketRef): Status {
  return versioningRecord(bucket).observed;
}

export function requestVersioning(
  bucket: BucketRef,
  status: unknown,
  locked: boolean
): S['ObjectBucketVersioning'] {
  if (status !== 'Enabled' && status !== 'Suspended')
    throw invalid('status must be Enabled or Suspended.');
  const r = versioningRecord(bucket);
  if (r.requestedAt !== undefined) {
    if (r.desired !== status)
      throw conflict('A versioning change is still running; wait for it to be ready.');
    return readVersioning(bucket);
  }
  if (status === 'Suspended' && locked)
    throw conflict('Object Lock keeps versioning on for this bucket.');
  if (r.desired !== status) {
    r.desired = status;
    r.revision += 1;
    r.required = true;
    r.requestedAt = Date.now();
    r.updatedAt = now();
  }
  return readVersioning(bucket);
}

/* ------------------------------------------------------------------ *
 * Versions. The plugin keeps the current listing; this keeps every version
 * and delete marker behind it, seeded from that listing on first use.
 * ------------------------------------------------------------------ */

const versions = new Map<string, Version[]>();
const days = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

/** Seed once from the bucket's current objects, plus some history for `assets`. */
export function ensureVersions(where: string, bucket: BucketRef, current: StoredObject[]) {
  if (versions.has(where)) return;
  const status = versioningStatus(bucket);
  const list: Version[] = current.map((o) => ({
    key: o.key,
    version_id: status ? randomUUID() : 'null',
    is_latest: true,
    delete_marker: false,
    size_bytes: o.size_bytes,
    last_modified: o.last_modified,
  }));
  if (bucket.name === 'assets') {
    const older = (key: string, size: number, age: number): Version => ({
      key,
      version_id: randomUUID(),
      is_latest: false,
      delete_marker: false,
      size_bytes: size,
      last_modified: days(age),
    });
    list.push(
      older('manifest.json', 702, 9),
      older('manifest.json', 655, 15),
      older('robots.txt', 41, 20),
      older('images/banner-2025.png', 118_904, 30),
      {
        key: 'images/banner-2025.png',
        version_id: randomUUID(),
        is_latest: true,
        delete_marker: true,
        size_bytes: 0,
        last_modified: days(3),
      }
    );
  }
  versions.set(where, list);
}

const byKeyThenNewest = (a: Version, b: Version) =>
  a.key === b.key
    ? Number(b.is_latest) - Number(a.is_latest) || b.last_modified.localeCompare(a.last_modified)
    : a.key.localeCompare(b.key);

export function listVersions(where: string, query: URLSearchParams): S['ObjectVersionList'] {
  const prefix = query.get('prefix') ?? '';
  const delimiter = query.get('delimiter') ?? '';
  const limit = Math.max(1, Math.min(1000, Number(query.get('limit') ?? 1000) || 1000));
  const keyMarker = query.get('key_marker');
  const versionMarker = query.get('version_id_marker');
  if (versionMarker && !keyMarker) throw invalid('version_id_marker requires key_marker.');
  const all = (versions.get(where) ?? [])
    .filter((v) => v.key.startsWith(prefix))
    .sort(byKeyThenNewest);
  const prefixes = new Set<string>();
  const rows: Version[] = [];
  for (const v of all) {
    const rest = v.key.slice(prefix.length);
    const cut = delimiter ? rest.indexOf(delimiter) : -1;
    if (cut >= 0) prefixes.add(prefix + rest.slice(0, cut + delimiter.length));
    else rows.push(v);
  }
  let start = 0;
  if (keyMarker) {
    const at = rows.findIndex((v) => v.key === keyMarker && v.version_id === versionMarker);
    start = at >= 0 ? at + 1 : rows.findIndex((v) => v.key > keyMarker);
    if (start < 0) start = rows.length;
  }
  const items = rows.slice(start, start + limit);
  const last = items.at(-1);
  return {
    items,
    // Folders come with the first page only, as S3 lists them once.
    common_prefixes: keyMarker ? [] : [...prefixes].sort(),
    ...(start + limit < rows.length && last
      ? { next_key_marker: last.key, next_version_id_marker: last.version_id }
      : {}),
  };
}

/** The current object for a key after a change: its newest version, unless that is a marker. */
function currentOf(where: string, key: string): StoredObject | null {
  const latest = (versions.get(where) ?? []).find((v) => v.key === key && v.is_latest);
  if (!latest || latest.delete_marker) return null;
  return { key, size_bytes: latest.size_bytes, last_modified: latest.last_modified };
}

function promoteNewest(list: Version[], key: string) {
  const rest = list.filter((v) => v.key === key).sort(byKeyThenNewest);
  rest.forEach((v, i) => (v.is_latest = i === 0));
}

/** A signed PUT landed. With versioning on it adds a version; otherwise it replaces `null`. */
export function recordWrite(where: string, bucket: BucketRef, object: StoredObject) {
  const status = versioningStatus(bucket);
  const list = (versions.get(where) ?? []).filter(
    (v) => !(v.key === object.key && status !== 'Enabled' && v.version_id === 'null')
  );
  for (const v of list) if (v.key === object.key) v.is_latest = false;
  list.push({
    ...object,
    version_id: status === 'Enabled' ? randomUUID() : 'null',
    is_latest: true,
    delete_marker: false,
  });
  versions.set(where, list);
}

/** An ordinary delete. Versioned buckets get a marker and keep their data. */
export function recordDelete(where: string, bucket: BucketRef, key: string) {
  const status = versioningStatus(bucket);
  let list = versions.get(where) ?? [];
  if (!status) list = list.filter((v) => v.key !== key);
  else {
    if (status === 'Suspended')
      list = list.filter((v) => !(v.key === key && v.version_id === 'null'));
    for (const v of list) if (v.key === key) v.is_latest = false;
    list.push({
      key,
      version_id: status === 'Enabled' ? randomUUID() : 'null',
      is_latest: true,
      delete_marker: true,
      size_bytes: 0,
      last_modified: now(),
    });
  }
  versions.set(where, list);
}

/** Permanent deletion of one version or marker; returns what the key's current object is now. */
export function deleteVersion(where: string, key: string, versionId: string) {
  if (!key || !versionId) throw invalid('key and version_id are required.');
  const list = versions.get(where) ?? [];
  const found = list.find((v) => v.key === key && v.version_id === versionId);
  // A retry after removal answers 200 with delete_marker false, as apid does.
  if (!found)
    return {
      result: { version_id: versionId, delete_marker: false },
      current: currentOf(where, key),
    };
  const next = list.filter((v) => v !== found);
  promoteNewest(next, key);
  versions.set(where, next);
  return {
    result: { version_id: versionId, delete_marker: found.delete_marker },
    current: currentOf(where, key),
  };
}

export function findVersion(where: string, key: string, versionId: string) {
  return (versions.get(where) ?? []).find((v) => v.key === key && v.version_id === versionId);
}

export function holdsVersions(where: string) {
  return (versions.get(where) ?? []).length > 0;
}

/* ------------------------------------------------------------------ *
 * Lifecycle rules (faas pkg/api/object_lifecycle.go): the policy is replaced
 * as a unit; DELETE clears the rules and keeps the revision counting.
 * ------------------------------------------------------------------ */

type Lifecycle = S['ObjectBucketLifecycle'];
const lifecycles = new Map<string, Lifecycle>();

export function readLifecycle(bucket: BucketRef): Lifecycle {
  if (!lifecycles.has(bucket.id))
    lifecycles.set(
      bucket.id,
      bucket.name === 'assets'
        ? {
            bucket_id: bucket.id,
            revision: 1,
            rules: [
              {
                id: 'expire-tmp',
                status: 'Enabled',
                filter: { prefix: 'tmp/' },
                expiration: { days: 7 },
              },
              { id: 'abort-uploads', status: 'Enabled', abort_incomplete_multipart_days: 3 },
            ],
            updated_at: bucket.created_at ?? now(),
          }
        : { bucket_id: bucket.id, revision: 0, rules: [], updated_at: bucket.created_at ?? now() }
    );
  return lifecycles.get(bucket.id)!;
}

function validRule(rule: S['ObjectLifecycleRule']) {
  const e = rule.expiration;
  const actions = [e, rule.noncurrent_version_expiration, rule.abort_incomplete_multipart_days];
  if (rule.status !== 'Enabled' && rule.status !== 'Disabled') return false;
  if (!actions.some((a) => a !== undefined && a !== null)) return false;
  if (e && Object.keys(e).length !== 1) return false;
  if (e?.date && !/T00:00:00(\.0+)?Z$/.test(e.date)) return false;
  const tagged = Object.keys(rule.filter?.tags ?? {}).length > 0;
  return !(tagged && (rule.abort_incomplete_multipart_days || e?.expired_object_delete_marker));
}

export function writeLifecycle(bucket: BucketRef, body: Record<string, unknown>): Lifecycle {
  const rules = body.rules as S['ObjectLifecycleRule'][] | undefined;
  if (!Array.isArray(rules) || rules.length === 0 || rules.length > 1000)
    throw invalid('rules must hold one to a thousand rules; clear the policy with DELETE.');
  if (!rules.every(validRule)) throw invalid('Invalid object storage request.');
  const named = rules.map((r, i) => ({
    ...r,
    id: r.id || `rule-${i + 1}-${randomUUID().slice(0, 8)}`,
  }));
  if (new Set(named.map((r) => r.id)).size !== named.length)
    throw invalid('Rule IDs must be unique.');
  const next = { ...readLifecycle(bucket), rules: named, updated_at: now() };
  next.revision += 1;
  lifecycles.set(bucket.id, next);
  return next;
}

export function clearLifecycle(bucket: BucketRef): Lifecycle {
  const before = readLifecycle(bucket);
  const next = { ...before, rules: [], revision: before.revision + 1, updated_at: now() };
  lifecycles.set(bucket.id, next);
  return next;
}
