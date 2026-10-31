import { describe, expect, it } from 'vitest';
import {
  configChangeNote,
  guardHeadline,
  planRollback,
  revisionChange,
  rollbackSummary,
  type ConfigGuard,
  type ConfigRevision,
  type ConfigRevisionDetail,
} from './config-history';

const revision = (over: Partial<ConfigRevision>): ConfigRevision => ({
  revision: 1,
  scope: 'default',
  source: 'env.set',
  actor: 'ada@example.com',
  created_at: '2026-10-30T10:00:00Z',
  variable_count: 0,
  secret_count: 0,
  ...over,
});

const detail = (
  n: number,
  variables: Record<string, string>,
  secret_versions: Record<string, number> = {}
): ConfigRevisionDetail => ({
  ...revision({ revision: n }),
  variables,
  secret_versions,
});

const guard = (over: Partial<ConfigGuard>): ConfigGuard => ({
  id: 'g-1',
  scope: 'default',
  status: 'watching',
  base_revision: 4,
  head_revision: 5,
  restorable: true,
  opened_at: '2026-10-30T10:00:00Z',
  last_change_at: '2026-10-30T10:00:00Z',
  ...over,
});

describe('revisionChange', () => {
  it('names the key and what happened to it', () => {
    expect(revisionChange(revision({ source: 'env.set', key: 'LOG_LEVEL' }))).toBe('Set LOG_LEVEL');
    expect(revisionChange(revision({ source: 'env.delete', key: 'LOG_LEVEL' }))).toBe(
      'Deleted LOG_LEVEL'
    );
    expect(revisionChange(revision({ source: 'secret.set', key: 'DB_URL' }))).toBe(
      'Set secret DB_URL'
    );
    expect(revisionChange(revision({ source: 'secret.rotate', key: 'DB_URL' }))).toBe(
      'Rotated secret DB_URL'
    );
  });

  it('points rollbacks and guard restores at the revision they restored', () => {
    expect(revisionChange(revision({ source: 'config.rollback', restored_revision: 3 }))).toBe(
      'Rolled back to revision 3'
    );
    expect(revisionChange(revision({ source: 'config.guard_restore', restored_revision: 2 }))).toBe(
      'Config guard restored revision 2'
    );
    expect(revisionChange(revision({ source: 'baseline' }))).toBe('Config before the next change');
  });
});

describe('guardHeadline', () => {
  it('says whether a watching guard is still waiting for traffic', () => {
    expect(guardHeadline(guard({}))).toMatch(/waiting for the first request/i);
    expect(guardHeadline(guard({ window_ends_at: '2026-10-30T10:10:00Z' }))).toMatch(
      /judging traffic/i
    );
  });

  it('carries the decision summary of a closed guard', () => {
    const restored = guard({
      status: 'restored',
      decision: {
        rule: 'fail_first_wake_5xx',
        summary: '7 of 9 requests failed',
        new_requests: 9,
        new_server_errors: 7,
        old_requests: 100,
        old_server_errors: 0,
      },
    });
    expect(guardHeadline(restored)).toBe(
      'The new values failed, so the guard restored revision 4: 7 of 9 requests failed.'
    );
    expect(guardHeadline(guard({ status: 'regressed', decision: restored.decision }))).toMatch(
      /left the config as it is: 7 of 9 requests failed\./
    );
    expect(guardHeadline(guard({ status: 'clean' }))).toMatch(/passed/);
  });
});

describe('configChangeNote', () => {
  it('is empty when the write recorded nothing', () => {
    expect(configChangeNote(undefined)).toBeUndefined();
  });

  it('names the revision and the guard window', () => {
    expect(configChangeNote({ revision: 7 })).toBe('Recorded as config revision 7.');
    expect(
      configChangeNote({
        revision: 7,
        guard: { id: 'g', status: 'watching', base_revision: 6, window_minutes: 10 },
      })
    ).toBe(
      'Config revision 7. The config guard watches the first 10 minutes of traffic with the new values and restores revision 6 if the app starts failing.'
    );
  });
});

describe('planRollback', () => {
  it('sets keys whose value differs, deletes keys the target lacks, and never returns values', () => {
    const target = detail(3, { A: 'one', B: 'two', C: 'three' }, { DB: 1 });
    const newest = detail(5, { A: 'one', B: 'changed', D: 'four' }, { DB: 2 });
    const plan = planRollback(target, newest, ['A', 'B', 'D']);
    expect(plan).toEqual({
      set: ['B', 'C'],
      deleted: ['D'],
      secrets: [{ key: 'DB', target_version: 1, current_version: 2 }],
    });
    expect(JSON.stringify(plan)).not.toMatch(/one|two|three|four|changed/);
  });

  it('deletes a live key the newest revision never recorded', () => {
    const plan = planRollback(detail(1, { A: 'x' }), detail(2, { A: 'x' }), ['A', 'MANUAL']);
    expect(plan.deleted).toEqual(['MANUAL']);
    expect(plan.set).toEqual([]);
  });

  it('reports secrets added or removed since the target', () => {
    const plan = planRollback(detail(1, {}, { OLD: 1 }), detail(2, {}, { NEW: 1 }), []);
    expect(plan.secrets).toEqual([
      { key: 'NEW', target_version: undefined, current_version: 1 },
      { key: 'OLD', target_version: 1, current_version: undefined },
    ]);
  });
});

describe('rollbackSummary', () => {
  it('says what changes, what does not, and that running instances need a restart', () => {
    const text = rollbackSummary(3, {
      set: ['B'],
      deleted: ['D'],
      secrets: [{ key: 'DB', target_version: 1, current_version: 2 }],
    });
    expect(text).toMatch(/Sets B and deletes D/);
    expect(text).toMatch(/Secrets are not restored: DB keeps its current version/);
    expect(text).toMatch(/keep their current values until they restart/);
  });

  it('says when nothing would change', () => {
    expect(rollbackSummary(3, { set: [], deleted: [], secrets: [] })).toMatch(
      /already match revision 3/
    );
  });
});
