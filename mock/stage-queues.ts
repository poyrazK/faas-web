import { createHash } from 'node:crypto';
import type { components } from '../src/lib/api/schema';
import { stageQueuePayload } from '../src/lib/stage-queue';

type Response = components['schemas']['ProjectEnvironmentQueueBindingsResponse'];
type Request = components['schemas']['ReplaceProjectEnvironmentQueueBindingsRequest'];
type Key = { project: string; environment: string; workload: string };
const records = new Map<string, Response>();
const id = (key: Key) => `${key.project}:${key.environment}:${key.workload}`;

export function getStageQueueRecord(key: Key): Response | null {
  return records.get(id(key)) ?? null;
}

export function putStageQueueRecord(key: Key, request: Request): Response {
  const before = getStageQueueRecord(key);
  const expected = before?.workload_revision ?? 0;
  if (request.expected_revision !== expected) throw new Error('Stage workload revision changed.');
  if (!Array.isArray(request.bindings)) throw new Error('A complete bindings list is required.');
  const snapshot = before
    ? { kind: 'ready' as const, data: before }
    : { kind: 'uninitialized' as const, workloadRevision: 0 };
  const checked = stageQueuePayload(snapshot, request.bindings);
  const bindings = [...checked.bindings].sort((a, b) => a.name.localeCompare(b.name));
  if (before && JSON.stringify(before.bindings) === JSON.stringify(bindings)) return before;
  const record: Response = {
    environment: key.environment,
    workload: key.workload,
    workload_revision: expected + 1,
    revision: (before?.revision ?? 0) + 1,
    config_hash: createHash('sha256').update(JSON.stringify(bindings)).digest('hex'),
    activation_state: 'unavailable',
    bindings,
  };
  records.set(id(key), record);
  return record;
}
