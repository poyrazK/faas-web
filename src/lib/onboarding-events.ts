import { track } from '@vercel/analytics';
import { featureFlags } from './feature-flags';
import { onboardingKey, type OnboardingOwner } from './onboarding-draft';

type Event =
  | 'start'
  | 'path_selected'
  | 'deployment_requested'
  | 'deployment_live'
  | 'deployment_failed'
  | 'endpoint_opened'
  | 'setup_dismissed';
type Source = 'sample' | 'git' | 'existing';
const sent = new Set<string>();

/** Coarse events only. Resource/account identifiers remain local deduplication keys. */
export function onboardingEvent(
  event: Event,
  details: { source?: Source; plan?: string } = {},
  once?: { owner: OnboardingOwner; app?: string; deployment?: string }
) {
  if (!import.meta.env.PROD || !featureFlags.onboardingV2) return;
  const key = once
    ? `${onboardingKey(once.owner)}.event.${event}.${once.app ?? ''}.${once.deployment ?? ''}`
    : undefined;
  if (key) {
    if (sent.has(key)) return;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, '1');
    } catch {
      /* Session-level deduplication still works without storage. */
    }
    sent.add(key);
  }
  try {
    track(`onboarding_${event}`, {
      ...(details.source && ['sample', 'git', 'existing'].includes(details.source)
        ? { source: details.source }
        : {}),
      ...(details.plan && ['free', 'hobby', 'pro', 'scale', 'unknown'].includes(details.plan)
        ? { plan: details.plan }
        : {}),
    });
  } catch {
    /* Analytics never blocks deployment or recovery. */
  }
}
