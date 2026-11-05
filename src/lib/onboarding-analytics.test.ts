import { expect, it } from 'vitest';
import { onboardingAnalyticsPrivacy } from './onboarding-analytics';

it.each([
  '/onboarding',
  '/onboarding/',
  '/Onboarding',
  '/login',
  '/signup',
  '/will-it-run',
  '/dashboard/apps/new',
])('removes repository/recovery and return parameters from SDK event URLs on %s', (path) => {
  for (const type of ['pageview', 'event'] as const) {
    const event = {
      type,
      url: `https://gregale.dev${path}?repo=private/repository&next=%2Fcli-auth%2Fauthorize%3Ftoken%3Dsecret#private-app`,
    };
    expect(onboardingAnalyticsPrivacy(event)).toEqual({
      type,
      url: `https://gregale.dev${path}`,
    });
  }
});
it('preserves ordinary marketing attribution', () => {
  const event = { type: 'pageview' as const, url: 'https://gregale.dev/pricing?utm_source=docs' };
  expect(onboardingAnalyticsPrivacy(event)).toBe(event);
});
it('drops an invalid SDK URL instead of forwarding it', () => {
  expect(onboardingAnalyticsPrivacy({ type: 'event', url: 'invalid' })).toBeNull();
});
