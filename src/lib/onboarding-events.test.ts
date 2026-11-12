import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ track: vi.fn(), flags: { onboardingV2: true } }));
vi.mock('@vercel/analytics', () => ({ track: mocks.track }));
vi.mock('./feature-flags', () => ({ featureFlags: mocks.flags }));
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  localStorage.clear();
  mocks.flags.onboardingV2 = true;
  vi.stubEnv('PROD', true);
});
it('sends only approved coarse fields and keeps account, repo and endpoint identifiers local', async () => {
  const { onboardingEvent } = await import('./onboarding-events');
  onboardingEvent(
    'deployment_live',
    { source: 'sample', plan: 'free' },
    {
      owner: { account: 'private-account', workspace: 'private-company' },
      app: 'private-app',
      deployment: 'private-id',
    }
  );
  expect(mocks.track).toHaveBeenCalledExactlyOnceWith('onboarding_deployment_live', {
    source: 'sample',
    plan: 'free',
  });
});
it('deduplicates a completion across remounts and reloads for the same actor/app/attempt', async () => {
  const receipt = {
    owner: { account: 'actor', workspace: null },
    app: 'hello-test',
    deployment: 'a'.repeat(32),
  };
  const { onboardingEvent } = await import('./onboarding-events');
  onboardingEvent('deployment_live', {}, receipt);
  onboardingEvent('deployment_live', {}, receipt);
  vi.resetModules();
  (await import('./onboarding-events')).onboardingEvent('deployment_live', {}, receipt);
  expect(mocks.track).toHaveBeenCalledOnce();
});
it('does not send custom events when the feature is disabled', async () => {
  mocks.flags.onboardingV2 = false;
  (await import('./onboarding-events')).onboardingEvent('start');
  expect(mocks.track).not.toHaveBeenCalled();
});
it('does not let analytics failure affect deployment', async () => {
  mocks.track.mockImplementationOnce(() => {
    throw new Error('unavailable');
  });
  const { onboardingEvent } = await import('./onboarding-events');
  expect(() => onboardingEvent('deployment_requested', { source: 'git' })).not.toThrow();
});

afterEach(() => vi.unstubAllEnvs());
