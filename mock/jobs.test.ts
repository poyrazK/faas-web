import { describe, expect, it } from 'vitest';
import {
  attemptsFor,
  definitionRefusal,
  jobCaps,
  occurrencePage,
  occurrencesFor,
  runRequestRefusal,
} from './jobs';

const caps = jobCaps('pro');
const job = { command: ['node', 'run.js'] };
const sha = `sha256:${'a'.repeat(64)}`;

describe('definitionRefusal', () => {
  it('accepts a partial definition within the plan', () => {
    expect(
      definitionRefusal(
        {
          image_ref: 'ghcr.io/acme/x:v2',
          command: ['node'],
          env_overrides: { A: '1' },
          ram_mb: 64,
          retry_max: 0,
        },
        caps
      )
    ).toBeUndefined();
  });

  it('refuses what apid refuses, with its codes (handlers_jobs.go:976-1110)', () => {
    expect(definitionRefusal({ ram_mb: 32 }, caps)?.status).toBe(400);
    expect(definitionRefusal({ ram_mb: 4096 }, caps)).toMatchObject({
      status: 403,
      code: 'job_quota_exceeded',
      extra: { limit: 2048, observed: 4096 },
    });
    expect(definitionRefusal({ max_parallelism: 0 }, caps)?.code).toBe('validation_failed');
    expect(definitionRefusal({ image_ref: ' ' }, caps)?.code).toBe('validation_failed');
    expect(
      definitionRefusal(
        {
          failure_rules: {
            version: 1,
            rules: [
              { exit_codes: [65], action: 'retry' },
              { exit_codes: [65], action: 'fail_partition' },
            ],
            unmatched_failure: 'retry',
            uncertain_outcome: 'hold',
          },
        },
        caps
      )?.detail
    ).toMatch(/unique/);
  });
});

describe('runRequestRefusal', () => {
  const now = Date.parse('2026-11-03T10:00:00Z');
  it('counts tasks from a count, inputs or a manifest', () => {
    expect(runRequestRefusal({ tasks: 4 }, job, caps, now)).toEqual({ tasks: 4 });
    expect(
      runRequestRefusal(
        {
          inputs: [
            { input_id: 'a', input_ref: 'r' },
            { input_id: 'b', input_ref: 'r' },
          ],
        },
        job,
        caps,
        now
      )
    ).toEqual({ tasks: 2 });
    expect(
      runRequestRefusal(
        { input_manifest_uri: 'obj://app/b/inputs-12.json', input_manifest_sha256: sha },
        job,
        caps,
        now
      )
    ).toEqual({ tasks: 12 });
  });

  it.each([
    [
      {
        inputs: [
          { input_id: 'a', input_ref: 'r' },
          { input_id: 'a', input_ref: 'r' },
        ],
      },
      400,
    ],
    [{ input_manifest_uri: 'obj://app/b/x.json' }, 400],
    [{ input_manifest_uri: 'obj://app/b/missing.json', input_manifest_sha256: sha }, 404],
    [{ tasks: 1, execution_class: 'flexible' }, 400],
    [
      {
        tasks: 1,
        execution_class: 'flexible',
        latest_start_at: '2026-11-04T11:00:00Z',
      },
      400,
    ],
    [{ tasks: 1, latest_start_at: '2026-11-03T11:00:00Z' }, 400],
    [{ tasks: 1, parallelism: 26 }, 403],
    [{ tasks: 1001 }, 403],
    [{ tasks: 1, env_overrides: { GREGALE_X: '1' } }, 400],
  ])('refuses %j with %i', (body, status) => {
    const result = runRequestRefusal(body, job, caps, now);
    expect('refusal' in result && result.refusal.status).toBe(status);
  });

  it('accepts a flexible window within a day', () => {
    expect(
      runRequestRefusal(
        { tasks: 2, execution_class: 'flexible', latest_start_at: '2026-11-03T14:00:00Z' },
        job,
        caps,
        now
      )
    ).toEqual({ tasks: 2 });
  });

  it('refuses arguments for a job with no executable', () => {
    const result = runRequestRefusal({ tasks: 1, arguments: [] }, { command: [] }, caps, now);
    expect('refusal' in result && result.refusal.detail).toMatch(/executable/);
  });
});

describe('occurrences', () => {
  it('pages newest first by occurrence id, with each recorded decision on the first page', () => {
    const all = occurrencesFor(
      {
        id: 'abcdef12-0000',
        schedule_policy: { version: 1, overlap: 'skip', missed_runs: 'coalesce_latest' },
      },
      ['run-a', 'run-b']
    );
    const first = occurrencePage(all, new URLSearchParams());
    expect(first.occurrences).toHaveLength(50);
    expect(first.occurrences[0]).toMatchObject({ status: 'running', job_run_id: 'run-a' });
    expect(first.occurrences.map((o) => o.status)).toEqual(
      expect.arrayContaining(['skipped_overlap', 'missed_deadline', 'coalesced'])
    );
    const second = occurrencePage(
      all,
      new URLSearchParams({ before: first.next_before!, limit: '50' })
    );
    expect(second.occurrences).toHaveLength(10);
    expect(second.next_before).toBeUndefined();
  });

  it('records only started times without a policy', () => {
    const all = occurrencesFor({ id: 'abcdef12-0000' }, []);
    expect(new Set(all.map((o) => o.status))).toEqual(new Set(['running', 'succeeded']));
  });
});

describe('attemptsFor', () => {
  const task = {
    run_id: 'run',
    task_index: 0,
    attempt: 3,
    created_at: '2026-11-03T10:00:00Z',
  };
  it('lists every finished attempt, earlier ones failed and retried', () => {
    const attempts = attemptsFor({ ...task, status: 'succeeded' });
    expect(attempts.map((a) => [a.attempt, a.status, a.work_decision?.action])).toEqual([
      [1, 'failed', 'retry'],
      [2, 'failed', 'retry'],
      [3, 'succeeded', undefined],
    ]);
  });
  it('leaves out the attempt still running', () => {
    expect(attemptsFor({ ...task, status: 'claimed' })).toHaveLength(2);
  });
});
