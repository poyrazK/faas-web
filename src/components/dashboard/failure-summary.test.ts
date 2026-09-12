import { describe, expect, it } from 'vitest';
import type { components } from '@/lib/api/schema';
import { failureSummary } from './failure-summary';

const deployment: components['schemas']['DeploymentResponse'] = {
  id: 'dep-1',
  app_id: 'app-1',
  status: 'failed',
  kind: 'github',
  image_digest: '',
  created_at: '2026-09-12T00:00:00Z',
  rollback_on_5xx: false,
  first_5xx_count: 0,
};

describe('failureSummary', () => {
  it('prefers structured explanations, filters empty excerpts, and preserves evidence order', () => {
    expect(
      failureSummary({
        deployment: {
          ...deployment,
          error: 'raw error',
          error_why: '  The start command is missing. ',
          error_fix: ' Set the start command. ',
          error_hint: 'less specific',
          error_code: 'start_failed',
          error_relevant_logs: [
            { message: ' ' },
            { source: 'app', message: '<script>not executable</script>' },
            { source: 'vm-init', message: 'exit 1' },
          ],
        },
      })
    ).toEqual({
      cause: 'The start command is missing.',
      nextStep: 'Set the start command.',
      code: 'start_failed',
      evidence: [
        { source: 'app', message: '<script>not executable</script>' },
        { source: 'vm-init', message: 'exit 1' },
      ],
    });
  });
  it('falls back to raw error and hint when structured fields are blank', () => {
    expect(
      failureSummary({
        deployment: {
          ...deployment,
          error_why: ' ',
          error: 'exit 1',
          error_fix: '',
          error_hint: 'Inspect the start command.',
        },
      })
    ).toMatchObject({ cause: 'exit 1', nextStep: 'Inspect the start command.' });
  });
  it.each([
    ['oom', 'The build ran out of memory.'],
    ['timeout', 'The build exceeded its time limit.'],
    ['user_error', 'The build reported an application error.'],
    ['infra', 'The build reported an infrastructure error.'],
  ] as const)('describes build-only %s without inventing a fix', (failure_class, cause) => {
    expect(
      failureSummary({
        build: {
          id: 'b-1',
          deployment_id: '',
          status: 'failed',
          kind: 'github',
          source_bytes: 1,
          enqueued_at: '2026-09-12T00:00:00Z',
          failure_class,
        },
      })
    ).toEqual({
      cause,
      nextStep: 'Review the build output for more detail.',
      code: undefined,
      evidence: [],
    });
  });
  it('does not invent a diagnosis when evidence is absent', () => {
    expect(failureSummary({})).toEqual({
      cause: 'No failure explanation was recorded.',
      nextStep: 'Review the build output for more detail.',
      code: undefined,
      evidence: [],
    });
  });
});
