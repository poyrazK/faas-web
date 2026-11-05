import { expect, it } from 'vitest';
import { onboardingProgress } from './onboarding-progress';
const draft = {
  kind: 'existing' as const,
  app: 'hello-app',
  deployment: 'a'.repeat(32),
  phase: 'accepted' as const,
};
it('never counts creation, accepted or unknown submissions as a live deployment', () => {
  expect(
    onboardingProgress({ draft: { ...draft, deployment: undefined, phase: 'submitting' } })
  ).toBe('unknown');
  expect(
    onboardingProgress({
      draft,
      app: { id: 'app-1' },
      deployment: { app_id: 'app-1', status: 'building' },
    })
  ).toBe('deploying');
  expect(
    onboardingProgress({
      draft: { ...draft, phase: 'unknown' },
      app: { id: 'app-1' },
      deployment: { app_id: 'app-1', status: 'live' },
    })
  ).toBe('unknown');
});
it('requires a matching deployment and gives failed reads precedence over cached live state', () => {
  const input = { draft, app: { id: 'app-1' }, deployment: { app_id: 'app-1', status: 'live' } };
  expect(onboardingProgress(input)).toBe('live');
  expect(onboardingProgress({ ...input, error: new Error('offline') })).toBe('unavailable');
  expect(onboardingProgress({ ...input, deployment: { app_id: 'app-2', status: 'live' } })).toBe(
    'mismatch'
  );
});
