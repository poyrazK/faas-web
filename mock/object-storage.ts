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
const SEEDED_VERSIONED = new Set(['assets', 'user-uploads']);
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
    // The seeded buckets keep versions (`user-uploads` is under Object Lock,
    // which needs them); every bucket made in the console starts off.
    const on = SEEDED_VERSIONED.has(bucket.name);
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
  // The signed contract under Object Lock carries a legal hold and governance retention.
  const contract = list.find((v) => v.key === SEEDED_HOLD_KEY && bucket.name === 'user-uploads');
  if (contract)
    protections.set(`${where}/${contract.key}/${contract.version_id}`, {
      legal_hold: 'ON',
      retention: {
        mode: 'GOVERNANCE',
        retain_until_date: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      },
    });
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
  if (versionProtected(where, key, versionId))
    throw conflict('This version is protected by retention or a legal hold.');
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

/* ------------------------------------------------------------------ *
 * CORS (faas pkg/apid/object/bucket_cors.go): the rule set is replaced as a
 * unit; DELETE leaves only the console's own origins allowed.
 * ------------------------------------------------------------------ */

type Cors = S['ObjectBucketCORS'];
const corsRules = new Map<string, Cors>();

export function readCors(bucket: BucketRef): Cors {
  return (
    corsRules.get(bucket.id) ?? {
      bucket_id: bucket.id,
      rules: [],
      revision: 0,
      updated_at: bucket.created_at ?? now(),
    }
  );
}

export function writeCors(bucket: BucketRef, body: Record<string, unknown>): Cors {
  const rules = body.rules as S['ObjectBucketCORSRule'][] | undefined;
  const valid =
    Array.isArray(rules) &&
    rules.length >= 1 &&
    rules.length <= 100 &&
    rules.every(
      (r) =>
        Array.isArray(r.allowed_origins) &&
        r.allowed_origins.length > 0 &&
        r.allowed_origins.every((o) => o === '*' || /^https?:\/\/[^/?#\s]+$/.test(o)) &&
        Array.isArray(r.allowed_methods) &&
        r.allowed_methods.length > 0
    );
  if (!valid) throw invalid('Invalid object storage request.');
  const next = { ...readCors(bucket), rules: rules!, updated_at: now() };
  next.revision += 1;
  corsRules.set(bucket.id, next);
  return next;
}

export function clearCors(bucket: BucketRef) {
  const before = readCors(bucket);
  corsRules.set(bucket.id, { ...before, rules: [], updated_at: now() });
}

/* ------------------------------------------------------------------ *
 * Object tags (faas pkg/apid/object/tagging.go): the whole set is replaced
 * in place, and no version is written.
 * ------------------------------------------------------------------ */

const tags = new Map<string, Record<string, string>>();

function taggable(where: string, key: string) {
  if (!currentOf(where, key))
    throw new StorageRefusal(404, 'object_storage_not_found', 'Bucket or object not found.');
}

export function readTags(where: string, key: string): S['ObjectTaggingResult'] {
  taggable(where, key);
  return { tags: tags.get(`${where}/${key}`) ?? (key === 'robots.txt' ? { team: 'web' } : {}) };
}

export function writeTags(
  where: string,
  key: string,
  body: Record<string, unknown>
): S['ObjectTaggingResult'] {
  taggable(where, key);
  const next = body.tags as Record<string, string> | undefined;
  if (!next || typeof next !== 'object' || Object.keys(next).length > 10)
    throw invalid('tags must be an object of at most ten entries.');
  tags.set(`${where}/${key}`, { ...next });
  return { tags: { ...next } };
}

export function clearTags(where: string, key: string): S['ObjectTaggingResult'] {
  taggable(where, key);
  tags.set(`${where}/${key}`, {});
  return { tags: {} };
}

/* ------------------------------------------------------------------ *
 * Default encryption (faas pkg/apid/object/bucket_encryption.go). A new
 * default is verified before it applies; the mock verifies it in ~6 s.
 * ------------------------------------------------------------------ */

type Encryption = S['ObjectEncryption'];
interface EncryptionRecord {
  active?: Encryption;
  desired?: Encryption;
  revision: number;
  requestedAt?: number;
  updatedAt: string;
}
const encryption = new Map<string, EncryptionRecord>();
export const MOCK_KMS_KEY = 'arn:gregale:kms:us-east-1:mock:key/app-data';

export function encryptionCapabilities(): S['ObjectEncryptionCapabilities'] {
  return { algorithms: ['AES256', 'aws:kms'], key_ids: [MOCK_KMS_KEY], bucket_defaults: true };
}

function encryptionRecord(bucket: BucketRef) {
  let r = encryption.get(bucket.id);
  if (!r) {
    r = {
      revision: bucket.name === 'user-uploads' ? 1 : 0,
      active: bucket.name === 'user-uploads' ? { algorithm: 'AES256' } : undefined,
      updatedAt: bucket.created_at ?? now(),
    };
    encryption.set(bucket.id, r);
  }
  if (r.requestedAt !== undefined && Date.now() - r.requestedAt >= 2 * STEP_MS) {
    r.active = r.desired;
    r.desired = undefined;
    r.requestedAt = undefined;
  }
  return r;
}

export function readEncryption(bucket: BucketRef): S['ObjectBucketEncryption'] {
  const r = encryptionRecord(bucket);
  const age = r.requestedAt === undefined ? Infinity : Date.now() - r.requestedAt;
  return {
    bucket_id: bucket.id,
    state: age < STEP_MS ? 'waiting' : age < 2 * STEP_MS ? 'applying' : 'ready',
    revision: r.revision,
    ...(r.active ? { encryption: r.active } : {}),
    ...(r.requestedAt !== undefined && r.desired ? { desired_encryption: r.desired } : {}),
    updated_at: r.updatedAt,
  };
}

export function requestEncryption(bucket: BucketRef, next: Encryption | undefined) {
  const r = encryptionRecord(bucket);
  if (r.requestedAt !== undefined)
    throw conflict('Another encryption change is still being applied.');
  if (next) {
    const caps = encryptionCapabilities();
    const kms = next.algorithm !== 'AES256';
    if (
      !caps.algorithms.includes(next.algorithm) ||
      (kms ? !caps.key_ids.includes(next.key_id ?? '') : next.key_id)
    )
      throw invalid('Choose an enrolled algorithm, and an enrolled key for KMS.');
    if (next.bucket_key_enabled && next.algorithm !== 'aws:kms')
      throw invalid('Bucket keys apply only to aws:kms.');
  }
  r.desired = next;
  r.revision += 1;
  r.requestedAt = Date.now();
  r.updatedAt = now();
  return readEncryption(bucket);
}

/* ------------------------------------------------------------------ *
 * Object Lock (faas pkg/apid/object/bucket_object_lock.go). Enabling is
 * permanent and needs versioning, which the request turns on.
 * ------------------------------------------------------------------ */

type LockConfiguration = S['ObjectBucketObjectLockConfiguration'];
interface LockRecord {
  observed?: LockConfiguration;
  desired?: LockConfiguration;
  required: boolean;
  revision: number;
  requestedAt?: number;
  updatedAt: string;
}
const locks = new Map<string, LockRecord>();
const SEEDED_HOLD_KEY = 'contracts/msa-2026.pdf';

export function lockCapabilities(): S['ObjectLockCapabilities'] {
  return {
    bucket_configuration: true,
    default_event_hold: true,
    version_event_hold: true,
    write_event_hold: false,
    version_retention: true,
    version_legal_hold: true,
  };
}

function lockRecord(bucket: BucketRef) {
  let r = locks.get(bucket.id);
  if (!r) {
    const on = bucket.name === 'user-uploads';
    const seeded: LockConfiguration = {
      enabled: true,
      default_retention: { mode: 'GOVERNANCE', days: 30 },
    };
    r = {
      required: on,
      revision: on ? 1 : 0,
      ...(on ? { observed: seeded, desired: seeded } : {}),
      updatedAt: bucket.created_at ?? now(),
    };
    locks.set(bucket.id, r);
  }
  if (r.requestedAt !== undefined && Date.now() - r.requestedAt >= 3 * STEP_MS) {
    r.observed = r.desired;
    r.requestedAt = undefined;
  }
  return r;
}

export function lockOn(bucket: BucketRef) {
  return lockRecord(bucket).required;
}

export function readLock(bucket: BucketRef): S['ObjectBucketObjectLock'] {
  const r = lockRecord(bucket);
  const age = r.requestedAt === undefined ? Infinity : Date.now() - r.requestedAt;
  return {
    bucket_id: bucket.id,
    state: age < STEP_MS ? 'waiting' : age < 3 * STEP_MS ? 'applying' : 'ready',
    revision: r.revision,
    enabled_required: r.required,
    observed_known: true,
    observed_configuration: r.observed ?? { enabled: false },
    ...(r.desired ? { desired_configuration: r.desired } : {}),
    ...(age < STEP_MS && versioningStatus(bucket) !== 'Enabled'
      ? { last_error_code: 'versioning_pending' as const }
      : {}),
    updated_at: r.updatedAt,
  };
}

export function requestLock(bucket: BucketRef, body: Record<string, unknown>) {
  const configuration = body.configuration as LockConfiguration | undefined;
  if (!configuration || configuration.enabled !== true)
    throw invalid('configuration.enabled must be true; Object Lock cannot be turned off.');
  const r = lockRecord(bucket);
  const same = JSON.stringify(r.desired) === JSON.stringify(configuration);
  if (r.requestedAt !== undefined) {
    if (same) return readLock(bucket);
    throw conflict('Another Object Lock change is still running.');
  }
  if (versioningStatus(bucket) !== 'Enabled') requestVersioning(bucket, 'Enabled', false);
  r.required = true;
  r.desired = configuration;
  r.revision += 1;
  r.requestedAt = Date.now();
  r.updatedAt = now();
  return readLock(bucket);
}

/* ------------------------------------------------------------------ *
 * Version protection (faas pkg/apid/object/version_protection.go). Each
 * change is an operation a worker applies; here it applies after ~3 s.
 * ------------------------------------------------------------------ */

interface Protection {
  legal_hold: 'ON' | 'OFF';
  retention: S['ObjectVersionRetention'];
}
const protections = new Map<string, Protection>();
const operations = new Map<
  string,
  { op: S['ObjectVersionProtection']; at: number; where: string }
>();

function settleOperations() {
  for (const entry of operations.values()) {
    const { op, at, where } = entry;
    if (op.state === 'ready' || Date.now() - at < STEP_MS) continue;
    const id = `${where}/${op.key}/${op.version_id}`;
    const p = protections.get(id) ?? { legal_hold: 'OFF', retention: {} };
    if (op.legal_hold) p.legal_hold = op.legal_hold.status;
    if (op.retention) p.retention = { ...p.retention, ...op.retention };
    if (op.retention && Object.keys(op.retention).length === 0) p.retention = {};
    protections.set(id, p);
    op.state = 'ready';
    op.updated_at = now();
  }
}

function protection(where: string, key: string, version: string): Protection {
  settleOperations();
  return protections.get(`${where}/${key}/${version}`) ?? { legal_hold: 'OFF', retention: {} };
}

export function versionProtected(where: string, key: string, version: string) {
  const p = protection(where, key, version);
  const until = p.retention.retain_until_date ? Date.parse(p.retention.retain_until_date) : 0;
  return p.legal_hold === 'ON' || p.retention.event_hold === 'ON' || until > Date.now();
}

function owned(where: string, key: string, version: string) {
  if (!findVersion(where, key, version))
    throw new StorageRefusal(404, 'object_storage_not_found', 'Bucket or object not found.');
}

export function readLegalHold(
  where: string,
  key: string,
  version: string
): S['ObjectVersionLegalHoldResult'] {
  owned(where, key, version);
  return {
    version_id: version,
    legal_hold: { status: protection(where, key, version).legal_hold },
  };
}

export function readRetention(
  where: string,
  key: string,
  version: string
): S['ObjectVersionRetentionResult'] {
  owned(where, key, version);
  return { version_id: version, retention: protection(where, key, version).retention };
}

function accept(
  where: string,
  bucket: BucketRef,
  op: Omit<S['ObjectVersionProtection'], 'bucket_id' | 'state' | 'created_at' | 'updated_at'>
) {
  const existing = operations.get(op.id);
  if (existing) return existing.op;
  const full: S['ObjectVersionProtection'] = {
    ...op,
    bucket_id: bucket.id,
    state: 'waiting',
    created_at: now(),
    updated_at: now(),
  };
  operations.set(op.id, { op: full, at: Date.now(), where });
  return full;
}

export function requestLegalHold(
  where: string,
  bucket: BucketRef,
  key: string,
  version: string,
  body: Record<string, unknown>
) {
  owned(where, key, version);
  if (!lockOn(bucket)) throw conflict('Turn on Object Lock for this bucket first.');
  const hold = body.legal_hold as { status?: string } | undefined;
  if (typeof body.id !== 'string' || (hold?.status !== 'ON' && hold?.status !== 'OFF'))
    throw invalid('id and legal_hold.status (ON or OFF) are required.');
  return accept(where, bucket, {
    id: body.id,
    key,
    version_id: version,
    kind: 'legal_hold',
    legal_hold: { status: hold.status },
  });
}

export function requestRetention(
  where: string,
  bucket: BucketRef,
  key: string,
  version: string,
  body: Record<string, unknown>
) {
  owned(where, key, version);
  if (!lockOn(bucket)) throw conflict('Turn on Object Lock for this bucket first.');
  const next = body.retention as S['ObjectVersionRetention'] | undefined;
  if (typeof body.id !== 'string' || !next || typeof next !== 'object')
    throw invalid('id and retention are required.');
  const current = protection(where, key, version).retention;
  const until = current.retain_until_date ? Date.parse(current.retain_until_date) : 0;
  const active = current.event_hold === 'ON' || until > Date.now();
  if (active && next.event_hold === undefined) {
    if (!next.retain_until_date || Date.parse(next.retain_until_date) < until)
      throw conflict('Active retention cannot be shortened or cleared.');
    if (current.mode === 'COMPLIANCE' && next.mode === 'GOVERNANCE')
      throw conflict('Compliance retention cannot be changed to governance.');
  }
  if (next.event_hold === 'ON' && !next.event_hold_duration)
    throw invalid('An event hold needs a days or years duration.');
  return accept(where, bucket, {
    id: body.id,
    key,
    version_id: version,
    kind: 'retention',
    retention: next,
  });
}

export function readOperation(bucket: BucketRef, id: string): S['ObjectVersionProtection'] {
  settleOperations();
  const entry = operations.get(id);
  if (!entry || entry.op.bucket_id !== bucket.id)
    throw new StorageRefusal(404, 'object_storage_not_found', 'Bucket or object not found.');
  const age = Date.now() - entry.at;
  return entry.op.state === 'ready'
    ? entry.op
    : { ...entry.op, state: age < STEP_MS / 2 ? 'waiting' : 'applying' };
}

/* ------------------------------------------------------------------ *
 * Multipart uploads (faas pkg/apid/object/storage_multipart.go). The mock's
 * single-upload limit is small so a few-MiB file shows the parts flow.
 * ------------------------------------------------------------------ */

export const MOCK_SINGLE_PUT_BYTES = 16 * 1024 ** 2;
export const MOCK_PART_BYTES = 8 * 1024 ** 2;
type Session = S['ObjectMultipartUpload'] & {
  where: string;
  parts: Map<number, S['ObjectMultipartPart']>;
};
const sessions = new Map<string, Session>();
const view = ({ where: _w, parts: _p, ...session }: Session): S['ObjectMultipartUpload'] => session;

function session(where: string, id: string) {
  const s = sessions.get(id);
  if (!s || s.where !== where)
    throw new StorageRefusal(404, 'object_storage_not_found', 'Bucket or object not found.');
  if (s.state === 'active' && Date.parse(s.expires_at) < Date.now()) s.state = 'aborted';
  return s;
}

export function listSessions(where: string): S['ObjectMultipartUploadList'] {
  return {
    items: [...sessions.values()]
      .filter((s) => s.where === where)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map(view),
  };
}

export function startSession(where: string, body: Record<string, unknown>, maxBytes: number) {
  const key = String(body.key ?? '');
  const size = Number(body.size_bytes);
  const contentType = String(body.content_type ?? 'application/octet-stream');
  if (!key || !Number.isInteger(size) || size < 1)
    throw invalid('key and size_bytes are required.');
  if (size > maxBytes)
    throw new StorageRefusal(
      409,
      'object_storage_capacity_reserved',
      'The upload is larger than the object size limit.'
    );
  // The same live key, size and content type resumes the existing session.
  const live = [...sessions.values()].find(
    (s) =>
      s.where === where &&
      s.state === 'active' &&
      s.key === key &&
      s.size_bytes === size &&
      s.content_type === contentType
  );
  if (live) return { status: 200, body: view(live) };
  const created: Session = {
    id: randomUUID(),
    key,
    size_bytes: size,
    part_size_bytes: MOCK_PART_BYTES,
    part_count: Math.ceil(size / MOCK_PART_BYTES),
    content_type: contentType,
    state: 'active',
    expires_at: new Date(Date.now() + 24 * 3_600_000).toISOString(),
    created_at: now(),
    where,
    parts: new Map(),
  };
  sessions.set(created.id, created);
  return { status: 201, body: view(created) };
}

export function readSession(where: string, id: string) {
  return view(session(where, id));
}

export function sessionParts(where: string, id: string): S['ObjectMultipartPartList'] {
  const s = session(where, id);
  return { items: [...s.parts.values()].sort((a, b) => a.part_number - b.part_number) };
}

/** Bytes the signed URL for part `n` must carry. */
export function partSize(where: string, id: string, part: number) {
  const s = session(where, id);
  if (s.state !== 'active') throw conflict('The upload is not taking parts.');
  if (!Number.isInteger(part) || part < 1 || part > s.part_count) throw invalid('No such part.');
  return part === s.part_count
    ? s.size_bytes - (s.part_count - 1) * s.part_size_bytes
    : s.part_size_bytes;
}

export function recordPart(where: string, id: string, part: number, bytes: number, etag: string) {
  const s = session(where, id);
  s.parts.set(part, { part_number: part, etag, size_bytes: bytes, last_modified: now() });
}

export function completeSession(where: string, id: string, body: Record<string, unknown>) {
  const s = session(where, id);
  if (s.state === 'aborted') throw conflict('The upload was aborted.');
  const parts = body.parts as { part_number: number; etag: string }[] | undefined;
  const ok =
    Array.isArray(parts) &&
    parts.length === s.part_count &&
    parts.every((p, i) => p.part_number === i + 1 && s.parts.get(p.part_number)?.etag === p.etag);
  if (!ok) throw invalid('Supply one confirmed ETag for every part, in order.');
  s.state = 'completed';
  s.etag = `"${randomUUID().replace(/-/g, '')}-${s.part_count}"`;
  return {
    session: view(s),
    object: { key: s.key, size_bytes: s.size_bytes, last_modified: now() },
  };
}

export function abortSession(where: string, id: string) {
  const s = session(where, id);
  if (s.state === 'completed') throw conflict('The upload already completed.');
  s.state = 'aborted';
}

/* ------------------------------------------------------------------ *
 * Upload routes (faas pkg/apid/object/storage.go): POST creates or updates
 * by name; DELETE stops new uploads and keeps stored objects.
 * ------------------------------------------------------------------ */

const routes = new Map<string, S['ObjectUploadRoute'][]>();

export function listRoutes(slug: string, seedBucket?: BucketRef): S['ObjectUploadRouteList'] {
  if (!routes.has(slug))
    routes.set(
      slug,
      seedBucket
        ? [
            {
              id: randomUUID(),
              name: 'avatar',
              bucket_id: seedBucket.id,
              key_prefix: 'avatars',
              max_bytes: 5 * 1024 ** 2,
              allowed_content_types: ['image/*'],
              enabled: true,
              created_at: seedBucket.created_at ?? now(),
              updated_at: seedBucket.created_at ?? now(),
            },
          ]
        : []
    );
  return { items: routes.get(slug)! };
}

export function saveRoute(slug: string, body: Record<string, unknown>) {
  const name = String(body.name ?? '');
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(name)) throw invalid('Invalid object storage request.');
  const list = listRoutes(slug).items;
  const existing = list.find((r) => r.name === name);
  const route: S['ObjectUploadRoute'] = {
    id: existing?.id ?? randomUUID(),
    name,
    bucket_id: String(body.bucket_id ?? ''),
    ...(body.key_prefix ? { key_prefix: String(body.key_prefix) } : {}),
    max_bytes: Number(body.max_bytes ?? 100 * 1024 ** 2),
    ...(Array.isArray(body.allowed_content_types)
      ? { allowed_content_types: body.allowed_content_types as string[] }
      : {}),
    enabled: body.enabled !== false,
    ...(body.encryption ? { encryption: body.encryption as S['ObjectEncryption'] } : {}),
    created_at: existing?.created_at ?? now(),
    updated_at: now(),
  };
  routes.set(slug, [...list.filter((r) => r.name !== name), route]);
  return { status: existing ? 200 : 201, body: route };
}

export function deleteRoute(slug: string, name: string) {
  const list = listRoutes(slug).items;
  if (!list.some((r) => r.name === name))
    throw new StorageRefusal(404, 'object_storage_not_found', 'Bucket or object not found.');
  routes.set(
    slug,
    list.filter((r) => r.name !== name)
  );
}

/* ------------------------------------------------------------------ *
 * Notifications (faas pkg/apid/object/notifications.go): a full replacement
 * clears compute-trigger ownership; DELETE keeps the revision counting.
 * ------------------------------------------------------------------ */

type Notifications = S['ObjectBucketNotifications'];
const notifications = new Map<string, Notifications>();
const ARN =
  /^arn:gregale:(lambda:[^:\s]+:[^:\s]+:function:[0-9a-f-]{36}|sqs:[^:\s]+:[^:\s]+:[0-9a-f-]{36}\/\S+)$/;

/** apid's ARNs carry the app's UUID; the mock's seeded ids are bare hex. */
const asUuid = (id: string) =>
  /^[0-9a-f]{32}$/.test(id)
    ? `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`
    : id;

export function readNotifications(bucket: BucketRef, appId: string): Notifications {
  if (!notifications.has(bucket.id)) {
    const seeded = bucket.name === 'assets';
    const managed = `gregale-compute-${randomUUID()}`;
    notifications.set(bucket.id, {
      bucket_id: bucket.id,
      revision: seeded ? 1 : 0,
      ...(seeded ? { managed_rule_ids: [managed] } : {}),
      rules: seeded
        ? [
            {
              id: managed,
              destination: `arn:gregale:lambda:us-east-1:mock:function:${asUuid(appId)}`,
              events: ['s3:ObjectCreated:*'],
              prefix: 'images/',
            },
          ]
        : [],
    });
  }
  return notifications.get(bucket.id)!;
}

export function writeNotifications(
  bucket: BucketRef,
  appId: string,
  rules: S['ObjectNotificationRule'][]
) {
  const before = readNotifications(bucket, appId);
  const valid =
    Array.isArray(rules) &&
    rules.length <= 1000 &&
    rules.every((r) => ARN.test(r.destination) && Array.isArray(r.events) && r.events.length > 0);
  if (!valid)
    throw new StorageRefusal(400, 'validation_failed', 'invalid notification rules or destination');
  const next: Notifications = {
    bucket_id: bucket.id,
    revision: before.revision + 1,
    rules: rules.map((r, i) => ({ ...r, id: r.id || `rule-${before.revision + 1}-${i + 1}` })),
  };
  notifications.set(bucket.id, next);
  return next;
}

/* ------------------------------------------------------------------ *
 * Write receipts (faas pkg/apid/object/write_receipts.go), seeded for the
 * `assets` bucket: one of each status.
 * ------------------------------------------------------------------ */

const receipts = new Map<string, S['ObjectWriteReceipt'][]>();

function receiptsFor(bucket: BucketRef) {
  if (!receipts.has(bucket.id)) {
    const at = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
    const base = { bucket_id: bucket.id, content_type: 'application/octet-stream' };
    receipts.set(
      bucket.id,
      bucket.name === 'assets'
        ? [
            {
              ...base,
              id: randomUUID(),
              key: 'avatars/42.png',
              operation: 'upload',
              bytes: 18_231,
              content_type: 'image/png',
              etag: '',
              status: 'pending',
              created_at: at(0.1),
            },
            {
              ...base,
              id: randomUUID(),
              key: 'exports/2026-11.csv',
              operation: 'put',
              bytes: 902_114,
              etag: '"9b2cf535f27731c974343645a3985328"',
              status: 'completed',
              created_at: at(5),
            },
            {
              ...base,
              id: randomUUID(),
              key: 'images/hero-copy.webp',
              operation: 'copy',
              bytes: 284_331,
              etag: '',
              status: 'failed',
              error_code: 'provider_write_rejected',
              created_at: at(30),
            },
          ]
        : []
    );
  }
  return receipts.get(bucket.id)!;
}

export function listReceipts(
  bucket: BucketRef,
  query: URLSearchParams
): S['ObjectWriteReceiptList'] {
  const status = query.get('status') ?? 'pending';
  if (!['pending', 'completed', 'failed', 'all'].includes(status))
    throw invalid('Invalid object storage request.');
  const limit = Math.max(1, Math.min(100, Number(query.get('limit') ?? 50) || 50));
  const start = Number(query.get('cursor') ?? 0) || 0;
  const all = receiptsFor(bucket).filter((r) => status === 'all' || r.status === status);
  return {
    items: all.slice(start, start + limit),
    ...(start + limit < all.length ? { next_cursor: String(start + limit) } : {}),
  };
}

export function readReceipt(bucket: BucketRef, id: string) {
  const found = receiptsFor(bucket).find((r) => r.id === id);
  if (!found)
    throw new StorageRefusal(404, 'object_storage_not_found', 'Bucket or object not found.');
  return found;
}
